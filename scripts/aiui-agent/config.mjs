import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

// Attempt to load ~/.aiuirc if environment variables are not pre-set
try {
  const homeDir = process.env.HOME || os.homedir();
  const rcPath = path.resolve(homeDir, '.aiuirc');
  if (fs.existsSync(rcPath)) {
    const lines = fs.readFileSync(rcPath, 'utf8').split('\n');
    for (const line of lines) {
      const match = line.match(/^\s*(?:export\s+)?([A-Za-z0-9_]+)\s*=\s*["']?(.*?)["']?\s*$/);
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2];
      }
    }
  }
} catch {}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const ROOT_DIR = (() => {
  const home = process.env.HOME || os.homedir();
  const repoFallback = path.resolve(__dirname, '../..');
  const candidates = [
    repoFallback,
    process.env.AIUI_HOME,
    path.resolve(home, 'AIUI'),
    path.resolve(home, '.aiui'),
    path.resolve(home, 'aiui'),
  ].filter((c) => Boolean(c) && c !== home && c !== '/Users/adminuser');

  for (const c of candidates) {
    if (
      fs.existsSync(path.resolve(c, 'scripts/restart-spark.mjs')) &&
      fs.existsSync(path.resolve(c, 'scripts/aiui-agent.mjs'))
    ) {
      return c;
    }
  }
  for (const c of candidates) {
    if (
      fs.existsSync(path.resolve(c, 'scripts/aiui-agent.mjs')) &&
      fs.existsSync(path.resolve(c, 'scripts/aiui-agent/core/agent.mjs'))
    ) {
      return c;
    }
  }
  return repoFallback;
})();

export function isRunningOnSpark() {
  if (process.platform === 'darwin') return false;
  if (process.platform === 'linux') {
    const h = (os.hostname() || '').toLowerCase();
    return h.includes('spark') || h.includes('dgx') || h.includes('gx10');
  }
  return false;
}

export const SANDBOX_RUNNER_URL = process.env.SANDBOX_RUNNER_URL || 'http://127.0.0.1:17330';
export const MEMPALACE_URL = process.env.MEMPALACE_URL || 'http://127.0.0.1:17333';
export const CLOUD_KEY_PROXY_URL = process.env.CLOUD_KEY_PROXY_URL || 'http://127.0.0.1:17332/featherless/v1';
export const FEATHERLESS_DIRECT_URL = 'https://api.featherless.ai/v1';

export function getResolvedSshKey() {
  if (process.env.SPARK_SSH_KEY) {
    const clean = process.env.SPARK_SSH_KEY.replace(/^"|"$/g, '');
    if (fs.existsSync(clean)) return clean;
  }
  const home = process.env.HOME || os.homedir();
  const candidates = [
    path.resolve(home, 'Library/Application Support/NVIDIA/Sync/config/nvsync.key'),
    path.resolve(home, '.ssh/id_ed25519'),
    path.resolve(home, '.ssh/id_rsa'),
    path.resolve(home, '.ssh/spark.key'),
    path.resolve(home, '.ssh/nvsync.key'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

export const SSH_KEY = process.env.SPARK_SSH_KEY || getResolvedSshKey() || '';
export const SPARK_HOST = process.env.SPARK_HOST || '100.66.147.53';
export const SPARK_QWEN_HOST = process.env.SPARK_QWEN_HOST || '192.168.4.103';
export const SPARK_TAILSCALE_HOST = '100.66.147.53';
export const SPARK_USER = process.env.SPARK_USER || 'flak3dd';

/** Chat completion URLs for the Spark vLLM switch. SPARK_ROUTE=lan|tailscale|both (default both). */
export function sparkVllmChatUrls() {
  const route = String(process.env.SPARK_ROUTE || 'both').toLowerCase();
  const port = Number(process.env.SPARK_PORT || 8000) || 8000;
  const lan = process.env.SPARK_QWEN_HOST || SPARK_QWEN_HOST;
  const hosts = route === 'lan' ? [lan] : route === 'tailscale' || route === 'ts' ? [SPARK_TAILSCALE_HOST] : [lan, SPARK_TAILSCALE_HOST];
  const unique = [];
  for (const host of hosts) {
    const clean = String(host || '').trim();
    if (clean && !unique.includes(clean)) unique.push(clean);
  }
  return unique.map((host) => `http://${host}:${port}/v1/chat/completions`);
}

export const DEFAULT_MODEL = process.env.FEATHERLESS_MODEL || 'Qwen/Qwen2.5-Coder-32B-Instruct';
export const DEFAULT_API_KEY = process.env.FEATHERLESS_API_KEY || '';
export const DEFAULT_TARGET = isRunningOnSpark() ? 'dgx_spark' : 'local';
export const DEFAULT_WORKSPACE = process.cwd();
export const DEFAULT_ENV_ID = 'web_session';

export function normalizeSandboxPath(rawPath, envId = DEFAULT_ENV_ID) {
  let p = String(rawPath || '').trim();
  p = p.replace(/^\/+/, '');
  if (p.startsWith(`tmp/spark-sandboxes/${envId}/`)) {
    p = p.slice(`tmp/spark-sandboxes/${envId}/`.length);
  } else if (p.startsWith('tmp/spark-sandboxes/')) {
    p = p.slice('tmp/spark-sandboxes/'.length);
  }
  return p;
}

export function loadOptimizerPolicy() {
  const possiblePolicyPaths = [
    path.resolve(ROOT_DIR, 'logs/chat-response-optimizer-policy.json'),
    path.resolve(process.env.HOME || '', 'AIUI/logs/chat-response-optimizer-policy.json'),
  ];
  for (const p of possiblePolicyPaths) {
    try {
      if (fs.existsSync(p)) {
        return JSON.parse(fs.readFileSync(p, 'utf8'));
      }
    } catch {}
  }
  return null;
}

export function loadScaffoldsCatalog() {
  const possibleScaffoldPaths = [
    path.resolve(ROOT_DIR, 'src/lib/scaffoldTemplates.json'),
    path.resolve(__dirname, 'scaffoldTemplates.json'),
    path.resolve(__dirname, '../scaffoldTemplates.json'),
    path.resolve(process.env.HOME || '', 'abliterated_ui/src/lib/scaffoldTemplates.json'),
    path.resolve(process.env.HOME || '', 'aiui-agent/scaffoldTemplates.json'),
  ];
  for (const sp of possibleScaffoldPaths) {
    try {
      if (fs.existsSync(sp)) {
        return JSON.parse(fs.readFileSync(sp, 'utf8'));
      }
    } catch {}
  }
  return {};
}

export const SCAFFOLD_CATALOG = loadScaffoldsCatalog();
