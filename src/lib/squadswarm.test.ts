import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  SQUADSARM_URLS,
  parseSquadswarmHealth,
  fetchSquadswarmStatus,
} from './squadswarm.ts'

describe('parseSquadswarmHealth', () => {
  it('accepts the live health shape', () => {
    const health = parseSquadswarmHealth({
      status: 'ok',
      timestamp: '2026-09-23T08:48:08.858Z',
      version: '0.0.1',
    })
    assert.deepEqual(health, {
      status: 'ok',
      timestamp: '2026-09-23T08:48:08.858Z',
      version: '0.0.1',
    })
  })

  it('rejects unrelated payloads', () => {
    assert.equal(parseSquadswarmHealth(null), null)
    assert.equal(parseSquadswarmHealth({ error: 'Unauthorized' }), null)
    assert.equal(parseSquadswarmHealth({ status: 200 }), null)
  })
})

describe('fetchSquadswarmStatus', () => {
  it('marks online when fetch returns ok health JSON', async () => {
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({ status: 'ok', timestamp: '2026-09-23T00:00:00.000Z', version: '0.0.1' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    const result = await fetchSquadswarmStatus({ fetchImpl })
    assert.equal(result.ok, true)
    assert.equal(result.online, true)
    assert.equal(result.health?.version, '0.0.1')
    assert.equal(result.urls.health, SQUADSARM_URLS.health)
    assert.match(result.note, /magic link/i)
  })

  it('marks offline on 401-style bodies without inventing auth', async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    const result = await fetchSquadswarmStatus({ fetchImpl })
    assert.equal(result.ok, false)
    assert.equal(result.online, false)
    assert.equal(result.httpStatus, 401)
    assert.ok(result.error)
  })

  it('exposes only documented public URLs', () => {
    assert.equal(SQUADSARM_URLS.home, 'https://www.squadswarm.xyz/')
    assert.equal(SQUADSARM_URLS.health, 'https://www.squadswarm.xyz/api/health')
    assert.equal(SQUADSARM_URLS.scopes, 'https://www.squadswarm.xyz/scopes')
    assert.equal(SQUADSARM_URLS.docs, 'https://www.squadswarm.xyz/docs')
  })
})
