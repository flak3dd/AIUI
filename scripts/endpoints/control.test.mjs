import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { controlEndpoint, ENDPOINTS, probeUrls } from './control.mjs'

describe('endpoint control', () => {
  it('rejects an unknown action and refuses to stop the studio', async () => {
    const bad = await controlEndpoint('sandbox', 'reboot')
    assert.equal(bad.ok, false)
    const studio = await controlEndpoint('studio', 'stop')
    assert.equal(studio.ok, false)
    assert.match(studio.message, /disabled/i)
  })

  it('keeps a backup URL for Spark LAN and the key proxy', () => {
    const lan = ENDPOINTS.find((item) => item.id === 'spark-lan')
    const proxy = ENDPOINTS.find((item) => item.id === 'proxy')
    assert.ok(probeUrls(lan).includes('http://100.66.147.53:8000/v1/models'))
    assert.ok(probeUrls(proxy).includes('http://100.66.147.53:8000/v1/models'))
  })
})
