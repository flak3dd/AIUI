import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  isOptimizeShortcut,
  expandOptimizePrompt,
  COMPLETE_OPTIMIZATION_DIRECTIVE,
} from './chatResponseOptimizer.ts'

describe('chatResponseOptimizer — optimise shortcut prompt', () => {
  it('detects simple "optimise" and "optimize"', () => {
    assert.equal(isOptimizeShortcut('optimise'), true)
    assert.equal(isOptimizeShortcut('optimize'), true)
    assert.equal(isOptimizeShortcut('OPTIMISE'), true)
    assert.equal(isOptimizeShortcut('  optimise  '), true)
  })

  it('detects slash command variants "/optimise" and "/optimize"', () => {
    assert.equal(isOptimizeShortcut('/optimise'), true)
    assert.equal(isOptimizeShortcut('/optimize'), true)
    assert.equal(isOptimizeShortcut('⚡ optimise'), true)
  })

  it('detects shortcut with extra focus area arguments', () => {
    assert.equal(isOptimizeShortcut('optimise memory'), true)
    assert.equal(isOptimizeShortcut('optimize gb10 vram'), true)
    assert.equal(isOptimizeShortcut('/optimise sandbox caches'), true)
  })

  it('does not trigger on unrelated regular conversation', () => {
    assert.equal(isOptimizeShortcut('how do I optimize this sql query?'), false)
    assert.equal(isOptimizeShortcut('can we optimize our webpack build?'), false)
    assert.equal(isOptimizeShortcut('optimism is a virtue'), false)
  })

  it('expands "optimise" into the comprehensive directive', () => {
    const expanded = expandOptimizePrompt('optimise')
    assert.equal(expanded, COMPLETE_OPTIMIZATION_DIRECTIVE)
    assert.ok(expanded.includes('Telemetry & Hardware State'))
    assert.ok(expanded.includes('nvidia-smi'))
    assert.ok(expanded.includes('DGX vLLM (:8000)'))
    assert.ok(expanded.includes('Sandbox Runner (:17330)'))
    assert.ok(expanded.includes('MemPalace Bridge (:17333)'))
    assert.ok(expanded.includes('Meta-Awareness Monitor (:17336)'))
    assert.ok(expanded.includes('http://127.0.0.1:17336/api/suggestions'))
    assert.ok(expanded.includes('http://127.0.0.1:17337/api/policy'))
  })

  it('appends special focus area when arguments are provided', () => {
    const expanded = expandOptimizePrompt('optimise DGX GPU VRAM')
    assert.ok(expanded.includes(COMPLETE_OPTIMIZATION_DIRECTIVE))
    assert.ok(expanded.includes('**Special Focus Area:** DGX GPU VRAM'))
  })
})

describe('chatResponseOptimizer — evolved strategy policy integration', () => {
  it('applies evolved policy temperature biases correctly with boundary clamping', async () => {
    const { applyOptimizerTemperature } = await import('./chatResponseOptimizer.ts')

    // Test positive bias (exploration-heavy evolved strategy)
    const explorerPolicy = {
      enabled: true,
      updatedAt: Date.now(),
      healthIndex: 85,
      maxDurationMs: 35000,
      minUsefulChars: 45,
      antiLoopStrict: true,
      temperatureBias: 0.18,
      systemNudge: 'Require test assertion evidence and real exit codes before concluding.',
      reasons: ['evolved_archetype_novelty_explorer'],
      stats: { eventsSeen: 10, emptyResponses: 0, slowResponses: 0, stalls: 0, toolHeavyRatio: 0.5 },
    }
    assert.equal(applyOptimizerTemperature(0.7, explorerPolicy), 0.88)

    // Test negative bias (defensive / deep-build strategy)
    const deepBuildPolicy = {
      ...explorerPolicy,
      temperatureBias: -0.22,
      reasons: ['evolved_archetype_deep-build_high-assurance'],
    }
    assert.equal(applyOptimizerTemperature(0.7, deepBuildPolicy), 0.48)

    // Test boundary clamping
    const extremePolicy = { ...explorerPolicy, temperatureBias: 0.8 }
    assert.equal(applyOptimizerTemperature(0.7, extremePolicy), 1.2) // Clamped to 1.2

    const freezingPolicy = { ...explorerPolicy, temperatureBias: -0.9 }
    assert.equal(applyOptimizerTemperature(0.7, freezingPolicy), 0.0) // Clamped to 0.0
  })

  it('extracts actionable system nudges from evolved policy', async () => {
    const { optimizerNudgeText } = await import('./chatResponseOptimizer.ts')

    const evolvedPolicy = {
      enabled: true,
      updatedAt: Date.now(),
      healthIndex: 92,
      maxDurationMs: 28000,
      minUsefulChars: 50,
      antiLoopStrict: true,
      temperatureBias: -0.10,
      systemNudge: 'Require test assertion evidence and real exit codes before concluding. If blocked >1 attempt, stop retrying the same tool; pivot immediately.',
      reasons: ['evolved_archetype_balanced_generalist', 'multi_objective_ga_tuned'],
      stats: { eventsSeen: 100, emptyResponses: 2, slowResponses: 1, stalls: 0, toolHeavyRatio: 0.4 },
    }

    const nudge = optimizerNudgeText(evolvedPolicy)
    assert.ok(nudge)
    assert.ok(nudge.includes('Require test assertion evidence'))
    assert.ok(nudge.includes('pivot immediately'))
  })

  it('validates active logs/chat-response-optimizer-policy.json schema integration', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const policyPath = path.resolve(process.cwd(), 'logs/chat-response-optimizer-policy.json')

    if (fs.existsSync(policyPath)) {
      const content = JSON.parse(fs.readFileSync(policyPath, 'utf8'))
      assert.equal(typeof content.enabled, 'boolean')
      assert.equal(typeof content.healthIndex, 'number')
      assert.equal(typeof content.temperatureBias, 'number')
      assert.ok(content.healthIndex >= 0 && content.healthIndex <= 100)
      assert.ok(content.temperatureBias >= -1.0 && content.temperatureBias <= 1.0)
      assert.ok(Array.isArray(content.reasons))
      assert.equal(typeof content.stats, 'object')
    }
  })

  it('validates evolved multi-task contextual genome in active policy', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const policyPath = path.resolve(process.cwd(), 'logs/chat-response-optimizer-policy.json')

    if (fs.existsSync(policyPath)) {
      const content = JSON.parse(fs.readFileSync(policyPath, 'utf8'))
      assert.ok(content.stats.multiTaskGenome, 'Policy should contain multiTaskGenome')
      const mg = content.stats.multiTaskGenome
      assert.ok(mg.code_gen, 'multiTaskGenome should have code_gen')
      assert.ok(mg.self_healing, 'multiTaskGenome should have self_healing')
      assert.ok(mg.fast_query, 'multiTaskGenome should have fast_query')
      assert.ok(mg.systems_devops, 'multiTaskGenome should have systems_devops')
      assert.ok(mg.global_meta, 'multiTaskGenome should have global_meta')
      assert.equal(typeof mg.code_gen.diff_conservatism, 'number')
      assert.equal(typeof mg.code_gen.verification_depth, 'number')
      assert.equal(typeof mg.self_healing.anti_loop_sensitivity, 'number')
    }
  })
})

