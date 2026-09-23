/**
 * Async Abliteration support loop for local Spark vLLM orchestration.
 *
 * Uses the documented Abliteration OpenAI-compatible API already configured in this repo:
 *   base: https://api.abliteration.ai/v1  (VITE_ABLITERATION_BASE_URL)
 *   path: /chat/completions
 *   auth: Authorization Bearer (VITE_ABLITERATION_API_KEY)
 *
 * Local vLLM enqueues heavy slices and keeps working; results are collected later.
 * Not a SquadSwarm scopes/bids client — only public health stays in squadswarm.mjs.
 */

export const ABLITERATION_DEFAULT_BASE_URL = 'https://api.abliteration.ai/v1'
/** Fallback when VITE_ABLITERATION_MODEL is unset. Must match an id from GET /v1/models. */
export const ABLITERATION_DEFAULT_MODEL = 'abliterated-model'

export const SQUAD_SUPPORT_MAX_IN_FLIGHT = 3
export const SQUAD_SUPPORT_MAX_CONTEXT_CHARS = 100_000
export const SQUAD_SUPPORT_MAX_RESULT_CHARS = 8_000

const MISSING_KEY_ERROR =
  'Abliteration API key missing. Set VITE_ABLITERATION_API_KEY before using squad_enqueue.'
const MISSING_BASE_ERROR =
  'Abliteration base URL missing. Set VITE_ABLITERATION_BASE_URL (default https://api.abliteration.ai/v1).'
const SECRET_REFUSAL_ERROR =
  'Refused: payload looks like it contains an API key, password, or private key. Do not send secrets to squad_enqueue.'
const OVERSIZE_ERROR = `Refused: combined task+context exceeds ${SQUAD_SUPPORT_MAX_CONTEXT_CHARS} characters.`

/** @type {Map<string, { status: string, task: string, context: string, result?: string, error?: string, createdAt: number, finishedAt?: number }>} */
const tasks = new Map()
/** @type {string[]} */
const waitQueue = []
let inFlight = 0
let idSeq = 0

/** @type {{ fetchImpl?: typeof fetch, resolveConfig?: () => { baseUrl: string, apiKey: string, model: string }, now?: () => number } | null} */
let testHooks = null

/**
 * Test-only: inject fetch / config. Pass null to reset.
 * @param {{ fetchImpl?: typeof fetch, resolveConfig?: () => { baseUrl: string, apiKey: string, model: string }, now?: () => number } | null} hooks
 */
export function __setSquadSupportTestHooks(hooks) {
  testHooks = hooks
  if (hooks === null) {
    tasks.clear()
    waitQueue.length = 0
    inFlight = 0
    idSeq = 0
  }
}

/**
 * @param {Record<string, string | undefined>} [env]
 */
export function resolveAbliterationSupportConfig(env = process.env) {
  const baseUrl = String(
    env.VITE_ABLITERATION_BASE_URL || ABLITERATION_DEFAULT_BASE_URL,
  )
    .trim()
    .replace(/\/+$/, '')
  const apiKey = String(env.VITE_ABLITERATION_API_KEY || '').trim()
  const model =
    String(env.VITE_ABLITERATION_MODEL || '').trim() || ABLITERATION_DEFAULT_MODEL
  return { baseUrl, apiKey, model }
}

/**
 * Heuristic refusal for secret-looking payloads (keys, passwords, PEM blocks).
 * @param {string} text
 */
export function looksLikeSecretMaterial(text) {
  const s = String(text || '')
  if (!s) return false
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(s)) return true
  if (/-----BEGIN PRIVATE KEY-----/.test(s)) return true
  if (/\b(?:api[_-]?key|secret[_-]?key|access[_-]?token|password)\s*[:=]\s*\S+/i.test(s)) return true
  if (/\b(?:sk|pk|rk|ak)[_-][A-Za-z0-9]{16,}\b/.test(s)) return true
  if (/\bBearer\s+[A-Za-z0-9\-._~+/]+=*\b/.test(s)) return true
  if (/VITE_ABLITERATION_API_KEY\s*=\s*\S+/.test(s)) return true
  if (/FEATHERLESS_API_KEY\s*=\s*\S+/.test(s)) return true
  return false
}

/**
 * @param {string} task
 * @param {string} [context]
 */
export function validateSquadSupportPayload(task, context = '') {
  const t = String(task || '').trim()
  const c = String(context || '')
  if (!t) return { ok: false, error: 'task is required' }
  if (t.length + c.length > SQUAD_SUPPORT_MAX_CONTEXT_CHARS) {
    return { ok: false, error: OVERSIZE_ERROR }
  }
  if (looksLikeSecretMaterial(t) || looksLikeSecretMaterial(c)) {
    return { ok: false, error: SECRET_REFUSAL_ERROR }
  }
  return { ok: true, task: t, context: c }
}

function nextTaskId() {
  idSeq += 1
  const now = testHooks?.now?.() ?? Date.now()
  return `squad-${now}-${idSeq}`
}

function getConfig() {
  if (testHooks?.resolveConfig) return testHooks.resolveConfig()
  return resolveAbliterationSupportConfig()
}

function getFetch() {
  return testHooks?.fetchImpl ?? fetch
}

function pump() {
  while (inFlight < SQUAD_SUPPORT_MAX_IN_FLIGHT && waitQueue.length > 0) {
    const id = waitQueue.shift()
    if (!id) break
    const row = tasks.get(id)
    if (!row || row.status !== 'queued') continue
    row.status = 'running'
    inFlight += 1
    void runAbliterationTask(id).finally(() => {
      inFlight -= 1
      pump()
    })
  }
}

/**
 * @param {string} taskId
 */
async function runAbliterationTask(taskId) {
  const row = tasks.get(taskId)
  if (!row) return
  const cfg = getConfig()
  if (!cfg.apiKey) {
    row.status = 'error'
    row.error = MISSING_KEY_ERROR
    row.finishedAt = testHooks?.now?.() ?? Date.now()
    return
  }
  if (!cfg.baseUrl) {
    row.status = 'error'
    row.error = MISSING_BASE_ERROR
    row.finishedAt = testHooks?.now?.() ?? Date.now()
    return
  }

  const userContent = row.context
    ? `Task:\n${row.task}\n\nContext:\n${row.context}`
    : row.task

  const body = {
    model: cfg.model || ABLITERATION_DEFAULT_MODEL,
    stream: false,
    max_tokens: 2048,
    temperature: 0.2,
    messages: [
      {
        role: 'system',
        content:
          'You are the async Abliteration support model for AIUI. Execute the offloaded task and return a compact, actionable result for the local Spark orchestrator. No preamble. No secrets.',
      },
      { role: 'user', content: userContent },
    ],
  }

  try {
    const fetchImpl = getFetch()
    const res = await fetchImpl(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    })
    const text = await res.text()
    if (!res.ok) {
      row.status = 'error'
      row.error = `Abliteration chat/completions HTTP ${res.status}: ${text.slice(0, 200)}`
      row.finishedAt = testHooks?.now?.() ?? Date.now()
      return
    }
    let parsed = null
    try {
      parsed = JSON.parse(text)
    } catch {
      row.status = 'error'
      row.error = 'Abliteration returned non-JSON body'
      row.finishedAt = testHooks?.now?.() ?? Date.now()
      return
    }
    const content = extractChatContent(parsed)
    if (!content) {
      row.status = 'error'
      row.error = 'Abliteration returned an empty completion'
      row.finishedAt = testHooks?.now?.() ?? Date.now()
      return
    }
    row.status = 'done'
    row.result = content.slice(0, SQUAD_SUPPORT_MAX_RESULT_CHARS)
    row.finishedAt = testHooks?.now?.() ?? Date.now()
  } catch (err) {
    row.status = 'error'
    row.error = err instanceof Error ? err.message : 'Abliteration support call failed'
    row.finishedAt = testHooks?.now?.() ?? Date.now()
  }
}

/**
 * @param {unknown} parsed
 */
export function extractChatContent(parsed) {
  if (!parsed || typeof parsed !== 'object') return ''
  const choices = /** @type {{ choices?: Array<{ message?: { content?: unknown } }> }} */ (parsed)
    .choices
  if (!Array.isArray(choices) || !choices.length) return ''
  const content = choices[0]?.message?.content
  if (typeof content === 'string') return content.trim()
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part
        if (part && typeof part === 'object' && typeof /** @type {{ text?: string }} */ (part).text === 'string') {
          return /** @type {{ text: string }} */ (part).text
        }
        return ''
      })
      .join('')
      .trim()
  }
  return ''
}

/**
 * Enqueue a heavy slice for the Abliteration support model. Returns a task id immediately.
 * @param {{ task?: string, context?: string }} args
 */
export function squadEnqueue(args = {}) {
  const cfg = getConfig()
  if (!String(cfg.apiKey || '').trim()) {
    return { ok: false, error: MISSING_KEY_ERROR }
  }
  if (!String(cfg.baseUrl || '').trim()) {
    return { ok: false, error: MISSING_BASE_ERROR }
  }

  const validated = validateSquadSupportPayload(args.task, args.context)
  if (!validated.ok) {
    return { ok: false, error: validated.error }
  }

  const taskId = nextTaskId()
  tasks.set(taskId, {
    status: 'queued',
    task: validated.task,
    context: validated.context,
    createdAt: testHooks?.now?.() ?? Date.now(),
  })
  waitQueue.push(taskId)
  pump()
  return {
    ok: true,
    taskId,
    status: 'queued',
    note: 'Abliteration support accepted the task. Continue local work; call squad_collect with this taskId when you need the compact result.',
  }
}

/**
 * Collect status / compact result for a previously enqueued task.
 * @param {{ taskId?: string }} args
 */
export function squadCollect(args = {}) {
  const taskId = String(args.taskId || '').trim()
  if (!taskId) return { ok: false, error: 'taskId is required' }
  const row = tasks.get(taskId)
  if (!row) return { ok: false, error: `Unknown taskId: ${taskId}` }

  if (row.status === 'queued' || row.status === 'running') {
    return {
      ok: true,
      taskId,
      status: row.status === 'running' ? 'pending' : 'pending',
      pending: true,
    }
  }

  if (row.status === 'done') {
    if (!row.result) {
      return { ok: false, taskId, status: 'error', error: 'Done but empty result' }
    }
    return {
      ok: true,
      taskId,
      status: 'done',
      pending: false,
      result: row.result,
    }
  }

  return {
    ok: false,
    taskId,
    status: 'error',
    error: row.error || 'Support task failed',
  }
}

/** CLI / Vite handler — returns JSON string. */
export function squadEnqueueHandler(args) {
  return JSON.stringify(squadEnqueue(args || {}))
}

/** CLI / Vite handler — returns JSON string. */
export function squadCollectHandler(args) {
  return JSON.stringify(squadCollect(args || {}))
}
