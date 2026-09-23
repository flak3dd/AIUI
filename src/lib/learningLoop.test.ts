import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { applyLearningStep, freshLearningState, lessonFromAction } from './learningLoop.ts'

describe('learning loop', () => {
  it('files one lesson for a failed command and refuses a secret blob', () => {
    assert.equal(
      lessonFromAction({ command: 'ls missing', exitCode: 255 }),
      'Failed: ls missing (exit 255). Do not run that command unchanged.',
    )
    assert.equal(lessonFromAction({ command: 'echo api_key=sk-live', exitCode: 1 }), null)
  })

  it('marks a second look as a repeated phase', () => {
    let state = freshLearningState()
    const first = applyLearningStep(state, { toolName: 'read_file', filesRead: ['a.ts'] })
    state = first.state
    assert.equal(first.step.phase, 'look')
    assert.equal(first.step.repeated, false)
    const second = applyLearningStep(state, { toolName: 'grep_search', filesRead: ['b.ts'] })
    assert.equal(second.step.phase, 'look')
    assert.equal(second.step.repeated, true)
    assert.match(second.step.nudge || '', /repeated/)
  })

  it('stops the cached-output excuse on the second claim', () => {
    let state = freshLearningState()
    state = applyLearningStep(state, { responseText: 'The bash tool seems to be returning cached/old output. Let me try a different approach.' }).state
    const again = applyLearningStep(state, { responseText: 'This is likely a caching or display issue. Let me try a different approach.' })
    assert.ok(again.step.repeated)
    assert.match(again.step.nudge || '', /not cached/)
  })

  it('steers when reasoning repeats', () => {
    const plan = 'I will list the directory then read the same file and explain the same plan again in detail.'
    let state = freshLearningState()
    state = applyLearningStep(state, { reasoning: plan }).state
    const again = applyLearningStep(state, { reasoning: plan })
    assert.match(again.step.nudge || '', /reasoning/i)
  })
})
