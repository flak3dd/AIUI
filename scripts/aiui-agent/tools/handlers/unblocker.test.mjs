import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { serializeCookies } from './unblocker.mjs'

describe('unlocker custom headers and cookies', () => {
  it('serializes cookie objects and lists into one Cookie header', () => {
    assert.equal(serializeCookies('session=abc'), 'session=abc')
    assert.equal(serializeCookies({ session: 'abc', theme: 'dracula' }), 'session=abc; theme=dracula')
    assert.equal(serializeCookies([{ name: 'session', value: 'abc' }]), 'session=abc')
  })
})
