#!/usr/bin/env node
/**
 * ==============================================================================
 * DYNAMIC TOOLS CROSS-NODE SYNCHRONIZATION UTILITY
 * ==============================================================================
 * Synchronizes tools/registry.json and tools/acquired/ between:
 * 1. AIUI local repo (/Users/adminuser/AIUI/tools)
 * 2. abliterated_ui local repo (/Users/adminuser/abliterated_ui/tools)
 * 3. Remote DGX Spark workspace (/tmp/spark-sandboxes/web_session/tools)
 * ==============================================================================
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '../..');

const SRC_TOOLS_DIR = path.join(ROOT, 'tools');
const SRC_REGISTRY = path.join(SRC_TOOLS_DIR, 'registry.json');
const SRC_ACQUIRED = path.join(SRC_TOOLS_DIR, 'acquired');

const ABLIT_TOOLS_DIR = '/Users/adminuser/abliterated_ui/tools';
const ABLIT_REGISTRY = path.join(ABLIT_TOOLS_DIR, 'registry.json');
const ABLIT_ACQUIRED = path.join(ABLIT_TOOLS_DIR, 'acquired');

function syncLocalDirs() {
  console.log('🔄 Synchronizing dynamic tools locally between AIUI and abliterated_ui...');
  
  if (!fs.existsSync(SRC_TOOLS_DIR)) fs.mkdirSync(SRC_TOOLS_DIR, { recursive: true });
  if (!fs.existsSync(SRC_ACQUIRED)) fs.mkdirSync(SRC_ACQUIRED, { recursive: true });
  if (!fs.existsSync(ABLIT_TOOLS_DIR)) fs.mkdirSync(ABLIT_TOOLS_DIR, { recursive: true });
  if (!fs.existsSync(ABLIT_ACQUIRED)) fs.mkdirSync(ABLIT_ACQUIRED, { recursive: true });

  // 1. Sync registry
  if (fs.existsSync(SRC_REGISTRY)) {
    fs.copyFileSync(SRC_REGISTRY, ABLIT_REGISTRY);
    console.log(`  ✔ Copied registry.json to ${ABLIT_REGISTRY}`);
  } else if (fs.existsSync(ABLIT_REGISTRY)) {
    fs.copyFileSync(ABLIT_REGISTRY, SRC_REGISTRY);
    console.log(`  ✔ Copied registry.json from ${ABLIT_REGISTRY} to ${SRC_REGISTRY}`);
  }

  // 2. Sync acquired tool scripts
  if (fs.existsSync(SRC_ACQUIRED)) {
    const files = fs.readdirSync(SRC_ACQUIRED);
    for (const f of files) {
      const src = path.join(SRC_ACQUIRED, f);
      const dest = path.join(ABLIT_ACQUIRED, f);
      fs.copyFileSync(src, dest);
      console.log(`  ✔ Synced tool: ${f}`);
    }
  }
}

function syncToSpark() {
  const isSshAvailable = fs.existsSync('/Users/adminuser/Library/Application Support/NVIDIA/Sync/config/nvsync.key');
  if (!isSshAvailable) {
    console.log('ℹ SSH key for DGX Spark not found, skipping remote sync.');
    return;
  }

  console.log('🚀 Syncing tools to remote DGX Spark (/tmp/spark-sandboxes/web_session/tools)...');
  try {
    const cmd = `ssh -o StrictHostKeyChecking=no -i "/Users/adminuser/Library/Application Support/NVIDIA/Sync/config/nvsync.key" flak3dd@100.66.147.53 "mkdir -p /tmp/spark-sandboxes/web_session/tools/acquired"`;
    execSync(cmd, { timeout: 15000, stdio: 'pipe' });

    if (fs.existsSync(SRC_REGISTRY)) {
      const scpReg = `scp -o StrictHostKeyChecking=no -i "/Users/adminuser/Library/Application Support/NVIDIA/Sync/config/nvsync.key" "${SRC_REGISTRY}" flak3dd@100.66.147.53:/tmp/spark-sandboxes/web_session/tools/registry.json`;
      execSync(scpReg, { timeout: 15000, stdio: 'pipe' });
      console.log('  ✔ Remote registry.json synced.');
    }

    if (fs.existsSync(SRC_ACQUIRED)) {
      const files = fs.readdirSync(SRC_ACQUIRED);
      for (const f of files) {
        const scpFile = `scp -o StrictHostKeyChecking=no -i "/Users/adminuser/Library/Application Support/NVIDIA/Sync/config/nvsync.key" "${path.join(SRC_ACQUIRED, f)}" flak3dd@100.66.147.53:/tmp/spark-sandboxes/web_session/tools/acquired/${f}`;
        execSync(scpFile, { timeout: 15000, stdio: 'pipe' });
        console.log(`  ✔ Remote tool script synced: ${f}`);
      }
    }
  } catch (err) {
    console.warn(`⚠ Remote sync notice: ${err.message}`);
  }
}

syncLocalDirs();
syncToSpark();
console.log('✨ Dynamic tools synchronization complete.\n');
