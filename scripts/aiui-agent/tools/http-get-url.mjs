/**
 * Layer 1 URL gate + optional Bright Data SuperProxy egress for http_get_json.
 * Public URL reads only. Never browser proof; never Web Unlocker / CAPTCHA path.
 */

import http from 'node:http'
import https from 'node:https'
import tls from 'node:tls'
import { URL } from 'node:url'

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
 * @returns {'brightdata-proxy' | 'direct'}
 */
export function resolveHttpGetEgress(env = process.env) {
  return resolveBrightDataProxyFromEnv(env) ? 'brightdata-proxy' : 'direct'
}

/**
 * Plain GET via optional HTTP CONNECT SuperProxy. No Unlocker headers/API.
 * @param {string} urlString
 * @param {{ timeoutMs?: number, env?: NodeJS.ProcessEnv }} [opts]
 */
export async function fetchPublicHttpGet(urlString, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 10000
  const env = opts.env ?? process.env
  const proxy = resolveBrightDataProxyFromEnv(env)
  const egress = proxy ? 'brightdata-proxy' : 'direct'

  if (!proxy) {
    const res = await fetch(urlString, {
      method: 'GET',
      headers: { Accept: 'application/json,text/plain,*/*' },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'follow',
    })
    const text = await res.text()
    return { ok: res.ok, status: res.status, data: text, egress }
  }

  const { status, body } = await httpGetViaBrightDataProxy(urlString, proxy, timeoutMs)
  return { ok: status >= 200 && status < 300, status, data: body, egress }
}

/**
 * Single public GET through Bright Data SuperProxy (HTTP CONNECT).
 * Does not call api.brightdata.com, Web Unlocker, or captcha/cookie headers.
 *
 * @param {string} urlString
 * @param {{ host: string, port: number, username: string, password: string }} proxy
 * @param {number} timeoutMs
 */
function httpGetViaBrightDataProxy(urlString, proxy, timeoutMs) {
  const target = new URL(urlString)
  const isHttps = target.protocol === 'https:'
  const destPort = Number(target.port) || (isHttps ? 443 : 80)
  const auth = Buffer.from(`${proxy.username}:${proxy.password}`, 'utf8').toString('base64')
  const path = `${target.pathname || '/'}${target.search || ''}`

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

      const openRequest = (connection) => {
        const req = (isHttps ? https : http).request(
          {
            protocol: target.protocol,
            hostname: target.hostname,
            port: destPort,
            method: 'GET',
            path,
            headers: {
              Host: target.host,
              Accept: 'application/json,text/plain,*/*',
              Connection: 'close',
            },
            agent: false,
            createConnection: () => connection,
            timeout: timeoutMs,
          },
          (proxiedRes) => {
            const chunks = []
            proxiedRes.on('data', (c) => chunks.push(c))
            proxiedRes.on('end', () => {
              resolve({
                status: proxiedRes.statusCode || 0,
                body: Buffer.concat(chunks).toString('utf8'),
              })
            })
          },
        )
        req.on('timeout', () => req.destroy(new Error('Proxied GET timed out')))
        req.on('error', reject)
        req.end()
      }

      if (isHttps) {
        const tlsSocket = tls.connect(
          {
            socket,
            servername: target.hostname,
            timeout: timeoutMs,
          },
          () => openRequest(tlsSocket),
        )
        tlsSocket.on('error', reject)
        tlsSocket.on('timeout', () => {
          tlsSocket.destroy()
          reject(new Error('Proxied TLS timed out'))
        })
      } else {
        openRequest(socket)
      }
    })

    connectReq.end()
  })
}
