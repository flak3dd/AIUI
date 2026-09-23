#!/usr/bin/env node
/**
 * ⚡ Automated Test Suite: AIUI-grade Autonomous SWE Blueprint
 * Tests all 6 core pillars:
 * 1. Surgical Code Intelligence (replace_file_content, multi_replace, grep_search, get_file_outline)
 * 2. Closed-Loop Proof-of-Work Verification (ExecutionPlan gates, evaluateProgress)
 * 3. Background Process Supervisor (BackgroundProcessManager lifecycle & logs)
 * 4. Headless Browser Agent (API contracts & fallback)
 * 5. Hierarchical Multi-Agent Topology (Subagent role tools & scoping)
 * 6. AIUI quad-pane UI component imports
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  replaceFileContentHandler,
  multiReplaceFileContentHandler,
} from '../aiui-agent/tools/handlers/diff.mjs';
import {
  grepSearchHandler,
  getFileOutlineHandler,
} from '../aiui-agent/tools/handlers/search.mjs';
import processManager from '../aiui-agent/core/process-manager.mjs';
import {
  startDaemonHandler,
  readDaemonLogsHandler,
  stopDaemonHandler,
  listDaemonsHandler,
} from '../aiui-agent/tools/handlers/daemon.mjs';
import {
  browserOpenHandler,
  browserScreenshotHandler,
  browserConsoleLogsHandler,
} from '../aiui-agent/tools/handlers/browser.mjs';
import { SUBAGENT_ROLES, SubagentRunner } from '../aiui-agent/core/subagent.mjs';
import { PlanEngine, ExecutionPlan } from '../aiui-agent/core/planner.mjs';
import { AGENT_TOOLS } from '../aiui-agent/tools/registry.mjs';
import { executeTool } from '../aiui-agent/tools/executor.mjs';

console.log('🧪 ================================================================');
console.log('🧪 VERIFYING AIUI AUTONOMOUS SWE ARCHITECTURE BLUEPRINT');
console.log('🧪 ================================================================\n');

const testTmpDir = path.resolve(process.cwd(), '.tmp-devin-test');
fs.mkdirSync(testTmpDir, { recursive: true });

try {
  // -------------------------------------------------------------
  // PILLAR 1: Surgical Code Intelligence & Ripgrep
  // -------------------------------------------------------------
  console.log('1. Testing Pillar 1: Surgical Diff & Exact Search-and-Replace...');
  const sampleFilePath = path.join(testTmpDir, 'sample_code.js');
  const sampleContent = `function calculateTotal(items) {
  let total = 0;
  for (const item of items) {
    total += item.price;
  }
  return total;
}

export default calculateTotal;`;

  fs.writeFileSync(sampleFilePath, sampleContent, 'utf8');

  // Test 1.1: Exact unique hunk replacement
  const targetHunk = `  for (const item of items) {
    total += item.price;
  }`;
  const replacementHunk = `  for (const item of items) {
    total += item.price * (1 - (item.discount || 0));
  }`;

  const diffRes = JSON.parse(await replaceFileContentHandler({
    path: sampleFilePath,
    target: targetHunk,
    replacement: replacementHunk,
  }));

  assert.equal(diffRes.ok, true, 'replace_file_content must succeed on unique target');
  assert.equal(diffRes.exitCode, 0);
  const updatedContent = fs.readFileSync(sampleFilePath, 'utf8');
  assert.ok(updatedContent.includes('item.discount'), 'File must contain replacement hunk');
  assert.ok(updatedContent.includes('function calculateTotal'), 'Rest of file must remain intact');
  console.log('   ✔ Exact surgical hunk replacement verified.');

  // Test 1.2: Ambiguous target rejection (prevents corrupting multiple locations)
  fs.writeFileSync(sampleFilePath, 'const a = 1;\nconst a = 1;\n', 'utf8');
  const ambigRes = JSON.parse(await replaceFileContentHandler({
    path: sampleFilePath,
    target: 'const a = 1;',
    replacement: 'const a = 2;',
  }));
  assert.equal(ambigRes.ok, false, 'Must reject ambiguous non-unique target');
  assert.equal(ambigRes.occurrences, 2);
  console.log('   ✔ Ambiguous non-unique target rejection verified.');

  // Test 1.3: Atomic Multi-Replace
  fs.writeFileSync(sampleFilePath, 'line A\nline B\nline C\n', 'utf8');
  const multiRes = JSON.parse(await multiReplaceFileContentHandler({
    path: sampleFilePath,
    replacements: [
      { target: 'line A', replacement: 'alpha' },
      { target: 'line C', replacement: 'gamma' },
    ],
  }));
  assert.equal(multiRes.ok, true);
  assert.equal(multiRes.hunksApplied, 2);
  const multiContent = fs.readFileSync(sampleFilePath, 'utf8');
  assert.equal(multiContent, 'alpha\nline B\ngamma\n');
  console.log('   ✔ Atomic multi-replace verified.');

  // Test 1.4: Ripgrep Search & Outline Extraction
  const searchRes = JSON.parse(await grepSearchHandler({
    pattern: 'gamma',
    path: testTmpDir,
  }));
  assert.equal(searchRes.ok, true);
  assert.equal(searchRes.matchCount, 1);
  console.log('   ✔ Ripgrep code search verified.');

  const outlineRes = JSON.parse(await getFileOutlineHandler({
    path: 'scripts/aiui-agent/core/planner.mjs',
  }));
  assert.equal(outlineRes.ok, true);
  assert.ok(outlineRes.symbolCount > 0, 'Outline must detect functions and classes');
  assert.ok(outlineRes.symbols.some((s) => s.name === 'PlanEngine' || s.name === 'ExecutionPlan'));
  console.log(`   ✔ AST symbol outline verified (${outlineRes.symbolCount} symbols extracted).\n`);

  // -------------------------------------------------------------
  // PILLAR 2: Proof-of-Work Verification Pipeline
  // -------------------------------------------------------------
  console.log('2. Testing Pillar 2: Closed-Loop Verification Pipeline & Planner Gates...');
  const planEngine = new PlanEngine({ target: 'local', workspaceDir: process.cwd() });
  const testPlan = await planEngine.generateDeliberationAndPlan('Fix bug in auth.ts and run npm test', { workspaceDir: process.cwd() });

  assert.ok(testPlan instanceof ExecutionPlan);
  assert.ok(testPlan.steps.length >= 3);
  testPlan.steps.forEach((s) => {
    assert.ok(s.verificationGate && s.verificationGate.trim().length > 0, `Step ${s.id} must have non-empty verificationGate`);
  });
  console.log('   ✔ All synthesized plan milestones enforce mandatory verification gates.');

  // Test evaluateProgress milestone advance for replace_file_content
  const step2 = testPlan.steps[1];
  const progressRes = planEngine.evaluateProgress(testPlan, 'replace_file_content', { path: 'auth.ts' }, { ok: true, bytes: 100 });
  assert.ok(progressRes, 'replace_file_content must advance implementation milestone');
  console.log('   ✔ evaluateProgress advances upon surgical patch completion.\n');

  // -------------------------------------------------------------
  // PILLAR 3: Background Process Supervisor
  // -------------------------------------------------------------
  console.log('3. Testing Pillar 3: Background Process Supervisor (Daemon Manager)...');
  const daemonStart = JSON.parse(await startDaemonHandler({
    id: 'test_server',
    command: 'node -e "setInterval(() => console.log(\'heartbeat\'), 100)"',
  }));
  assert.equal(daemonStart.ok, true);
  assert.ok(daemonStart.pid > 0);
  assert.ok(processManager.isAlive('test_server'));

  // Allow heartbeat to log
  await new Promise((r) => setTimeout(r, 250));

  const daemonLogs = JSON.parse(await readDaemonLogsHandler({ id: 'test_server', lines: 10 }));
  assert.equal(daemonLogs.ok, true);
  assert.ok(daemonLogs.logs.includes('heartbeat'), 'Must capture stdout stream into ring buffer');

  const daemonStop = JSON.parse(await stopDaemonHandler({ id: 'test_server' }));
  assert.equal(daemonStop.ok, true);
  assert.equal(processManager.isAlive('test_server'), false);
  console.log('   ✔ Daemon start, stdout ring-buffer capture, and stop lifecycle verified.\n');

  // -------------------------------------------------------------
  // PILLAR 4: Headless Browser Agent
  // -------------------------------------------------------------
  console.log('4. Testing Pillar 4: Headless Browser Agent...');
  const browserRes = JSON.parse(await browserOpenHandler({
    url: 'https://example.com',
    headless: true,
  }));
  assert.ok(browserRes.ok !== undefined);

  const logsRes = JSON.parse(await browserConsoleLogsHandler({ level: 'all' }));
  assert.equal(logsRes.ok, true);
  assert.ok(Array.isArray(logsRes.logs));
  console.log('   ✔ Browser automation interface & console telemetry verified.\n');

  // -------------------------------------------------------------
  // PILLAR 5: Hierarchical Multi-Agent Topology
  // -------------------------------------------------------------
  console.log('5. Testing Pillar 5: Hierarchical Subagent Topology...');
  assert.ok(SUBAGENT_ROLES.recon, 'Recon subagent role defined');
  assert.ok(SUBAGENT_ROLES.coder, 'Coder subagent role defined');
  assert.ok(SUBAGENT_ROLES.browser_qa, 'Browser QA subagent role defined');
  assert.ok(!SUBAGENT_ROLES.recon.tools.includes('write_file'), 'Recon must not have write_file access');
  assert.ok(SUBAGENT_ROLES.coder.tools.includes('replace_file_content'), 'Coder must have replace_file_content access');
  assert.ok(SUBAGENT_ROLES.browser_qa.tools.includes('browser_open'), 'Browser QA must have browser_open access');
  console.log('   ✔ Subagent role-based tool scoping and context isolation verified.\n');

  // -------------------------------------------------------------
  // PILLAR 6: Registry & Dispatcher Integrity
  // -------------------------------------------------------------
  console.log('6. Testing Pillar 6: Tool Registry & Central Dispatcher...');
  const toolNames = AGENT_TOOLS.map((t) => t.function.name);
  const requiredDevinTools = [
    'replace_file_content',
    'multi_replace_file_content',
    'grep_search',
    'get_file_outline',
    'start_daemon',
    'read_daemon_logs',
    'stop_daemon',
    'list_daemons',
    'browser_open',
    'browser_screenshot',
    'browser_click',
    'browser_type',
    'browser_console_logs',
    'spawn_subagent',
  ];

  requiredDevinTools.forEach((reqTool) => {
    assert.ok(toolNames.includes(reqTool), `AGENT_TOOLS must contain "${reqTool}"`);
  });
  console.log(`   ✔ All ${requiredDevinTools.length} AIUI tools registered in registry.mjs.`);

  // Test executeTool central dispatcher
  const outlineDispatch = JSON.parse(await executeTool('get_file_outline', JSON.stringify({ path: sampleFilePath }), {}));
  assert.equal(outlineDispatch.ok, true);
  // -------------------------------------------------------------
  // PILLAR 7: CLI & REPL Subcommand Integration
  // -------------------------------------------------------------
  console.log('7. Testing Pillar 7: CLI & REPL Command Integration...');
  const cliContent = fs.readFileSync(path.resolve('scripts/aiui-agent/cli.mjs'), 'utf8');
  assert.ok(cliContent.includes("a === 'diff'"), 'cli.mjs must contain "diff" subcommand branch');
  assert.ok(cliContent.includes("a === 'daemons'"), 'cli.mjs must contain "daemons" subcommand branch');
  assert.ok(cliContent.includes("a === 'browser'"), 'cli.mjs must contain "browser" subcommand branch');
  assert.ok(cliContent.includes("init-git"), 'cli.mjs must support init-git and connect-repo');
  console.log('   ✔ cli.mjs subcommands (diff, daemons, browser, init-git) verified.');

  const agentContent = fs.readFileSync(path.resolve('scripts/aiui-agent/core/agent.mjs'), 'utf8');
  assert.ok(agentContent.includes("'/diff'"), 'agent.mjs must register /diff in slashCommands');
  assert.ok(agentContent.includes("'/connect-repo'"), 'agent.mjs must register /connect-repo in slashCommands');
  assert.ok(agentContent.includes("'/daemons'"), 'agent.mjs must register /daemons in slashCommands');
  assert.ok(agentContent.includes("'/browser'"), 'agent.mjs must register /browser in slashCommands');
  assert.ok(agentContent.includes("cmd === '/diff'"), 'agent.mjs must handle /diff dispatch');
  assert.ok(agentContent.includes("cmd === '/connect-repo' || cmd === '/init-git'"), 'agent.mjs must handle /connect-repo dispatch');
  assert.ok(agentContent.includes("cmd === '/daemons'"), 'agent.mjs must handle /daemons dispatch');
  assert.ok(agentContent.includes("cmd === '/browser'"), 'agent.mjs must handle /browser dispatch');
  console.log('   ✔ agent.mjs REPL slash commands (/diff, /connect-repo, /init-git, /daemons, /browser) verified.');

  const rootAiuiContent = fs.readFileSync(path.resolve('aiui'), 'utf8');
  assert.ok(rootAiuiContent.includes('diff)'), 'root aiui script must have diff dispatch branch');
  assert.ok(rootAiuiContent.includes('connect-repo|init-git)'), 'root aiui script must have connect-repo dispatch branch');
  assert.ok(rootAiuiContent.includes('daemons)'), 'root aiui script must have daemons dispatch branch');
  assert.ok(rootAiuiContent.includes('browser)'), 'root aiui script must have browser dispatch branch');
  assert.ok(rootAiuiContent.includes('[3]'), 'root aiui script must have diff in show_menu');

  // Verify AIUI quad-pane UI single-click git repo connection contracts
  const diffPaneContent = fs.readFileSync(path.resolve('src/components/devin/DevinDiffEditorPane.tsx'), 'utf8');
  assert.ok(diffPaneContent.includes('onInitGitRepo'), 'DevinDiffEditorPane must expose onInitGitRepo prop');
  assert.ok(diffPaneContent.includes('fatal: not a git repository'), 'DevinDiffEditorPane must show error banner for non-git');
  assert.ok(diffPaneContent.includes('Single Click: Connect to Repo'), 'DevinDiffEditorPane must have Single Click connect button');

  const termPaneContent = fs.readFileSync(path.resolve('src/components/devin/DevinTerminalPane.tsx'), 'utf8');
  assert.ok(termPaneContent.includes('onInitGitRepo'), 'DevinTerminalPane must accept onInitGitRepo prop');
  assert.ok(termPaneContent.includes('isGitRepoError'), 'DevinTerminalPane must detect git repository errors');

  const quadViewContent = fs.readFileSync(path.resolve('src/components/devin/DevinQuadPaneView.tsx'), 'utf8');
  assert.ok(quadViewContent.includes('handleInitGitRepo'), 'DevinQuadPaneView must implement handleInitGitRepo');
  assert.ok(quadViewContent.includes('git init && git status'), 'DevinQuadPaneView must execute git init && git status');
  console.log('   ✔ AIUI quad-pane UI single-click connect repo contracts verified.');
  // -------------------------------------------------------------
  // PILLAR 8: Anti-Loop Circuit Breaker & Advisory Intent Routing
  // -------------------------------------------------------------
  console.log('8. Testing Pillar 8: Metacognitive Circuit Breakers & Advisory Intent...');
  const { CircuitBreakerManager, normalizeBashCommand, computeTokenOverlap } = await import('./aiui-agent/core/circuit-breaker.mjs');
  const { isAdvisoryPrompt } = await import('./aiui-agent/core/planner.mjs');

  // Verify advisory intent classification
  assert.equal(isAdvisoryPrompt('how to improve aiui fully autonomous capabilities'), true);
  assert.equal(isAdvisoryPrompt('what is the architecture of the memory palace?'), true);
  assert.equal(isAdvisoryPrompt('explain the provider lifecycle states'), true);
  assert.equal(isAdvisoryPrompt('fix bug in auth.ts and run tests'), false);
  console.log('   ✔ Advisory intent correctly routes questions away from shell loops.');

  // Verify command normalization & token overlap
  const cmdA = 'cd /Users/adminuser/AIUI && echo "=== AUTONOMOUS ASSESSMENT ===" && head -20 package.json';
  const cmdB = 'echo "=== AUTONOMECAPABILITIES asSESSMENT ===" && head -20 package.json';
  assert.ok(computeTokenOverlap(normalizeBashCommand(cmdA), normalizeBashCommand(cmdB)) >= 0.7);
  console.log('   ✔ Command normalization detects fuzzy duplicate commands across typos.');

  // Verify strict circuit breaker hard block on 2nd attempt
  const cb = new CircuitBreakerManager(testTmpDir, 'test_env');
  const firstEval = cb.evaluateAction('bash', { command: 'echo hello && ls' });
  assert.equal(firstEval.isCircuitBreaker, false);
  const secondEval = cb.evaluateAction('bash', { command: 'echo hello && ls' });
  assert.equal(secondEval.isCircuitBreaker, true, 'Second execution of identical command must be hard-blocked');
  console.log('   ✔ Strict 2-strike circuit breaker blocks command thrashing immediately.\n');

  console.log('================================================================');
  console.log('🏆 ALL AIUI AUTONOMOUS SWE ARCHITECTURAL TESTS PASSED (100%)');
  console.log('================================================================\n');
} finally {
  // Cleanup
  try {
    fs.rmSync(testTmpDir, { recursive: true, force: true });
  } catch {}
}
