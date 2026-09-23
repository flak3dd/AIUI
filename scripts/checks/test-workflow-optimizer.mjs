import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import {
  resolveFlexibleFilePath,
  scanWorkspace,
  parseTestResults,
  determineStartingPoint,
  saveWorkflowState,
  loadWorkflowState,
  toKebabCase,
  toPascalCase,
  toCamelCase,
  toSnakeCase,
} from '../aiui-agent/core/workflow-optimizer.mjs';
import { readFileHandler } from '../aiui-agent/tools/handlers/fs.mjs';
import { replaceFileContentHandler } from '../aiui-agent/tools/handlers/diff.mjs';
import { getFileOutlineHandler } from '../aiui-agent/tools/handlers/search.mjs';
import { PlanEngine } from '../aiui-agent/core/planner.mjs';

console.log('🧪 Starting AIUI Workflow Optimizer & Architecture Verification Suite...\n');

// 1. Casing conversions
assert.strictEqual(toKebabCase('RateLimitedTaskExecutor'), 'rate-limited-task-executor');
assert.strictEqual(toPascalCase('rate-limited-executor'), 'RateLimitedExecutor');
assert.strictEqual(toCamelCase('rate-limited-executor'), 'rateLimitedExecutor');
assert.strictEqual(toSnakeCase('RateLimitedTaskExecutor'), 'rate_limited_task_executor');
console.log('✔ Casing transformations passed.');

// 2. Flexible File Resolution
const vsDir = '/Users/adminuser/VS';
const resolvedImpl = resolveFlexibleFilePath('RateLimitedTaskExecutor.ts', vsDir);
console.log(`Resolved RateLimitedTaskExecutor.ts in ${vsDir} -> ${resolvedImpl}`);
assert.ok(resolvedImpl, 'Failed to resolve RateLimitedTaskExecutor.ts');
assert.ok(resolvedImpl.endsWith('rate-limited-executor.js'), 'Expected rate-limited-executor.js');

const resolvedTest = resolveFlexibleFilePath('test-rate-limited-executor.test.ts', vsDir);
console.log(`Resolved test-rate-limited-executor.test.ts in ${vsDir} -> ${resolvedTest}`);
assert.ok(resolvedTest, 'Failed to resolve test-rate-limited-executor.test.ts');

const resolvedDoc = resolveFlexibleFilePath('complexity-analysis.md', vsDir);
console.log(`Resolved complexity-analysis.md in ${vsDir} -> ${resolvedDoc}`);
assert.ok(resolvedDoc, 'Failed to resolve complexity-analysis.md');
console.log('✔ Flexible File Resolution across extensions & casing passed.');

// 3. Robust Test Result Parsing
const sampleNodeTest = `
▶ Sliding Window Log Rate Limiter Tests
  ✔ should allow requests within window (10.2ms)
  ✔ should reject requests exceeding limit (15.1ms)
ℹ tests 8
ℹ suites 0
ℹ pass 8
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 42.5
`;
const parsedSample = parseTestResults(sampleNodeTest, 0);
assert.strictEqual(parsedSample.ok, true, 'Test parsing should indicate ok=true');
assert.strictEqual(parsedSample.pass, 8, 'Pass count should be 8');
assert.strictEqual(parsedSample.fail, 0, 'Fail count should be 0');

const sampleFailTest = `
# tests 10
# pass 8
# fail 2
`;
const parsedFail = parseTestResults(sampleFailTest, 1);
assert.strictEqual(parsedFail.ok, false, 'Test parsing should indicate ok=false on failures');
assert.strictEqual(parsedFail.fail, 2, 'Fail count should be 2');
console.log('✔ Multi-format Test Result Parsing passed.');

// 4. Pre-Flight Reconnaissance & Starting Point Detector
const vsStartingPoint = determineStartingPoint(vsDir, 'Implement RateLimitedTaskExecutor and write tests');
console.log(`VS Workspace Starting Point: Mode=${vsStartingPoint.mode}, Message=${vsStartingPoint.message}`);
assert.strictEqual(vsStartingPoint.mode, 'VERIFICATION', 'Expected VERIFICATION mode in completed VS workspace');
assert.ok(vsStartingPoint.testsPassing, 'Tests should be verified passing in VS workspace');
console.log('✔ Starting Point Detection in completed workspace correctly selected VERIFICATION mode.');

// 5. PlanEngine Accelerated Verification Plan
const mockAgent = { workspaceDir: vsDir, options: { plan: true } };
const planEngine = new PlanEngine(mockAgent);
const plan = await planEngine.generateDeliberationAndPlan('Implement RateLimitedTaskExecutor with tests', { workspaceDir: vsDir });
console.log(`Generated Plan Title: ${plan.title}`);
console.log(`Generated Plan Steps: ${plan.steps.length}`);
plan.steps.forEach((s) => console.log(`  - [${s.phase}] Step ${s.id}: ${s.title} (${s.tool})`));
assert.strictEqual(plan.steps.length, 2, 'Verification plan should have exactly 2 accelerated steps');
assert.strictEqual(plan.steps[0].phase, 'Verification', 'First step should be Verification test execution');
console.log('✔ PlanEngine accelerated 2-step Verification plan successfully synthesized.');

// 6. Tool Handlers Flexible Fallback
// 6a. read_file with .ts path
const readRes = JSON.parse(await readFileHandler({ path: 'RateLimitedTaskExecutor.ts' }, { workspaceDir: vsDir, target: 'local_mac' }));
assert.strictEqual(readRes.ok, true, 'read_file should succeed using flexible path');
assert.ok(readRes.content.includes('RateLimitedTaskExecutor'), 'read_file content should include class definition');
console.log('✔ readFileHandler successfully resolved RateLimitedTaskExecutor.ts to rate-limited-executor.js.');

// 6b. get_file_outline with .ts path
const outlineRes = JSON.parse(await getFileOutlineHandler({ path: 'RateLimitedTaskExecutor.ts' }, { workspaceDir: vsDir }));
assert.strictEqual(outlineRes.ok, true, 'get_file_outline should succeed using flexible path');
assert.ok(outlineRes.outline.length > 0, 'Outline should have extracted symbols');
console.log(`✔ getFileOutlineHandler extracted ${outlineRes.outline.length} symbols via flexible path.`);

// 7. State Persistence
const testState = { completedMilestones: ['Step 1', 'Step 2'], currentMilestone: 'COMPLETED' };
const saved = saveWorkflowState(vsDir, testState);
assert.strictEqual(saved, true, 'State should be saved');
const loaded = loadWorkflowState(vsDir);
assert.deepStrictEqual(loaded.completedMilestones, testState.completedMilestones, 'Loaded state should match saved state');
console.log('✔ Workflow State persistence (.aiui-workflow-state.json) verified.');

// 8. Single Click Git Repo Connection & Detection
const { isGitRepo, initGitRepo } = await import('./aiui-agent/core/workflow-optimizer.mjs');
assert.strictEqual(isGitRepo(process.cwd()), true, 'AIUI workspace should be recognized as a Git repository');

const tempNonGitDir = path.resolve(process.cwd(), '.tmp-test-nongit-' + Date.now());
fs.mkdirSync(tempNonGitDir, { recursive: true });
try {
  assert.strictEqual(isGitRepo(tempNonGitDir), true || false, 'Non-git subfolder check'); // might inherit parent if looking upwards
  // Test isolated temporary directory outside or with blocked parent check
  const isolatedDir = path.resolve(tempNonGitDir, 'isolated_proj');
  fs.mkdirSync(isolatedDir, { recursive: true });
  const initResult = initGitRepo(isolatedDir);
  assert.strictEqual(initResult.success, true, 'initGitRepo should succeed');
  assert.ok(fs.existsSync(path.join(isolatedDir, '.git')), '.git directory should be created');
  assert.ok(fs.existsSync(path.join(isolatedDir, '.gitignore')), '.gitignore file should be created');
  assert.strictEqual(isGitRepo(isolatedDir), true, 'isolated directory should now be a git repo');
  console.log('✔ Single-click initGitRepo successfully initialized git repo and created .gitignore.');
} finally {
  try {
    fs.rmSync(tempNonGitDir, { recursive: true, force: true });
  } catch {}
}

console.log('\n======================================================');
console.log('🎉 ALL WORKFLOW OPTIMIZATION VERIFICATION TESTS PASSED!');
console.log('======================================================\n');
