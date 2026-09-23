#!/usr/bin/env node
/**
 * ==============================================================================
 * 📦 AIUI CLIENT DISTRIBUTION BUNDLER
 * ==============================================================================
 * Packages the standalone AIUI client suite into dist/aiui-client.tar.gz
 * so any machine on the network can install it via curl in seconds.
 * ==============================================================================
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');
const DIST_DIR = path.resolve(ROOT_DIR, 'dist');
const STAGING_DIR = path.resolve(DIST_DIR, 'staging');

console.log('⚡ Building AIUI Client Distribution Bundle...');

if (fs.existsSync(STAGING_DIR)) {
  fs.rmSync(STAGING_DIR, { recursive: true, force: true });
}
fs.mkdirSync(STAGING_DIR, { recursive: true });

function copyRecursive(src, dest) {
  if (!fs.existsSync(src)) return;
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const item of fs.readdirSync(src)) {
      copyRecursive(path.join(src, item), path.join(dest, item));
    }
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

// 1. Copy core runner and wrapper scripts
const itemsToCopy = [
  'aiui',
  'bin/aiui',
  'package.json',
  'scripts/aiui-agent.mjs',
  'scripts/aiui-agent',
  'scripts/matrix.sh',
  'scripts/benchmark.mjs',
  'scripts/restart-spark.mjs',
  'scripts/dynamic-tool-manager.mjs',
];

for (const item of itemsToCopy) {
  const srcPath = path.resolve(ROOT_DIR, item);
  const destPath = path.resolve(STAGING_DIR, item);
  if (fs.existsSync(srcPath)) {
    copyRecursive(srcPath, destPath);
    console.log(`  ✔ Copied ${item}`);
  }
}

// 2. Ensure executable permissions
const binPaths = [
  path.resolve(STAGING_DIR, 'aiui'),
  path.resolve(STAGING_DIR, 'bin/aiui'),
  path.resolve(STAGING_DIR, 'scripts/aiui-agent.mjs'),
  path.resolve(STAGING_DIR, 'scripts/matrix.sh'),
];
for (const p of binPaths) {
  if (fs.existsSync(p)) {
    fs.chmodSync(p, 0o755);
  }
}

// 3. Create tar.gz archive
const tarGzPath = path.resolve(DIST_DIR, 'aiui-client.tar.gz');
console.log(`  📦 Compressing to ${tarGzPath}...`);
execSync(`tar -czf "${tarGzPath}" -C "${STAGING_DIR}" .`, { stdio: 'inherit' });

// 4. Clean staging
fs.rmSync(STAGING_DIR, { recursive: true, force: true });

const sizeBytes = fs.statSync(tarGzPath).size;
console.log(`✔ Bundle created: ${tarGzPath} (${Math.round(sizeBytes / 1024)} KB)`);
