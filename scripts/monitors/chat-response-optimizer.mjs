#!/usr/bin/env node
/**
 * Continuous chat-response optimizer.
 * Tails agent monitor events + MemPalace/self-awareness signals and maintains
 * a live policy that the AIUI client applies when "Optimize chat responses" is on.
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')
const LOG_DIR = path.join(ROOT, 'logs')
const POLICY_FILE = path.join(LOG_DIR, 'chat-response-optimizer-policy.json')
const ACTIONS_LOG = path.join(LOG_DIR, 'chat-response-optimizer.jsonl')
const PATCHES_FILE = path.join(LOG_DIR, 'chat-response-optimizer-patches.json')

const PORT = Number(process.env.RESPONSE_OPTIMIZER_PORT || 17337)
const HOST = process.env.RESPONSE_OPTIMIZER_HOST || '0.0.0.0'

const isSpark = process.env.USER === 'flak3dd' || (process.arch === 'arm64' && process.platform === 'linux')
const AGENT_MONITOR_URL = process.env.AGENT_MONITOR_URL || (isSpark ? 'http://127.0.0.1:17335' : 'http://100.66.147.53:17335')
const SELF_AWARE_URL = process.env.SELF_IMPROVEMENT_URL || (isSpark ? 'http://127.0.0.1:17336' : 'http://100.66.147.53:17336')
const MEMPALACE_URL = process.env.MEMPALACE_URL || (isSpark ? 'http://192.168.4.50:17333' : 'http://127.0.0.1:17333')
const JSONL = path.join(LOG_DIR, 'agent-responses.jsonl')

if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true })

const state = {
  enabled: true,
  eventsSeen: 0,
  emptyResponses: 0,
  slowResponses: 0,
  stalls: 0,
  toolCalls: 0,
  responses: 0,
  recent: [],
  lastPolicy: null,
  pendingPatches: loadPatches(),
}

function loadPatches() {
  try {
    if (!fs.existsSync(PATCHES_FILE)) return []
    const raw = JSON.parse(fs.readFileSync(PATCHES_FILE, 'utf8'))
    return Array.isArray(raw.patches) ? raw.patches : []
  } catch { return [] }
}

function savePatches() {
  fs.writeFileSync(
    PATCHES_FILE,
    JSON.stringify({ updatedAt: Date.now(), patches: state.pendingPatches }, null, 2),
  )
}


function fetchJson(url, ms = 2000) {
  return new Promise((resolve) => {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), ms)
    fetch(url, { signal: ctrl.signal })
      .then(async (r) => {
        clearTimeout(t)
        try {
          resolve({ ok: r.ok, data: await r.json() })
        } catch {
          resolve({ ok: r.ok, data: null })
        }
      })
      .catch(() => {
        clearTimeout(t)
        resolve({ ok: false, data: null })
      })
  })
}

function pushRecent(e) {
  state.recent.push(e)
  if (state.recent.length > 80) state.recent.shift()
}

function ingestEvent(e) {
  if (!e || typeof e !== 'object') return
  state.eventsSeen += 1
  const type = e.type || e.event || 'unknown'
  pushRecent({ type, ts: e.timestamp || Date.now(), durationMs: e.durationMs, model: e.model })

  if (type === 'tool_call') state.toolCalls += 1
  if (type === 'response') {
    state.responses += 1
    const text = String(e.responseText || e.response || e.content || '')
    const dur = Number(e.durationMs || 0)
    if (text.trim().length < 8) state.emptyResponses += 1
    if (dur > 20000) state.slowResponses += 1
    if (dur > 120000 || (dur > 30000 && text.trim().length < 8)) state.stalls += 1
  }
  if (type === 'anti_loop') {
    const a = e.analysis || {}
    if (a.progressMade === false || a.isLooping === true) state.stalls += 1
  }
  if (type === 'error') state.stalls += 1
}

function readJsonlTail(maxLines = 120) {
  try {
    if (!fs.existsSync(JSONL)) return
    const raw = fs.readFileSync(JSONL, 'utf8')
    const lines = raw.trim().split('\n').slice(-maxLines)
    for (const line of lines) {
      try {
        ingestEvent(JSON.parse(line))
      } catch {
        /* skip */
      }
    }
  } catch {
    /* skip */
  }
}


function generatePatchSuggestions(policy, awareness) {
  // Unrestricted suggestion types for Agent mode — any durable improvement may be proposed.
  // UI path requires human approve; Agent mode may apply without category filters.
  const patches = []
  const now = Date.now()
  const mk = (partial) => ({
    id: `patch_${now}_${Math.random().toString(36).slice(2, 8)}`,
    status: 'pending',
    createdAt: now,
    source: 'chat-response-optimizer',
    applyMode: 'approve-or-agent', // UI approve, or Agent mode unrestricted apply
    ...partial,
  })

  if (policy.stats.emptyResponses >= 2) {
    patches.push(mk({
      kind: 'code',
      title: 'Reject near-empty assistant turns in chat loop',
      rationale: `${policy.stats.emptyResponses} empty/near-empty responses observed`,
      files: ['src/App.tsx'],
      summary: 'After stream completes, if trimmed content length < policy.minUsefulChars, auto-continue once with optimizer nudge instead of committing empty bubble.',
      proposedDiff: null,
      agentPrompt: 'In AIUI src/App.tsx chat completion handler: if optimizeChatResponses is on and final assistant text is empty/too short, do not finalize; inject optimizer systemNudge and retry once. Show a toast. No silent infinite retries.',
    }))
  }

  if (policy.stats.stalls >= 2 || policy.antiLoopStrict) {
    patches.push(mk({
      kind: 'code',
      title: 'Tighten anti-loop circuit with optimizer policy',
      rationale: 'Stalls / weak progress detected in agent flows',
      files: ['src/App.tsx', 'src/lib/agentAnalyzer.ts'],
      summary: 'When antiLoopStrict policy is true, treat progressMade=false for 2 consecutive rounds as breaker; surface getAntiLoopPromptSuggestions chips automatically.',
      proposedDiff: null,
      agentPrompt: 'Wire AIUI anti-loop path to fetch http://127.0.0.1:17337/api/policy when optimizeChatResponses is enabled. If antiLoopStrict, escalate faster and auto-offer suggestion chips. Unrestricted as to which suggestion kinds are allowed.',
    }))
  }

  if (policy.stats.toolHeavyRatio > 0.55) {
    patches.push(mk({
      kind: 'prompt-or-code',
      title: 'Reduce tool thrash — batch tools + user-facing status',
      rationale: `toolHeavyRatio=${policy.stats.toolHeavyRatio}`,
      files: ['src/App.tsx', 'src/lib/agent.ts'],
      summary: 'Add a mid-loop user status line every N tool calls and prefer batched reads; optional max tools-per-turn from policy.',
      proposedDiff: null,
      agentPrompt: 'Optimize AIUI agent tool loop for fewer redundant tool_calls. Add optional maxToolCallsPerTurn from optimizer policy. Keep Agent-mode suggestion surface unrestricted.',
    }))
  }

  if ((awareness?.mempalace?.signals?.testishDrawerShare ?? 0) >= 0.4) {
    patches.push(mk({
      kind: 'ops-or-code',
      title: 'Filter noisy MemPalace wings during auto-recall',
      rationale: 'Palace recall skewed to test/smoke/browser drawers',
      files: ['src/lib/mempalace.ts', 'src/App.tsx'],
      summary: 'When optimizing, exclude wings matching /test|smoke|browser/ from auto-recall unless user opts in.',
      proposedDiff: null,
      agentPrompt: 'Update MemPalace auto-recall in AIUI to skip noisy test wings when optimizeChatResponses is on, unless settings.mempalaceIncludeTestWings is true.',
    }))
  }

  // Dedup by title against pending
  const existing = new Set(state.pendingPatches.filter(x => x.status === 'pending').map(x => x.title))
  let added = 0
  for (const patch of patches) {
    if (existing.has(patch.title)) continue
    state.pendingPatches.unshift(patch)
    added += 1
  }
  // keep last 50
  state.pendingPatches = state.pendingPatches.slice(0, 50)
  if (added) savePatches()
  return added
}

function buildPolicy(awareness) {
  const toolHeavy =
    state.responses + state.toolCalls > 0
      ? state.toolCalls / Math.max(1, state.responses + state.toolCalls)
      : 0

  const reasons = []
  let maxDurationMs = 45000
  let minUsefulChars = 12
  let antiLoopStrict = false
  let temperatureBias = 0
  let systemNudge = null
  let healthIndex = awareness?.healthIndex ?? 70

  if (state.emptyResponses >= 2) {
    reasons.push('empty_responses')
    minUsefulChars = 40
    systemNudge =
      'Optimization: prior turns returned near-empty text. Answer with a concrete status line and next action; avoid blank or filler-only replies.'
    temperatureBias -= 0.1
  }
  if (state.slowResponses >= 2 || state.stalls >= 2) {
    reasons.push('slow_or_stall')
    maxDurationMs = 25000
    antiLoopStrict = true
    systemNudge =
      (systemNudge ? systemNudge + ' ' : '') +
      'If blocked >1 attempt, stop retrying the same tool; call research_and_acquire_tool if a specialized tool is needed (e.g. sqlite_query, csv_stats, git_blame), or pivot immediately.'
    temperatureBias -= 0.05
  }
  if (toolHeavy > 0.55) {
    reasons.push('tool_heavy')
    systemNudge =
      (systemNudge ? systemNudge + ' ' : '') +
      'Prefer fewer tool calls: batch reads, verify once, then respond to the user with outcomes.'
  }

  const palace = awareness?.mempalace
  if (palace?.signals?.testishDrawerShare >= 0.4) {
    reasons.push('palace_noise')
    systemNudge =
      (systemNudge ? systemNudge + ' ' : '') +
      'Do not lean on noisy test-memory; prefer current session evidence and live tool results.'
  }

  if (!reasons.length) {
    systemNudge =
      'Keep replies concise, evidence-backed, and progress-oriented. Prefer one clear next step.'
  }

  const policy = {
    enabled: state.enabled,
    updatedAt: Date.now(),
    healthIndex,
    maxDurationMs,
    minUsefulChars,
    antiLoopStrict,
    temperatureBias: Number(temperatureBias.toFixed(2)),
    systemNudge,
    reasons,
    stats: {
      eventsSeen: state.eventsSeen,
      emptyResponses: state.emptyResponses,
      slowResponses: state.slowResponses,
      stalls: state.stalls,
      toolHeavyRatio: Number(toolHeavy.toFixed(3)),
    },
  }
  state.lastPolicy = policy
  try {
    fs.writeFileSync(POLICY_FILE, JSON.stringify(policy, null, 2))
    fs.appendFileSync(
      ACTIONS_LOG,
      JSON.stringify({ ts: Date.now(), type: 'policy', reasons, healthIndex, stats: policy.stats }) + '\n',
    )
  } catch {
    /* ignore */
  }
  return policy
}

async function tick() {
  const [recent, awareness] = await Promise.all([
    fetchJson(`${AGENT_MONITOR_URL}/api/agent/recent?limit=40`),
    fetchJson(`${SELF_AWARE_URL}/api/awareness`),
  ])
  const events = recent.data?.events || recent.data?.recent || recent.data?.items || []
  if (Array.isArray(events)) {
    for (const e of events.slice(-40)) ingestEvent(e)
  }
  return buildPolicy(awareness.ok ? awareness.data : null)
}

// seed from jsonl once
readJsonlTail(150)
buildPolicy(null)

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)

  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({
        ok: true,
        service: 'chat-response-optimizer',
        port: PORT,
        enabled: state.enabled,
        policy: state.lastPolicy,
      }),
    )
    return
  }

  if (url.pathname === '/api/policy') {
    const policy = state.lastPolicy || buildPolicy(null)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, policy }))
    return
  }

  if (url.pathname === '/api/enable' && req.method === 'POST') {
    let body = ''
    for await (const c of req) body += c
    try {
      const parsed = JSON.parse(body || '{}')
      if (typeof parsed.enabled === 'boolean') state.enabled = parsed.enabled
    } catch {
      /* ignore */
    }
    const policy = buildPolicy(null)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, policy }))
    return
  }

  if (url.pathname === '/api/event' && req.method === 'POST') {
    let body = ''
    for await (const c of req) body += c
    try {
      ingestEvent(JSON.parse(body))
    } catch {
      /* ignore */
    }
    const policy = buildPolicy(null)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, policy }))
    return
  }


  if (url.pathname === '/api/patches') {
    const status = url.searchParams.get('status')
    let patches = state.pendingPatches
    if (status) patches = patches.filter((p) => p.status === status)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, patches, applyPolicy: 'ui-approve-or-agent-unrestricted' }))
    return
  }

  if (url.pathname === '/api/patches/approve' && req.method === 'POST') {
    let body = ''
    for await (const c of req) body += c
    const parsed = JSON.parse(body || '{}')
    const patch = state.pendingPatches.find((p) => p.id === parsed.id)
    if (!patch) {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'patch not found' }))
      return
    }
    patch.status = 'approved'
    patch.approvedAt = Date.now()
    savePatches()
    fs.appendFileSync(ACTIONS_LOG, JSON.stringify({ ts: Date.now(), type: 'patch_approved', id: patch.id, title: patch.title }) + '\n')
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, patch, agentPrompt: patch.agentPrompt }))
    return
  }

  if (url.pathname === '/api/patches/reject' && req.method === 'POST') {
    let body = ''
    for await (const c of req) body += c
    const parsed = JSON.parse(body || '{}')
    const patch = state.pendingPatches.find((p) => p.id === parsed.id)
    if (patch) {
      patch.status = 'rejected'
      patch.rejectedAt = Date.now()
      savePatches()
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, patch }))
    return
  }

  // Agent mode: claim next approved-or-pending patch without category restrictions
  if (url.pathname === '/api/patches/next-for-agent') {
    const allowPending = url.searchParams.get('allowPending') !== 'false'
    const patch = state.pendingPatches.find(
      (p) => p.status === 'approved' || (allowPending && p.status === 'pending'),
    )
    if (!patch) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, patch: null }))
      return
    }
    patch.status = 'claimed_by_agent'
    patch.claimedAt = Date.now()
    savePatches()
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, patch, unrestricted: true }))
    return
  }

  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: 'not found' }))
})

server.listen(PORT, HOST, () => {
  console.log(`[chat-optimizer] listening on http://${HOST}:${PORT}`)
  console.log(`[chat-optimizer] policy -> ${POLICY_FILE}`)
  tick().catch(() => {})
})

setInterval(() => {
  tick().catch(() => {})
}, 5000)

// Follow jsonl growth
let jsonlPos = 0
try {
  jsonlPos = fs.existsSync(JSONL) ? fs.statSync(JSONL).size : 0
} catch {
  jsonlPos = 0
}
setInterval(() => {
  try {
    if (!fs.existsSync(JSONL)) return
    const st = fs.statSync(JSONL)
    if (st.size < jsonlPos) jsonlPos = 0
    if (st.size === jsonlPos) return
    const fd = fs.openSync(JSONL, 'r')
    const len = st.size - jsonlPos
    const buf = Buffer.alloc(len)
    fs.readSync(fd, buf, 0, len, jsonlPos)
    fs.closeSync(fd)
    jsonlPos = st.size
    for (const line of buf.toString('utf8').split('\n')) {
      if (!line.trim()) continue
      try {
        ingestEvent(JSON.parse(line))
      } catch {
        /* skip */
      }
    }
    buildPolicy(null)
  } catch {
    /* ignore */
  }
}, 2000)
