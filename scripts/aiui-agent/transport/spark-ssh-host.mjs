import net from 'node:net';

/** @typedef {{ ok: boolean, refused: boolean, timedOut?: boolean, error?: string }} TcpProbeResult */

const DEFAULT_TIMEOUT_MS = 2000;
const DEFAULT_PORT = 22;

/** Cached effective SSH host after at most one primary + one fallback probe. */
let cachedSparkSshHost = null;
/** Set when both configured and Tailscale SSH ports refuse/fail. */
let bothHostsRefused = false;

/**
 * Short TCP connect probe (no SSH, no keys).
 * @param {string} host
 * @param {number} [port]
 * @param {number} [timeoutMs]
 * @returns {Promise<TcpProbeResult>}
 */
export function probeTcpPort(host, port = DEFAULT_PORT, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {
        /* ignore */
      }
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish({ ok: true, refused: false }));
    socket.once('timeout', () => finish({ ok: false, refused: false, timedOut: true, error: 'ETIMEDOUT' }));
    socket.once('error', (err) => {
      const code = err && (err.code || err.message);
      const refused = code === 'ECONNREFUSED' || /ECONNREFUSED/i.test(String(code || ''));
      finish({ ok: false, refused, error: String(code || 'error') });
    });
    try {
      socket.connect(port, host);
    } catch (err) {
      finish({ ok: false, refused: false, error: String(err?.code || err?.message || err) });
    }
  });
}

export function resetSparkSshHostCache() {
  cachedSparkSshHost = null;
  bothHostsRefused = false;
}

export function getCachedSparkSshHost() {
  return cachedSparkSshHost;
}

export function sparkSshBothHostsRefused() {
  return bothHostsRefused;
}

/**
 * Resolve Spark SSH host: try configured host, on ECONNREFUSED fall back to
 * Tailscale once. Never loops. Does not invent tunnels if both refuse.
 *
 * @param {{
 *   configuredHost?: string,
 *   fallbackHost?: string,
 *   port?: number,
 *   timeoutMs?: number,
 *   probe?: typeof probeTcpPort,
 *   force?: boolean,
 * }} [options]
 * @returns {Promise<{ host: string, usedFallback: boolean, bothRefused: boolean }>}
 */
export async function resolveSparkSshHost(options = {}) {
  const configuredHost = String(options.configuredHost || '').trim();
  const fallbackHost = String(options.fallbackHost || '').trim();
  const port = options.port ?? DEFAULT_PORT;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const probe = options.probe || probeTcpPort;

  if (!options.force && cachedSparkSshHost) {
    return {
      host: cachedSparkSshHost,
      usedFallback: cachedSparkSshHost !== configuredHost,
      bothRefused: bothHostsRefused,
    };
  }

  if (!configuredHost) {
    return { host: fallbackHost || configuredHost, usedFallback: Boolean(fallbackHost), bothRefused: false };
  }

  const primary = await probe(configuredHost, port, timeoutMs);
  if (primary.ok) {
    cachedSparkSshHost = configuredHost;
    bothHostsRefused = false;
    return { host: configuredHost, usedFallback: false, bothRefused: false };
  }

  // One fallback only when primary is connection-refused and fallback differs.
  if (
    primary.refused &&
    fallbackHost &&
    fallbackHost !== configuredHost
  ) {
    const secondary = await probe(fallbackHost, port, timeoutMs);
    if (secondary.ok) {
      cachedSparkSshHost = fallbackHost;
      bothHostsRefused = false;
      return { host: fallbackHost, usedFallback: true, bothRefused: false };
    }
    bothHostsRefused = secondary.refused || primary.refused;
    cachedSparkSshHost = configuredHost;
    return { host: configuredHost, usedFallback: false, bothRefused: true };
  }

  // Primary not refused (timeout/other) or no distinct fallback — keep configured, no loop.
  cachedSparkSshHost = configuredHost;
  bothHostsRefused = false;
  return { host: configuredHost, usedFallback: false, bothRefused: false };
}
