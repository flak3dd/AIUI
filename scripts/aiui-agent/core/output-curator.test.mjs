import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { formatToolOutputForContext } from './output-curator.mjs'

describe('formatToolOutputForContext', () => {
  it('keeps a short tool result intact', () => {
    const text = 'exit 0\nok'
    assert.equal(formatToolOutputForContext(text), text)
  })

  it('caps a long dump and points at squad_enqueue', () => {
    const text = 'x'.repeat(12000)
    const out = formatToolOutputForContext(text)
    assert.ok(out.length < text.length)
    assert.match(out, /characters truncated/)
    assert.match(out, /squad_enqueue/)
  })

  it('omits middle lines of a long log', () => {
    const text = Array.from({ length: 400 }, (_, i) => `line ${i}`).join('\n')
    const out = formatToolOutputForContext(text)
    assert.match(out, /lines omitted/)
    assert.match(out, /squad_enqueue/)
    assert.ok(!out.includes('line 199'))
  })
})
