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

  it('mode all allows public http(s) websites', () => {
    const all = { mode: 'all', origins: ['http://127.0.0.1:5173'] }
    assert.equal(isOriginAllowlisted('https://betzillo.com', all), true)
    assert.equal(isOriginAllowlisted('https://example.com', all), true)
    assert.equal(isOriginAllowlisted('https://www.example.com/path', all), true)
  })

  it('mode all allows explicitly listed loopback origins (path/slash ignored)', () => {
    const all = {
      mode: 'all',
      origins: ['http://127.0.0.1:5173', 'http://localhost:5173/', 'http://127.0.0.1:5175'],
    }
    assert.equal(isOriginAllowlisted('http://127.0.0.1:5173', all), true)
    assert.equal(isOriginAllowlisted('http://127.0.0.1:5173/', all), true)
    assert.equal(isOriginAllowlisted('http://127.0.0.1:5173/app?x=1#hash', all), true)
    assert.equal(isOriginAllowlisted('http://localhost:5173/', all), true)
    assert.equal(isOriginAllowlisted('http://127.0.0.1:5175/x', all), true)
  })

  it('mode all rejects private loopback and non-http(s)', () => {
    const all = { mode: 'all', origins: ['http://127.0.0.1:5173'] }
    assert.equal(isOriginAllowlisted('http://127.0.0.1:9999', all), false)
    assert.equal(isOriginAllowlisted('file:///tmp/x', all), false)
    assert.equal(isOriginAllowlisted('https://user:pass@example.com/', all), false)
    assert.equal(isOriginAllowlisted('http://192.168.1.1/', all), false)
    assert.equal(isOriginAllowlisted('http://10.0.0.5/', all), false)
    assert.equal(isOriginAllowlisted('http://printer.local/', all), false)
  })

  it('mode all still allows operator-started localhost', () => {
    const all = { mode: 'all', origins: [] }
    assert.equal(isOriginAllowlisted('http://127.0.0.1:4312/', all, { operatorStarted: true }), true)
    assert.equal(isOriginAllowlisted('http://localhost:3000/', all, { operatorStarted: true }), true)
  })
})
