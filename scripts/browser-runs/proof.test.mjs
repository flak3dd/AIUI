import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isCountableBrowserRun, isOriginAllowlisted } from './proof.mjs'

const countable = {
  executorRan: true,
  engine: 'playwright-chromium',
  finalUrl: 'http://127.0.0.1:9/',
  httpStatus: 200,
  domAssertion: { ok: true },
  consoleErrorCount: 0,
  screenshot: { bytes: 12 },
  steps: [
    { action: 'type', ok: true, engine: 'playwright-chromium' },
    { action: 'click', ok: true, engine: 'playwright-chromium' },
  ],
}

describe('durable browser proof', () => {
  it('rejects HTTP fallback and a bare status 200', () => {
    assert.equal(isCountableBrowserRun({ ...countable, engine: 'http-fallback', screenshot: { bytes: 0 }, steps: [] }), false)
    assert.equal(isCountableBrowserRun({ ...countable, screenshot: { bytes: 0 } }), false)
    assert.equal(isCountableBrowserRun({ ...countable, domAssertion: { ok: false } }), false)
    assert.equal(isCountableBrowserRun({ ...countable, executorRan: false }), false)
  })

  it('counts a playwright run with click, type, and screenshot bytes', () => {
    assert.equal(isCountableBrowserRun(countable), true)
  })

  it('blocks unattended origins that were not allowlisted', () => {
    assert.equal(isOriginAllowlisted('https://pay.example/login', ['http://127.0.0.1:5173']), false)
    assert.equal(isOriginAllowlisted('http://127.0.0.1:5173/app', ['http://127.0.0.1:5173']), true)
    assert.equal(isOriginAllowlisted('http://127.0.0.1:4312/', [], { operatorStarted: true }), true)
  })
})
