#!/usr/bin/env node
/**
 * ⚡ Test Suite: AIUI Multi-Stage Response Format & Terminal Engine
 * Validates cognitive progression protocol parsing, categorized tool cards,
 * closed-loop verification proof gates, and terminal markdown rendering across skins.
 */

import assert from 'node:assert/strict';
import { getSkin, CLI_SKINS, stripAnsi } from '../aiui-agent/ui/skins.mjs';
import {
  wrapAnsi,
  renderTerminalMarkdown,
  formatInlineMarkdown,
} from '../aiui-agent/ui/markdown.mjs';
import {
  getResponsiveWidth,
  renderCognitiveProgressionCard,
  renderToolExecutionStage,
  renderVerificationProofGate,
  renderAgentResponseStage,
  badge,
  renderCard,
} from '../aiui-agent/ui/components.mjs';

console.log('🧪 ================================================================');
console.log('🧪 TESTING AIUI MULTI-STAGE RESPONSE FORMAT ENGINE');
console.log('🧪 ================================================================\n');

// 1. Test ANSI-Aware Word Wrapping
console.log('1. Testing ANSI-aware word wrapping (wrapAnsi)...');
const sampleText = 'This is a long line of text that needs to wrap properly across multiple terminal lines without clipping.';
const wrapped = wrapAnsi(sampleText, 30);
assert.ok(wrapped.length >= 3, 'Text should wrap into at least 3 lines');
wrapped.forEach((line) => {
  assert.ok(stripAnsi(line).length <= 30, `Line "${line}" exceeds max width 30`);
});

const coloredText = '\x1b[38;2;0;240;255m\x1b[1mCyan bold text\x1b[0m followed by \x1b[38;2;168;85;247mviolet text that extends across the boundary\x1b[0m';
const coloredWrapped = wrapAnsi(coloredText, 25);
assert.ok(coloredWrapped.length >= 2, 'Colored text should wrap cleanly');
coloredWrapped.forEach((line) => {
  assert.ok(stripAnsi(line).length <= 25, `Colored line exceeds width 25: "${stripAnsi(line)}"`);
});
console.log('   ✔ wrapAnsi wraps cleanly without exceeding bounds.\n');

// 2. Test Terminal Markdown Engine
console.log('2. Testing Terminal Markdown Engine...');
const skin = getSkin('cyberpunk');
const markdownSample = `
# Executive Summary

Here is the diagnosis of the issue:
- [x] Identify syntax error in system-prompt.mjs
- [ ] Run regression test suite

\`\`\`javascript
function testFix() {
  const diff = "git diff --stat";
  return true;
}
\`\`\`

> [!NOTE]
> All changes are verified within isolated DGX Spark sandbox.

### Next Actions:
1. Execute reproduction test with exit code 0
2. Confirm regression suite passes
`;

const renderedMd = renderTerminalMarkdown(markdownSample, { skin, width: 80 });
assert.ok(Array.isArray(renderedMd), 'Markdown output must be array of strings');
assert.ok(renderedMd.length > 10, 'Markdown should produce styled output lines');

const fullMdText = renderedMd.join('\n');
assert.ok(fullMdText.includes('EXECUTIVE SUMMARY'), 'Header 1 should be rendered');
assert.ok(fullMdText.includes('[DONE]'), 'Completed checklist item should render [DONE]');
assert.ok(fullMdText.includes('[PENDING]'), 'Pending checklist item should render [PENDING]');
assert.ok(fullMdText.includes('javascript'), 'Fenced code block should include language box');
assert.ok(fullMdText.includes('NOTE'), 'Callout alert should render NOTE badge');
console.log('   ✔ Terminal Markdown engine correctly parsed headers, code fences, checklists, and alerts.\n');

// 3. Test 5-Stage Cognitive Progression Protocol Parsing
console.log('3. Testing 5-Stage Cognitive Progression Protocol Parsing...');
const fiveStageThoughts = `
STAGE 1: [OBSERVE & RECALL CONTEXT]
- Defect identified at line 78 of scripts/aiui-agent/core/system-prompt.mjs.
- SyntaxError: Unexpected identifier 'git' due to unescaped backticks in template literal.

STAGE 2: [ORIENT: CONTEXT AUDIT & ANTI-STAGNATION CHECK]
- Invariant 1: File is already inspected. Re-reading is strictly forbidden.
- Transition immediately to write_file patch.

STAGE 3: [DECIDE: SURGICAL DIFF SYNTHESIS]
- Replace raw \`git diff --stat\` with single-quoted string 'git diff --stat'.
- Ensure proof-of-work invariant is preserved.

STAGE 4: [ACT: PROGRESSIVE MUTATION EMISSION]
- Emitting write_file with corrected rule 13.

STAGE 5: [VERIFY: DIRECT PROOF]
- Next tool call: bash "node --check scripts/aiui-agent/core/system-prompt.mjs" to verify exit code 0.
`;

const progCard = renderCognitiveProgressionCard({
  thoughts: fiveStageThoughts,
  round: 1,
  maxRounds: 50,
  skin,
  width: 84,
});

assert.ok(typeof progCard === 'string', 'Progression card must be a string');
assert.ok(progCard.includes('COGNITIVE PROGRESSION PROTOCOL'), 'Card must have title');
assert.ok(progCard.includes('STAGE 1: OBSERVE'), 'Stage 1 must be parsed and rendered');
assert.ok(progCard.includes('STAGE 2: ORIENT'), 'Stage 2 must be parsed and rendered');
assert.ok(progCard.includes('STAGE 3: DECIDE'), 'Stage 3 must be parsed and rendered');
assert.ok(progCard.includes('STAGE 4: ACT'), 'Stage 4 must be parsed and rendered');
assert.ok(progCard.includes('STAGE 5: VERIFY'), 'Stage 5 must be parsed and rendered');
assert.ok(progCard.includes('5/5 cognitive progression stages evaluated'), 'Footer must report 5/5 stages');
console.log('   ✔ 5-Stage cognitive progression protocol successfully parsed and rendered.\n');

// 4. Test Categorized Tool Execution Stages
console.log('4. Testing Categorized Tool Execution Stages...');

// 4a. Reconnaissance Tool (read_file)
const reconCard = renderToolExecutionStage({
  toolName: 'read_file',
  parsedArgs: { path: 'scripts/aiui-agent/core/system-prompt.mjs', start_line: 1, line_count: 50 },
  rawResult: JSON.stringify({ ok: true, path: 'scripts/aiui-agent/core/system-prompt.mjs', totalLines: 300 }),
  parsed: { ok: true, path: 'scripts/aiui-agent/core/system-prompt.mjs', totalLines: 300 },
  skin,
  width: 84,
});
assert.ok(reconCard.includes('RECONNAISSANCE & DISCOVERY'), 'read_file must be categorized as RECON');
assert.ok(reconCard.includes('Retained in working context memory'), 'read_file must display cache retention invariant');

// 4b. Mutation Tool (write_file)
const mutationCard = renderToolExecutionStage({
  toolName: 'write_file',
  parsedArgs: { path: 'scripts/aiui-agent/core/system-prompt.mjs', content: 'const x = 1;\nconst y = 2;' },
  rawResult: JSON.stringify({ ok: true, bytes: 450 }),
  parsed: { ok: true, bytes: 450 },
  skin,
  width: 84,
});
assert.ok(mutationCard.includes('MUTATION & CODE SYNTHESIS'), 'write_file must be categorized as MUTATION');
assert.ok(stripAnsi(mutationCard).includes('450 bytes written'), 'write_file must display payload size');

// 4c. Shell Execution Tool (bash test command)
const verifyBashCard = renderToolExecutionStage({
  toolName: 'bash',
  parsedArgs: { command: 'node --check scripts/aiui-agent/core/system-prompt.mjs' },
  rawResult: JSON.stringify({ exitCode: 0, stdout: 'Syntax OK', durationMs: 42 }),
  parsed: { exitCode: 0, stdout: 'Syntax OK', durationMs: 42 },
  skin,
  width: 84,
});
assert.ok(verifyBashCard.includes('VERIFICATION PASS'), 'bash test command must be categorized as VERIFICATION');
assert.ok(verifyBashCard.includes('EXIT 0 · 42ms'), 'bash exit 0 and latency must be in status badge');

// 4d. Anti-Loop Circuit Breaker Intercept
const breakerCard = renderToolExecutionStage({
  toolName: 'read_file',
  parsedArgs: { path: 'same_file.txt' },
  rawResult: JSON.stringify({ ok: false, error: 'Repetitive action blocked by circuit breaker' }),
  parsed: { ok: false, error: 'Repetitive action blocked by circuit breaker' },
  isCircuitBreaker: true,
  skin,
  width: 84,
});
assert.ok(breakerCard.includes('ANTI-LOOP INTERCEPT'), 'Circuit breaker must be categorized as ANTI-LOOP INTERCEPT');
assert.ok(breakerCard.includes('BREAKER TRIPPED'), 'Circuit breaker must have BREAKER TRIPPED badge');
console.log('   ✔ Tool execution cards correctly categorized across all functional stages.\n');

// 5. Test Closed-Loop Verification Proof Gate (Rule 13)
console.log('5. Testing Closed-Loop Verification Proof Gate...');
const proofGateCard = renderVerificationProofGate({
  gate: 'Reproduction test exit code 0',
  status: 'passed',
  command: 'node --check scripts/aiui-agent/core/system-prompt.mjs',
  evidence: 'Syntax check passed without errors (exit code 0)',
  exitCode: 0,
  skin,
  width: 84,
});
assert.ok(proofGateCard.includes('PROOF-OF-WORK INVARIANT'), 'Card must have Proof-of-Work Invariant title');
assert.ok(proofGateCard.includes('GATE PASSED (EXIT 0)'), 'Badge must confirm GATE PASSED');
assert.ok(proofGateCard.includes('node --check'), 'Verification command must be visible');
console.log('   ✔ Closed-loop verification proof gate successfully rendered.\n');

// 6. Test Final Agent Response Deliverable
console.log('6. Testing Final Agent Response Deliverable...');
const deliverableCard = renderAgentResponseStage({
  content: '## Solution Summary\n- Fixed unescaped backtick syntax error.\n- Verified clean exit code 0.',
  skin,
  width: 84,
  stats: { rounds: 2 },
  commandsRun: ['git diff', 'node --check scripts/aiui-agent/core/system-prompt.mjs'],
  filesModified: ['scripts/aiui-agent/core/system-prompt.mjs'],
});
assert.ok(deliverableCard.includes('AUTONOMOUS AGENT DELIVERABLE'), 'Card must have deliverable title');
assert.ok(deliverableCard.includes('OBJECTIVE FULFILLED'), 'Badge must have OBJECTIVE FULFILLED');
assert.ok(deliverableCard.includes('Solution Summary'), 'Body markdown must be parsed');
console.log('   ✔ Final agent response deliverable successfully assembled.\n');

// 7. Test Cross-Skin Compatibility
console.log('7. Testing Cross-Skin Compatibility across all 5 themes...');
for (const skinKey of Object.keys(CLI_SKINS)) {
  const currentSkin = getSkin(skinKey);
  const card = renderCognitiveProgressionCard({
    thoughts: fiveStageThoughts,
    round: 1,
    maxRounds: 50,
    skin: currentSkin,
    width: 80,
  });
  assert.ok(card.length > 100, `Skin ${skinKey} failed to render progression card`);
}
console.log('   ✔ Cross-skin rendering passed for cyberpunk, matrix, ember, nord, and synthwave.\n');

console.log('🎉 ALL CLI RESPONSE STAGE FORMAT TESTS PASSED SUCCESSFULLY!');
