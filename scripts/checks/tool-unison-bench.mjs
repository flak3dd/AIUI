#!/usr/bin/env node
/**
 * CLI executor vs studio /api/agent-runs/tool.
 * Every registered tool is invoked on both paths with the same safe arguments.
 * web_unblocker is only called without a URL so it fails closed and does not fetch.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { executeTool } from '../aiui-agent/tools/executor.mjs'
import { tools } from '../aiui-agent/tools/registry.mjs'
import { createRun } from '../aiui-agent/core/run-record.mjs'

const UI = process.env.AIUI_UI_URL || 'http://127.0.0.1:5173'
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aiui-unison-'))
const sample = path.join(tmp, 'sample.txt')
fs.writeFileSync(sample, 'alpha unison beta\n')
const daemonId = `unison-${process.pid}`

const handoff = createRun({ goal: 'tool unison bench' })
const ctx = {
  workspaceDir: tmp,
  target: 'local_mac',
  baseUrl: 'http://100.66.147.53:8000/v1',
  envId: 'unison-bench',
  runRecord: handoff,
}

function argsFor(name) {
  switch (name) {
    case 'bash':
      return { command: 'echo unison-ok' }
    case 'write_file':
      return { path: sample, content: 'alpha unison beta\n' }
    case 'read_file':
      return { path: sample }
    case 'replace_file_content':
      return { path: sample, target: 'alpha', replacement: 'ALPHA' }
    case 'multi_replace_file_content':
      return { path: sample, replacements: [{ target: 'BETA', replacement: 'beta' }, { target: 'unison', replacement: 'unison' }] }
    case 'grep_search':
      return { pattern: 'unison', path: tmp }
    case 'get_file_outline':
      return { path: path.resolve('scripts/aiui-agent/core/run-record.mjs') }
    case 'start_daemon':
      return { id: daemonId, command: 'sleep 30', cwd: tmp }
    case 'read_daemon_logs':
      return { id: daemonId }
    case 'stop_daemon':
      return { id: daemonId }
    case 'list_daemons':
      return {}
    case 'browser_open':
      return { url: 'http://127.0.0.1:5173/' }
    case 'browser_screenshot':
    case 'browser_console_logs':
      return {}
    case 'browser_click':
    case 'browser_type':
      return { selector: '#aiui-unison-missing', text: 'x' }
    case 'spawn_subagent':
      return {}
    case 'list_acquired_tools':
      return {}
    case 'remove_acquired_tool':
      return {}
    case 'hand_off_run':
      return { runId: handoff.id }
    case 'web_unblocker':
      return {}
    case 'list_models':
      return { limit: 3 }
    case 'http_get_json':
      return { url: 'https://example.com' }
    case 'now':
      return {}
    case 'memory_search':
      return { query: 'aiui', limit: 1 }
    case 'memory_checkpoint':
      return { items: [{ wing: 'aiui-unison', room: 'bench', content: 'tool unison probe' }] }
    case 'spawn_linux_container':
      return { envId: `unison-${process.pid}`, profile: 'minimal_alpine', target: 'local_mac', timeoutMinutes: 5 }
    case 'destroy_linux_container':
      return { envId: `unison-${process.pid}`, target: 'local_mac' }
    case 'list_linux_containers':
      return {}
    case 'list_scaffolds':
      return { query: 'node' }
    case 'apply_scaffold':
      return { templateId: '__unison_missing__' }
    case 'set_workspace_dir':
      return { directory: tmp, target: 'local_mac' }
    case 'get_workspace_dir':
      return { target: 'local_mac' }
    case 'ssh':
      return { command: 'echo unison-ssh', timeoutSeconds: 8 }
    case 'base64':
      return { action: 'encode', data: 'unison' }
    case 'research_and_acquire_tool':
      return {}
    default:
      return {}
  }
}

function parse(raw) {
  try {
    const value = JSON.parse(raw)
    return { ok: value?.ok === true, error: value?.error ? String(value.error).slice(0, 140) : '', raw: value }
  } catch {
    return { ok: false, error: String(raw).slice(0, 140), raw: null }
  }
}

async function withTimeout(promise, ms) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout ${ms}ms`)), ms)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    clearTimeout(timer)
  }
}

async function uiCall(name, args) {
  const res = await fetch(`${UI}/api/agent-runs/tool`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, arguments: args, record: false }),
  })
  return parse(await res.text())
}

const names = tools.map((tool) => tool.function.name)
const executorSrc = fs.readFileSync(new URL('../aiui-agent/tools/executor.mjs', import.meta.url), 'utf8')
const handled = [...executorSrc.matchAll(/name === '([^']+)'/g)].map((match) => match[1])
const uiSrc = fs.readFileSync(new URL('../../src/lib/agent.ts', import.meta.url), 'utf8')
const uiLocal = [...uiSrc.matchAll(/name === '([^']+)'/g)].map((match) => match[1]).filter((name) => name !== 'exec')

const catalogGaps = [
  ...handled.filter((name) => !names.includes(name)).map((name) => `executor missing schema: ${name}`),
  ...names.filter((name) => !handled.includes(name)).map((name) => `schema missing executor: ${name}`),
  ...uiLocal.filter((name) => !names.includes(name)).map((name) => `ui local tool not in registry: ${name}`),
]

const rows = []
for (const name of names) {
  const args = argsFor(name)
  const limit = name.startsWith('browser_') || name === 'ssh' || name.includes('container') ? 25000 : 12000
  const resetSample = () => fs.writeFileSync(sample, 'alpha unison BETA\n')
  let cli
  let ui
  try {
    if (name === 'replace_file_content' || name === 'multi_replace_file_content' || name === 'write_file') resetSample()
    cli = parse(await withTimeout(executeTool(name, JSON.stringify(args), ctx), limit))
  } catch (err) {
    cli = { ok: false, error: err.message }
  }
  try {
    if (name === 'replace_file_content' || name === 'multi_replace_file_content' || name === 'write_file') resetSample()
    ui = await withTimeout(uiCall(name, args), limit)
  } catch (err) {
    ui = { ok: false, error: err.message }
  }
  const unison = cli.ok === ui.ok
  rows.push({ name, unison, cli: cli.ok, ui: ui.ok, cliError: cli.error, uiError: ui.error })
  const mark = unison ? 'UNISON' : 'SPLIT'
  console.log(`${mark} ${name} cli=${cli.ok} ui=${ui.ok}${cli.error || ui.error ? ` :: ${(cli.error || ui.error).slice(0, 100)}` : ''}`)
}

try {
  await executeTool('stop_daemon', JSON.stringify({ id: daemonId }), ctx)
} catch {
  /* bench daemon already stopped or never started */
}

const split = rows.filter((row) => !row.unison)
console.log(`\ncatalog ${catalogGaps.length ? catalogGaps.join('; ') : 'unison ' + names.length}`)
console.log(`tools ${rows.length} unison ${rows.length - split.length} split ${split.length}`)
if (catalogGaps.length || split.length) process.exit(1)
