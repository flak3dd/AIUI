/**
 * SquadSwarm (https://www.squadswarm.xyz/) — public surface only.
 *
 * Live product: cooperative work brokerage (scopes → squad bids → AI-amplified delivery).
 * Public programmable surface observed: GET /api/health.
 * Scopes, docs, and MCP-related routes require magic-link / SIWE sign-in — no public API key
 * or OpenAPI was published. Do not invent authenticated endpoints here.
 */

export const SQUADSARM_ORIGIN = 'https://www.squadswarm.xyz'
export const SQUADSARM_ORIGINS = [
  'https://www.squadswarm.xyz',
  'https://squadswarm.xyz',
] as const

export const SQUADSARM_URLS = {
  home: `${SQUADSARM_ORIGIN}/`,
  about: `${SQUADSARM_ORIGIN}/about`,
  scopes: `${SQUADSARM_ORIGIN}/scopes`,
  docs: `${SQUADSARM_ORIGIN}/docs`,
  login: `${SQUADSARM_ORIGIN}/login`,
  signup: `${SQUADSARM_ORIGIN}/signup`,
  health: `${SQUADSARM_ORIGIN}/api/health`,
} as const

export type SquadswarmHealth = {
  status: string
  timestamp?: string
  version?: string
}

export type SquadswarmStatusResult = {
  ok: boolean
  online: boolean
  health?: SquadswarmHealth
  httpStatus?: number
  urls: typeof SQUADSARM_URLS
  note: string
  error?: string
}

const AUTH_GATED_NOTE =
  'Public beta. Only GET /api/health is unauthenticated. Scope Board, Docs, and agent/MCP surfaces require sign-in (magic link or wallet). Open the URLs in a browser — do not invent API keys.'

/**
 * Parse SquadSwarm /api/health JSON. Rejects unrelated payloads.
 */
export function parseSquadswarmHealth(data: unknown): SquadswarmHealth | null {
  if (!data || typeof data !== 'object') return null
  const row = data as Record<string, unknown>
  if (typeof row.status !== 'string' || !row.status.trim()) return null
  return {
    status: row.status,
    ...(typeof row.timestamp === 'string' ? { timestamp: row.timestamp } : {}),
    ...(typeof row.version === 'string' ? { version: row.version } : {}),
  }
}

/**
 * Fetch public health. In the Studio browser, pass a fetch that goes through
 * `/api/http-get` (CORS). In Node, default `fetch` works.
 */
export async function fetchSquadswarmStatus(options?: {
  fetchImpl?: typeof fetch
  timeoutMs?: number
}): Promise<SquadswarmStatusResult> {
  const fetchImpl = options?.fetchImpl ?? fetch
  const timeoutMs = Math.min(15000, Math.max(1000, options?.timeoutMs ?? 5000))
  const urls = SQUADSARM_URLS

  try {
    const res = await fetchImpl(urls.health, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    })
    const text = await res.text()
    let parsed: unknown = null
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = null
    }
    const health = parseSquadswarmHealth(parsed)
    const online = res.ok && health?.status === 'ok'
    return {
      ok: online,
      online,
      health: health ?? undefined,
      httpStatus: res.status,
      urls,
      note: AUTH_GATED_NOTE,
      ...(online
        ? {}
        : {
            error: health
              ? `Unexpected health status: ${health.status}`
              : `HTTP ${res.status}; body not SquadSwarm health JSON`,
          }),
    }
  } catch (err) {
    return {
      ok: false,
      online: false,
      urls,
      note: AUTH_GATED_NOTE,
      error: err instanceof Error ? err.message : 'SquadSwarm health check failed',
    }
  }
}

/** Studio-side fetch via localhost http-get proxy (avoids browser CORS). */
export async function fetchSquadswarmStatusViaHttpGetProxy(): Promise<SquadswarmStatusResult> {
  try {
    const res = await fetch('/api/http-get', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: SQUADSARM_URLS.health }),
    })
    const payload = await res.json().catch(() => null)
    if (!payload || typeof payload !== 'object') {
      return {
        ok: false,
        online: false,
        urls: SQUADSARM_URLS,
        note: AUTH_GATED_NOTE,
        error: 'http-get proxy returned a non-JSON body',
      }
    }
    const row = payload as Record<string, unknown>
    if (row.ok === false) {
      return {
        ok: false,
        online: false,
        urls: SQUADSARM_URLS,
        note: AUTH_GATED_NOTE,
        error: String(row.error || 'http-get proxy failed'),
      }
    }
    let parsed: unknown = row.data
    if (typeof parsed === 'string') {
      try {
        parsed = JSON.parse(parsed)
      } catch {
        /* keep string */
      }
    }
    const health = parseSquadswarmHealth(parsed)
    const httpStatus = typeof row.status === 'number' ? row.status : undefined
    const online = Boolean(health?.status === 'ok' && (httpStatus == null || httpStatus === 200))
    return {
      ok: online,
      online,
      health: health ?? undefined,
      httpStatus,
      urls: SQUADSARM_URLS,
      note: AUTH_GATED_NOTE,
      ...(online
        ? {}
        : {
            error: health
              ? `Unexpected health status: ${health.status}`
              : 'Proxy body was not SquadSwarm health JSON',
          }),
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'SquadSwarm proxy health check failed'
    return {
      ok: false,
      online: false,
      urls: SQUADSARM_URLS,
      note: AUTH_GATED_NOTE,
      error:
        message.includes('NetworkError') ||
        message.includes('Failed to fetch') ||
        message.includes('Load failed')
          ? 'The browser could not reach /api/http-get. Restart the Studio dev server and try again.'
          : message,
    }
  }
}
