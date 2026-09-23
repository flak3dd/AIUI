/**
 * SquadSwarm public client for the CLI agent.
 * Mirrors src/lib/squadswarm.ts — health only; no invented auth.
 */

export const SQUADSARM_ORIGIN = 'https://www.squadswarm.xyz'

export const SQUADSARM_URLS = {
  home: `${SQUADSARM_ORIGIN}/`,
  about: `${SQUADSARM_ORIGIN}/about`,
  scopes: `${SQUADSARM_ORIGIN}/scopes`,
  docs: `${SQUADSARM_ORIGIN}/docs`,
  login: `${SQUADSARM_ORIGIN}/login`,
  signup: `${SQUADSARM_ORIGIN}/signup`,
  health: `${SQUADSARM_ORIGIN}/api/health`,
}

const AUTH_GATED_NOTE =
  'Public beta. Only GET /api/health is unauthenticated. Scope Board, Docs, and agent/MCP surfaces require sign-in (magic link or wallet). Open the URLs in a browser — do not invent API keys.'

/**
 * @param {unknown} data
 * @returns {{ status: string, timestamp?: string, version?: string } | null}
 */
export function parseSquadswarmHealth(data) {
  if (!data || typeof data !== 'object') return null
  const row = /** @type {Record<string, unknown>} */ (data)
  if (typeof row.status !== 'string' || !row.status.trim()) return null
  return {
    status: row.status,
    ...(typeof row.timestamp === 'string' ? { timestamp: row.timestamp } : {}),
    ...(typeof row.version === 'string' ? { version: row.version } : {}),
  }
}

/**
 * @param {{ timeoutMs?: number, fetchImpl?: typeof fetch }} [options]
 */
export async function fetchSquadswarmStatus(options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = Math.min(15000, Math.max(1000, options.timeoutMs ?? 5000))
  const urls = SQUADSARM_URLS

  try {
    const res = await fetchImpl(urls.health, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    })
    const text = await res.text()
    let parsed = null
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

/** CLI / agent tool handler — returns JSON string. */
export async function squadswarmStatusHandler() {
  return JSON.stringify(await fetchSquadswarmStatus())
}
