import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  sparkEndpointGroups,
  sparkHostsForRoute,
  normalizeSparkRoute,
} from './providers.ts'

describe('spark vLLM routes', () => {
  it('LAN switch stays on the LAN host', () => {
    assert.deepEqual(sparkHostsForRoute('lan', '192.168.4.103'), ['192.168.4.103'])
    const groups = sparkEndpointGroups('192.168.4.103', 8000, true, 'lan')
    assert.equal(groups.length, 1)
    assert.equal(groups[0][groups[0].length - 1], 'http://192.168.4.103:8000/v1')
    assert.ok(groups[0].includes('http://127.0.0.1:17332/spark/192.168.4.103/8000/v1'))
  })

  it('Tailscale switch stays on the Tailscale host', () => {
    const groups = sparkEndpointGroups('192.168.4.103', 8000, true, 'tailscale')
    assert.equal(groups.length, 1)
    assert.equal(groups[0][groups[0].length - 1], 'http://100.66.147.53:8000/v1')
  })

  it('Both races LAN and Tailscale as separate chains', () => {
    const groups = sparkEndpointGroups('192.168.4.103', 8000, true, 'both')
    assert.equal(groups.length, 2)
    assert.equal(groups[0][groups[0].length - 1], 'http://192.168.4.103:8000/v1')
    assert.equal(groups[1][groups[1].length - 1], 'http://100.66.147.53:8000/v1')
  })

  it('unknown route values fall back to both', () => {
    assert.equal(normalizeSparkRoute('nope'), 'both')
    assert.equal(normalizeSparkRoute('lan'), 'lan')
  })
})
