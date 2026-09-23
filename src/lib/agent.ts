/**
 * Agent tools for web-api-app with integrated Auto Bash Shell & Cloud APIs.
 * Connects to local sandbox runner (:17330) and remote DGX Spark cluster.
 */
import type { ChatMessage, ToolCall } from './api.ts'
import { ApiClient } from './api.ts'
import type { ProviderConfig } from './providers.ts'
import {
  executeBashCommand,
  getStoredTarget,
  getStoredWorkspaceDir,
  setStoredWorkspaceDir,
  getSandboxBaseUrl,
  spawnLinuxContainer,
  destroyLinuxContainer,
  listLinuxContainers,
  type ExecutionTarget,
  type BashExecResult,
} from './bashShell.ts'
import { MemoryPalace, searchMemory, checkpointMemory } from './mempalace.ts'
import { getAllScaffolds, getScaffoldFiles } from './scaffoldTemplates.ts'
import { formatAIUIResponse } from './devinResponseFormatter.ts'
import { isTurnBrowserCueActive, WORD_CUE_SYSTEM_RULE } from './wordCues.ts'
import { fetchSquadswarmStatusViaHttpGetProxy } from './squadswarm.ts'
import { squadCollectViaProxy, squadEnqueueViaProxy } from './squadSupport.ts'
import {
  MISSING_TOOL_ACQUISITION_RULE,
  autoAcquireMissingTool,
  executeDynamicTool,
  loadDynamicToolRegistry,
  researchAndAcquireTool,
  registerToolInSession,
} from './dynamicToolManager.ts'

/** Reject host escapes and path traversal before any sandbox I/O. */
function sandboxPathError(filePath: string): string | null {
  const p = String(filePath || '').trim()
  if (!p) return 'Path required'
  if (p.includes('..')) return 'Directory traversal is not allowed'
  if (
    p.startsWith('/Users/') ||
    p.startsWith('/home/') ||
    p.includes('/Users/adminuser') ||
    /^[A-Za-z]:\\/.test(p)
  ) {
    return 'Host paths are forbidden; use sandbox workspace paths only'
  }
  return null
}

export const AGENT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'bash',
      description:
        'Execute a shell command inside the DGX Spark sandbox or isolated Linux container (:17330). Returns REAL stdout, stderr, and exitCode. Use to inspect files, run tests, execute scripts (python, node, bash), compile code, check system status, etc.',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'The exact bash command line to run (e.g. ls -lah, python3 test.py, etc.)',
          },
          target: {
            type: 'string',
            enum: ['dgx_spark', 'container'],
            description: 'Execution target: dgx_spark (default DGX GPU sandbox) or container (isolated Linux pod)',
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
        'Create a new file or completely overwrite an existing file. For existing files, prefer replace_file_content for surgical edits.',
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
            enum: ['dgx_spark', 'container'],
            description: 'Execution target: dgx_spark (default remote DGX sandbox) or container',
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
      name: 'pdf_ocr',
      description:
        'Read a local PDF on this Mac with pymupdf4llm.to_markdown. Returns Markdown plus pageCount; OCRs sparse pages. Use this instead of bash or SSH for .pdf files.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute path to a .pdf file on this Mac' },
          maxPages: { type: 'number' },
          forceOcr: { type: 'boolean' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'read_file',
      description:
        'Read the contents of a file in the sandbox workspace (DGX Spark). Use to inspect existing code, verify edits, or read error logs.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Path of the file to read',
          },
          target: {
            type: 'string',
            enum: ['dgx_spark', 'container'],
            description: 'Execution target: dgx_spark (default remote DGX sandbox) or container',
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
      name: 'replace_file_content',
      description:
        'Surgically replace an exact, unique block of code within a file without modifying the rest. Prefer this over write_file for existing files.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Target file path' },
          target: { type: 'string', description: 'Exact character sequence to replace (must be unique)' },
          replacement: { type: 'string', description: 'Replacement code' },
        },
        required: ['path', 'target', 'replacement'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'multi_replace_file_content',
      description: 'Atomically apply multiple surgical code replacements to a file in one transaction.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Target file path' },
          replacements: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                target: { type: 'string' },
                replacement: { type: 'string' },
              },
              required: ['target', 'replacement'],
            },
          },
        },
        required: ['path', 'replacements'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'grep_search',
      description: 'Fast code search using ripgrep. Supports regex, glob filters, and path scoping.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Search pattern (regex or literal)' },
          path: { type: 'string', description: 'Directory or file to search (default: workspace)' },
          glob: { type: 'string', description: 'Glob filter (e.g. *.ts)' },
          case_sensitive: { type: 'boolean' },
          max_results: { type: 'number' },
        },
        required: ['pattern'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_file_outline',
      description: 'Extract function, class, interface, and type signatures with line numbers.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to source file' },
        },
        required: ['path'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'start_daemon',
      description: 'Start a long-running background process with optional port readiness polling.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string' },
          id: { type: 'string' },
          port: { type: 'number' },
          cwd: { type: 'string' },
        },
        required: ['command', 'id'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_daemon_logs',
      description: 'Read trailing log lines from a running background daemon.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          lines: { type: 'number' },
        },
        required: ['id'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'stop_daemon',
      description: 'Stop a running background daemon.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_daemons',
      description: 'List running background daemons, PIDs, uptime, and ports.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'nl_automate',
      description:
        'Natural-language browser task on the allowlisted local studio. Requires the word cue "automate" in the user prompt.',
      parameters: {
        type: 'object',
        properties: {
          instruction: { type: 'string', description: 'Plain-language browser task' },
        },
        required: ['instruction'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_open',
      description: 'Open a visible Chrome window (Playwright) and navigate to a URL. Requires word cue "automate".',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string' },
          headless: { type: 'boolean' },
        },
        required: ['url'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_screenshot',
      description: 'Capture a PNG screenshot of the active browser page.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          fullPage: { type: 'boolean' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_click',
      description: 'Click an element on the active browser page by CSS selector.',
      parameters: {
        type: 'object',
        properties: { selector: { type: 'string' } },
        required: ['selector'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_type',
      description: 'Type text into an input on the active browser page.',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string' },
          text: { type: 'string' },
        },
        required: ['selector', 'text'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_console_logs',
      description: 'Get browser console logs, exceptions, and network errors.',
      parameters: {
        type: 'object',
        properties: {
          level: { type: 'string', enum: ['error', 'warn', 'info', 'all'] },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'spawn_subagent',
      description: 'Delegate a focused objective to an isolated subagent (recon, coder, browser_qa).',
      parameters: {
        type: 'object',
        properties: {
          role: { type: 'string', enum: ['recon', 'coder', 'browser_qa'] },
          objective: { type: 'string' },
          target_files: { type: 'array', items: { type: 'string' } },
          max_rounds: { type: 'number' },
        },
        required: ['role', 'objective'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'hand_off_run',
      description: 'Hand the current run to n8n so it continues after this chat closes.',
      parameters: {
        type: 'object',
        properties: { runId: { type: 'string' } },
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
      name: 'squadswarm_status',
      description:
        'Check SquadSwarm public health (GET /api/health) and return official public URLs (home, about, scopes, docs, login). Scope Board and Docs require sign-in — no public API key. Prefer this over inventing SquadSwarm endpoints.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'squad_enqueue',
      description:
        'Hand a heavy task (+ optional context) to the async Abliteration.ai support model (larger cloud model). Returns a taskId immediately so local Spark vLLM can keep working. Cap ~100k chars in. Do not send .env, API keys, passwords, or /Users secrets. Local bash/file edits stay local.',
      parameters: {
        type: 'object',
        properties: {
          task: { type: 'string', description: 'What the support model should do' },
          context: {
            type: 'string',
            description: 'Optional large slice (logs, plan, pasted text) — not secrets',
          },
        },
        required: ['task'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'squad_collect',
      description:
        'Poll an Abliteration support task by taskId. Returns pending until done, then a compact result (≤~8k chars). Non-blocking — keep doing local work while pending.',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: 'Id returned by squad_enqueue' },
        },
        required: ['taskId'],
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
  {
    type: 'function',
    function: {
      name: 'list_scaffolds',
      description:
        'List all 52 standardized project scaffolds (FastAPI, Go API, Node API, Next.js, Helm, K8s, Docker, Vitest, Playwright, Turborepo, Prisma, etc.).',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Optional keyword filter (e.g. docker, fastapi, k8s)' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'apply_scaffold',
      description:
        'Apply and write a complete standardized project scaffold into the workspace or sandbox. Generates all required configs, code files, and Dockerfiles with {{PROJECT_NAME}} interpolated.',
      parameters: {
        type: 'object',
        properties: {
          templateId: {
            type: 'string',
            description: 'The template ID to apply (e.g. generic, node-api, fastapi, go-api, next-app, helm-chart, monorepo-turbo, etc.)',
          },
          projectName: {
            type: 'string',
            description: 'Name of the project to replace {{PROJECT_NAME}} placeholders (default: app)',
          },
          target: {
            type: 'string',
            enum: ['local_mac', 'dgx_spark'],
            description: 'Target execution host (default: local_mac)',
          },
        },
        required: ['templateId'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_workspace_dir',
      description:
        'Set or change the active working directory for bash commands, file operations, and tests across local Mac or remote cluster (e.g. /Users/adminuser/AIUI, /Users/adminuser/r, /Users/adminuser/log-sorter, /tmp/spark-sandboxes).',
      parameters: {
        type: 'object',
        properties: {
          directory: {
            type: 'string',
            description: 'The target absolute or user-relative directory to switch to',
          },
          target: {
            type: 'string',
            enum: ['local_mac', 'dgx_spark'],
            description: 'Target execution host (default: local_mac)',
          },
        },
        required: ['directory'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_workspace_dir',
      description:
        'Inspect the currently configured active workspace directory and available workspace presets.',
      parameters: {
        type: 'object',
        properties: {
          target: {
            type: 'string',
            enum: ['local_mac', 'dgx_spark'],
            description: 'Target execution host (default: local_mac)',
          },
        },
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

const CLI_PROXY_TOOLS = new Set([
  'replace_file_content',
  'multi_replace_file_content',
  'grep_search',
  'get_file_outline',
  'start_daemon',
  'read_daemon_logs',
  'stop_daemon',
  'list_daemons',
  'nl_automate',
  'spawn_subagent',
  'hand_off_run',
  'ssh',
  'base64',
  'web_unblocker',
])

async function proxyCliTool(name: string, args: Record<string, unknown>): Promise<string> {
  try {
    const res = await fetch('/api/agent-runs/tool', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, arguments: args }),
    })
    const text = await res.text()
    try {
      const parsed = JSON.parse(text)
      if (parsed && typeof parsed === 'object' && !('ok' in parsed)) {
        parsed.ok = res.ok
      }
      return JSON.stringify(parsed)
    } catch {
      return text
    }
  } catch (err) {
    return JSON.stringify({
      ok: false,
      error: err instanceof Error ? err.message : `${name} proxy failed`,
    })
  }
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

  if (name.startsWith('browser_') || name === 'nl_automate') {
    if (!isTurnBrowserCueActive()) {
      return JSON.stringify({
        ok: false,
        error:
          'Browser tools require the word cue "automate" in the user prompt. Without that cue, headed browser automation will not start.',
      })
    }
  }

  if (name.startsWith('browser_')) {
    try {
      const res = await fetch('/api/browser-runs/tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, arguments: args }),
      })
      const text = await res.text()
      try {
        const parsed = JSON.parse(text)
        const ok = parsed.ok === true && parsed.engine === 'playwright-chromium'
        return JSON.stringify({
          ...parsed,
          ok,
          exitCode: typeof parsed.exitCode === 'number' ? parsed.exitCode : ok ? 0 : 1,
        })
      } catch {
        return text
      }
    } catch (err) {
      return JSON.stringify({
        ok: false,
        error: err instanceof Error ? err.message : 'browser dispatch failed',
      })
    }
  }

  if (CLI_PROXY_TOOLS.has(name)) {
    if (name === 'replace_file_content' || name === 'multi_replace_file_content') {
      invalidateFileCache()
    }
    return proxyCliTool(name, args)
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
      cached: false,
      executedAt: new Date().toISOString(),
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
    const pathErr = sandboxPathError(filePath)
    if (pathErr) {
      return JSON.stringify({ ok: false, error: pathErr })
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

  if (name === 'pdf_ocr') {
    const filePath = String(args.path || '').trim()
    try {
      const res = await fetch('/api/pdf-ocr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: filePath,
          maxPages: args.maxPages,
          forceOcr: args.forceOcr,
        }),
      })
      const text = await res.text()
      return text
    } catch (err) {
      return JSON.stringify({ ok: false, error: err instanceof Error ? err.message : 'pdf_ocr failed' })
    }
  }

  if (name === 'read_file') {
    const filePath = String(args.path || args.filename || '').trim()
    const target = (args.target as ExecutionTarget) || getStoredTarget()
    if (!filePath) {
      return JSON.stringify({ ok: false, error: 'File path required' })
    }
    const pathErr = sandboxPathError(filePath)
    if (pathErr) {
      return JSON.stringify({ ok: false, error: pathErr })
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
    try {
      const res = await fetch('/api/http-get', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      return await res.text()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'http_get_json failed'
      return JSON.stringify({
        ok: false,
        error: message.includes('NetworkError') || message.includes('Failed to fetch') || message.includes('Load failed')
          ? 'The browser could not reach /api/http-get. Restart the Studio dev server and try again.'
          : message,
      })
    }
  }

  if (name === 'squadswarm_status') {
    return JSON.stringify(await fetchSquadswarmStatusViaHttpGetProxy())
  }

  if (name === 'squad_enqueue') {
    return JSON.stringify(
      await squadEnqueueViaProxy({
        task: String(args.task || ''),
        context: args.context != null ? String(args.context) : undefined,
      }),
    )
  }

  if (name === 'squad_collect') {
    return JSON.stringify(await squadCollectViaProxy({ taskId: String(args.taskId || '') }))
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

  if (name === 'list_scaffolds') {
    const q = String(args.query || '').toLowerCase()
    const all = getAllScaffolds()
    const filtered = q
      ? all.filter(
          (s) =>
            s.id.toLowerCase().includes(q) ||
            s.name.toLowerCase().includes(q) ||
            s.description.toLowerCase().includes(q),
        )
      : all
    return JSON.stringify({
      ok: true,
      count: filtered.length,
      templates: filtered.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        fileCount: Object.keys(s.files || {}).length,
      })),
    })
  }

  if (name === 'apply_scaffold') {
    const templateId = String(args.templateId || '').trim()
    const projectName = String(args.projectName || 'app').trim()
    const target = (args.target as ExecutionTarget) || getStoredTarget()

    const files = getScaffoldFiles(templateId, { projectName })
    if (files.length === 0) {
      return JSON.stringify({ ok: false, error: `Template not found: ${templateId}` })
    }

    invalidateFileCache()
    const filePayload: Record<string, { content: string }> = {}
    for (const f of files) {
      filePayload[f.path] = { content: f.content }
    }

    try {
      const res = await fetch(`${getSandboxBaseUrl()}/api/sandbox/materialize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          envId: 'web_session',
          target,
          files: filePayload,
          replaceAll: false,
        }),
      })
      if (res.ok) {
        return JSON.stringify({
          ok: true,
          templateId,
          projectName,
          writtenFiles: files.map((f) => f.path),
          message: `Successfully scaffolded ${templateId} with ${files.length} files`,
        })
      }
    } catch {
      // fallback to writing files via bash
    }

    for (const f of files) {
      const b64 = btoa(unescape(encodeURIComponent(f.content)))
      const cmd = `mkdir -p "$(dirname "${f.path}")" && echo "${b64}" | base64 -d > "${f.path}"`
      const bRes = await executeBashCommand(cmd, target)
      if (onBashResult) onBashResult(bRes)
    }

    return JSON.stringify({
      ok: true,
      templateId,
      projectName,
      writtenFiles: files.map((f) => f.path),
      message: `Scaffolded ${templateId} (${files.length} files) via fallback write`,
    })
  }

  if (name === 'set_workspace_dir') {
    const dir = String(args.directory || args.dir || '').trim()
    if (!dir) {
      return JSON.stringify({ ok: false, error: 'No directory specified' })
    }
    const pathErr = sandboxPathError(dir)
    if (pathErr || !dir.startsWith('/tmp/spark-sandboxes')) {
      return JSON.stringify({
        ok: false,
        error: pathErr || 'Host paths are forbidden; sandbox workspace under /tmp/spark-sandboxes required',
      })
    }
    const target = (args.target as ExecutionTarget) || getStoredTarget()
    setStoredWorkspaceDir(dir)
    invalidateFileCache()
    const checkRes = await executeBashCommand('pwd', target, undefined, undefined, dir)
    if (onBashResult) onBashResult(checkRes)
    return JSON.stringify({
      ok: checkRes.ok,
      activeWorkspaceDir: dir,
      currentDirectory: checkRes.stdout.trim(),
      target,
      error: checkRes.error || (checkRes.ok ? undefined : checkRes.stderr),
    })
  }

  if (name === 'get_workspace_dir') {
    const target = (args.target as ExecutionTarget) || getStoredTarget()
    const currentDir = getStoredWorkspaceDir(target)
    return JSON.stringify({
      ok: true,
      activeWorkspaceDir: currentDir,
      target,
      presets: [
        '/Users/adminuser/AIUI',
        '/Users/adminuser/r',
        '/Users/adminuser/log-sorter',
        '/Users/adminuser/abliterated_ui',
        '/tmp/spark-sandboxes',
        '/mnt/nvme/ocr_pipeline/workspaces',
      ],
    })
  }

  // Dynamic tool manager — same acquisition path as CLI agent
  if (name === 'research_and_acquire_tool') {
    return await researchAndAcquireTool(argsJson)
  }
  if (name === 'list_acquired_tools') {
    const reg = await loadDynamicToolRegistry()
    const tools = Object.values(reg)
    return JSON.stringify({ ok: true, count: tools.length, tools }, null, 2)
  }
  if (name === 'remove_acquired_tool') {
    const toolName = String(args.tool_name || '').trim()
    if (!toolName) {
      return JSON.stringify({ ok: false, error: 'tool_name is required' })
    }
    const reg = await loadDynamicToolRegistry()
    if (reg[toolName]) {
      delete reg[toolName]
      return JSON.stringify({ ok: true, message: `Tool '${toolName}' removed from session cache.` })
    }
    return JSON.stringify({ ok: false, error: `Tool '${toolName}' not found in registry.` })
  }

  const registry = await loadDynamicToolRegistry()
  if (registry[name]?.verified) {
    return await executeDynamicTool(name, argsJson)
  }

  try {
    const res = await fetch('/api/agent-runs/tool', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, arguments: args }),
    })
    const text = await res.text()
    try {
      const parsed = JSON.parse(text)
      if (parsed && typeof parsed === 'object' && !('ok' in parsed)) parsed.ok = res.ok
      // Known server tool succeeded (or returned a structured refusal) — do not JIT-acquire
      if (res.ok || parsed?.ok === true || parsed?.refused === true) {
        return JSON.stringify(parsed)
      }
      // Unknown / failed server tool → try acquisition instead of dead-end
      if (
        typeof parsed?.error === 'string' &&
        /unknown tool|not found|not (a )?registered/i.test(parsed.error)
      ) {
        const jit = await autoAcquireMissingTool(name, argsJson)
        if (jit.ok && typeof jit.executionResult === 'string') {
          if (jit.definition && (jit.definition as { function?: { name?: string } }).function?.name) {
            const fn = (jit.definition as { function: { name: string; description?: string; parameters?: Record<string, unknown> } }).function
            registerToolInSession({
              name: fn.name,
              description: fn.description || '',
              parameters: fn.parameters || {},
              runtime: 'python3',
              entrypoint: `tools/acquired/${fn.name}.py`,
              installedAt: Date.now(),
              verified: true,
            })
          }
          return jit.executionResult
        }
        return JSON.stringify(jit)
      }
      return JSON.stringify(parsed)
    } catch {
      return JSON.stringify({ ok: false, error: text.slice(0, 300) || `Tool ${name} failed` })
    }
  } catch (err) {
    // Network/API miss → acquire rather than "I can't"
    const jit = await autoAcquireMissingTool(name, argsJson)
    if (jit.ok && typeof jit.executionResult === 'string') {
      return jit.executionResult
    }
    if (jit.refused || jit.error) {
      return JSON.stringify(jit)
    }
    return JSON.stringify({ ok: false, error: err instanceof Error ? err.message : `Unknown tool: ${name}` })
  }
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
  'pdf_ocr',
  'now',
  'memory_search',
  'list_models',
  'http_get_json',
  'squadswarm_status',
  'squad_enqueue',
  'squad_collect',
  'list_linux_containers',
  'list_scaffolds',
])

/**
 * Curate tool/bash dumps for the next model turn: keep signal (head + tail),
 * drop middle noise, and hard-cap chars so context stays diagnosis-friendly.
 */
const OFFLOAD_HINT =
  'Omitted bulk stays out of local context. Use squad_enqueue with a specific question and a short excerpt; do not paste the omitted text back.'

function withOffloadHint(body: string): string {
  if (body.includes('squad_enqueue')) return body
  return `${body}\n${OFFLOAD_HINT}`
}

export function formatToolOutputForContext(text: string, maxChars = 3500): string {
  if (!text) return text

  let curated = text
  let omittedBulk = false
  const lines = text.split('\n')
  const MAX_LINES = 80
  if (lines.length > MAX_LINES) {
    const headN = 20
    const tailN = 60
    const omitted = lines.length - headN - tailN
    omittedBulk = true
    curated = [
      ...lines.slice(0, headN),
      '',
      `... [${omitted} lines omitted for context quality] ...`,
      '',
      ...lines.slice(-tailN),
    ].join('\n')
  }

  if (curated.length <= maxChars) return omittedBulk ? withOffloadHint(curated) : curated
  const half = Math.floor((maxChars - 160) / 2)
  const head = curated.slice(0, half)
  const tail = curated.slice(curated.length - half)
  const omitted = curated.length - (head.length + tail.length)
  return withOffloadHint(`${head}\n\n... [${omitted} characters truncated for context quality] ...\n\n${tail}`)
}

/** Shrink tool results from earlier rounds so the local model keeps room for the live step. */
export function compactHistoricToolMessages(messages: ChatMessage[]): ChatMessage[] {
  if (messages.length < 8) return messages
  const thresholdIdx = messages.length - 4
  return messages.map((msg, idx) => {
    if (idx < thresholdIdx && msg.role === 'tool' && typeof msg.content === 'string' && msg.content.length > 300) {
      const lines = msg.content.split('\n').filter(Boolean)
      const firstLine = (lines[0] || '').slice(0, 100)
      return {
        ...msg,
        content: `[Historical Tool Output Verified & Compacted]: "${firstLine}..." (${lines.length} lines archived from earlier round)`,
      }
    }
    return msg
  })
}

export type ApplyToolCallsOptions = {
  envId?: string
  chatId?: string
  target?: ExecutionTarget
  provider?: string
}

export async function applyToolCalls(
  toolCalls: ToolCall[],
  provider: ProviderConfig,
  onBashResult?: (res: BashExecResult) => void,
  _options?: ApplyToolCallsOptions,
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

Tools: bash, pdf_ocr, write_file, read_file, replace_file_content, multi_replace_file_content, grep_search, get_file_outline, start_daemon, read_daemon_logs, stop_daemon, list_daemons, nl_automate, browser_open, browser_screenshot, browser_click, browser_type, browser_console_logs, spawn_subagent, hand_off_run, list_models, http_get_json, squadswarm_status, squad_enqueue, squad_collect, now, memory_search, memory_checkpoint, spawn_linux_container, destroy_linux_container, list_linux_containers, list_scaffolds, apply_scaffold, set_workspace_dir, get_workspace_dir, ssh, base64, research_and_acquire_tool.
IMPORTANT: Tool names (grep_search, replace_file_content, read_file, write_file, get_file_outline, start_daemon, …) are NATIVE AGENT TOOLS, not shell commands. Never run tool names inside bash — invoke them via native function/tool calling.
Use nl_automate for a plain-language browser task on the local studio — only when the user said the word cue "automate".
Prefer native tool_calls. Only use <run>command</run> or fenced bash when tools are unavailable.
Never fabricate stdout/stderr — only trust real tool results. Bash results are fresh executions (cached: false, with executedAt); never claim they are cached or old.
Async support: when the user task or pasted context is large, or the command plan is long, call squad_enqueue with that heavy slice (returns taskId immediately), keep doing local bash/file work, then squad_collect for the compact result. Do not send .env, API keys, passwords, or /Users secrets. Local Spark vLLM is the orchestrator; Abliteration runs offloads in the background.

Surgical edit & proof-of-work laws:
1. Prefer grep_search / get_file_outline for discovery. Do not re-read a file already in context.
2. For existing files, use replace_file_content (or multi_replace_file_content). write_file is ONLY for brand-new files — never overwrite whole existing files.
3. After any file edit, your next action must be bash verification that exits 0 (tests, compile, or targeted check). Include that command and git diff --stat before claiming done.
4. Required loop: grep_search → replace_file_content → bash (exit 0). Forbidden: repeated read_file → write_file whole-file dumps.

Rules & Output Directives:
1. Dotpoint Thinking Logic: When formulating reasoning (e.g. inside <think> tags), structure thoughts as concise dotpoints:
   - • Intent / Hypothesis
   - • Planned commands / actions
   - • Verification criteria
2. Consolidated Bash Section: Execute and present all bash commands together in the same section without interleaving chatter.
3. Less Chat, Maximum Action: Cut conversational filler, meta-announcements, and chatty preambles. Let tool executions and results speak.
4. Fix-verify loop: on failure inspect → change approach → re-run. Never repeat the same failing command unchanged.
5. Anti-loop: no repeated preambles or identical answers; pivot when stuck.
6. Memory: memory_search before guessing past project context; checkpoint meaningful outcomes.
7. When done: return a compact dotpoint summary: what changed, evidence (exit codes, paths), and status. If you modified a file, you may not finish until a bash verification command has exited 0 since that edit. Include that command and git diff --stat.
8. Before browser_open, state the full URL. Unattended opens only succeed for origins on the allowlist.
9. ${WORD_CUE_SYSTEM_RULE}
10. ${MISSING_TOOL_ACQUISITION_RULE}

Containers (optional): profiles python_data | gpu_spark | minimal_alpine; destroy when finished.`

export const DEEP_BUILD_DIRECTIVE = `
=== DEEP BUILD MODE ===
Enterprise-grade thoroughness is required:
1. Plan boundaries, contracts, edge cases, and failure modes before writing.
2. Zero stubs/TODOs — complete implementations with validation, types, and logging.
3. Write and run automated tests; verify exit codes / HTTP status / real output.
4. End with an evidence-based summary of files changed and verified invariants.
5. Thinking/reasoning alone is not a reply — always emit user-visible content or tool_calls.`

export function buildTurnContextBlock(opts: {
  goal: string
  stage?: string
  lastFailed?: string | null
  avoid?: string | null
  round?: number
}): string {
  const currentWs = getStoredWorkspaceDir()
  const lines = ['=== CURRENT TURN CONTEXT ===', `Goal: ${opts.goal}`, `Active Workspace: ${currentWs}`]
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

/** Format assistant content for the AIUI workspace transcript. */
export function formatAgentResponseAsDevin(
  content: string,
  reasoning?: string,
  toolCalls?: ToolCall[],
  meta?: { status?: string; progress?: string },
): string {
  return formatAIUIResponse({
    content: content || '',
    reasoning: reasoning || undefined,
    status: meta?.status,
    progress: meta?.progress,
    toolCalls: (toolCalls || []).map((tc) => {
      let toolArgs: Record<string, unknown> = {}
      try {
        toolArgs = tc.function?.arguments ? JSON.parse(tc.function.arguments) : {}
      } catch {
        toolArgs = { raw: tc.function?.arguments || '' }
      }
      return {
        toolName: tc.function?.name || 'unknown',
        toolArgs,
        status: 'pending' as const,
      }
    }),
  })
}

// ------------------------------------------------------------------------------
// Type-safe autonomous agent engine (generics + metrics)
// ------------------------------------------------------------------------------

export interface AgentTurnMetrics {
  turnIndex: number
  durationMs: number
  cacheHit: boolean
  success: boolean
  timestamp: number
  error?: string
}

export interface AgentMetricsSnapshot {
  totalTurns: number
  totalDurationMs: number
  avgDurationMs: number
  cacheHits: number
  cacheMisses: number
  cacheHitRatio: number
  errorCount: number
  lastExecutedAt?: number
  turns: AgentTurnMetrics[]
}

export class AgentMetrics {
  private turns: AgentTurnMetrics[] = []
  private hits = 0
  private misses = 0
  private errors = 0

  recordTurn(durationMs: number, cacheHit: boolean, error?: Error): void {
    if (cacheHit) this.hits++
    else this.misses++
    if (error) this.errors++
    this.turns.push({
      turnIndex: this.turns.length + 1,
      durationMs,
      cacheHit,
      success: !error,
      timestamp: Date.now(),
      error: error?.message,
    })
    if (this.turns.length > 500) this.turns.shift()
  }

  getSnapshot(): AgentMetricsSnapshot {
    const total = this.hits + this.misses
    const totalDuration = this.turns.reduce((acc, t) => acc + t.durationMs, 0)
    return {
      totalTurns: this.turns.length,
      totalDurationMs: totalDuration,
      avgDurationMs: this.turns.length > 0 ? Math.round(totalDuration / this.turns.length) : 0,
      cacheHits: this.hits,
      cacheMisses: this.misses,
      cacheHitRatio: total > 0 ? this.hits / total : 0,
      errorCount: this.errors,
      lastExecutedAt: this.turns.length > 0 ? this.turns[this.turns.length - 1].timestamp : undefined,
      turns: [...this.turns],
    }
  }

  reset(): void {
    this.turns = []
    this.hits = 0
    this.misses = 0
    this.errors = 0
  }
}

export interface AgentOptions<TContext = Record<string, unknown>> {
  api?: ApiClient
  memory?: MemoryPalace
  context?: TContext
  logger?: (level: 'info' | 'warn' | 'error' | 'debug', msg: string, data?: unknown) => void
}

export class Agent<TInput = string, TOutput = string, TContext = Record<string, unknown>> {
  private api: ApiClient
  private memory: MemoryPalace
  private context: TContext
  private metrics: AgentMetrics
  private logger?: (level: 'info' | 'warn' | 'error' | 'debug', msg: string, data?: unknown) => void

  constructor(options: AgentOptions<TContext> = {}) {
    this.api = options.api || new ApiClient()
    this.memory = options.memory || new MemoryPalace()
    this.context = options.context || ({} as TContext)
    this.metrics = new AgentMetrics()
    this.logger = options.logger
  }

  async process(input: TInput, options?: { bypassCache?: boolean; timeout?: number }): Promise<TOutput> {
    const t0 = performance.now()
    let cacheHit = false
    let err: Error | undefined
    try {
      if (!input || (typeof input === 'string' && input.trim().length === 0)) {
        throw new Error('Input cannot be empty')
      }
      const cacheKey = typeof input === 'string' ? input : JSON.stringify(input)
      if (!options?.bypassCache) {
        const cached = this.memory.lookup(cacheKey)
        if (cached !== undefined) {
          cacheHit = true
          this.log('info', 'Memory cache hit', { key: cacheKey })
          if (typeof cached === 'string') {
            try {
              return JSON.parse(cached) as TOutput
            } catch {
              return cached as unknown as TOutput
            }
          }
          return cached as unknown as TOutput
        }
      }
      const queryStr = typeof input === 'string' ? input : JSON.stringify(input)
      const rawResult = await this.api.query(queryStr, options?.timeout)
      this.memory.store(cacheKey, rawResult)
      this.log('info', 'Query completed and cached', { key: cacheKey })
      try {
        return JSON.parse(rawResult) as TOutput
      } catch {
        return rawResult as unknown as TOutput
      }
    } catch (e: unknown) {
      err = e instanceof Error ? e : new Error(String(e))
      this.log('error', 'Agent.process failed', { error: err.message })
      throw err
    } finally {
      this.metrics.recordTurn(Math.round(performance.now() - t0), cacheHit, err)
    }
  }

  async batchProcess(inputs: TInput[]): Promise<TOutput[]> {
    return Promise.all(inputs.map((input) => this.process(input)))
  }

  getContext(): TContext {
    return this.context
  }

  setContext(partial: Partial<TContext>): void {
    this.context = { ...this.context, ...partial } as TContext
  }

  getMetrics(): AgentMetricsSnapshot {
    return this.metrics.getSnapshot()
  }

  resetMetrics(): void {
    this.metrics.reset()
  }

  setLogger(fn: (level: 'info' | 'warn' | 'error' | 'debug', msg: string, data?: unknown) => void): void {
    this.logger = fn
  }

  private log(level: 'info' | 'warn' | 'error' | 'debug', msg: string, data?: unknown): void {
    if (this.logger) {
      try {
        this.logger(level, msg, data)
      } catch {
        /* ignore logger failures */
      }
    }
  }
}


