import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  looksLikeSecretMaterial,
  validateSquadSupportPayload,
  SQUAD_SUPPORT_MAX_CONTEXT_CHARS,
} from './squadSupport.ts'

describe('squadSupport studio helpers', () => {
  it('refuses secret material', () => {
    assert.equal(looksLikeSecretMaterial('ak_abcdefghijklmnopqrstuvwxyz'), true)
    assert.equal(looksLikeSecretMaterial('normal engineering brief'), false)
  })

  it('validates required task and size', () => {
    assert.equal(validateSquadSupportPayload('').ok, false)
    const ok = validateSquadSupportPayload('do the thing', 'ctx')
    assert.equal(ok.ok, true)
    if (ok.ok) {
      assert.equal(ok.task, 'do the thing')
      assert.equal(ok.context, 'ctx')
    }
    const big = validateSquadSupportPayload('t', 'y'.repeat(SQUAD_SUPPORT_MAX_CONTEXT_CHARS))
    assert.equal(big.ok, false)
  })
})
