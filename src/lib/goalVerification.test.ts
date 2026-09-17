import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  isNonVerificationCommand,
  isRealVerificationCommand,
  shouldCountAsGoalVerified,
} from './goalVerification.ts'

describe('goalVerification — false positives from AIUI agent runs', () => {
  it('does not treat mkdir under tests/ as verification', () => {
    const cmd = 'mkdir -p /tmp/spark-sandboxes/automation-scaffold/tests/e2e'
    assert.equal(isRealVerificationCommand(cmd), false)
    assert.equal(shouldCountAsGoalVerified({ command: cmd, exitCode: 0 }), false)
  })

  it('does not treat ls of tests/ with || echo as verification', () => {
    const cmd =
      'ls -la /tmp/spark-sandboxes/automation-scaffold/tests/e2e/ 2>/dev/null || echo "neither path exists"'
    assert.equal(isNonVerificationCommand(cmd), true)
    assert.equal(shouldCountAsGoalVerified({ command: cmd, exitCode: 0 }), false)
  })

  it('does not treat empty find of *.ts under scaffold as verification', () => {
    const cmd =
      'find /tmp/spark-sandboxes/automation-scaffold -type f -name "*.ts" -o -name "*.csv"'
    assert.equal(shouldCountAsGoalVerified({ command: cmd, exitCode: 0, stdout: '' }), false)
  })

  it('does not match bare substring test in a path', () => {
    assert.equal(isRealVerificationCommand('cat src/tests/helper.ts'), false)
    assert.equal(isRealVerificationCommand('cd tests && ls'), false)
  })
})

describe('goalVerification — real runners still count', () => {
  it('accepts npm test / vitest / pytest / go test on exit 0', () => {
    for (const cmd of [
      'npm test',
      'npm run test',
      'npx vitest run',
      'pytest -q',
      'python3 -m pytest',
      'go test ./...',
      'cargo test',
      'npx playwright test',
      'npm run verify',
    ]) {
      assert.equal(isRealVerificationCommand(cmd), true, cmd)
      assert.equal(shouldCountAsGoalVerified({ command: cmd, exitCode: 0 }), true, cmd)
    }
  })

  it('rejects real runners that failed', () => {
    assert.equal(shouldCountAsGoalVerified({ command: 'npm test', exitCode: 1 }), false)
  })
})
