import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { critiqueTurn } from './criticGate.ts'

describe('critic gate', () => {
  it('passes when nothing was edited', () => {
    assert.equal(critiqueTurn({ filesModified: [], verified: false }).ok, true)
  })

  it('blocks a file change that has no passing command', () => {
    const result = critiqueTurn({ filesModified: ['src/App.tsx'], verified: false })
    assert.equal(result.ok, false)
    assert.match(result.reasons[0], /exited 0/)
  })

  it('blocks a passing edit that never recorded a diff', () => {
    const result = critiqueTurn({ filesModified: ['src/App.tsx'], verified: true })
    assert.equal(result.ok, false)
    assert.match(result.reasons.join(' '), /git diff/)
  })

  it('blocks secret paths even when verification passed', () => {
    const result = critiqueTurn({
      filesModified: ['.env'],
      verified: true,
      diffStat: '.env | 2 +-',
    })
    assert.equal(result.ok, false)
  })

  it('walks a sample fix from failed repro to a passing diff', () => {
    const before = critiqueTurn({ filesModified: ['src/auth/jwt.ts'], verified: false })
    assert.equal(before.ok, false)
    const after = critiqueTurn({
      filesModified: ['src/auth/jwt.ts'],
      verified: true,
      diffStat: 'src/auth/jwt.ts | 12 ++++----',
    })
    assert.equal(after.ok, true)
  })

  it('passes a normal edit with a diff stat', () => {
    const result = critiqueTurn({
      filesModified: ['src/App.tsx'],
      verified: true,
      diffStat: 'src/App.tsx | 4 +-',
    })
    assert.equal(result.ok, true)
  })
})