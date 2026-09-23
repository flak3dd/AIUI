import { MEMPALACE_URL } from '../../config.mjs';

/**
 * Handle memory_search tool invocation
 */
export async function memorySearchHandler(args) {
  try {
    const res = await fetch(`${MEMPALACE_URL}/mcp/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: args.query,
        ...(args.wing ? { wing: args.wing } : {}),
        limit: args.limit || 5,
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`MemPalace HTTP ${res.status}`);
    const data = await res.json();
    const rawResults = data.result?.results || data.results || [];
    // Filter noisy test/browser wings
    const filtered = rawResults.filter((r) => !/test|browser|smoke/i.test(r.wing || ''));
    return JSON.stringify({ ok: true, count: filtered.length, results: filtered.slice(0, args.limit || 5) });
  } catch (err) {
    return JSON.stringify({ ok: false, error: `MemPalace search offline: ${err.message}` });
  }
}

/**
 * Handle memory_checkpoint tool invocation
 */
export async function memoryCheckpointHandler(args) {
  try {
    const res = await fetch(`${MEMPALACE_URL}/mcp/checkpoint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: args.items || [] }),
      signal: AbortSignal.timeout(5000),
    });
    const json = await res.json();
    return JSON.stringify({ ok: res.ok, ...json });
  } catch (err) {
    return JSON.stringify({ ok: false, error: `MemPalace checkpoint offline: ${err.message}` });
  }
}
