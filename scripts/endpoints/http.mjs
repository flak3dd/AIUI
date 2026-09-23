import { isBrowserRunsLocalRequest } from '../browser-runs/http.mjs'
import { controlEndpoint, listEndpointHealth } from './control.mjs'

function send(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      if (!chunks.length) return resolve({})
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch (err) { reject(err) }
    })
    req.on('error', reject)
  })
}

export async function handleEndpointsRequest(req, res) {
  if (!isBrowserRunsLocalRequest(req)) {
    send(res, 403, { ok: false, error: 'endpoints API is localhost-only' })
    return
  }
  const url = new URL(req.url || '/', 'http://127.0.0.1')
  const route = url.pathname.replace(/\/$/, '')
  try {
    if (req.method === 'GET' && route === '/api/endpoints/health') {
      send(res, 200, { ok: true, endpoints: await listEndpointHealth() })
      return
    }
    if (req.method === 'POST' && route === '/api/endpoints/action') {
      const body = await readBody(req)
      const result = await controlEndpoint(String(body.id || ''), String(body.action || ''))
      send(res, result.ok ? 200 : 400, result)
      return
    }
    send(res, 404, { ok: false, error: 'Unknown endpoints route' })
  } catch (err) {
    send(res, 500, { ok: false, error: err.message })
  }
}
