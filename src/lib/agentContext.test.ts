import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { compactHistoricToolMessages, formatToolOutputForContext } from './agent.ts'
import type { ChatMessage } from './api.ts'

describe('studio context curation', () => {
  it('keeps a short tool result free of the offload hint', () => {
    assert.equal(formatToolOutputForContext('ok'), 'ok')
  })

  it('adds the offload hint when a dump is truncated', () => {
    const out = formatToolOutputForContext('y'.repeat(5000))
    assert.match(out, /characters truncated/)
    assert.match(out, /squad_enqueue/)
  })

  it('compacts tool output older than the last four messages', () => {
    const bulky = 'A'.repeat(400)
    const messages: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'go' },
      { role: 'tool', content: bulky, tool_call_id: 'old' },
      { role: 'assistant', content: 'next' },
      { role: 'tool', content: bulky, tool_call_id: 'recent' },
      { role: 'assistant', content: 'more' },
      { role: 'user', content: 'steer' },
      { role: 'assistant', content: 'now' },
    ]
    const out = compactHistoricToolMessages(messages)
    assert.match(String(out[2].content), /Compacted/)
    assert.equal(out[4].content, bulky)
    assert.equal(compactHistoricToolMessages(messages.slice(0, 3)).length, 3)
  })
})
