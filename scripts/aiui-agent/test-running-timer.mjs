#!/usr/bin/env node

import assert from 'node:assert/strict';
import { formatRunningTime, LiveSpinner } from './ui/components.mjs';
import { getSkin, stripAnsi } from './ui/skins.mjs';

console.log('🧪 Testing Running Timer and Double-Escape Interrupt Engine...');

// Test 1: formatRunningTime duration formatting
console.log('  Testing formatRunningTime boundaries...');
{
  assert.equal(formatRunningTime(0), '0s');
  assert.equal(formatRunningTime(500), '0s');
  assert.equal(formatRunningTime(1000), '1s');
  assert.equal(formatRunningTime(14000), '14s');
  assert.equal(formatRunningTime(59000), '59s');
  assert.equal(formatRunningTime(60000), '1m 0s');
  assert.equal(formatRunningTime(72000), '1m 12s');
  assert.equal(formatRunningTime(132000), '2m 12s');
  assert.equal(formatRunningTime(3600000), '1h 0m 0s');
  assert.equal(formatRunningTime(3735000), '1h 2m 15s');
  console.log('  ✔ formatRunningTime correctly produces "2m 12s" and duration boundaries.');
}

// Test 2: LiveSpinner output text structure
console.log('  Testing LiveSpinner output format...');
{
  const skin = getSkin('cyberpunk');
  const fakeStart = Date.now() - 132000; // 2m 12s ago
  const spinner = new LiveSpinner({
    label: 'Running tools',
    skin,
    showTimer: true,
    startTime: fakeStart,
  });

  let capturedWrite = '';
  const origWrite = process.stdout.write;
  process.stdout.write = (str) => {
    capturedWrite += str;
    return true;
  };

  try {
    spinner.render();
  } finally {
    process.stdout.write = origWrite;
  }

  const plainText = stripAnsi(capturedWrite);
  console.log('  Captured rendered line:', JSON.stringify(plainText));
  assert.ok(plainText.includes('Running tools'), 'Should contain "Running tools"');
  assert.ok(plainText.includes('2m 12s'), 'Should contain "2m 12s"');
  assert.ok(plainText.includes('(esc twice to interrupt)'), 'Should contain "(esc twice to interrupt)"');
  assert.ok(plainText.includes('·'), 'Should contain middle dot "·"');
  console.log('  ✔ LiveSpinner renders exact "Running tools · 2m 12s (esc twice to interrupt)" pattern.');
}

// Test 3: Double Escape Interrupt trigger logic
console.log('  Testing ESC-twice interrupt state transitions...');
{
  let interrupted = false;
  const spinner = new LiveSpinner({
    label: 'Running tools',
    skin: getSkin('cyberpunk'),
    showTimer: true,
    allowInterrupt: true,
    onInterrupt: () => {
      interrupted = true;
    },
  });

  spinner.start();
  assert.equal(spinner.isEscPending, false);

  // 1st ESC press
  spinner.keyListener('\x1b', { name: 'escape' });
  assert.equal(spinner.isEscPending, true);
  assert.equal(interrupted, false);

  // 2nd ESC press (within 1.5s)
  spinner.keyListener('\x1b', { name: 'escape' });
  assert.equal(interrupted, true);
  assert.equal(spinner.timer, null);
  console.log('  ✔ Double-ESC successfully triggers interrupt and halts spinner.');
}

console.log('\n🎉 ALL RUNNING TIMER TESTS PASSED SUCCESSFULLY!\n');
