/**
 * MemPalace browser client — calls the mempalace-bridge HTTP server.
 * Follows the bashShell.ts pattern (localStorage-backed URL, typed responses, timeout fetch).
 */

export interface MemPalaceStatus {
  online: boolean
  url: string
  latencyMs?: number
  totalDrawers?: number
  wings?: Record<string, number>
  error?: string
}

export interface MemPalaceHit {
  text: string
  wing: string
  room: string
  source_file?: string
  similarity?: number
}

export interface MemPalaceSearchResult {
  results: MemPalaceHit[]
  total?: number
}

export interface MemPalaceCheckpointResult {
  added: unknown[]
  duplicates: unknown[]
  errors: unknown[]
  diary?: unknown
}

export interface MemPalaceDiaryEntry {
  date?: string
  timestamp?: string
  topic?: string
  content?: string
}

const DEFAULT_MEMPALACE_URL =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_MEMPALACE_URL) ||
  'http://127.0.0.1:17333'
const STORAGE_MEMPALACE_URL_KEY = 'abliterated_mempalace_url'
const STORAGE_AUTO_RECALL_KEY = 'abliterated_mempalace_auto_recall'
const STORAGE_AUTO_CHECKPOINT_KEY = 'abliterated_mempalace_auto_checkpoint'

export function getMempalaceBaseUrl(): string {
  try {
    const stored = localStorage.getItem(STORAGE_MEMPALACE_URL_KEY)
    if (stored) return stored
  } catch {
    /* ignore */
  }
  if (typeof window !== 'undefined' && (window.location.port === '5173' || window.location.port === '5174')) {
    return `${window.location.origin}/mempalace-bridge`
  }
  return DEFAULT_MEMPALACE_URL
}

export function setMempalaceBaseUrl(url: string) {
  try {
    localStorage.setItem(STORAGE_MEMPALACE_URL_KEY, url)
  } catch {
    /* ignore */
  }
}

export function getAutoRecall(): boolean {
  try {
    return localStorage.getItem(STORAGE_AUTO_RECALL_KEY) !== 'false'
  } catch {
    return true
  }
}

export function setAutoRecall(enabled: boolean) {
  try {
    localStorage.setItem(STORAGE_AUTO_RECALL_KEY, enabled ? 'true' : 'false')
  } catch {
    /* ignore */
  }
}

export function getAutoCheckpoint(): boolean {
  try {
    return localStorage.getItem(STORAGE_AUTO_CHECKPOINT_KEY) !== 'false'
  } catch {
    return true
  }
}

export function setAutoCheckpoint(enabled: boolean) {
  try {
    localStorage.setItem(STORAGE_AUTO_CHECKPOINT_KEY, enabled ? 'true' : 'false')
  } catch {
    /* ignore */
  }
}

/** Check if the MemPalace bridge is healthy and reachable */
export async function checkMempalaceHealth(baseUrl = getMempalaceBaseUrl()): Promise<MemPalaceStatus> {
  const t0 = performance.now()
  try {
    const res = await fetch(`${baseUrl}/health`, {
      signal: AbortSignal.timeout(2500),
    })
    const latencyMs = Math.round(performance.now() - t0)
    if (res.ok) {
      const json = await res.json()
      return {
        online: Boolean(json.mcpReady),
        url: baseUrl,
        latencyMs,
      }
    }
    return {
      online: false,
      url: baseUrl,
      latencyMs,
      error: `HTTP ${res.status}`,
    }
  } catch (err: unknown) {
    return {
      online: false,
      url: baseUrl,
      error: err instanceof Error ? err.message : 'Connection refused',
    }
  }
}

/** Semantic search the MemPalace palace */
export async function searchMemory(
  query: string,
  opts?: { wing?: string; room?: string; limit?: number },
  baseUrl = getMempalaceBaseUrl(),
): Promise<MemPalaceSearchResult> {
  const res = await fetch(`${baseUrl}/mcp/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query,
      limit: opts?.limit ?? 5,
      ...(opts?.wing ? { wing: opts.wing } : {}),
      ...(opts?.room ? { room: opts.room } : {}),
    }),
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) {
    throw new Error(`MemPalace search HTTP ${res.status}`)
  }
  const json = await res.json()
  // Bridge returns { ok, result: { results: [...] } } where result is parsed MCP tool output
  const result = json.result || json
  return {
    results: Array.isArray(result.results) ? result.results : [],
    total: result.total,
  }
}

/** Save conversation items to the palace (semantic-dedup + diary in one call) */
export async function checkpointMemory(
  items: Array<{ wing: string; room: string; content: string }>,
  diary?: { agent_name: string; entry: string; topic?: string },
  baseUrl = getMempalaceBaseUrl(),
): Promise<MemPalaceCheckpointResult> {
  const res = await fetch(`${baseUrl}/mcp/checkpoint`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      items,
      ...(diary ? { diary } : {}),
      added_by: 'web-api-app',
    }),
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) {
    throw new Error(`MemPalace checkpoint HTTP ${res.status}`)
  }
  const json = await res.json()
  const result = json.result || json
  return {
    added: result.added || [],
    duplicates: result.duplicates || [],
    errors: result.errors || [],
    diary: result.diary,
  }
}

/** Write a diary entry for an agent */
export async function writeDiary(
  agent: string,
  entry: string,
  topic?: string,
  baseUrl = getMempalaceBaseUrl(),
): Promise<{ success: boolean }> {
  const res = await fetch(`${baseUrl}/mcp/diary-write`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agent_name: agent, entry, ...(topic ? { topic } : {}) }),
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) {
    throw new Error(`MemPalace diary-write HTTP ${res.status}`)
  }
  const json = await res.json()
  const result = json.result || json
  return { success: Boolean(result.success) }
}

/** Read recent diary entries for an agent */
export async function readDiary(
  agent: string,
  lastN = 10,
  baseUrl = getMempalaceBaseUrl(),
): Promise<{ entries: MemPalaceDiaryEntry[] }> {
  const params = new URLSearchParams({ agent_name: agent, last_n: String(lastN) })
  const res = await fetch(`${baseUrl}/mcp/diary-read?${params}`, {
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) {
    throw new Error(`MemPalace diary-read HTTP ${res.status}`)
  }
  const json = await res.json()
  const result = json.result || json
  return { entries: result.entries || [] }
}

/** Get full palace status (drawer count, wings, protocol) */
export async function getMempalaceStatus(
  baseUrl = getMempalaceBaseUrl(),
): Promise<{ totalDrawers: number; wings: Record<string, number> }> {
  const res = await fetch(`${baseUrl}/mcp/status`, {
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) {
    throw new Error(`MemPalace status HTTP ${res.status}`)
  }
  const json = await res.json()
  const result = json.result || json
  return {
    totalDrawers: result.total_drawers || 0,
    wings: result.wings || {},
  }
}
