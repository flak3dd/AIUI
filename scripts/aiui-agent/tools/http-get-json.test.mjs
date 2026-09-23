import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isCountableBrowserRun } from '../../browser-runs/proof.mjs'
import { httpGetJsonHandler } from './handlers/utils.mjs'
import {
  isValidHttpGetUrl,
  resolveBrightDataProxyFromEnv,
  resolveHttpGetEgress,
} from './http-get-url.mjs'

describe('http_get_json Layer 1 URL gate', () => {
  it('accepts a public https URL shape without a network call', () => {
    const gate = isValidHttpGetUrl('https://api.github.com/repos')
    assert.equal(gate.ok, true)
    assert.equal(gate.url, 'https://api.github.com/repos')
  })

  it('rejects private and loopback URLs', () => {
    assert.equal(isValidHttpGetUrl('http://127.0.0.1:8000/health').ok, false)
    assert.equal(isValidHttpGetUrl('http://localhost:17330/api/sandbox/health').ok, false)
    assert.equal(isValidHttpGetUrl('http://192.168.4.103:8000/health').ok, false)
    assert.equal(isValidHttpGetUrl('http://10.0.0.1:8080/').ok, false)
    assert.equal(isValidHttpGetUrl('http://172.20.0.2:8000/').ok, false)
    assert.equal(isValidHttpGetUrl('http://169.254.169.254/latest/meta-data').ok, false)
    assert.equal(isValidHttpGetUrl('http://[::1]/').ok, false)
  })

  it('rejects file URLs and other non-http(s) schemes', () => {
    assert.equal(isValidHttpGetUrl('file:///etc/passwd').ok, false)
    assert.equal(isValidHttpGetUrl('javascript:alert(1)').ok, false)
    assert.equal(isValidHttpGetUrl('ftp://example.com/a').ok, false)
  })

  it('rejects missing, empty, credentialed, and malformed URLs', () => {
    assert.equal(isValidHttpGetUrl('').ok, false)
    assert.equal(isValidHttpGetUrl('   ').ok, false)
    assert.equal(isValidHttpGetUrl(undefined).ok, false)
    assert.equal(isValidHttpGetUrl('not-a-url').ok, false)
    assert.equal(isValidHttpGetUrl('https://user:secret@example.com/x').ok, false)
  })

  it('handler returns error JSON and does not fetch when rejected', async () => {
    const raw = await httpGetJsonHandler({ url: 'http://127.0.0.1:9/' })
    const parsed = JSON.parse(raw)
    assert.equal(parsed.ok, false)
    assert.match(String(parsed.error), /private|loopback|link-local/i)
    assert.equal(parsed.egress, undefined)
    assert.equal(parsed.status, undefined)
  })
})

describe('http_get_json Bright Data SuperProxy egress', () => {
  it('does not use proxy when SuperProxy env is empty', () => {
    const empty = {
      BRIGHTDATA_HOST: '',
      BRIGHTDATA_PORT: '',
      BRIGHTDATA_USER: '',
      BRIGHTDATA_PASS: '',
    }
    assert.equal(resolveBrightDataProxyFromEnv(empty), null)
    assert.equal(resolveHttpGetEgress(empty), 'direct')
    assert.equal(resolveBrightDataProxyFromEnv({}), null)
  })

  it('selects brightdata-proxy only when all four env vars are set', () => {
    const cfg = resolveBrightDataProxyFromEnv({
      BRIGHTDATA_HOST: 'brd.superproxy.io',
      BRIGHTDATA_PORT: '33335',
      BRIGHTDATA_USER: 'user-example',
      BRIGHTDATA_PASS: 'redacted',
    })
    assert.ok(cfg)
    assert.equal(cfg.host, 'brd.superproxy.io')
    assert.equal(cfg.port, 33335)
    assert.equal(cfg.username, 'user-example')
    assert.equal(typeof cfg.password, 'string')
    assert.equal(
      resolveHttpGetEgress({
        BRIGHTDATA_HOST: 'brd.superproxy.io',
        BRIGHTDATA_PORT: '33335',
        BRIGHTDATA_USER: 'user-example',
        BRIGHTDATA_PASS: 'redacted',
      }),
      'brightdata-proxy',
    )
    // Incomplete set stays direct
    assert.equal(
      resolveHttpGetEgress({
        BRIGHTDATA_HOST: 'brd.superproxy.io',
        BRIGHTDATA_PORT: '33335',
      }),
      'direct',
    )
  })
})

describe('http_get_json is not browser proof', () => {
  it('egress labels cannot satisfy isCountableBrowserRun', () => {
    for (const egress of ['direct', 'brightdata-proxy']) {
      const resultShape = {
        ok: true,
        status: 200,
        data: '{"hello":true}',
        egress,
      }
      assert.equal(isCountableBrowserRun(resultShape), false)
      assert.equal(
        isCountableBrowserRun({
          ...resultShape,
          executorRan: true,
          engine: egress,
          finalUrl: 'https://example.com/',
          httpStatus: 200,
          domAssertion: { ok: true },
          consoleErrorCount: 0,
          screenshot: { bytes: 1 },
          steps: [],
        }),
        false,
      )
    }
  })
})
