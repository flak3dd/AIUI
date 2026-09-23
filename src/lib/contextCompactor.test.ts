import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  estimateTokens,
  estimateMessagesTokens,
  getProviderContextLimit,
  compactMessagesForContext,
  calculateSafeMaxTokens,
} from './contextCompactor.ts'

describe('contextCompactor', () => {
  describe('estimateTokens', () => {
    it('approximates tokens based on length', () => {
      assert.equal(estimateTokens(''), 0)
      assert.equal(estimateTokens(null), 0)
      assert.equal(estimateTokens('hello world'), 4) // 11 / 3.4 ~ 3.23 -> 4
    })
  })

  describe('estimateMessagesTokens', () => {
    it('sums message contents and overhead', () => {
      const msgs = [
        { role: 'system', content: 'You are an AI assistant.' },
        { role: 'user', content: 'Hello there!' },
      ]
      const est = estimateMessagesTokens(msgs)
      assert.ok(est > 20, `Estimate should be > 20, got ${est}`)
    })
  })

  describe('getProviderContextLimit', () => {
    it('returns default context limit per provider', () => {
      assert.equal(getProviderContextLimit('spark'), 32768)
      assert.equal(getProviderContextLimit('featherless'), 32768)
      assert.equal(getProviderContextLimit('unknown'), 16384)
    })
  })

  describe('calculateSafeMaxTokens', () => {
    it('clamps output tokens when input consumes most of context', () => {
      // Input: 12289, Context: 16384, Requested: 4096 -> Headroom: 16384 - 12289 - 48 = 4047
      const safe = calculateSafeMaxTokens(12289, 4096, 16384, 48)
      assert.equal(safe, 4047)
      assert.ok(12289 + safe <= 16384, 'Total must not exceed max context')
    })

    it('returns requested tokens when headroom is ample', () => {
      const safe = calculateSafeMaxTokens(2000, 4096, 16384, 48)
      assert.equal(safe, 4096)
    })

    it('returns minimum floor when headroom is exhausted', () => {
      const safe = calculateSafeMaxTokens(16350, 4096, 16384, 48)
      assert.equal(safe, 256)
    })
  })

  describe('compactMessagesForContext', () => {
    it('compacts verbose intermediate tool outputs when exceeding context budget', () => {
      const largeOutput = 'X'.repeat(6000)
      const msgs = [
        { role: 'system', content: 'System Directive' },
        { role: 'user', content: 'Build a project' },
        { role: 'tool', content: largeOutput },
        { role: 'assistant', content: 'Working on it' },
        { role: 'user', content: 'What is the status?' },
      ]

      // Target maxContext 2000, targetOutput 500 -> budget ~1436 tokens
      const compacted = compactMessagesForContext(msgs, 2000, 500)
      assert.equal(compacted[0].role, 'system')
      assert.equal(compacted[1].role, 'user')
      assert.equal(compacted[1].content, 'Build a project')
      assert.equal(compacted[compacted.length - 1].content, 'What is the status?')

      const toolMsg = compacted.find((m) => m.role === 'tool')
      if (toolMsg) {
        assert.ok(
          toolMsg.content?.includes('[...output truncated to preserve context window...]'),
          'Tool output should be truncated'
        )
      }
    })
  })
})
