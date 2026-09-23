import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  SQUADSARM_URLS,
  parseSquadswarmHealth,
  fetchSquadswarmStatus,
  squadswarmStatusHandler,
} from './squadswarm.mjs'

describe('squadswarm CLI client', () => {
  it('parses health JSON', () => {
    assert.deepEqual(
      parseSquadswarmHealth({ status: 'ok', version: '0.0.1' }),
      { status: 'ok', version: '0.0.1' },
    )
  })

  it('fetchSquadswarmStatus uses injected fetch', async () => {
    const fetchImpl = async (url) => {
      assert.equal(url, SQUADSARM_URLS.health)
      return new Response(JSON.stringify({ status: 'ok', version: '0.0.1' }), { status: 200 })
    }
    const result = await fetchSquadswarmStatus({ fetchImpl })
    assert.equal(result.online, true)
  })

  it('squadswarmStatusHandler returns JSON string', async () => {
    const prev = globalThis.fetch
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ status: 'ok', version: '0.0.1' }), { status: 200 })
    try {
      const raw = await squadswarmStatusHandler()
      const parsed = JSON.parse(raw)
      assert.equal(parsed.ok, true)
      assert.equal(parsed.urls.about, 'https://www.squadswarm.xyz/about')
    } finally {
      globalThis.fetch = prev
    }
  })
})
