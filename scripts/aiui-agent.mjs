#!/usr/bin/env node

/**
 * ==============================================================================
 * ⚡ AIUI SOVEREIGN AUTONOMOUS AGENT & CLUSTER SHELL
 * ==============================================================================
 * Facade entry point preserving 100% backward compatibility with:
 * - ./aiui CLI runner
 * - npm run aiui
 * - package.json bin: { "aiui": "./scripts/aiui-agent.mjs" }
 * - External module imports
 *
 * Modular implementation lives under ./aiui-agent/
 * ==============================================================================
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCli } from './aiui-agent/cli.mjs';
import { c } from './aiui-agent/ui/skins.mjs';

export * from './aiui-agent/index.mjs';

const __filename = fileURLToPath(import.meta.url);

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  runCli().catch((err) => {
    console.error(`${c.red}Fatal Error:${c.reset}`, err);
    process.exit(1);
  });
}
