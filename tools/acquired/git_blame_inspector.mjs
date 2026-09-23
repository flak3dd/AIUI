#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const args = process.argv.slice(2);
let filePath = '';
let startLine = null;
let endLine = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--file-path') filePath = args[++i];
  if (args[i] === '--start-line') startLine = Number(args[++i]);
  if (args[i] === '--end-line') endLine = Number(args[++i]);
}

if (!filePath) {
  console.log(JSON.stringify({ ok: false, error: "file_path is required" }));
  process.exit(1);
}

const gitArgs = ['blame', '--porcelain'];
if (startLine && endLine) {
  gitArgs.push(`-L${startLine},${endLine}`);
} else if (startLine) {
  gitArgs.push(`-L${startLine},+50`);
}
gitArgs.push(filePath);

const proc = spawnSync('git', gitArgs, { encoding: 'utf8' });

if (proc.status !== 0) {
  console.log(JSON.stringify({
    ok: false,
    error: proc.stderr.trim() || 'git blame failed',
    exitCode: proc.status
  }));
  process.exit(1);
}

const lines = proc.stdout.split('\n');
const commits = {};
const blameLines = [];

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const headerMatch = line.match(/^([a-f0-9]{40})\s+(\d+)\s+(\d+)/);
  if (headerMatch) {
    const hash = headerMatch[1].slice(0, 8);
    const lineNum = Number(headerMatch[3]);
    let author = 'unknown';
    let authorTime = '';
    let summary = '';

    while (i + 1 < lines.length && !lines[i + 1].startsWith('\t')) {
      i++;
      if (lines[i].startsWith('author ')) author = lines[i].slice(7);
      if (lines[i].startsWith('author-time ')) authorTime = new Date(Number(lines[i].slice(12)) * 1000).toISOString().slice(0, 10);
      if (lines[i].startsWith('summary ')) summary = lines[i].slice(8);
    }
    if (i + 1 < lines.length && lines[i + 1].startsWith('\t')) {
      i++;
      const code = lines[i].slice(1);
      blameLines.push({ lineNum, hash, author, authorTime, summary, code });
    }
  }
}

console.log(JSON.stringify({
  ok: true,
  filePath,
  totalLinesBlamed: blameLines.length,
  lines: blameLines.slice(0, 200),
  truncated: blameLines.length > 200
}, null, 2));
process.exit(0);
