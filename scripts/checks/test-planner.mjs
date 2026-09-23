#!/usr/bin/env node
/**
 * ⚡ Automated Test Suite: AIUI Thinking & Planning Engine
 * Verifies 4-pillar cognitive deliberation, execution plan lifecycle,
 * milestone tracking, ANSI card rendering, and premature stop prevention.
 */

import assert from 'node:assert/strict';
import { PlanEngine, ExecutionPlan, PlanStep } from '../aiui-agent/core/planner.mjs';
import { getSkin } from '../aiui-agent/ui/skins.mjs';
import { renderPlanCard, renderThinkingMatrix } from '../aiui-agent/ui/components.mjs';
import { checkPlanCompletion } from '../aiui-agent/core/workflow-optimizer.mjs';

console.log('🧪 ================================================================');
console.log('🧪 TESTING AIUI COGNITIVE DELIBERATION & PLANNING ENGINE');
console.log('🧪 ================================================================\n');

// Mock agent for offline unit testing
const mockAgent = {
  target: 'local',
  workspaceDir: process.cwd(),
  options: {},
  callLlm: null, // Test deterministic fallback
};

const engine = new PlanEngine(mockAgent);

// 1. Test shouldPlan heuristics
console.log('1. Testing shouldPlan heuristics...');
assert.equal(engine.shouldPlan('what time is it'), false, 'Trivial query should not trigger planning');
assert.equal(engine.shouldPlan('pwd'), false, 'Short command should not trigger planning');
assert.equal(engine.shouldPlan('git status'), false, 'Single status check should not trigger planning');
assert.equal(engine.shouldPlan('Fix bug in src/lib/api.ts and run pytest on test_api.py'), true, 'Multi-step engineering task should trigger planning');
assert.equal(engine.shouldPlan('Create new payment validator module then verify with tests'), true, 'Multi-verb operational prompt should trigger planning');
assert.equal(engine.shouldPlan('simple prompt', { plan: true }), true, 'Explicit --plan flag must force planning');
assert.equal(engine.shouldPlan('Fix bug in src/lib/api.ts', { fast: true }), false, '--fast flag must bypass planning');
console.log('   ✔ shouldPlan heuristics verified.\n');

// 2. Test 4-Pillar Deliberation & Plan Generation
console.log('2. Testing 4-Pillar Deliberation & Plan Generation...');
const goal = 'Fix authentication token expiry in src/lib/auth.ts and verify with npm test';
const plan = await engine.generateDeliberationAndPlan(goal, { workspaceDir: '/tmp/test-workspace' });

assert.ok(plan instanceof ExecutionPlan, 'Generated plan must be an ExecutionPlan instance');
assert.equal(plan.goal, goal);
assert.ok(plan.steps.length >= 3, 'Plan should contain at least 3 phases/steps');
assert.ok(plan.deliberation, 'Plan must contain cognitive deliberation');
assert.ok(Array.isArray(plan.deliberation.decomposition), 'Deliberation must include decomposition');
assert.ok(Array.isArray(plan.deliberation.risks), 'Deliberation must include risks');
assert.ok(Array.isArray(plan.deliberation.verificationCriteria), 'Deliberation must include verification gates');
console.log(`   ✔ Deliberation generated with ${plan.steps.length} milestones and 4-pillar analysis.\n`);

// 3. Test Plan Lifecycle & Milestone Transitions
console.log('3. Testing Plan Lifecycle & Milestone Transitions...');
assert.equal(plan.steps[0].status, 'active', 'Step 1 should be active initially');
assert.equal(plan.steps[1].status, 'pending', 'Step 2 should be pending initially');
assert.equal(plan.isComplete(), false, 'Plan should not be complete initially');
assert.equal(plan.getCompletedCount(), 0, 'Completed count should be 0');

// Complete Step 1
plan.markStepComplete(0, 'Read src/lib/auth.ts successfully');
assert.equal(plan.steps[0].status, 'completed');
assert.equal(plan.steps[1].status, 'active', 'Step 2 should become active after Step 1 completes');
assert.equal(plan.getCompletedCount(), 1);

// Complete Step 2
plan.markStepComplete(1, 'Patched token expiry logic');
assert.equal(plan.steps[1].status, 'completed');
assert.equal(plan.steps[2].status, 'active');

// Complete Step 3
plan.markStepComplete(2, 'npm test passed with exit code 0');
assert.equal(plan.steps[2].status, 'completed');
assert.equal(plan.isComplete(), true, 'Plan must be complete when all steps are completed');
assert.equal(plan.getProgressRatio(), 1.0);
console.log('   ✔ Milestone transitions and lifecycle verified.\n');

// 4. Test evaluateProgress automated milestone advance
console.log('4. Testing evaluateProgress tool output mapping...');
const testPlan = new ExecutionPlan({
  goal: 'Inspect schema and implement patch',
  steps: [
    { phase: 'Reconnaissance', title: 'Inspect schema.json', tool: 'read_file', targetFiles: ['schema.json'] },
    { phase: 'Implementation', title: 'Update schema.json', tool: 'write_file', targetFiles: ['schema.json'] },
    { phase: 'Verification', title: 'Verify schema validator', tool: 'bash' },
  ],
});

// Simulate read_file tool execution
const reconUpdate = engine.evaluateProgress(testPlan, 'read_file', { path: 'schema.json' }, { ok: true, content: '{}' });
assert.ok(reconUpdate, 'read_file should satisfy Reconnaissance step');
assert.equal(testPlan.steps[0].status, 'completed');
assert.equal(testPlan.steps[1].status, 'active');

// Simulate write_file tool execution
const implUpdate = engine.evaluateProgress(testPlan, 'write_file', { path: 'schema.json' }, { ok: true, bytes: 42 });
assert.ok(implUpdate, 'write_file should satisfy Implementation step');
assert.equal(testPlan.steps[1].status, 'completed');
assert.equal(testPlan.steps[2].status, 'active');

// Simulate bash tool execution
const verifyUpdate = engine.evaluateProgress(testPlan, 'bash', { command: 'npm test' }, { ok: true, exitCode: 0 });
assert.ok(verifyUpdate, 'bash exit 0 should satisfy Verification step');
assert.equal(testPlan.isComplete(), true);
console.log('   ✔ Tool-driven milestone evaluation verified.\n');

// 5. Test Cognitive Register Formatting
console.log('5. Testing Cognitive Register injection format...');
const regPlan = new ExecutionPlan({
  goal: 'Refactor database queries',
  steps: [
    { phase: 'Reconnaissance', title: 'Audit query patterns', status: 'completed' },
    { phase: 'Implementation', title: 'Refactor to parameterized queries', status: 'active', targetFiles: ['db.ts'], verificationGate: 'Syntax valid' },
    { phase: 'Verification', title: 'Run database integration tests', status: 'pending', verificationGate: 'pytest exit 0' },
  ],
});

const regText = regPlan.formatForCognitiveRegister();
assert.ok(regText.includes('STRATEGIC EXECUTION PLAN'), 'Must include plan header');
assert.ok(regText.includes('[✔ DONE]'), 'Must include completed badge');
assert.ok(regText.includes('[▶ ACTIVE]'), 'Must include active badge');
assert.ok(regText.includes('[○ PENDING]'), 'Must include pending badge');
assert.ok(regText.includes('Current Active Objective: Step 2'), 'Must specify active step');
console.log('   ✔ Cognitive Register formatting verified.\n');

// 6. Test ANSI Component Rendering across all skins
console.log('6. Testing visual ANSI rendering across skins...');
const skins = ['cyberpunk', 'matrix', 'ember', 'nord', 'synthwave'];
for (const skinId of skins) {
  const skin = getSkin(skinId);
  const deliberationOutput = renderThinkingMatrix({
    deliberation: {
      intent: 'Verify plan visualizer components',
      decomposition: ['Pillar 1: Decomposition', 'Pillar 2: Architecture'],
      architecture: ['src/lib/planner.mjs', 'src/lib/agent.mjs'],
      risks: ['Buffer truncation on narrow terminals'],
      verificationCriteria: ['renderCard returns valid string'],
    },
    skin,
  });
  assert.ok(deliberationOutput.includes('COGNITIVE DELIBERATION MATRIX'), `Deliberation matrix rendered in ${skinId}`);

  const planOutput = renderPlanCard({ plan: regPlan, skin });
  assert.ok(planOutput.includes('STRATEGIC PLAN'), `Plan card rendered in ${skinId}`);
}
console.log('   ✔ Visual cards rendered cleanly in all 5 skins.\n');

// 7. Test checkPlanCompletion helper
console.log('7. Testing checkPlanCompletion validator...');
const completeCheck = checkPlanCompletion({ steps: [{ title: 'Step 1', status: 'completed' }] });
assert.equal(completeCheck.isComplete, true);

const incompleteCheck = checkPlanCompletion({
  steps: [
    { title: 'Step 1', status: 'completed' },
    { title: 'Step 2', status: 'active' },
  ],
});
assert.equal(incompleteCheck.isComplete, false);
assert.equal(incompleteCheck.remainingCount, 1);
assert.ok(incompleteCheck.directive?.includes('Step 2'));
console.log('   ✔ checkPlanCompletion validator verified.\n');

console.log('================================================================');
console.log('🎉 ALL THINKING & PLANNING TESTS PASSED WITH 100% INTEGRITY!');
console.log('================================================================');
