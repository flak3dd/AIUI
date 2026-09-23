#!/usr/bin/env node
import { spawn } from 'node:child_process';

const proc = spawn('node', ['--test', 'src/lib/autonomyEnhancements.test.ts'], {
  stdio: 'inherit',
});

proc.on('exit', (code) => {
  process.exit(code || 0);
});
