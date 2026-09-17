/**
 * Agent tools for web-api-app with integrated Auto Bash Shell & Cloud APIs.
 * Connects to local sandbox runner (:17330) and remote DGX Spark cluster.
 */
import type { ChatMessage, ToolCall } from './api'
import type { ProviderConfig } from './providers'
import {
  executeBashCommand,
  getStoredTarget,
  getSandboxBaseUrl,
  spawnLinuxContainer,
  destroyLinuxContainer,
  listLinuxContainers,
  type ExecutionTarget,
  type BashExecResult,
} from './bashShell'
import { searchMemory, checkpointMemory } from './mempalace'

export const AGENT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'bash',
      description:
        'Execute a shell command inside the local Mac, DGX Spark, or isolated Linux container (:17330). Returns REAL stdout, stderr, and exitCode. Use to inspect files, run tests, execute scripts (python, node, bash), compile code, check system status, etc.',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'The exact bash command line to run (e.g. ls -lah, python3 test.py, etc.)',
          },
          target: {
            type: 'string',
            enum: ['local_mac', 'dgx_spark', 'container'],
            description: 'Execution target: local_mac, dgx_spark, or container (isolated Linux pod)',
          },
        },
        required: ['command'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description:
        'Write or overwrite a file in the workspace/sandbox. Essential for creating scripts, writing tests, or applying code fixes during self-healing.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Relative or absolute file path to create/overwrite (e.g. solution.py, test.py)',
          },
          content: {
            type: 'string',
            description: 'The complete text content to write into the file',
          },
          target: {
            type: 'string',
            enum: ['local_mac', 'dgx_spark'],
            description: 'Execution target: local_mac (default) or dgx_spark',
          },
        },
        required: ['path', 'content'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description:
        'Read the contents of a file in the workspace/sandbox. Use to inspect existing code, verify edits, or read error logs.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Path of the file to read',
          },
          target: {
            type: 'string',
            enum: ['local_mac', 'dgx_spark'],
            description: 'Execution target: local_mac (default) or dgx_spark',
          },
        },
        required: ['path'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_models',
      description: 'List model IDs from the active cloud provider GET /v1/models (real API).',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Optional substring filter' },
          limit: { type: 'number', description: 'Max results (default 30)' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'http_get_json',
      description:
        'GET a public https URL and return truncated JSON/text. Only https URLs. For reading API docs or public JSON — not for secrets.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string' },
        },
        required: ['url'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'now',
      description: 'Return the current UTC ISO timestamp from the browser clock.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'memory_search',
      description:
        'Search the MemPalace memory palace for past conversations, decisions, and context. Use before answering questions about people, projects, or past events — never guess, verify first.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'What to search for (semantic search, natural language OK)',
          },
          wing: {
            type: 'string',
            description: 'Optional: filter by wing (project name)',
          },
          limit: {
            type: 'number',
            description: 'Max results (default 5)',
          },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'memory_checkpoint',
      description:
        'Save conversation items to the MemPalace memory palace for future recall. Each item is verbatim content filed under a wing (project) and room (topic). Semantic-deduplicates before filing.',
      parameters: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                wing: { type: 'string', description: 'Project name' },
                room: { type: 'string', description: 'Topic slug (e.g. decisions, auth, bugs)' },
                content: { type: 'string', description: 'Verbatim content to store' },
              },
              required: ['wing', 'room', 'content'],
            },
          },
        },
        required: ['items'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'spawn_linux_container',
      description:
        'Spawn an isolated lightweight Linux container with pre-installed developer & data science packages (Python 3.11, DuckDB, Pandas, NumPy, PyTest, FastAPI, Git, Curl, Jq, or PyTorch CUDA on DGX Spark). Mounts workspace directory to /workspace.',
      parameters: {
        type: 'object',
        properties: {
          envId: {
            type: 'string',
            description: 'Unique environment ID or session identifier for the container',
          },
          profile: {
            type: 'string',
            enum: ['python_data', 'gpu_spark', 'minimal_alpine'],
            description: 'Container environment profile: python_data (default), gpu_spark (DGX Blackwell PyTorch GPU), or minimal_alpine',
          },
          target: {
            type: 'string',
            enum: ['dgx_spark', 'local_mac'],
            description: 'Host machine on which to run the container (default dgx_spark)',
          },
          extraPackages: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional additional pip or apk packages to install inside the container',
          },
          timeoutMinutes: {
            type: 'number',
            description: 'Auto-teardown TTL in minutes (default 30)',
          },
          enableGpu: {
            type: 'boolean',
            description: 'Whether to attach NVIDIA Blackwell GB10 GPU to the container (requires target dgx_spark)',
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'destroy_linux_container',
      description: 'Stop and destroy an ephemeral Linux container to release resources.',
      parameters: {
        type: 'object',
        properties: {
          envId: {
            type: 'string',
            description: 'Environment ID of the container to destroy',
          },
          target: {
            type: 'string',
            enum: ['dgx_spark', 'local_mac'],
            description: 'Host machine on which the container is running (default dgx_spark)',
          },
        },
        required: ['envId'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_linux_containers',
      description: 'List all currently running Linux sandbox containers, their profiles, uptime, remaining TTL, and workspace paths.',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
  },
]

// In-memory read cache to prevent redundant disk/SSH round-trips
const fileReadCache = new Map<string, { content: string; exitCode: number; error?: string; ts: number }>()

export function invalidateFileCache() {
  fileReadCache.clear()
}

export async function runTool(
  name: string,
  argsJson: string,
  provider: ProviderConfig,
  onBashResult?: (res: BashExecResult) => void,
): Promise<string> {
  let args: Record<string, unknown> = {}
  try {
    args = argsJson ? JSON.parse(argsJson) : {}
  } catch {
    return JSON.stringify({ ok: false, error: 'Invalid tool arguments JSON' })
  }

  if (name === 'bash' || name === 'exec') {
    const cmd = String(args.command || args.cmd || '').trim()
    if (!cmd) {
      return JSON.stringify({ ok: false, error: 'No command specified' })
    }
    // Writing or modifying commands invalidate read cache
    invalidateFileCache()
    const target = (args.target as ExecutionTarget) || getStoredTarget()
    const res = await executeBashCommand(cmd, target)
    if (onBashResult) {
      onBashResult(res)
    }
    return JSON.stringify({
      ok: res.ok,
      exitCode: res.exitCode,
      target: res.target,
      durationMs: res.durationMs,
      stdout: res.stdout || '',
      stderr: res.stderr || '',
      error: res.error,
    })
  }

  if (name === 'write_file') {
    invalidateFileCache()
    const filePath = String(args.path || args.filename || '').trim()
    const content = String(args.content ?? '')
    const target = (args.target as ExecutionTarget) || getStoredTarget()
    if (!filePath) {
      return JSON.stringify({ ok: false, error: 'File path required' })
    }
    try {
      const res = await fetch(`${getSandboxBaseUrl()}/api/sandbox/materialize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          envId: 'web_session',
          target,
          files: { [filePath]: { content } },
          replaceAll: false,
        }),
      })
      if (res.ok) {
        return JSON.stringify({
          ok: true,
          path: filePath,
          bytes: content.length,
          exitCode: 0,
          message: `Successfully wrote ${filePath} (${content.length} bytes)`,
        })
      }
    } catch {
      // fallback to bash base64
    }
    const b64 = btoa(unescape(encodeURIComponent(content)))
    const cmd = `mkdir -p "$(dirname "${filePath}")" && echo "${b64}" | base64 -d > "${filePath}"`
    const res = await executeBashCommand(cmd, target)
    if (onBashResult) onBashResult(res)
    return JSON.stringify({
      ok: res.ok,
      path: filePath,
      bytes: content.length,
      exitCode: res.exitCode,
      error: res.error || (res.ok ? undefined : res.stderr),
    })
  }

  if (name === 'read_file') {
    const filePath = String(args.path || args.filename || '').trim()
    const target = (args.target as ExecutionTarget) || getStoredTarget()
    if (!filePath) {
      return JSON.stringify({ ok: false, error: 'File path required' })
    }

    // Fast-path: check in-memory cache (TTL: 20 seconds)
    const cacheKey = `${target}:${filePath}`
    const cached = fileReadCache.get(cacheKey)
    if (cached && Date.now() - cached.ts < 20000) {
      return JSON.stringify({
        ok: cached.exitCode === 0,
        path: filePath,
        content: cached.content,
        exitCode: cached.exitCode,
        cached: true,
        error: cached.error,
      })
    }

    const cmd = `cat "${filePath}"`
    const res = await executeBashCommand(cmd, target)
    if (onBashResult) onBashResult(res)

    if (res.ok) {
      fileReadCache.set(cacheKey, {
        content: res.stdout,
        exitCode: res.exitCode,
        error: res.error,
        ts: Date.now(),
      })
    }

    return JSON.stringify({
      ok: res.ok,
      path: filePath,
      content: res.stdout,
      exitCode: res.exitCode,
      error: res.ok ? undefined : (res.stderr || res.error),
    })
  }

  if (name === 'now') {
    return JSON.stringify({ ok: true, utc: new Date().toISOString() })
  }

  if (name === 'memory_search') {
    const query = String(args.query || '')
    if (!query) {
      return JSON.stringify({ ok: false, error: 'Missing query' })
    }
    try {
      const result = await searchMemory(query, {
        ...(args.wing ? { wing: String(args.wing) } : {}),
        ...(args.limit ? { limit: Number(args.limit) } : {}),
      })
      return JSON.stringify({
        ok: true,
        count: result.results.length,
        results: result.results.map((r) => ({
          wing: r.wing,
          room: r.room,
          text: r.text.slice(0, 500),
          similarity: r.similarity,
        })),
      })
    } catch (e) {
      return JSON.stringify({ ok: false, error: e instanceof Error ? e.message : 'memory search failed' })
    }
  }

  if (name === 'memory_checkpoint') {
    const items = Array.isArray(args.items) ? args.items : []
    if (!items.length) {
      return JSON.stringify({ ok: false, error: 'No items to checkpoint' })
    }
    try {
      const result = await checkpointMemory(
        items.map((it: { wing?: string; room?: string; content?: string }) => ({
          wing: String(it.wing || 'web-api-app'),
          room: String(it.room || 'general'),
          content: String(it.content || ''),
        })),
      )
      return JSON.stringify({
        ok: true,
        added: result.added.length,
        duplicates: result.duplicates.length,
        errors: result.errors.length,
      })
    } catch (e) {
      return JSON.stringify({ ok: false, error: e instanceof Error ? e.message : 'checkpoint failed' })
    }
  }

  if (name === 'list_models') {
    if (provider.requiresApiKey && !provider.apiKey) {
      return JSON.stringify({ ok: false, error: 'No API key configured' })
    }
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (provider.apiKey) headers.Authorization = `Bearer ${provider.apiKey}`
    const res = await fetch(`${provider.baseUrl}/models`, { headers })
    if (!res.ok) {
      return JSON.stringify({ ok: false, error: `HTTP ${res.status}` })
    }
    const json = await res.json()
    const ids = (Array.isArray(json?.data) ? json.data : [])
      .map((d: { id?: string }) => String(d.id || ''))
      .filter(Boolean)
    const q = String(args.query || '').toLowerCase()
    const filtered = q ? ids.filter((id: string) => id.toLowerCase().includes(q)) : ids
    const limit = Math.min(100, Math.max(1, Number(args.limit) || 30))
    return JSON.stringify({
      ok: true,
      count: filtered.length,
      models: filtered.slice(0, limit),
      note: 'Real /v1/models response; truncated for display.',
    })
  }

  if (name === 'http_get_json') {
    const url = String(args.url || '')
    if (!/^https:\/\//i.test(url)) {
      return JSON.stringify({ ok: false, error: 'Only https:// URLs allowed' })
    }
    const res = await fetch(url, { headers: { Accept: 'application/json,text/plain,*/*' } })
    const text = await res.text()
    return JSON.stringify({
      ok: res.ok,
      status: res.status,
      body: text.slice(0, 4000),
      truncated: text.length > 4000,
    })
  }

  if (name === 'spawn_linux_container') {
    const res = await spawnLinuxContainer({
      envId: args.envId ? String(args.envId) : undefined,
      profile: (args.profile as 'python_data' | 'gpu_spark' | 'minimal_alpine') || 'python_data',
      target: (args.target as 'dgx_spark' | 'local_mac') || 'dgx_spark',
      extraPackages: Array.isArray(args.extraPackages) ? args.extraPackages.map(String) : [],
      timeoutMinutes: args.timeoutMinutes ? Number(args.timeoutMinutes) : 30,
      enableGpu: Boolean(args.enableGpu),
    })
    return JSON.stringify(res)
  }

  if (name === 'destroy_linux_container') {
    const envId = String(args.envId || '')
    if (!envId) return JSON.stringify({ ok: false, error: 'envId required' })
    const target = (args.target as 'dgx_spark' | 'local_mac') || 'dgx_spark'
    const res = await destroyLinuxContainer(envId, target)
    return JSON.stringify(res)
  }

  if (name === 'list_linux_containers') {
    const res = await listLinuxContainers()
    return JSON.stringify(res)
  }

  return JSON.stringify({ ok: false, error: `Unknown tool: ${name}` })
}

export interface ToolExecutionDetail {
  toolCallId: string
  name: string
  rawResult: string
  ok: boolean
  exitCode?: number
  bashResult?: BashExecResult
  error?: string
}

export interface ApplyToolsResult {
  messages: ChatMessage[]
  hasFailure: boolean
  failedCmds: string[]
  executions: ToolExecutionDetail[]
}

const READ_ONLY_TOOLS = new Set([
  'read_file',
  'now',
  'memory_search',
  'list_models',
  'http_get_json',
  'list_linux_containers',
])

/**
 * Curate tool/bash dumps for the next model turn: keep signal (head + tail),
 * drop middle noise, and hard-cap chars so context stays diagnosis-friendly.
 */
export function formatToolOutputForContext(text: string, maxChars = 3500): string {
  if (!text) return text

  let curated = text
  const lines = text.split('\n')
  const MAX_LINES = 80
  if (lines.length > MAX_LINES) {
    const headN = 20
    const tailN = 60
    const omitted = lines.length - headN - tailN
    curated = [
      ...lines.slice(0, headN),
      '',
      `... [${omitted} lines omitted for context quality] ...`,
      '',
      ...lines.slice(-tailN),
    ].join('\n')
  }

  if (curated.length <= maxChars) return curated
  const half = Math.floor((maxChars - 160) / 2)
  const head = curated.slice(0, half)
  const tail = curated.slice(curated.length - half)
  const omitted = curated.length - (head.length + tail.length)
  return `${head}\n\n... [${omitted} characters truncated for context quality] ...\n\n${tail}`
}

export async function applyToolCalls(
  toolCalls: ToolCall[],
  provider: ProviderConfig,
  onBashResult?: (res: BashExecResult) => void,
): Promise<ApplyToolsResult> {
  const messages: ChatMessage[] = []
  const executions: ToolExecutionDetail[] = []
  const failedCmds: string[] = []
  let hasFailure = false

  const runSingle = async (tc: ToolCall) => {
    let capturedBashRes: BashExecResult | undefined
    const rawResult = await runTool(
      tc.function.name,
      tc.function.arguments || '{}',
      provider,
      (bRes) => {
        capturedBashRes = bRes
        if (onBashResult) onBashResult(bRes)
      },
    )

    let isOk = true
    let exitCode: number | undefined
    let errorMsg: string | undefined

    try {
      const parsed = JSON.parse(rawResult)
      if (parsed && typeof parsed === 'object') {
        if ('ok' in parsed && parsed.ok === false) {
          isOk = false
        }
        if ('exitCode' in parsed && typeof parsed.exitCode === 'number') {
          exitCode = parsed.exitCode
          if (parsed.exitCode !== 0) isOk = false
        }
        if ('error' in parsed && parsed.error) {
          errorMsg = String(parsed.error)
        }
      }
    } catch {
      // not JSON format
    }

    return {
      tc,
      rawResult,
      isOk,
      exitCode,
      errorMsg,
      capturedBashRes,
    }
  }

  // Optimize: Parallelize concurrent execution for batches of read-only tools
  const allReadOnly = toolCalls.every((tc) => READ_ONLY_TOOLS.has(tc.function.name))
  let results: Awaited<ReturnType<typeof runSingle>>[] = []

  if (allReadOnly && toolCalls.length > 1) {
    results = await Promise.all(toolCalls.map(runSingle))
  } else {
    for (const tc of toolCalls) {
      results.push(await runSingle(tc))
    }
  }

  for (const item of results) {
    if (!item.isOk) {
      hasFailure = true
      failedCmds.push(
        item.tc.function.name === 'bash'
          ? (item.capturedBashRes?.command || 'bash')
          : item.tc.function.name,
      )
    }

    const toolMsg: ChatMessage = {
      role: 'tool',
      tool_call_id: item.tc.id,
      name: item.tc.function.name,
      content: formatToolOutputForContext(item.rawResult),
    }

    messages.push(toolMsg)
    executions.push({
      toolCallId: item.tc.id,
      name: item.tc.function.name,
      rawResult: item.rawResult,
      ok: item.isOk,
      exitCode: item.exitCode,
      bashResult: item.capturedBashRes,
      error: item.errorMsg,
    })
  }

  return { messages, hasFailure, failedCmds, executions }
}

export const CHAT_SYSTEM = `You are Abliterated AI — a sharp engineering assistant.
Be concise and accurate. Prefer evidence over speculation. Use markdown sparingly.
If the user asks you to run or change something and Agent Mode is off, explain the steps clearly rather than inventing command output.`

export const AGENT_SYSTEM = `You are Abliterated AI in Agent Mode — an autonomous systems engineer with live tools.

Tools: bash, write_file, read_file, list_models, http_get_json, now, memory_search, memory_checkpoint, spawn_linux_container, destroy_linux_container, list_linux_containers.
Prefer native tool_calls. Only use <run>command</run> or fenced bash when tools are unavailable.
Never fabricate stdout/stderr — only trust real tool results.

Rules:
1. Action over chatter — call a tool instead of announcing plans.
2. Fix-verify loop — on failure: inspect → change approach → re-run. Never repeat the same failing command unchanged.
3. Anti-loop — no repeated preambles or identical answers; pivot when stuck.
4. Memory — memory_search before guessing past project context; checkpoint meaningful outcomes.
5. When done — short summary: what changed, evidence (exit codes / paths), what's left.

Containers (optional): profiles python_data | gpu_spark | minimal_alpine; destroy when finished.`

export const DEEP_BUILD_DIRECTIVE = `
=== DEEP BUILD MODE ===
Enterprise-grade thoroughness is required:
1. Plan boundaries, contracts, edge cases, and failure modes before writing.
2. Zero stubs/TODOs — complete implementations with validation, types, and logging.
3. Write and run automated tests; verify exit codes / HTTP status / real output.
4. End with an evidence-based summary of files changed and verified invariants.`

export function buildTurnContextBlock(opts: {
  goal: string
  stage?: string
  lastFailed?: string | null
  avoid?: string | null
  round?: number
}): string {
  const lines = ['=== CURRENT TURN CONTEXT ===', `Goal: ${opts.goal}`]
  if (opts.stage) lines.push(`Stage: ${opts.stage}`)
  if (opts.round != null) lines.push(`Round: ${opts.round}`)
  if (opts.lastFailed) lines.push(`Last failed: ${opts.lastFailed}`)
  if (opts.avoid) lines.push(`Do not repeat: ${opts.avoid}`)
  lines.push(
    'Next: one concrete tool action toward the goal, or a final verified summary if complete.',
  )
  lines.push('=== END TURN CONTEXT ===')
  return lines.join('\n')
}

export function buildContinueNudge(opts: {
  goal: string
  reason: string
  stage?: string
  lastFailed?: string | null
  avoid?: string | null
  directive?: string | null
}): string {
  const parts = [`[CONTINUE — ${opts.reason}]`, `Goal: ${opts.goal}`]
  if (opts.stage) parts.push(`Stage: ${opts.stage}`)
  if (opts.lastFailed) parts.push(`Last failed: ${opts.lastFailed}`)
  if (opts.avoid) parts.push(`Do not repeat: ${opts.avoid}`)
  if (opts.directive) parts.push(opts.directive)
  else parts.push('Take one concrete next tool action. Do not restate prior plans.')
  return parts.join('\n')
}

/** Heuristic: only inject RAG/MemPalace for questions that need prior knowledge. */
export function looksLikeKnowledgeQuery(text: string): boolean {
  const q = (text || '').trim()
  if (q.length < 16) return false
  if (/^(continue|ok|okay|thanks|thank you|yes|no|yep|nope)\b/i.test(q)) return false
  return (
    /(how|what|where|why|explain|architecture|config|setup|which|does|work|remember|last time|previously)/i.test(
      q,
    ) || q.length > 48
  )
}


