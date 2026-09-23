import { SPARK_TAILSCALE_HOST } from '../aiui-agent/config.mjs'
import { executeTool } from '../aiui-agent/tools/executor.mjs'
import { tools } from '../aiui-agent/tools/registry.mjs'
import { appendStep, createRun, readLatestRun, readRun, updateRun } from '../aiui-agent/core/run-record.mjs'
import { handOffRun } from '../aiui-agent/transport/n8n-handoff.mjs'
import { isBrowserRunsLocalRequest } from '../browser-runs/http.mjs'
import { syncSessionBrowserCueFromText } from '../browser-runs/word-cues.mjs'

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

export async function handleAgentRunsRequest(req, res) {
  if (!isBrowserRunsLocalRequest(req)) {
    send(res, 403, { ok: false, error: 'agent-runs API is localhost-only' })
    return
  }
  const url = new URL(req.url || '/', 'http://127.0.0.1')
  const route = url.pathname.replace(/\/$/, '')
  try {
    if (req.method === 'GET' && route === '/api/agent-runs/latest') {
      send(res, 200, { ok: true, record: readLatestRun() })
      return
    }
    if (req.method === 'GET' && route === '/api/agent-runs/tools') {
      send(res, 200, { ok: true, tools })
      return
    }
    if (req.method === 'POST' && route === '/api/agent-runs') {
      const body = await readBody(req)
      syncSessionBrowserCueFromText(body.goal || '')
      send(res, 200, { ok: true, record: createRun({ goal: body.goal }) })
      return
    }
    if (req.method === 'POST' && route === '/api/agent-runs/step') {
      const body = await readBody(req)
      const record = appendStep(body.id, body.step || {})
      send(res, record ? 200 : 404, record ? { ok: true, record } : { ok: false, error: 'run not found' })
      return
    }
    if (req.method === 'POST' && route === '/api/agent-runs/handoff') {
      const body = await readBody(req)
      const record = readRun(body.id) || readLatestRun()
      if (!record) {
        send(res, 404, { ok: false, error: 'run not found' })
        return
      }
      const handed = await handOffRun(record)
      if (handed.ok) updateRun(record.id, { status: 'handed_off' })
      send(res, handed.ok ? 200 : 502, { ...handed, record: readRun(record.id) })
      return
    }
    if (req.method === 'POST' && route === '/api/agent-runs/tool') {
      const body = await readBody(req)
      const args = typeof body.arguments === 'string' ? body.arguments : JSON.stringify(body.arguments || {})
      const raw = await executeTool(body.name, args, {
        workspaceDir: process.cwd(),
        target: 'local_mac',
        baseUrl: `http://${process.env.SPARK_QWEN_HOST || SPARK_TAILSCALE_HOST}:8000/v1`,
      })
      let parsed = null
      try { parsed = JSON.parse(raw) } catch { parsed = { ok: false, error: String(raw).slice(0, 300) } }
      const latest = readLatestRun()
      if (latest && body.record !== false) {
        appendStep(latest.id, {
          tool: body.name,
          ok: parsed.ok === true,
          exitCode: parsed.exitCode,
          result: parsed.error || parsed.stdout || raw,
          command: parsed.command,
          browserRunId: parsed.sessionId,
        })
      }
      send(res, 200, typeof parsed === 'object' && parsed ? parsed : { ok: false, raw })
      return
    }
    send(res, 404, { ok: false, error: `Unknown agent-runs route: ${route}` })
  } catch (err) {
    send(res, 500, { ok: false, error: err.message })
  }
}
