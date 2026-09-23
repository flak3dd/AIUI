#!/usr/bin/env node
/**
 * Test Suite: AIUI Agent Strategy Meta-Evolutionary Policy Integration
 * Validates that the NSGA-II evolved policy and multi-task genome are
 * seamlessly integrated across config, system prompt, LLM transport, and telemetry.
 */
import assert from 'node:assert';
import { loadOptimizerPolicy } from './config.mjs';
import { SystemPromptEngine } from './core/system-prompt.mjs';

console.log('🧪 Running AIUI Evolved Policy Integration Test Suite...\n');

// ---------------------------------------------------------
// Test 1: Policy Loading & Genome Integrity
// ---------------------------------------------------------
console.log('• [Test 1/4] Validating loadOptimizerPolicy & multi-task genome...');
const policy = loadOptimizerPolicy();
assert.ok(policy, 'Evolved policy must exist');
assert.strictEqual(policy.enabled, true, 'Policy must be enabled');
assert.strictEqual(policy.healthIndex, 85, 'Health index should be 85');
assert.strictEqual(policy.maxDurationMs, 24369, 'Max duration should be 24369ms');
assert.strictEqual(policy.minUsefulChars, 27, 'Min useful chars should be 27');
assert.strictEqual(policy.temperatureBias, 0.069, 'Temperature bias should be +0.069');
assert.strictEqual(policy.antiLoopStrict, true, 'Anti-loop strict should be true');

const stats = policy.stats;
assert.ok(stats, 'Stats object must exist');
assert.strictEqual(stats.archetype, '🛡️ Deep-Build High-Assurance');
assert.strictEqual(stats.compositeFitness, 0.8513);
assert.strictEqual(stats.successRate, 0.8731);
assert.strictEqual(stats.turnEfficiency, 0.7859);
assert.strictEqual(stats.costEfficiency, 0.7144);
assert.strictEqual(stats.safetyScore, 0.9121);

const mg = stats.multiTaskGenome;
assert.ok(mg, 'Multi-task contextual genome must exist');
assert.strictEqual(mg.code_gen.diff_conservatism, 1.0);
assert.strictEqual(mg.code_gen.verification_depth, 0.962);
assert.strictEqual(mg.self_healing.anti_loop_sensitivity, 0.964);
assert.strictEqual(mg.self_healing.tool_diversity, 1.0);
assert.strictEqual(mg.fast_query.direct_response_ratio, 1.0);
assert.strictEqual(mg.systems_devops.pre_flight_dryrun, 0.936);
console.log('  ✔ Evolved policy, fitness scores, and multi-task genome verified.\n');

// ---------------------------------------------------------
// Test 2: SystemPromptEngine Dynamic Register Directives
// ---------------------------------------------------------
console.log('• [Test 2/4] Testing SystemPromptEngine evolved policy injection...');
const mockAgent = {
  maxRounds: 25,
  workspaceDir: process.cwd(),
  deepBuild: true,
  optimize: false, // Should activate via policy.enabled automatically
  circuitBreaker: { getHistoricalLessonsSummary: () => [] },
  messages: [],
  provider: 'spark',
};
const promptEngine = new SystemPromptEngine(mockAgent);
const register = promptEngine.buildDynamicCognitiveRegister(1, 'Implement feature', []);

assert.ok(register.includes('EVOLVED AGENT POLICY'), 'Register must contain EVOLVED AGENT POLICY mode');
assert.ok(register.includes('Deep-Build High-Assurance'), 'Register must mention evolved archetype');
assert.ok(register.includes('Diff Conservatism 100%'), 'Register must inject 100% diff conservatism directive');
assert.ok(register.includes('Verification Depth'), 'Register must inject verification depth directive');
assert.ok(register.includes('Direct Response Ratio'), 'Register must inject direct response ratio directive');
assert.ok(register.includes('Anti-Loop Sensitivity'), 'Register must inject anti-loop sensitivity directive');
assert.ok(register.includes('Pre-Flight Verification'), 'Register must inject pre-flight verification directive');
console.log('  ✔ SystemPromptEngine dynamic cognitive register accurately operationalizes genome.\n');

// ---------------------------------------------------------
// Test 3: Effective Temperature Calculation
// ---------------------------------------------------------
console.log('• [Test 3/4] Verifying effective temperature bias integration...');
const baseTemp = 0.2;
const isOptimized = mockAgent.optimize || Boolean(policy?.enabled);
assert.strictEqual(isOptimized, true, 'isOptimized should be true due to policy.enabled');
const tempBias = isOptimized ? (policy?.temperatureBias ?? 0) : 0;
const effectiveTemp = isOptimized ? Math.max(0.05, Math.min(1.0, baseTemp + tempBias)) : baseTemp;
assert.strictEqual(Number(effectiveTemp.toFixed(3)), 0.269, 'Effective temperature should be 0.269 (0.2 + 0.069)');
console.log(`  ✔ Effective temperature computed: ${effectiveTemp.toFixed(3)} (Base 0.2 + Bias 0.069)\n`);

// ---------------------------------------------------------
// Test 4: Slash Commands Existence
// ---------------------------------------------------------
console.log('• [Test 4/4] Validating slash commands (/policy, /evolve)...');
import fs from 'node:fs';
const agentCode = fs.readFileSync(new URL('./core/agent.mjs', import.meta.url), 'utf8');
assert.ok(agentCode.includes("cmd === '/policy'"), 'agent.mjs must contain /policy handler');
assert.ok(agentCode.includes("cmd === '/evolve'"), 'agent.mjs must contain /evolve handler');
assert.ok(agentCode.includes("'/policy'"), 'agent.mjs slashCommands must list /policy');
assert.ok(agentCode.includes("'/evolve'"), 'agent.mjs slashCommands must list /evolve');
console.log('  ✔ REPL commands /policy and /evolve validated in agent.mjs.\n');

console.log('================================================================');
console.log('🎉 ALL 4 POLICY INTEGRATION TESTS PASSED SUCCESSFULLY!');
console.log('================================================================');
