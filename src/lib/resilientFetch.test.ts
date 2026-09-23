import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { fetchWithRetry } from './resilientFetch.ts'

describe('fetchWithRetry', () => {
  it('retries a lost connection and then uses the backup', async () => {
    const calls: string[] = []
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const href = String(input)
      calls.push(href)
      if (href.includes('backup')) return new Response('ok', { status: 200 })
      throw new Error('connection lost')
    }) as typeof fetch
    const response = await fetchWithRetry('http://primary/health', {}, {
      attempts: 2,
      backups: ['http://backup/health'],
      fetchImpl,
    })
    assert.equal(response.status, 200)
    assert.deepEqual(calls, [
      'http://primary/health',
      'http://primary/health',
      'http://backup/health',
    ])
  })
})
