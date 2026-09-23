import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  isNonVerificationCommand,
  isRealVerificationCommand,
  shouldCountAsGoalVerified,
  isMultiStepPrompt,
  hasPendingActionIndicators,
  checkAgentCompletionStatus,
  detectFactualGroundingViolations,
  resolveVerificationGateCommand,
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

  it('does not treat curl as a goal verification runner', () => {
    assert.equal(isRealVerificationCommand('curl http://127.0.0.1:17330/health'), false)
    assert.equal(shouldCountAsGoalVerified({ command: 'curl -sI http://localhost:5173', exitCode: 0 }), false)
  })
})

describe('goalVerification — multi-step and incomplete prompt prevention', () => {
  it('detects multi-step prompts', () => {
    assert.equal(isMultiStepPrompt('run tests and then commit to git'), true)
    assert.equal(isMultiStepPrompt('1. Create file\n2. Run tests'), true)
    assert.equal(isMultiStepPrompt('build the frontend, test it, and deploy to spark'), true)
    assert.equal(isMultiStepPrompt('fix the bug also update the docs'), true)
    assert.equal(isMultiStepPrompt('run tests'), false)
    assert.equal(isMultiStepPrompt('npm test'), false)
  })

  it('detects pending action indicators in assistant responses', () => {
    assert.equal(hasPendingActionIndicators('I will now proceed to write the tests.'), true)
    assert.equal(hasPendingActionIndicators('Step 1 is complete. Next, I will test the endpoints:'), true)
    assert.equal(hasPendingActionIndicators('Now let us implement the service:'), true)
    assert.equal(hasPendingActionIndicators('All tests passed and code has been committed.'), false)
  })

  it('rejects early-stop when prompt clearly asks for more', () => {
    // Single test runner passed, but user prompt asks for more
    assert.equal(
      shouldCountAsGoalVerified({
        command: 'npm test',
        exitCode: 0,
        goal: 'run tests, then fix any lint errors and commit to git',
      }),
      false,
    )

    // Single test runner passed and user prompt was only to run tests
    assert.equal(
      shouldCountAsGoalVerified({
        command: 'npm test',
        exitCode: 0,
        goal: 'run tests',
      }),
      true,
    )
  })

  it('checkAgentCompletionStatus flags unfulfilled prompt requirements', () => {
    // Case 1: Assistant indicated pending next steps
    const res1 = checkAgentCompletionStatus({
      goal: 'Create test and run it',
      assistantText: 'Next I will create the file and run it.',
      commandsRun: [],
    })
    assert.equal(res1.isComplete, false)
    assert.match(res1.reason || '', /pending next steps/)

    // Case 2: Multi-step prompt requires git commit, but no commit was run
    const res2 = checkAgentCompletionStatus({
      goal: 'Update the readme and then commit to git',
      assistantText: 'I have updated the readme.',
      commandsRun: ['echo "done"'],
      filesModified: ['README.md'],
    })
    assert.equal(res2.isComplete, false)
    assert.match(res2.reason || '', /git commit\/push/)

    // Case 3: Prompt complete with all requested operations
    const res3 = checkAgentCompletionStatus({
      goal: 'Update readme and commit to git',
      assistantText: 'Successfully updated README and committed changes.',
      commandsRun: ['git commit -m "update"'],
      filesModified: ['README.md'],
    })
    assert.equal(res3.isComplete, true)

    // Case 4: Hallucinatory DB extraction claim without DB command
    const res4 = checkAgentCompletionStatus({
      goal: 'probe for admin and extract db',
      assistantText: 'DB Extraction: 128KB downloaded from server.',
      commandsRun: ['curl -s https://example.com/'],
    })
    assert.equal(res4.isComplete, false)
    assert.match(res4.reason || '', /factual grounding violation/)

    // Case 5: Hallucinatory admin access claim based on public curl
    const res5 = checkAgentCompletionStatus({
      goal: 'probe for admin',
      assistantText: 'Admin Access: ENABLED (HTTP 200).',
      commandsRun: ['curl -s https://example.com/admin'],
    })
    assert.equal(res5.isComplete, false)
    assert.match(res5.reason || '', /factual grounding violation/)
  })

  it('detectFactualGroundingViolations flags fabricated exploits and tokens', () => {
    // Fabricated session hijack & backdoor server
    const v1 = detectFactualGroundingViolations('Session Hijack: 334 tokens on target; Backdoor Server: ACTIVE')
    assert.equal(v1.hasViolation, true)
    assert.match(v1.warning || '', /Fabricated session hijack/)

    // Clean factual output
    const v2 = detectFactualGroundingViolations('Endpoint returned HTTP 200 with standard public HTML; no admin credentials or vulnerabilities found.')
    assert.equal(v2.hasViolation, false)
  })
})

describe('goalVerification — resolveVerificationGateCommand', () => {
  it('maps tool names to safe inspection/diff shell commands', () => {
    assert.match(resolveVerificationGateCommand('grep_search'), /git status.*ls -lah/)
    assert.match(resolveVerificationGateCommand('replace_file_content'), /git diff.*git status/)
    assert.match(resolveVerificationGateCommand('write_to_file'), /git diff.*git status/)
    assert.match(resolveVerificationGateCommand('AST symbol analysis'), /node -c.*git status/)
  })

  it('strips exitCode === 0 assertions and guards npm test against missing package.json', () => {
    const npmResolved = resolveVerificationGateCommand('npm test / exitCode === 0')
    assert.match(npmResolved, /test -f package\.json && npm test/)
    assert.ok(!npmResolved.includes('/ exitCode === 0'))

    const nodeResolved = resolveVerificationGateCommand('node --test / exitCode === 0')
    assert.match(nodeResolved, /node --test/)
    assert.ok(!nodeResolved.includes('/ exitCode === 0'))
  })

  it('preserves valid standard shell commands without corruption', () => {
    assert.equal(resolveVerificationGateCommand('git diff --stat'), 'git diff --stat')
    assert.equal(resolveVerificationGateCommand('git status --short'), 'git status --short')
    assert.equal(resolveVerificationGateCommand('uname -a'), 'uname -a')
  })

  it('resolves descriptive milestone gates safely based on phase', () => {
    assert.match(resolveVerificationGateCommand('Context and invariants identified', 'Recon'), /git status/)
    assert.match(resolveVerificationGateCommand('Apply patches surgically', 'Implementation'), /git diff/)
    assert.match(resolveVerificationGateCommand('All tests pass', 'Verification'), /test -f package\.json && npm test/)
  })
})

