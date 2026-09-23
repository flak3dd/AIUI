#!/usr/bin/env node
import assert from 'node:assert';
import { AiuiAgent } from './core/agent.mjs';

console.log('🧪 Testing /mode Command & Operational Mode Switcher...');

const agent = new AiuiAgent({ deepBuild: false, optimize: false });

// Test 1: Initial state
assert.strictEqual(agent.deepBuild, false);

// Test 2: Mode switching to deep
agent.setMode('deep');
assert.strictEqual(agent.deepBuild, true);
assert.strictEqual(agent.mode, 'deep');

// Test 3: Mode switching to chat
agent.setMode('chat');
assert.strictEqual(agent.deepBuild, false);
assert.strictEqual(agent.mode, 'chat');

// Test 4: Mode switching to agent
agent.setMode('agent');
assert.strictEqual(agent.deepBuild, false);
assert.strictEqual(agent.mode, 'agent');

// Test 5: Mode switching to optimize
agent.setMode('optimize');
assert.strictEqual(agent.optimize, true);

console.log('✔ All /mode command and mode switcher unit assertions passed!\n');
