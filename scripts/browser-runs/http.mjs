import fs from 'node:fs'
import path from 'node:path'
import {
  addAllowlistOrigin,
  dispatchBrowserTool,
  getAllowlistConfig,
  readLatestRecord,
  readRecordById,
  runBlueprintProof,
} from './supervisor.mjs'
import { detectWordCues, hasWordCue, maybeRunAutomateCue, WORD_CUE_SYSTEM_RULE, syncSessionBrowserCueFromText } from './nl-command.mjs'

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
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (err) {
        reject(err)
      }
    })
    req.on('error', reject)
  })
}

function normalizeRemoteAddress(addr) {
  if (!addr) return ''
  let a = String(addr).trim()
  if (a.startsWith('::ffff:')) a = a.slice(7)
  return a
}

function isLoopbackAddress(addr) {
  const a = normalizeRemoteAddress(addr)
  return a === '127.0.0.1' || a === '::1' || a === 'localhost'
}

function hostHeaderIsLocal(hostHeader) {
  const host = String(hostHeader || '')
    .trim()
    .toLowerCase()
    .split(':')[0]
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1'
}

/**
 * Reject non-loopback callers. Missing socket remote address is treated as local
 * only when the Host header is localhost / 127.0.0.1.
 */
export function isBrowserRunsLocalRequest(req) {
  const remote =
    req.socket?.remoteAddress ||
    req.connection?.remoteAddress ||
    req.client?.remoteAddress ||
    ''
  if (remote) return isLoopbackAddress(remote)
  return hostHeaderIsLocal(req.headers?.host)
}

export async function handleBrowserRunsRequest(req, res) {
  if (!isBrowserRunsLocalRequest(req)) {
    send(res, 403, { ok: false, error: 'browser-runs API is localhost-only' })
    return
  }

  const url = new URL(req.url || '/', 'http://127.0.0.1')
  const route = url.pathname.replace(/\/$/, '')
  try {
    if (req.method === 'GET' && route === '/api/browser-runs/latest') {
      const id = url.searchParams.get('id')
      const record = id ? readRecordById(id) : readLatestRecord()
      send(res, 200, { ok: true, record })
      return
    }
    if (req.method === 'GET' && route === '/api/browser-runs/screenshot') {
      const id = url.searchParams.get('id') || url.searchParams.get('v')
      const record = id ? readRecordById(id) : readLatestRecord()
      const shot = record?.screenshot?.path
      const resolved = shot ? path.resolve(shot) : ''
      const inRuns = resolved.includes(`${path.sep}data${path.sep}browser-runs${path.sep}runs${path.sep}`)
      if (!shot || !record?.screenshot?.bytes || !inRuns || !fs.existsSync(resolved)) {
        send(res, 404, { ok: false, error: id ? `No screenshot for run ${id}` : 'No screenshot for the latest run' })
        return
      }
      res.statusCode = 200
      res.setHeader('Content-Type', 'image/png')
      fs.createReadStream(shot).pipe(res)
      return
    }
    if (req.method === 'GET' && route === '/api/browser-runs/allowlist') {
      const config = getAllowlistConfig()
      send(res, 200, { ok: true, mode: config.mode, origins: config.origins })
      return
    }
    if (req.method === 'POST' && route === '/api/browser-runs/allowlist') {
      const body = await readBody(req)
      send(res, 200, { ok: true, origins: addAllowlistOrigin(body.origin) })
      return
    }
    if (req.method === 'POST' && route === '/api/browser-runs/proof') {
      const result = await runBlueprintProof()
      send(res, result.ok ? 200 : 422, result)
      return
    }
    if (req.method === 'POST' && route === '/api/browser-runs/tool') {
      const body = await readBody(req)
      const args = typeof body.arguments === 'string' ? JSON.parse(body.arguments) : (body.arguments || {})
      const result = await dispatchBrowserTool(body.name, args)
      send(res, 200, result)
      return
    }
    if (req.method === 'POST' && route === '/api/browser-runs/cue') {
      const body = await readBody(req)
      const text = String(body.text || body.goal || body.prompt || '')
      syncSessionBrowserCueFromText(text)
      const cues = detectWordCues(text)
      if (!hasWordCue(text, 'automate')) {
        send(res, 200, {
          ok: true,
          triggered: false,
          started: false,
          cues,
          rule: WORD_CUE_SYSTEM_RULE,
        })
        return
      }
      const result = await maybeRunAutomateCue(text)
      send(res, 200, { ...result, rule: WORD_CUE_SYSTEM_RULE })
      return
    }
    send(res, 404, { ok: false, error: `Unknown browser-runs route: ${route}` })
  } catch (err) {
    send(res, 500, { ok: false, error: err.message })
  }
}
