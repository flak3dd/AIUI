import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  parseNaturalLanguageCommand,
  detectWordCues,
  hasWordCue,
  stripAutomateCue,
  maybeRunAutomateCue,
} from './nl-command.mjs'

describe('natural language automation', () => {
  it('turns a sentence into open, click, read, and theme steps', () => {
    const steps = parseNaturalLanguageCommand(
      'Open the local studio, click Settings, go to the Health tab, and change the theme to Dracula',
    )
    assert.deepEqual(steps.map((step) => step.action), ['open', 'click', 'click', 'select'])
    assert.equal(steps[0].url, 'http://127.0.0.1:5173/')
    assert.equal(steps[1].selector, 'button[aria-label="Settings"]')
    assert.match(steps[2].selector, /Health/)
    assert.equal(steps[3].value, 'dracula')
  })

  it('refuses a clause it cannot understand', () => {
    const steps = parseNaturalLanguageCommand('deploy the cluster to production')
    assert.equal(steps[0].action, 'unknown')
  })

  it('maps local proof page to an allowlisted open', () => {
    const steps = parseNaturalLanguageCommand('the local proof page')
    assert.equal(steps[0].action, 'open')
    assert.equal(steps[0].url, 'http://127.0.0.1:5173/')
  })
})

describe('word cues', () => {
  it('triggers on "automate the local proof page"', () => {
    const text = 'automate the local proof page'
    assert.equal(hasWordCue(text, 'automate'), true)
    assert.deepEqual(
      detectWordCues(text).map((c) => c.id),
      ['automate'],
    )
    assert.equal(stripAutomateCue(text).toLowerCase().includes('proof'), true)
  })

  it('does not trigger on "explain automation"', () => {
    assert.equal(hasWordCue('explain automation', 'automate'), false)
    assert.equal(detectWordCues('explain automation').length, 0)
  })

  it('does not trigger on a sentence that only contains "automatic"', () => {
    assert.equal(hasWordCue('this is an automatic process', 'automate'), false)
    assert.equal(detectWordCues('this is an automatic process').length, 0)
  })

  it('does not trigger on bare chat with no cue', () => {
    assert.equal(hasWordCue('how does the health panel work?', 'automate'), false)
    assert.equal(detectWordCues('fix the local studio architecture').length, 0)
  })

  it('maybeRunAutomateCue no-ops without the cue (does not start the browser)', async () => {
    const result = await maybeRunAutomateCue('explain automation in the studio')
    assert.equal(result.triggered, false)
    assert.equal(result.started, false)
    assert.equal(result.ok, true)
    assert.equal(result.sessionId, undefined)
  })

  it('maybeRunAutomateCue refuses a named non-allowlisted origin', async () => {
    const result = await maybeRunAutomateCue('automate https://reddit.com/r/test', {
      allowlist: ['http://127.0.0.1:5173'],
    })
    assert.equal(result.triggered, true)
    assert.equal(result.started, false)
    assert.equal(result.ok, false)
    assert.match(result.error || '', /not allowlisted/i)
  })
})
