/**
 * Layer 1 URL gate + optional Bright Data SuperProxy residential egress for http_get_json.
 * Public URL reads only. Never browser proof; never Web Unlocker / CAPTCHA path.
 */

import http from 'node:http'
import tls from 'node:tls'
import { URL } from 'node:url'

const MAX_REDIRECTS = 5
const BODY_PREVIEW_CHARS = 4000

/**
 * @param {unknown} rawUrl
 * @returns {{ ok: true, url: string } | { ok: false, error: string }}
 */
export function isValidHttpGetUrl(rawUrl) {
  if (rawUrl == null) {
    return { ok: false, error: 'url is required' }
  }
  const trimmed = String(rawUrl).trim()
  if (!trimmed) {
    return { ok: false, error: 'url is required' }
  }

  let parsed
  try {
    parsed = new URL(trimmed)
  } catch {
    return { ok: false, error: 'Invalid URL format' }
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: 'Only http:// and https:// URLs are permitted' }
  }

  if (parsed.username || parsed.password) {
    return { ok: false, error: 'Credentials in URL are not permitted' }
  }

  if (!parsed.hostname) {
    return { ok: false, error: 'URL hostname is required' }
  }

  if (isPrivateOrLocalHostname(parsed.hostname)) {
    return {
      ok: false,
      error: 'Private, loopback, and link-local addresses are not permitted',
    }
  }

  return { ok: true, url: trimmed }
}

/**
 * @param {string} hostname
 */
export function isPrivateOrLocalHostname(hostname) {
  const host = String(hostname || '')
    .replace(/^\[|\]$/g, '')
    .toLowerCase()

  if (!host) return true
  if (host === 'localhost' || host === '0.0.0.0' || host === '::' || host === '::1') return true
  if (host.endsWith('.localhost') || host.endsWith('.local')) return true

  // IPv4-mapped IPv6 (::ffff:a.b.c.d)
  const v4Mapped = host.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)
  if (v4Mapped) return isPrivateIpv4(v4Mapped[1])

  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) {
    return isPrivateIpv4(host)
  }

  if (host.includes(':')) {
    return isPrivateIpv6(host)
  }

  return false
}

/**
 * @param {string} ip
 */
function isPrivateIpv4(ip) {
  const parts = ip.split('.').map((p) => Number(p))
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true
  }
  const [a, b] = parts
  if (a === 10) return true
  if (a === 127) return true
  if (a === 0) return true
  if (a === 169 && b === 254) return true // link-local
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT / shared (optional hardening)
  return false
}

/**
 * @param {string} host
 */
function isPrivateIpv6(host) {
  const h = host.toLowerCase()
  if (h === '::1' || h === '::') return true
  // link-local fe80::/10
  if (/^fe[89ab][0-9a-f]:/i.test(h) || h.startsWith('fe80:')) return true
  // unique local fc00::/7
  if (h.startsWith('fc') || h.startsWith('fd')) return true
  return false
}

/**
 * SuperProxy env names from scripts/checks/list-env-values.mjs.
 * All four must be set; otherwise direct egress.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ host: string, port: number, username: string, password: string } | null}
 */
export function resolveBrightDataProxyFromEnv(env = process.env) {
  const host = String(env.BRIGHTDATA_HOST || '').trim()
  const portRaw = String(env.BRIGHTDATA_PORT || '').trim()
  const username = String(env.BRIGHTDATA_USER || '').trim()
  const password = String(env.BRIGHTDATA_PASS || '').trim()
  if (!host || !portRaw || !username || !password) return null
  const port = Number(portRaw)
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null
  return { host, port, username, password }
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {'brightdata-residential' | 'direct'}
 */
export function resolveHttpGetEgress(env = process.env) {
  return resolveBrightDataProxyFromEnv(env) ? 'brightdata-residential' : 'direct'
}

/**
 * @param {string} text
 * @param {string | null | undefined} contentType
 */
export function buildHttpGetBodyMeta(text, contentType) {
  const raw = String(text ?? '')
  const truncated = raw.length > BODY_PREVIEW_CHARS
  return {
    contentType: contentType ? String(contentType).split(';')[0].trim() || null : null,
    bytes: Buffer.byteLength(raw, 'utf8'),
    chars: raw.length,
    truncated,
    previewChars: BODY_PREVIEW_CHARS,
  }
}

/**
 * Plain GET via optional HTTP CONNECT SuperProxy. No Unlocker headers/API.
 * @param {string} urlString
 * @param {{ timeoutMs?: number, env?: NodeJS.ProcessEnv }} [opts]
 * @returns {Promise<{
 *   ok: boolean,
 *   status: number,
 *   data: string,
 *   egress: 'brightdata-residential' | 'direct',
 *   finalUrl: string,
 *   body: ReturnType<typeof buildHttpGetBodyMeta>,
 * }>}
 */
export async function fetchPublicHttpGet(urlString, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 10000
  const env = opts.env ?? process.env
  const proxy = resolveBrightDataProxyFromEnv(env)
  const egress = proxy ? 'brightdata-residential' : 'direct'

  if (!proxy) {
    const res = await fetch(urlString, {
      method: 'GET',
      headers: { Accept: 'application/json,text/plain,*/*' },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'follow',
    })
    const text = await res.text()
    const contentType = res.headers.get('content-type')
    const body = buildHttpGetBodyMeta(text, contentType)
    return {
      ok: res.ok,
      status: res.status,
      data: text.slice(0, BODY_PREVIEW_CHARS),
      egress,
      finalUrl: String(res.url || urlString),
      body,
    }
  }

  const result = await httpGetViaBrightDataProxy(urlString, proxy, timeoutMs)
  const body = buildHttpGetBodyMeta(result.body, result.contentType)
  return {
    ok: result.status >= 200 && result.status < 300,
    status: result.status,
    data: String(result.body || '').slice(0, BODY_PREVIEW_CHARS),
    egress,
    finalUrl: result.finalUrl,
    body,
  }
}

/**
 * Single public GET through Bright Data SuperProxy (HTTP CONNECT).
 * Does not call api.brightdata.com, Web Unlocker, or captcha/cookie headers.
 * Follows a small number of redirects only when the Location still passes the public URL gate.
 *
 * @param {string} urlString
 * @param {{ host: string, port: number, username: string, password: string }} proxy
 * @param {number} timeoutMs
 */
async function httpGetViaBrightDataProxy(urlString, proxy, timeoutMs) {
  let current = urlString
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const gate = isValidHttpGetUrl(current)
    if (!gate.ok) {
      throw new Error(`Redirect target rejected: ${gate.error}`)
    }
    const one = await httpGetOnceViaBrightDataProxy(gate.url, proxy, timeoutMs)
    const status = one.status
    if (status >= 300 && status < 400 && one.location) {
      const next = new URL(one.location, gate.url).toString()
      current = next
      continue
    }
    return {
      status: one.status,
      body: one.body,
      contentType: one.contentType,
      finalUrl: gate.url,
    }
  }
  throw new Error(`Too many redirects (max ${MAX_REDIRECTS})`)
}

/**
 * @param {string} urlString
 * @param {{ host: string, port: number, username: string, password: string }} proxy
 * @param {number} timeoutMs
 */
/**
 * Read one HTTP response from a duplex stream (CONNECT tunnel or TLS).
 * @param {import('node:stream').Duplex} stream
 * @param {string} requestText
 * @param {number} timeoutMs
 */
function httpExchangeOnStream(stream, requestText, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false
    const chunks = []
    const timer = setTimeout(() => {
      fail(new Error('Proxied GET timed out'))
    }, timeoutMs)

    const cleanup = () => {
      clearTimeout(timer)
      stream.removeListener('data', onData)
      stream.removeListener('error', onError)
      stream.removeListener('end', onEnd)
    }

    const fail = (err) => {
      if (settled) return
      settled = true
      cleanup()
      try {
        stream.destroy()
      } catch {
        /* ignore */
      }
      reject(err instanceof Error ? err : new Error(String(err)))
    }

    const succeed = (value) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(value)
    }

    const onError = (err) => fail(err)

    const tryParse = () => {
      const buf = Buffer.concat(chunks)
      const sep = buf.indexOf('\r\n\r\n')
      if (sep < 0) return
      const head = buf.subarray(0, sep).toString('utf8')
      const lines = head.split('\r\n')
      const statusLine = lines[0] || ''
      const statusMatch = statusLine.match(/^HTTP\/\d(?:\.\d)?\s+(\d{3})/i)
      const status = statusMatch ? Number(statusMatch[1]) : 0
      /** @type {Record<string, string>} */
      const headers = {}
      for (let i = 1; i < lines.length; i++) {
        const idx = lines[i].indexOf(':')
        if (idx <= 0) continue
        const key = lines[i].slice(0, idx).trim().toLowerCase()
        const val = lines[i].slice(idx + 1).trim()
        headers[key] = val
      }
      const bodyStart = sep + 4
      const contentLength = headers['content-length']
        ? Number(headers['content-length'])
        : null
      if (contentLength != null && Number.isFinite(contentLength)) {
        if (buf.length < bodyStart + contentLength) return
        const body = buf.subarray(bodyStart, bodyStart + contentLength).toString('utf8')
        succeed({
          status,
          body,
          contentType: headers['content-type'] || null,
          location: headers.location || null,
        })
        return
      }
      // No Content-Length: wait for stream end (Connection: close).
    }

    const onData = (chunk) => {
      chunks.push(chunk)
      tryParse()
    }

    const onEnd = () => {
      if (settled) return
      const buf = Buffer.concat(chunks)
      const sep = buf.indexOf('\r\n\r\n')
      if (sep < 0) {
        fail(new Error('Proxied response missing headers'))
        return
      }
      const head = buf.subarray(0, sep).toString('utf8')
      const lines = head.split('\r\n')
      const statusLine = lines[0] || ''
      const statusMatch = statusLine.match(/^HTTP\/\d(?:\.\d)?\s+(\d{3})/i)
      const status = statusMatch ? Number(statusMatch[1]) : 0
      /** @type {Record<string, string>} */
      const headers = {}
      for (let i = 1; i < lines.length; i++) {
        const idx = lines[i].indexOf(':')
        if (idx <= 0) continue
        headers[lines[i].slice(0, idx).trim().toLowerCase()] = lines[i].slice(idx + 1).trim()
      }
      succeed({
        status,
        body: buf.subarray(sep + 4).toString('utf8'),
        contentType: headers['content-type'] || null,
        location: headers.location || null,
      })
    }

    stream.on('data', onData)
    stream.on('error', onError)
    stream.on('end', onEnd)
    stream.write(requestText)
  })
}

function httpGetOnceViaBrightDataProxy(urlString, proxy, timeoutMs) {
  const target = new URL(urlString)
  const isHttps = target.protocol === 'https:'
  const destPort = Number(target.port) || (isHttps ? 443 : 80)
  const auth = Buffer.from(`${proxy.username}:${proxy.password}`, 'utf8').toString('base64')
  const path = `${target.pathname || '/'}${target.search || ''}`
  const requestText =
    `GET ${path} HTTP/1.1\r\n` +
    `Host: ${target.host}\r\n` +
    'Accept: application/json,text/plain,*/*\r\n' +
    'Connection: close\r\n' +
    '\r\n'

  return new Promise((resolve, reject) => {
    const connectReq = http.request({
      host: proxy.host,
      port: proxy.port,
      method: 'CONNECT',
      path: `${target.hostname}:${destPort}`,
      headers: {
        Host: `${target.hostname}:${destPort}`,
        'Proxy-Authorization': `Basic ${auth}`,
      },
      timeout: timeoutMs,
    })

    const onFail = (err) => {
      connectReq.destroy()
      reject(err instanceof Error ? err : new Error(String(err)))
    }

    connectReq.on('timeout', () => onFail(new Error('Proxy CONNECT timed out')))
    connectReq.on('error', onFail)

    connectReq.on('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy()
        reject(new Error(`Proxy CONNECT failed with status ${res.statusCode}`))
        return
      }

      const run = (stream) => {
        httpExchangeOnStream(stream, requestText, timeoutMs).then(resolve, reject)
      }

      if (isHttps) {
        const tlsSocket = tls.connect(
          {
            socket,
            servername: target.hostname,
            timeout: timeoutMs,
          },
          () => run(tlsSocket),
        )
        tlsSocket.on('error', reject)
        tlsSocket.on('timeout', () => {
          tlsSocket.destroy()
          reject(new Error('Proxied TLS timed out'))
        })
      } else {
        run(socket)
      }
    })

    connectReq.end()
  })
}
