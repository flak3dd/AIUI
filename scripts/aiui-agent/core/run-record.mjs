import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const RUNS_DIR = path.join(ROOT, 'data', 'agent-runs')

function recordPath(id) {
  return path.join(RUNS_DIR, id, 'record.json')
}

function write(record) {
  const dir = path.join(RUNS_DIR, record.id)
  fs.mkdirSync(dir, { recursive: true })
  record.updatedAt = new Date().toISOString()
  fs.writeFileSync(recordPath(record.id), JSON.stringify(record, null, 2))
  return record
}

export function createRun({ goal }) {
  const record = {
    id: `run-${Date.now()}`,
    goal: String(goal || ''),
    status: 'running',
    steps: [],
    filesTouched: [],
    lastCommand: '',
    browserRunId: null,
    milestones: [],
    children: [],
    checkpoint: null,
    finishedAt: null,
    updatedAt: new Date().toISOString(),
  }
  return write(record)
}

export function readRun(id) {
  try {
    return JSON.parse(fs.readFileSync(recordPath(id), 'utf8'))
  } catch {
    return null
  }
}

export function readLatestRun() {
  if (!fs.existsSync(RUNS_DIR)) return null
  const ids = fs.readdirSync(RUNS_DIR).filter((name) => fs.existsSync(recordPath(name)))
  if (!ids.length) return null
  ids.sort()
  return readRun(ids[ids.length - 1])
}

export function updateRun(id, patch) {
  const current = readRun(id)
  if (!current) return null
  const next = { ...current, ...patch, id: current.id }
  if (next.status === 'verified' && !next.finishedAt) next.finishedAt = new Date().toISOString()
  if (next.status !== 'verified') next.finishedAt = null
  return write(next)
}

export function appendStep(id, step) {
  const current = readRun(id)
  if (!current) return null
  const entry = {
    tool: String(step.tool || ''),
    ok: step.ok === true,
    exitCode: typeof step.exitCode === 'number' ? step.exitCode : null,
    result: String(step.result || '').slice(0, 500),
    at: new Date().toISOString(),
  }
  current.steps.push(entry)
  if (step.command) current.lastCommand = String(step.command)
  if (Array.isArray(step.files)) {
    for (const file of step.files) {
      if (file && !current.filesTouched.includes(file)) current.filesTouched.push(file)
    }
  }
  if (step.browserRunId) current.browserRunId = step.browserRunId
  return write(current)
}

export function writeCheckpoint(id, checkpoint) {
  return updateRun(id, {
    status: 'running',
    checkpoint: {
      summary: String(checkpoint.summary || ''),
      nextStep: String(checkpoint.nextStep || 'continue the same task'),
      updatedAt: new Date().toISOString(),
    },
  })
}

export function resumeText(record) {
  if (!record?.checkpoint?.summary) return ''
  return `${record.checkpoint.summary}\n\nOriginal goal: ${record.goal}`
}
