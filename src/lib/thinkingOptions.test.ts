import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { resolveThinkingKwargs, classifyStreamDelta } from './thinkingOptions.ts'

describe('resolveThinkingKwargs', () => {
  it('omits kwargs for abliteration even when thinking enabled', () => {
    assert.equal(resolveThinkingKwargs('abliteration', true), undefined)
    assert.equal(resolveThinkingKwargs('abliteration', false), undefined)
  })

  it('sets enable_thinking true for spark/featherless when enabled', () => {
    assert.deepEqual(resolveThinkingKwargs('spark', true), { enable_thinking: true })
    assert.deepEqual(resolveThinkingKwargs('featherless', true), { enable_thinking: true })
  })

  it('sets enable_thinking false when disabled', () => {
    assert.deepEqual(resolveThinkingKwargs('spark', false), { enable_thinking: false })
  })
})

describe('classifyStreamDelta', () => {
  it('prefers content over reasoning when both present', () => {
    assert.deepEqual(
      classifyStreamDelta({ content: 'Hi', reasoning_content: 'think' }),
      { kind: 'content', text: 'Hi' },
    )
  })

  it('routes reasoning_content alone to reasoning', () => {
    assert.deepEqual(
      classifyStreamDelta({ reasoning_content: 'step 1' }),
      { kind: 'reasoning', text: 'step 1' },
    )
  })

  it('returns none for empty delta', () => {
    assert.deepEqual(classifyStreamDelta({}), { kind: 'none', text: '' })
  })
})
