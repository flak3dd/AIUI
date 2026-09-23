import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseNaturalLanguageCommand } from './nl-command.mjs'

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
})
