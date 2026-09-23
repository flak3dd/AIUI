import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  WAKE_CHAR_CAP,
  bindLocus,
  consolidationPlan,
  factsFromKg,
  formatRecallBlock,
  formatWakeBlock,
  reflectPalaceDraft,
  roomsFromTraverse,
} from './palaceOrchestrator.ts'
import { PALACE_L0, PALACE_L1 } from './palaceWake.ts'

describe('palace orchestrator', () => {
  it('skips the palace for general world knowledge', () => {
    const locus = bindLocus('what is photosynthesis in green plants')
    assert.equal(locus.palaceFirst, false)
    assert.deepEqual(locus.rooms, [])
  })

  it('binds the project wing and both rooms when the workflow uses MemPalace', () => {
    const locus = bindLocus('how does our response workflow use MemPalace')
    assert.equal(locus.palaceFirst, true)
    assert.deepEqual(locus.wings, ['wing_agent_design'])
    assert.ok(locus.rooms.includes('response-workflow'))
    assert.ok(locus.rooms.includes('mempalace-integration'))
    assert.equal(locus.needsPathway, true)
  })

  it('does not file ephemeral or secret turns', () => {
    assert.equal(consolidationPlan('list the files in src'), null)
    assert.equal(consolidationPlan('searching now for the failing test'), null)
    assert.equal(
      consolidationPlan('we decided the api key is sk-live-secret and we always use it'),
      null,
    )
  })

  it('files a durable project decision as the user worded it', () => {
    const plan = consolidationPlan(
      'We decided to use MemPalace for long-term memory in this project.',
    )
    assert.ok(plan)
    assert.equal(plan?.wing, 'wing_agent_design')
    assert.equal(plan?.room, 'mempalace-integration')
    assert.equal(plan?.hall, 'hall_facts')
    assert.match(plan?.drawer || '', /We decided to use MemPalace/)
    assert.equal(plan?.triple?.predicate, 'uses')
    assert.equal(plan?.triple?.object, 'MemPalace')
  })

  it('keeps wake under the pre-locus token budget and states a miss', () => {
    const wake = formatWakeBlock('12 drawers, 1 wings')
    assert.ok(wake.length <= WAKE_CHAR_CAP)
    assert.match(wake, /L0:/)
    assert.match(wake, /L1:/)
    assert.ok(PALACE_L0.length < 400)
    assert.ok(PALACE_L1.length < 3200)
    const miss = formatRecallBlock(
      {
        palaceFirst: true,
        needsPathway: false,
        wings: ['wing_agent_design'],
        rooms: ['response-workflow'],
        halls: ['hall_discoveries'],
      },
      [],
      '',
    )
    assert.match(miss, /not in the palace/)
  })

  it('reads hop rooms from a traverse payload before search would use them', () => {
    const rooms = roomsFromTraverse({
      room: 'response-workflow',
      connected: [{ room: 'mempalace-integration', hop: 1 }],
    })
    assert.deepEqual(rooms, ['response-workflow', 'mempalace-integration'])
  })

  it('fails one reflection when a miss is stated as a palace fact', () => {
    const locus = {
      palaceFirst: true,
      needsPathway: false,
      wings: ['wing_agent_design'],
      rooms: ['response-workflow'],
      halls: ['hall_facts'],
    }
    const failed = reflectPalaceDraft('We decided last time to use Clerk.', {
      locus,
      miss: true,
      facts: [],
    })
    assert.equal(failed.ok, false)
    const held = reflectPalaceDraft('That decision is not in the palace.', {
      locus,
      miss: true,
      facts: [],
    })
    assert.equal(held.ok, true)
    const triples = factsFromKg({
      facts: [{ subject: 'response-workflow', predicate: 'uses', object: 'MemPalace' }],
    })
    assert.equal(triples.length, 1)
    const contradicted = reflectPalaceDraft('That is not in the palace.', {
      locus,
      miss: false,
      facts: triples,
    })
    assert.equal(contradicted.ok, false)
  })
})
