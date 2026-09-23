import { spawn } from 'node:child_process'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const ABLITERATED = path.resolve(ROOT, '../abliterated_ui')
const N8N_COMPOSE = path.join(os.homedir(), '.config', 'n8n', 'docker-compose.yml')

export const ENDPOINTS = [
  {
    id: 'spark-lan',
    name: 'Spark vLLM LAN',
    url: 'http://192.168.4.103:8000/v1/models',
    backups: ['http://100.66.147.53:8000/v1/models'],
    kind: 'spark',
  },
  {
    id: 'spark-ts',
    name: 'Spark vLLM Tailscale',
    url: 'http://100.66.147.53:8000/v1/models',
    backups: ['http://192.168.4.103:8000/v1/models'],
    kind: 'spark',
  },
  {
    id: 'proxy',
    name: 'Key proxy',
    url: 'http://127.0.0.1:17332/health',
    backups: ['http://100.66.147.53:8000/v1/models'],
    port: 17332,
    kind: 'proxy',
  },
  { id: 'sandbox', name: 'Sandbox runner', url: 'http://127.0.0.1:17330/health', port: 17330, kind: 'sandbox' },
  { id: 'mempalace', name: 'MemPalace', url: 'http://127.0.0.1:17333/health', port: 17333, kind: 'mempalace' },
  { id: 'n8n', name: 'n8n', url: 'http://127.0.0.1:5678/healthz', port: 5678, kind: 'n8n' },
  { id: 'studio', name: 'Studio', url: 'http://127.0.0.1:5173/', port: 5173, kind: 'studio' },
]

const ACTIONS = new Set(['start', 'stop', 'heal'])

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function probeUrls(endpoint) {
  return [endpoint.url, ...(endpoint.backups || [])]
}

async function probeOnce(url) {
  const started = Date.now()
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2500) })
    return { up: res.ok, status: res.status, ms: Date.now() - started, checkedUrl: url }
  } catch (err) {
    return {
      up: false,
      status: 0,
      ms: Date.now() - started,
      checkedUrl: url,
      error: err instanceof Error ? err.message : 'unreachable',
    }
  }
}

async function probe(endpoint) {
  const urls = probeUrls(endpoint)
  let last = { up: false, status: 0, ms: 0, checkedUrl: endpoint.url, attempts: 0, via: 'primary' }
  for (let index = 0; index < urls.length; index++) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      last = { ...(await probeOnce(urls[index])), attempts: attempt, via: index === 0 ? 'primary' : 'backup' }
      if (last.up) return last
      if (attempt < 3) await sleep(200 * attempt)
    }
  }
  return last
}

export async function listEndpointHealth() {
  const rows = await Promise.all(
    ENDPOINTS.map(async (endpoint) => ({
      id: endpoint.id,
      name: endpoint.name,
      url: endpoint.url,
      ...(await probe(endpoint)),
    })),
  )
  return rows
}

function spawnDetached(command, args, extraEnv = {}) {
  const child = spawn(command, args, {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, ...extraEnv },
  })
  child.unref()
  return child.pid
}

async function listeners(port) {
  try {
    const { stdout } = await execFileAsync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'])
    return stdout.split(/\s+/).map((line) => Number(line)).filter((pid) => pid > 0)
  } catch {
    return []
  }
}

async function stopPort(port) {
  const pids = await listeners(port)
  for (const pid of pids) {
    try { process.kill(pid, 'SIGTERM') } catch { /* already gone */ }
  }
  return pids
}

async function startKind(kind) {
  if (kind === 'studio') return { ok: true, message: 'Studio is this page.' }
  if (kind === 'proxy') {
    const script = path.join(ABLITERALED, 'scripts', 'cloud-key-proxy.mjs')
    if (!fs.existsSync(script)) return { ok: false, message: 'cloud-key-proxy.mjs was not found' }
    const pid = spawnDetached(process.execPath, [script], { CLOUD_PROXY_HOST: '127.0.0.1', CLOUD_PROXY_PORT: '17332' })
    return { ok: true, message: `Key proxy starting (pid ${pid})` }
  }
  if (kind === 'sandbox') {
    const script = path.join(ABLITERALED, 'scripts', 'sandbox-watchdog.mjs')
    if (!fs.existsSync(script)) return { ok: false, message: 'sandbox-watchdog.mjs was not found' }
    const pid = spawnDetached(process.execPath, [script], { SANDBOX_HOST: '127.0.0.1', SANDBOX_PORT: '17330' })
    return { ok: true, message: `Sandbox starting (pid ${pid})` }
  }
  if (kind === 'mempalace') {
    const script = path.join(ROOT, 'scripts', 'mempalace-bridge.mjs')
    const pid = spawnDetached(process.execPath, [script], { MEMPALACE_BRIDGE_HOST: '127.0.0.1', MEMPALACE_BRIDGE_PORT: '17333' })
    return { ok: true, message: `MemPalace starting (pid ${pid})` }
  }
  if (kind === 'n8n') {
    if (!fs.existsSync(N8N_COMPOSE)) return { ok: false, message: 'n8n compose file was not found' }
    spawnDetached('docker', ['compose', '-f', N8N_COMPOSE, 'up', '-d'])
    return { ok: true, message: 'n8n starting' }
  }
  if (kind === 'spark') {
    const script = path.join(ROOT, 'scripts', 'restart-spark.mjs')
    const pid = spawnDetached(process.execPath, [script, '--speed'])
    return { ok: true, message: `Spark restart sent (pid ${pid})` }
  }
  return { ok: false, message: 'Unknown service' }
}

async function stopKind(kind, endpoint) {
  if (kind === 'studio') return { ok: false, message: 'Stop is disabled for the studio you are using.' }
  if (kind === 'n8n') {
    if (!fs.existsSync(N8N_COMPOSE)) return { ok: false, message: 'n8n compose file was not found' }
    spawnDetached('docker', ['compose', '-f', N8N_COMPOSE, 'stop'])
    return { ok: true, message: 'n8n stopping' }
  }
  if (kind === 'spark') {
    return { ok: false, message: 'Spark stays up from here. Use Heal to restart it.' }
  }
  if (!endpoint.port) return { ok: false, message: 'No local port to stop' }
  const pids = await stopPort(endpoint.port)
  return { ok: true, message: pids.length ? `Stopped ${pids.length} listener(s) on :${endpoint.port}` : `Nothing listening on :${endpoint.port}` }
}

export async function controlEndpoint(id, action) {
  if (!ACTIONS.has(action)) return { ok: false, message: 'Action must be start, stop, or heal' }
  const endpoint = ENDPOINTS.find((item) => item.id === id)
  if (!endpoint) return { ok: false, message: 'Unknown endpoint' }
  if (action === 'stop') return stopKind(endpoint.kind, endpoint)
  if (action === 'start') {
    const health = await probe(endpoint)
    if (health.up) return { ok: true, message: `${endpoint.name} is already up` }
    return startKind(endpoint.kind)
  }
  const health = await probe(endpoint)
  if (endpoint.kind === 'spark') return startKind('spark')
  if (health.up && endpoint.port && endpoint.kind !== 'studio') await stopKind(endpoint.kind, endpoint)
  return startKind(endpoint.kind)
}
