import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import { appendStep, createRun, readLatestRun, resumeText, updateRun, writeCheckpoint } from './run-record.mjs'

describe('agent run record', () => {
  it('survives a new read and resumes from the checkpoint', () => {
    const created = createRun({ goal: 'fix the parser and test it' })
    appendStep(created.id, { tool: 'bash', ok: true, exitCode: 0, command: 'npm test', result: 'pass' })
    writeCheckpoint(created.id, { summary: 'Parser file edited.', nextStep: 'run npm test' })
    const latest = readLatestRun()
    assert.equal(latest.id, created.id)
    assert.equal(latest.status, 'running')
    assert.equal(latest.steps[0].tool, 'bash')
    assert.match(resumeText(latest), /Parser file edited/)
    assert.match(resumeText(latest), /fix the parser/)
    updateRun(created.id, { status: 'verified' })
    assert.ok(readLatestRun().finishedAt)
    fs.rmSync(path.resolve('data/agent-runs', created.id), { recursive: true, force: true })
  })
})
