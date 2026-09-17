import type { ProviderConfig } from './providers'

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: ToolCall[]
  tool_call_id?: string
  name?: string
}

export type ToolCall = {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export type ModelInfo = { id: string; gated: boolean }

/** Humanize provider HTTP failures (esp. Cloudflare 1010 vs bad key vs gated model). */
export function formatProviderHttpError(
  kind: string,
  status: number,
  detail: string,
): string {
  const raw = detail || ''
  const lower = raw.toLowerCase()
  if (
    status === 403 &&
    (lower.includes('1010') ||
      lower.includes('browser_signature') ||
      lower.includes('cloudflare') ||
      lower.includes('access denied'))
  ) {
    return (
      `${kind} HTTP 403: Cloudflare blocked this client (Error 1010 / browser signature). ` +
      'Point Featherless at the local cloud proxy (http://127.0.0.1:17332/featherless/v1) ' +
      'instead of calling api.featherless.ai directly from a non-browser client.'
    )
  }
  if (
    status === 401 ||
    lower.includes('unauthorized') ||
    lower.includes('must be signed in') ||
    lower.includes('invalid api key')
  ) {
    return (
      `${kind} HTTP ${status}: Featherless rejected auth. ` +
      'If using the proxy, set FEATHERLESS_API_KEY in abliterated_ui/.env; ' +
      'otherwise paste a valid key in Settings.'
    )
  }
  if (status === 403 && lower.includes('gated')) {
    return `${kind} HTTP 403: ${raw}`
  }
  return `${kind} HTTP ${status}: ${raw || '(no body)'}`
}


function authHeaders(provider: ProviderConfig, extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...extra,
  }
  if (provider.apiKey) {
    headers.Authorization = `Bearer ${provider.apiKey}`
  }
  return headers
}

export async function fetchModels(provider: ProviderConfig): Promise<ModelInfo[]> {
  // Cloud providers need a key; Spark/vLLM usually does not.
  if (provider.requiresApiKey && !provider.apiKey) return []
  const res = await fetch(`${provider.baseUrl}/models`, {
    headers: authHeaders(provider),
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    let detail = errText.slice(0, 500)
    try {
      const j = JSON.parse(errText)
      detail = j?.error?.message || j?.message || j?.error || detail
      if (typeof detail !== 'string') detail = JSON.stringify(detail).slice(0, 500)
    } catch { /* plain text / HTML */ }
    throw new Error(formatProviderHttpError('GET /models', res.status, detail))
  }
  const json = await res.json()
  const rows = Array.isArray(json?.data) ? json.data : []
  return rows
    .map((d: { id?: string; is_gated?: boolean }) => ({
      id: String(d.id || ''),
      gated: Boolean(d.is_gated),
    }))
    .filter((d: ModelInfo) => d.id)
}

export type StreamHandlers = {
  onToken: (text: string) => void
  onToolCalls?: (calls: ToolCall[]) => void
  onDone?: () => void
  /** Fired when the provider rejected native tools and we retried without them. */
  onToolsStripped?: (reason: string) => void
}

export class GatedModelError extends Error {
  model: string
  code: string = 'model_gated_needs_oauth'
  constructor(message: string, model: string) {
    super(message)
    this.name = 'GatedModelError'
    this.model = model
  }
}

/**
 * Build the request body for /chat/completions.
 * Abliteration cloud forbids chat_template_kwargs for public callers
 * (returns provider_control_forbidden). Spark needs it; Featherless ignores it.
 */
function buildStreamBody(
  body: Record<string, unknown>,
  provider: ProviderConfig,
): Record<string, unknown> {
  const reqBody: Record<string, unknown> = { ...body, stream: true }
  if (provider.id === 'abliteration') {
    delete reqBody.chat_template_kwargs
  } else {
    reqBody.chat_template_kwargs = { enable_thinking: false }
  }
  return reqBody
}

/** Stream chat completions (SSE). Returns final assistant message content + tool_calls + finishReason. */
export async function streamChat(
  provider: ProviderConfig,
  body: Record<string, unknown>,
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<{ content: string; tool_calls: ToolCall[]; finishReason: string | null; toolsStripped?: boolean }> {
  const res = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: authHeaders(provider, {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    }),
    body: JSON.stringify(buildStreamBody(body, provider)),
    signal,
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    let detail = errText.slice(0, 500)
    let isGated = false
    try {
      const j = JSON.parse(errText)
      const msg = j?.error?.message || j?.message
      const code = j?.error?.code
      if (msg) detail = msg
      if (code === 'model_gated_needs_oauth') {
        isGated = true
        detail +=
          ' — pick an ungated model (e.g. mlabonne/Meta-Llama-3.1-8B-Instruct-abliterated or Qwen/Qwen2.5-7B-Instruct) or connect HuggingFace at featherless.ai.'
      }
    } catch { /* plain text */ }

    if (res.status === 400 && detail.includes('tool choice requires --enable-auto-tool-choice')) {
      // Local vLLM was started without native tool-call parser flags.
      // Automatically retry without native API tool schemas so inference succeeds seamlessly.
      const reason =
        `${provider.name} rejected native tool_choice (needs --enable-auto-tool-choice on vLLM). ` +
        'Falling back to markdown/Auto-Bash. If you meant Spark, confirm provider=Spark and the serve script includes those flags.'
      handlers.onToolsStripped?.(reason)
      const fallbackBody = { ...body }
      delete fallbackBody.tools
      delete fallbackBody.tool_choice
      const fallback = await streamChat(provider, fallbackBody, handlers, signal)
      return { ...fallback, toolsStripped: true }
    }

    if (isGated || res.status === 403 && detail.toLowerCase().includes('gated')) {
      throw new GatedModelError(`chat/completions HTTP ${res.status}: ${detail}`, String(body.model || ''))
    }
    throw new Error(formatProviderHttpError('chat/completions', res.status, detail))
  }
  if (!res.body) throw new Error('No response body')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''
  let finishReason: string | null = null
  const toolAcc = new Map<number, ToolCall>()

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n')
    buffer = parts.pop() || ''
    for (const line of parts) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const data = trimmed.slice(5).trim()
      if (data === '[DONE]') {
        handlers.onDone?.()
        continue
      }
      try {
        const json = JSON.parse(data)
        const choice = json.choices?.[0]
        if (choice?.finish_reason) {
          finishReason = choice.finish_reason
        }
        const delta = choice?.delta || {}
        if (typeof delta.content === 'string' && delta.content) {
          content += delta.content
          handlers.onToken(delta.content)
        } else if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) {
          // Thinking models may stream only reasoning_content
          content += delta.reasoning_content
          handlers.onToken(delta.reasoning_content)
        }
        if (Array.isArray(delta.tool_calls)) {
          for (const tc of delta.tool_calls) {
            const idx = typeof tc.index === 'number' ? tc.index : 0
            const prev = toolAcc.get(idx) || {
              id: tc.id || `call_${idx}`,
              type: 'function' as const,
              function: { name: '', arguments: '' },
            }
            if (tc.id) prev.id = tc.id
            if (tc.function?.name) prev.function.name += tc.function.name
            if (tc.function?.arguments) prev.function.arguments += tc.function.arguments
            toolAcc.set(idx, prev)
          }
        }
      } catch {
        /* ignore partial JSON */
      }
    }
  }

  const tool_calls = [...toolAcc.values()].filter((t) => t.function.name)
  if (tool_calls.length) handlers.onToolCalls?.(tool_calls)
  handlers.onDone?.()
  return { content, tool_calls, finishReason }
}
