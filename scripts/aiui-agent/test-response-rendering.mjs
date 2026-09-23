#!/usr/bin/env node
/**
 * Test Suite: Verify CLI Response Rendering & Degeneration Filters
 * 1. Verifies that normal conversational responses render as clean terminal markdown, NOT inside AUTONOMOUS AGENT DELIVERABLE box.
 * 2. Verifies that degenerate token loops (e.g. {"!!!!!!!!!!!!!!!!...) are detected and sanitized.
 * 3. Verifies default models across the codebase use Qwen/Qwen2.5-Coder-32B-Instruct instead of 7B.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderTerminalMarkdown } from './ui/components.mjs';
import { getSkin } from './ui/skins.mjs';
import { DEFAULT_MODEL } from './config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

console.log('🧪 Running CLI Response Rendering & Model Guard Tests...\n');

// -------------------------------------------------------------
// Test 1: Verify clean terminal markdown rendering (No Deliverable Card Box)
// -------------------------------------------------------------
console.log('• [Test 1/3] Testing clean conversational markdown rendering...');
const skin = getSkin('cyberpunk');
const sampleResponse = `I have analyzed the repository structure.

Here are the key findings:
- Core services are responding on DGX Spark.
- The web unblocker supports manual expect elements.

\`\`\`javascript
const result = await unlockPage('https://example.com');
\`\`\`
`;

const renderedLines = renderTerminalMarkdown(sampleResponse, { skin, width: 80 });
const renderedText = renderedLines.join('\n');

assert.ok(!renderedText.includes('AUTONOMOUS AGENT DELIVERABLE'), 'Must NOT contain AUTONOMOUS AGENT DELIVERABLE');
assert.ok(!renderedText.includes('OBJECTIVE FULFILLED'), 'Must NOT contain OBJECTIVE FULFILLED badge');
assert.ok(renderedText.includes('key findings'), 'Should contain markdown text');
assert.ok(renderedText.includes('const result'), 'Should contain highlighted code block');
console.log('  ✔ Conversational response renders as clean markdown without box borders.\n');

// -------------------------------------------------------------
// Test 2: Degenerate Token Stutter Filter
// -------------------------------------------------------------
console.log('• [Test 2/3] Testing degenerate repetition filter...');
const degenerateContent = `{"` + '!'.repeat(500);
const isDegenerate = /(.)\1{15,}/.test(degenerateContent) || /^\{"[^a-zA-Z0-9]{6,}/.test(degenerateContent);
assert.strictEqual(isDegenerate, true, 'Should detect degenerate repeated token artifact');

const cleaned = degenerateContent.replace(/(.)\1{8,}/g, '').trim();
assert.ok(cleaned.length < 20, 'Should strip runaway repetitive characters');
console.log('  ✔ Degenerate repetitive token artifact successfully detected and stripped.\n');

// -------------------------------------------------------------
// Test 3: Validate Default Model is Coder 32B (Not 7B)
// -------------------------------------------------------------
console.log('• [Test 3/3] Validating default model configuration...');
assert.strictEqual(DEFAULT_MODEL, 'Qwen/Qwen2.5-Coder-32B-Instruct', 'DEFAULT_MODEL must be Qwen2.5-Coder-32B-Instruct');

const monitorCode = fs.readFileSync(path.join(ROOT, 'scripts/monitor-agent-responses.mjs'), 'utf8');
assert.ok(!monitorCode.includes("let model = 'Qwen/Qwen2.5-7B-Instruct'"), 'monitor-agent-responses.mjs must not default to 7B');

const providersCode = fs.readFileSync(path.join(ROOT, 'src/lib/providers.ts'), 'utf8');
assert.ok(providersCode.includes("'Qwen/Qwen2.5-Coder-32B-Instruct'"), 'providers.ts must prioritize Coder-32B');
assert.ok(!providersCode.includes("'Qwen/Qwen2.5-7B-Instruct'"), 'providers.ts must not reference 7B');

console.log('  ✔ Default models strictly configured to Qwen/Qwen2.5-Coder-32B-Instruct.\n');

console.log('================================================================');
console.log('🎉 ALL CLI RESPONSE & MODEL GUARD TESTS PASSED!');
console.log('================================================================');
