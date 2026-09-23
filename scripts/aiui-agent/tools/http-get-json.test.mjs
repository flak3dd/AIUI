import assert from 'node:assert/strict'
import http from 'node:http'
import { describe, it } from 'node:test'
import { isCountableBrowserRun } from '../../browser-runs/proof.mjs'
import { httpGetJsonHandler } from './handlers/utils.mjs'
import {
  buildHttpGetBodyMeta,
  fetchPublicHttpGet,
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
    assert.equal(isValidHttpGetUrl('http://host.local/x').ok, false)
    assert.equal(isValidHttpGetUrl('http://100.64.0.1/').ok, false)
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
    assert.equal(parsed.finalUrl, undefined)
  })
})

describe('http_get_json Bright Data residential SuperProxy egress', () => {
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

  it('selects brightdata-residential only when all four env vars are set', () => {
    const fake = {
      BRIGHTDATA_HOST: 'proxy-mock.example.test',
      BRIGHTDATA_PORT: '22225',
      BRIGHTDATA_USER: 'brd-customer-fake-zone-residential',
      BRIGHTDATA_PASS: 'fake-proxy-pass-not-real',
    }
    const cfg = resolveBrightDataProxyFromEnv(fake)
    assert.ok(cfg)
    assert.equal(cfg.host, 'proxy-mock.example.test')
    assert.equal(cfg.port, 22225)
    assert.equal(cfg.username, 'brd-customer-fake-zone-residential')
    assert.equal(typeof cfg.password, 'string')
    assert.equal(resolveHttpGetEgress(fake), 'brightdata-residential')
    // Incomplete set stays direct
    assert.equal(
      resolveHttpGetEgress({
        BRIGHTDATA_HOST: 'proxy-mock.example.test',
        BRIGHTDATA_PORT: '22225',
      }),
      'direct',
    )
  })

  it('buildHttpGetBodyMeta reports bytes and truncation', () => {
    const short = buildHttpGetBodyMeta('{"a":1}', 'application/json; charset=utf-8')
    assert.equal(short.contentType, 'application/json')
    assert.equal(short.truncated, false)
    assert.equal(short.chars, 7)
    assert.ok(short.bytes >= 7)

    const long = 'x'.repeat(5000)
    const meta = buildHttpGetBodyMeta(long, 'text/plain')
    assert.equal(meta.truncated, true)
    assert.equal(meta.chars, 5000)
    assert.equal(meta.previewChars, 4000)
  })

  it('fetchPublicHttpGet uses mocked CONNECT proxy and returns finalUrl + body meta', async () => {
    const origin = await new Promise((resolve) => {
      const server = http.createServer((_req, res) => {
        res.writeHead(400)
        res.end('expected CONNECT')
      })
      // Fake tunnel: accept CONNECT, then answer the proxied GET on the same socket.
      server.on('connect', (_req, clientSocket, _head) => {
        clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
        let buf = ''
        clientSocket.on('data', (chunk) => {
          buf += chunk.toString('utf8')
          if (!buf.includes('\r\n\r\n')) return
          const payload = '{"proxy":true}\n'
          clientSocket.write(
            'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n' +
              `Content-Length: ${Buffer.byteLength(payload)}\r\nConnection: close\r\n\r\n` +
              payload,
          )
          clientSocket.end()
        })
      })
      server.listen(0, '127.0.0.1', () => {
        const { port } = server.address()
        resolve({ server, port })
      })
    })

    try {
      const result = await fetchPublicHttpGet('http://example.com/public-json', {
        timeoutMs: 5000,
        env: {
          BRIGHTDATA_HOST: '127.0.0.1',
          BRIGHTDATA_PORT: String(origin.port),
          BRIGHTDATA_USER: 'fake-user-not-real',
          BRIGHTDATA_PASS: 'fake-pass-not-real',
        },
      })
      assert.equal(result.egress, 'brightdata-residential')
      assert.equal(result.status, 200)
      assert.equal(result.ok, true)
      assert.equal(result.finalUrl, 'http://example.com/public-json')
      assert.match(result.data, /proxy/)
      assert.equal(result.body.contentType, 'application/json')
      assert.equal(result.body.truncated, false)
      assert.ok(result.body.bytes > 0)
    } finally {
      origin.server.close()
    }
  })
})

describe('http_get_json is not browser proof', () => {
  it('egress labels cannot satisfy isCountableBrowserRun', () => {
    for (const egress of ['direct', 'brightdata-residential', 'brightdata-proxy']) {
      const resultShape = {
        ok: true,
        status: 200,
        data: '{"hello":true}',
        finalUrl: 'https://example.com/',
        body: { contentType: 'application/json', bytes: 14, chars: 14, truncated: false },
        egress,
      }
      assert.equal(isCountableBrowserRun(resultShape), false)
      assert.equal(
        isCountableBrowserRun({
          ...resultShape,
          executorRan: true,
          engine: egress,
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
