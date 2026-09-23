/**
 * Client-side bridge to the continuous chat-response optimizer daemon (:17337).
 * When settings.optimizeChatResponses is on, the chat loop can pull nudges/policy.
 */

export type OptimizerPolicy = {
  enabled: boolean
  updatedAt: number
  healthIndex: number
  maxDurationMs: number
  minUsefulChars: number
  antiLoopStrict: boolean
  temperatureBias: number
  systemNudge: string | null
  reasons: string[]
  stats: {
    eventsSeen?: number
    emptyResponses?: number
    slowResponses?: number
    stalls?: number
    toolHeavyRatio?: number
    successRate?: number
    turnEfficiency?: number
    costEfficiency?: number
    safetyScore?: number
    compositeFitness?: number
    empiricalAlignment?: number
    archetype?: string
    multiTaskGenome?: Record<string, Record<string, number>>
    genes?: Record<string, number>
  }
}

const OPTIMIZER_URL =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_RESPONSE_OPTIMIZER_URL) ||
  'http://127.0.0.1:17337'

let cached: OptimizerPolicy | null = null
let cachedAt = 0

export function getResponseOptimizerUrl() {
  return OPTIMIZER_URL
}

export async function fetchOptimizerPolicy(force = false): Promise<OptimizerPolicy | null> {
  const now = Date.now()
  if (!force && cached && now - cachedAt < 5000) return cached
  try {
    const res = await fetch(`${OPTIMIZER_URL}/api/policy`, {
      signal: AbortSignal.timeout(1500),
    })
    if (!res.ok) return cached
    const json = (await res.json()) as { ok?: boolean; policy?: OptimizerPolicy }
    if (json.policy) {
      cached = json.policy
      cachedAt = now
      return cached
    }
  } catch {
    /* daemon offline */
  }
  return cached
}

/** Build an extra system/user nudge when optimizer recommends intervention. */
export function optimizerNudgeText(policy: OptimizerPolicy | null | undefined): string | null {
  if (!policy?.enabled) return null
  if (policy.systemNudge && policy.systemNudge.trim()) return policy.systemNudge.trim()
  return null
}

export function applyOptimizerTemperature(
  base: number | undefined,
  policy: OptimizerPolicy | null | undefined,
): number {
  const t = typeof base === 'number' ? base : 0.7
  if (!policy?.enabled) return t
  const next = t + (policy.temperatureBias || 0)
  return Math.min(1.2, Math.max(0, Number(next.toFixed(2))))
}

/** Complete autonomous multi-subsystem optimization protocol. */
export const COMPLETE_OPTIMIZATION_DIRECTIVE = `Execute a comprehensive, complete system and performance optimization pass across all active subsystems:

1. Telemetry & Hardware State:
   - Inspect host memory usage and system load average.
   - Run \`nvidia-smi\` on DGX Spark (target: dgx_spark) to verify GB10 GPU VRAM availability, check for any rogue/orphaned processes, and ensure vLLM has clean compute margins.

2. Subsystems & Services Health:
   - Probe the status of DGX vLLM (:8000), DGX Sandbox Runner (:17330), MemPalace Bridge (:17333), and Meta-Awareness Monitor (:17336).
   - Verify that all core services are responding with healthy 200 HTTP statuses.

3. Meta-Awareness & Self-Improvement Suggestions:
   - Fetch live diagnostics from \`http://127.0.0.1:17336/api/suggestions\` (or read \`logs/self-improvement-suggestions.json\`).
   - Evaluate all High and Medium severity findings (e.g. memory pressure, runner drift, noisy test wings).
   - Apply recommended mitigations autonomously.

4. Chat Response Policy & Patches:
   - Query the live policy at \`http://127.0.0.1:17337/api/policy\` and claim any pending response-optimizer patches via \`/api/patches/next-for-agent\`.

5. MemPalace Vector Memory Hygiene:
   - Query the 'ops' wing in MemPalace (:17333) to verify probe recall on core operations facts.
   - Checkpoint current runtime, workspace topology, and optimization facts to durable memory.

6. Sandbox & Workspace Pruning:
   - Inspect \`/tmp/spark-sandboxes/\` on DGX Spark, list active workspaces, and clean up dead temporary caches or orphaned test artifacts.

Synthesize all findings into an executive System Health & Optimization Report with concrete metrics, health score, and actions taken.`

/**
 * Returns true if the user prompt is a shortcut requesting complete optimization.
 * Matches "optimise", "optimize", "/optimise", "/optimize", "⚡ optimise", etc.
 */
export function isOptimizeShortcut(text: string): boolean {
  const t = (text || '').trim().toLowerCase()
  return /^(?:⚡\s*)?(?:optimise|optimize|\/optimise|\/optimize)(?:\s+.*)?$/i.test(t)
}

/**
 * Expands the concise "optimise" shortcut into the complete optimization directive.
 */
export function expandOptimizePrompt(text: string): string {
  if (!isOptimizeShortcut(text)) return text
  const trimmed = text.trim()
  const m = trimmed.match(/^(?:⚡\s*)?(?:optimise|optimize|\/optimise|\/optimize)(?:\s+(.*))?$/i)
  const extra = m && m[1] ? m[1].trim() : ''
  if (extra) {
    return `${COMPLETE_OPTIMIZATION_DIRECTIVE}\n\n**Special Focus Area:** ${extra}`
  }
  return COMPLETE_OPTIMIZATION_DIRECTIVE
}

