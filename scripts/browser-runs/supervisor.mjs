import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isCountableBrowserRun, isOriginAllowlisted, originOf } from './proof.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const RUNS_DIR = path.join(ROOT, 'data', 'browser-runs', 'runs')
const ALLOWLIST_PATH = path.join(ROOT, 'data', 'browser-runs', 'allowlist.json')

const sessions = new Map()
/** Cap concurrent Playwright Chromium processes (one per Work browser window). */
export const MAX_BROWSER_SESSIONS = 4

function readAllowlistConfig() {
  try {
    const parsed = JSON.parse(fs.readFileSync(ALLOWLIST_PATH, 'utf8'))
    return {
      mode: parsed.mode === 'all' ? 'all' : 'list',
      origins: Array.isArray(parsed.origins) ? parsed.origins : [],
    }
  } catch {
    return {
      mode: 'list',
      origins: ['http://127.0.0.1:5173', 'http://localhost:5173'],
    }
  }
}

export function getAllowlistConfig() {
  return readAllowlistConfig()
}

export function listAllowlist() {
  return readAllowlistConfig().origins
}

export function addAllowlistOrigin(origin) {
  const clean = originOf(origin.endsWith('/') ? origin : `${origin}/`)
  const config = readAllowlistConfig()
  const origins = [...new Set([...config.origins, clean])]
  const payload = config.mode === 'all' ? { mode: 'all', origins } : { origins }
  fs.mkdirSync(path.dirname(ALLOWLIST_PATH), { recursive: true })
  fs.writeFileSync(ALLOWLIST_PATH, JSON.stringify(payload, null, 2))
  return origins
}

async function loadChromium() {
  try {
    const pw = await import('playwright')
    if (!pw.chromium) {
      return { ok: false, error: 'playwright.chromium is missing. HTTP 200 is not browser proof.' }
    }
    return { ok: true, chromium: pw.chromium }
  } catch (err) {
    return {
      ok: false,
      error: `Playwright import failed (${err.message}). Refusing HTTP fallback. Browser proof requires playwright-chromium.`,
    }
  }
}

function writeRecord(record) {
  const dir = path.join(RUNS_DIR, record.id)
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'record.json')
  fs.writeFileSync(file, JSON.stringify(record, null, 2))
  return file
}

function snapshotLiveSession(session) {
  if (!session) return null
  let finalUrl = session.finalUrl || ''
  try {
    if (session.page) finalUrl = session.page.url() || finalUrl
  } catch {
    /* page may already be closed */
  }
  return {
    id: session.id,
    engine: session.engine,
    executorRan: false,
    finalUrl,
    httpStatus: typeof session.httpStatus === 'number' ? session.httpStatus : 0,
    consoleErrorCount: Array.isArray(session.consoleErrors) ? session.consoleErrors.length : 0,
    steps: Array.isArray(session.steps) ? session.steps.map((step) => ({ ...step })) : [],
    terminal: 'running',
    countable: false,
  }
}

function readStoredRecordById(id) {
  if (!id || typeof id !== 'string') return null
  const file = path.join(RUNS_DIR, id, 'record.json')
  if (!fs.existsSync(file)) return null
  const record = JSON.parse(fs.readFileSync(file, 'utf8'))
  record.countable = isCountableBrowserRun(record)
  return record
}

/** Disk record first; fall back to in-memory live session (steps as the run progresses). */
export function readRecordById(id) {
  const stored = readStoredRecordById(id)
  if (stored) return stored
  return snapshotLiveSession(sessions.get(id))
}

export function readLatestRecord() {
  const live = [...sessions.values()]
  if (live.length) return snapshotLiveSession(live[live.length - 1])
  if (!fs.existsSync(RUNS_DIR)) return null
  const ids = fs.readdirSync(RUNS_DIR).filter((name) => fs.existsSync(path.join(RUNS_DIR, name, 'record.json')))
  if (!ids.length) return null
  ids.sort()
  return readStoredRecordById(ids[ids.length - 1])
}

export function listActiveSessions() {
  return [...sessions.values()].map((s) => ({
    id: s.id,
    engine: s.engine,
    finalUrl: s.finalUrl,
    httpStatus: s.httpStatus,
    steps: Array.isArray(s.steps) ? s.steps.length : 0,
  }))
}

async function endSession(session) {
  try {
    await session.browser?.close()
  } catch {
    /* already closed */
  }
  sessions.delete(session.id)
}

export async function closeSession(sessionId) {
  const session = sessions.get(sessionId)
  if (!session) {
    return { ok: false, exitCode: 1, error: `No session ${sessionId}` }
  }
  await endSession(session)
  return { ok: true, exitCode: 0, sessionId }
}

export async function openSession({ url, operatorStarted = false, headless = false }) {
  if (!isOriginAllowlisted(url, readAllowlistConfig(), { operatorStarted })) {
    return {
      ok: false,
      exitCode: 1,
      error: `Origin not allowlisted: ${originOf(url)}. Add it before unattended navigation.`,
    }
  }
  const loaded = await loadChromium()
  if (!loaded.ok) return { ok: false, exitCode: 1, error: loaded.error, engine: null }

  if (sessions.size >= MAX_BROWSER_SESSIONS) {
    return {
      ok: false,
      exitCode: 1,
      error: `Browser session cap reached (${MAX_BROWSER_SESSIONS}). Close a window before opening another.`,
      maxSessions: MAX_BROWSER_SESSIONS,
      activeSessions: sessions.size,
    }
  }

  const id = `run-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  const browser = await loaded.chromium.launch({
    headless: headless === true,
    args: ['--disable-dev-shm-usage'],
  })
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await context.newPage()
  const consoleErrors = []
  page.on('pageerror', (err) => consoleErrors.push(String(err?.message || err)))
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  const session = {
    id,
    engine: 'playwright-chromium',
    browser,
    page,
    consoleErrors,
    steps: [],
    httpStatus: null,
    finalUrl: url,
  }
  sessions.set(id, session)
  const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
  session.httpStatus = response ? response.status() : 0
  session.finalUrl = page.url()
  session.steps.push({
    action: 'navigation',
    ok: true,
    engine: 'playwright-chromium',
    selector: session.finalUrl,
  })
  return {
    ok: true,
    exitCode: 0,
    sessionId: id,
    engine: session.engine,
    url: session.finalUrl,
    status: session.httpStatus,
  }
}

function requireSession(sessionId) {
  // Prefer explicit session id so each Work browser window stays isolated.
  const session = sessionId ? sessions.get(sessionId) : [...sessions.values()].at(-1)
  if (!session || session.engine !== 'playwright-chromium') {
    return { error: 'No playwright-chromium session. Open an allowlisted page first. Click and type do not pass on HTTP fallback.' }
  }
  return { session }
}

export async function clickSession({ sessionId, selector }) {
  const found = requireSession(sessionId)
  if (found.error) return { ok: false, exitCode: 1, error: found.error }
  try {
    await found.session.page.click(selector, { timeout: 10000 })
    found.session.steps.push({ action: 'click', ok: true, engine: 'playwright-chromium', selector })
    return { ok: true, exitCode: 0, engine: 'playwright-chromium', selector, sessionId: found.session.id }
  } catch (err) {
    found.session.steps.push({ action: 'click', ok: false, engine: 'playwright-chromium', selector, error: err.message })
    return { ok: false, exitCode: 1, error: err.message, engine: 'playwright-chromium' }
  }
}

export async function textSession({ sessionId, selector }) {
  const found = requireSession(sessionId)
  if (found.error) return { ok: false, exitCode: 1, error: found.error }
  try {
    const locator = selector ? found.session.page.locator(selector).first() : found.session.page.locator('body')
    const text = await locator.evaluate((el) => {
      if (el instanceof HTMLSelectElement) return el.options[el.selectedIndex]?.text || ''
      return el.innerText || ''
    })
    return { ok: true, exitCode: 0, engine: 'playwright-chromium', sessionId: found.session.id, text: String(text || '').slice(0, 2000) }
  } catch (err) {
    return { ok: false, exitCode: 1, error: err.message, engine: 'playwright-chromium' }
  }
}

export async function selectSession({ sessionId, selector, value }) {
  const found = requireSession(sessionId)
  if (found.error) return { ok: false, exitCode: 1, error: found.error }
  try {
    await found.session.page.selectOption(selector, String(value), { timeout: 8000 })
    found.session.steps.push({ action: 'select', ok: true, engine: 'playwright-chromium', selector })
    return { ok: true, exitCode: 0, engine: 'playwright-chromium', sessionId: found.session.id, value }
  } catch (err) {
    found.session.steps.push({ action: 'select', ok: false, engine: 'playwright-chromium', selector, error: err.message })
    return { ok: false, exitCode: 1, error: err.message, engine: 'playwright-chromium' }
  }
}

export async function typeSession({ sessionId, selector, text }) {
  const found = requireSession(sessionId)
  if (found.error) return { ok: false, exitCode: 1, error: found.error }
  try {
    await found.session.page.fill(selector, String(text), { timeout: 10000 })
    found.session.steps.push({ action: 'type', ok: true, engine: 'playwright-chromium', selector })
    return { ok: true, exitCode: 0, engine: 'playwright-chromium', selector, sessionId: found.session.id }
  } catch (err) {
    found.session.steps.push({ action: 'type', ok: false, engine: 'playwright-chromium', selector, error: err.message })
    return { ok: false, exitCode: 1, error: err.message, engine: 'playwright-chromium' }
  }
}

export async function finishSession({ sessionId, domAssertion }) {
  const found = requireSession(sessionId)
  if (found.error) return { ok: false, exitCode: 1, error: found.error }
  const session = found.session
  const dir = path.join(RUNS_DIR, session.id)
  fs.mkdirSync(dir, { recursive: true })
  const shotPath = path.join(dir, 'screenshot.png')
  await session.page.screenshot({ path: shotPath })
  const bytes = fs.statSync(shotPath).size
  const assertion = domAssertion || { ok: false, reason: 'no assertion' }
  const proofOk = assertion.ok === true
  const steps = [
    ...session.steps,
    {
      action: 'proof',
      ok: proofOk,
      engine: 'playwright-chromium',
      selector: assertion.selector,
      error: proofOk ? undefined : assertion.reason || 'assertion failed',
    },
  ]
  const record = {
    id: session.id,
    engine: 'playwright-chromium',
    executorRan: true,
    finalUrl: session.page.url(),
    httpStatus: session.httpStatus,
    domAssertion: assertion,
    consoleErrorCount: session.consoleErrors.length,
    screenshot: { path: shotPath, bytes },
    steps,
    endedAt: new Date().toISOString(),
  }
  record.countable = isCountableBrowserRun(record)
  record.terminal = record.countable ? 'passed' : 'failed'
  writeRecord(record)
  await endSession(session)
  return { ok: record.countable, exitCode: record.countable ? 0 : 1, record }
}

export async function runBlueprintProof() {
  const html = `<!doctype html><html><body>
    <input id="name" />
    <button id="go">Go</button>
    <p id="proof"></p>
    <script>
      document.getElementById('go').onclick = () => {
        document.getElementById('proof').textContent = 'clicked:' + document.getElementById('name').value
      }
    </script>
  </body></html>`
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(html)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  const url = `http://127.0.0.1:${port}/`
  try {
    const opened = await openSession({ url, operatorStarted: true })
    if (!opened.ok) return opened
    const typed = await typeSession({ sessionId: opened.sessionId, selector: '#name', text: 'durable' })
    if (!typed.ok) return finishSession({ sessionId: opened.sessionId, domAssertion: { ok: false, reason: typed.error } })
    const clicked = await clickSession({ sessionId: opened.sessionId, selector: '#go' })
    if (!clicked.ok) return finishSession({ sessionId: opened.sessionId, domAssertion: { ok: false, reason: clicked.error } })
    const text = await sessions.get(opened.sessionId).page.textContent('#proof')
    const domAssertion = { ok: text === 'clicked:durable', selector: '#proof', actual: text, expected: 'clicked:durable' }
    return finishSession({ sessionId: opened.sessionId, domAssertion })
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

export async function dispatchBrowserTool(name, args = {}) {
  if (name === 'browser_open') {
    const url = typeof args === 'string' ? args : args.url || args.targetUrl
    const headless = args.headless === true || args.headless === 'true'
    return openSession({ url, operatorStarted: false, headless })
  }
  if (name === 'browser_close') {
    const sessionId = typeof args === 'string' ? args : args.sessionId
    return closeSession(sessionId)
  }
  if (name === 'browser_click') {
    return clickSession({ sessionId: args.sessionId, selector: args.selector || args })
  }
  if (name === 'browser_type') {
    return typeSession({ sessionId: args.sessionId, selector: args.selector, text: args.text })
  }
  if (name === 'browser_text') {
    return textSession({ sessionId: args.sessionId, selector: args.selector })
  }
  if (name === 'browser_select') {
    return selectSession({ sessionId: args.sessionId, selector: args.selector, value: args.value })
  }
  if (name === 'browser_screenshot' || name === 'browser_console_logs') {
    const found = requireSession(args.sessionId)
    if (found.error) return { ok: false, exitCode: 1, error: found.error }
    if (name === 'browser_console_logs') {
      return {
        ok: true,
        exitCode: 0,
        engine: 'playwright-chromium',
        sessionId: found.session.id,
        count: found.session.consoleErrors.length,
        logs: found.session.consoleErrors,
      }
    }
    const dir = path.join(RUNS_DIR, found.session.id)
    fs.mkdirSync(dir, { recursive: true })
    const shotPath = path.join(dir, 'screenshot.png')
    await found.session.page.screenshot({ path: shotPath })
    const bytes = fs.statSync(shotPath).size
    if (bytes <= 0) return { ok: false, exitCode: 1, error: 'Screenshot was empty', engine: 'playwright-chromium' }
    return {
      ok: true,
      exitCode: 0,
      engine: 'playwright-chromium',
      sessionId: found.session.id,
      path: shotPath,
      bytes,
    }
  }
  return { ok: false, exitCode: 1, error: `Unsupported browser tool: ${name}` }
}
