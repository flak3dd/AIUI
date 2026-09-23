import {
  fetchPublicHttpGet,
  isValidHttpGetUrl,
} from '../http-get-url.mjs'

export { isValidHttpGetUrl, resolveBrightDataProxyFromEnv, resolveHttpGetEgress } from '../http-get-url.mjs'

/**
 * Handle list_models tool invocation
 */
export async function listModelsHandler(args, ctx) {
  try {
    const base = String(ctx.baseUrl || '').replace(/\/+$/, '');
    const url = base.endsWith('/v1') ? `${base}/models` : `${base}/v1/models`;
    const headers = ctx.apiKey ? { Authorization: `Bearer ${ctx.apiKey}` } : {};
    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    let rows = (data.data || []).map((m) => m.id);
    if (args.query) {
      const q = String(args.query).toLowerCase();
      rows = rows.filter((id) => id.toLowerCase().includes(q));
    }
    const limit = args.limit || 30;
    return JSON.stringify({ ok: true, count: rows.length, models: rows.slice(0, limit) });
  } catch (err) {
    return JSON.stringify({ ok: false, error: err.message });
  }
}

/**
 * Handle http_get_json tool invocation.
 * Layer 1: gated public http(s) GET only. Optional residential SuperProxy when BRIGHTDATA_* env is set.
 * Never counts as browser proof; never Unlocker/CAPTCHA/cookie path.
 */
export async function httpGetJsonHandler(args) {
  const gate = isValidHttpGetUrl(args?.url)
  if (!gate.ok) {
    return JSON.stringify({ ok: false, error: gate.error })
  }

  try {
    const result = await fetchPublicHttpGet(gate.url, { timeoutMs: 10000 })
    return JSON.stringify({
      ok: result.ok,
      status: result.status,
      finalUrl: result.finalUrl,
      data: String(result.data || '').slice(0, 4000),
      body: result.body,
      egress: result.egress,
    })
  } catch (err) {
    return JSON.stringify({ ok: false, error: err.message })
  }
}

/**
 * Handle now tool invocation
 */
export function nowHandler() {
  return JSON.stringify({ ok: true, iso: new Date().toISOString(), timestamp: Date.now() });
}

/**
 * Handle base64 encode/decode tool invocation
 */
export function base64Handler(args) {
  const action = String(args.action || 'encode').toLowerCase().trim();
  const data = String(args.data || '');
  const urlSafe = Boolean(args.urlSafe);

  try {
    if (action === 'encode') {
      let encoded = Buffer.from(data, 'utf8').toString('base64');
      if (urlSafe) {
        encoded = encoded.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      }
      return JSON.stringify({
        ok: true,
        action: 'encode',
        urlSafe,
        result: encoded,
        inputBytes: Buffer.byteLength(data, 'utf8'),
        outputChars: encoded.length,
      });
    } else if (action === 'decode') {
      let raw = data.trim();
      if (urlSafe || raw.includes('-') || raw.includes('_')) {
        raw = raw.replace(/-/g, '+').replace(/_/g, '/');
        while (raw.length % 4 !== 0) raw += '=';
      }
      const decoded = Buffer.from(raw, 'base64').toString('utf8');
      return JSON.stringify({
        ok: true,
        action: 'decode',
        urlSafe,
        result: decoded,
        inputChars: data.length,
        outputBytes: Buffer.byteLength(decoded, 'utf8'),
      });
    } else {
      return JSON.stringify({ ok: false, error: `Invalid action "${action}". Must be "encode" or "decode".` });
    }
  } catch (err) {
    return JSON.stringify({ ok: false, error: `Base64 ${action} failed: ${err.message}` });
  }
}
