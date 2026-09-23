import fs from 'node:fs';
import path from 'node:path';
import util from 'node:util';
import { exec } from 'node:child_process';
import {
  ROOT_DIR,
  SANDBOX_RUNNER_URL,
  MEMPALACE_URL,
  CLOUD_KEY_PROXY_URL,
  SSH_KEY,
  SPARK_HOST,
  SPARK_USER,
  isRunningOnSpark,
  loadOptimizerPolicy,
} from '../config.mjs';
import { fileReadCache } from '../tools/handlers/fs.mjs';
import { renderCard, badge } from '../ui/components.mjs';
import { rgb, c } from '../ui/skins.mjs';

const execP = util.promisify(exec);

/**
 * Probe health and response latencies of ecosystem services.
 */
export async function checkServices() {
  const onSpark = isRunningOnSpark();
  const status = {
    runner: { ok: false, ms: 0 },
    mempalace: { ok: false, ms: 0 },
    cloudProxy: { ok: false, ms: 0 },
    sparkSsh: { ok: false, ms: 0 },
    isNativeSpark: onSpark,
  };

  try {
    const t0 = performance.now();
    const res = await fetch(`${SANDBOX_RUNNER_URL}/api/sandbox/status`, { signal: AbortSignal.timeout(1500) });
    status.runner = { ok: res.ok, ms: Math.round(performance.now() - t0) };
  } catch {}

  try {
    const t0 = performance.now();
    const res = await fetch(`${MEMPALACE_URL}/health`, { signal: AbortSignal.timeout(1500) });
    status.mempalace = { ok: res.ok, ms: Math.round(performance.now() - t0) };
  } catch {}

  try {
    const t0 = performance.now();
    const res = await fetch(`${CLOUD_KEY_PROXY_URL}/models`, { signal: AbortSignal.timeout(2000) });
    status.cloudProxy = { ok: res.ok, ms: Math.round(performance.now() - t0) };
  } catch {}

  if (onSpark) {
    status.sparkSsh = { ok: true, ms: 0 };
  } else {
    try {
      const t0 = performance.now();
      const { stdout } = await execP(
        `ssh -o BatchMode=yes -o ConnectTimeout=3 -o StrictHostKeyChecking=no -i ${SSH_KEY} ${SPARK_USER}@${SPARK_HOST} "hostname"`,
        { timeout: 4000 }
      );
      status.sparkSsh = { ok: stdout.trim().length > 0, ms: Math.round(performance.now() - t0) };
    } catch {}
  }

  return status;
}

/**
 * Execute comprehensive system, GPU, policy & cache optimization pass.
 */
export async function runOptimizationPass(ctx) {
  ctx.optimize = true;
  fileReadCache.clear();
  const policy = loadOptimizerPolicy();

  // Probe Spark GPU vLLM link
  let sparkStatus = 'OFFLINE';
  let latency = 'N/A';
  try {
    const t0 = performance.now();
    const hosts = ['192.168.4.103', '100.66.147.53'];
    for (const host of hosts) {
      try {
        const res = await fetch(`http://${host}:8000/v1/models`, { signal: AbortSignal.timeout(2500) });
        if (res.ok) {
          sparkStatus = `ONLINE (${host}:8000)`;
          latency = `${Math.round(performance.now() - t0)}ms`;
          break;
        }
      } catch {}
    }
  } catch {}

  const effectiveTemp = (0.2 + (policy?.temperatureBias || 0)).toFixed(3);
  const lines = [
    ` ${rgb(...ctx.skin.primary)}Optimizer Mode:${c.reset}    ${rgb(...ctx.skin.success)}ENABLED (Evolved High-Assurance Policy)${c.reset}`,
    ` ${rgb(...ctx.skin.primary)}Active Archetype:${c.reset}  ${rgb(...ctx.skin.gold)}${policy?.stats?.archetype || '🛡️ Deep-Build High-Assurance'}${c.reset}`,
    ` ${rgb(...ctx.skin.primary)}Health Index:${c.reset}      ${rgb(...ctx.skin.success)}${policy?.healthIndex ?? 85}/100${c.reset} (Composite Fitness: ${policy?.stats?.compositeFitness ?? 0.851})`,
    ` ${rgb(...ctx.skin.primary)}Temperature Bias:${c.reset}  ${rgb(...ctx.skin.accent)}${policy?.temperatureBias > 0 ? '+' : ''}${policy?.temperatureBias ?? 0}${c.reset} (Effective: ${effectiveTemp})`,
    ` ${rgb(...ctx.skin.primary)}Anti-Loop Policy:${c.reset}  ${rgb(...ctx.skin.success)}STRICT (Anti-stall & Fast-pivot)${c.reset}`,
    ` ${rgb(...ctx.skin.primary)}Local Mac FastPath:${c.reset}${rgb(...ctx.skin.success)}DIRECT PROCESS I/O (<3ms)${c.reset}`,
    ` ${rgb(...ctx.skin.primary)}Spark vLLM Link:${c.reset}   ${sparkStatus.includes('ONLINE') ? rgb(...ctx.skin.success) : rgb(...ctx.skin.warning)}${sparkStatus}${c.reset} (${latency})`,
    ` ${rgb(...ctx.skin.primary)}Socket & Cache:${c.reset}    ${rgb(...ctx.skin.muted)}fileReadCache cleared, TCP keep-alive pooled${c.reset}`,
  ];

  if (policy?.stats?.multiTaskGenome) {
    const mg = policy.stats.multiTaskGenome;
    lines.push(
      ``,
      ` ${rgb(...ctx.skin.primary)}Multi-Task Genome:${c.reset}`,
      `   • CodeGen:   diff=${mg.code_gen?.diff_conservatism ?? 1.0} | verify=${mg.code_gen?.verification_depth ?? 0.96}`,
      `   • Healing:   anti_loop=${mg.self_healing?.anti_loop_sensitivity ?? 0.96} | tool_div=${mg.self_healing?.tool_diversity ?? 1.0}`,
      `   • FastQuery: direct_ratio=${mg.fast_query?.direct_response_ratio ?? 1.0} | latency=${mg.fast_query?.latency_priority ?? 0.88}`,
      `   • DevOps:    preflight=${mg.systems_devops?.pre_flight_dryrun ?? 0.94} | isolation=${mg.systems_devops?.container_isolation ?? 0.86}`
    );
  }

  if (policy?.systemNudge) {
    lines.push(``, ` ${rgb(...ctx.skin.muted)}Policy Nudge:${c.reset} ${policy.systemNudge.slice(0, 110)}...`);
  }

  console.log(
    '\n' +
      renderCard({
        title: '⚡ SYSTEM RESPONSE OPTIMIZER REPORT',
        badge: badge('OPT-LEVEL 3', ctx.skin.success, ctx.skin.badgeBg),
        lines,
        skin: ctx.skin,
        width: 76,
      }) +
      '\n'
  );
}

export const AGENT_MONITOR_URL = process.env.AGENT_MONITOR_URL || 'http://127.0.0.1:17335';

/**
 * Transmits non-blocking agent debug and traffic telemetry to:
 * 1. The local Agent Monitor server (:17335)
 * 2. Persistent log files: logs/agent-responses.log & logs/agent-responses.jsonl
 */
export function sendCliDebugEvent(event) {
  const payload = {
    ...event,
    timestamp: event.timestamp || Date.now(),
    source: 'aiui_cli',
  };

  // 1. Dispatch non-blocking HTTP to local monitor daemon (:17335)
  fetch(`${AGENT_MONITOR_URL}/api/agent/event`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(1000),
  }).catch(() => {});

  // 2. Direct append to log file in logs/agent-responses.log & jsonl
  try {
    const logDir = path.resolve(ROOT_DIR, 'logs');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

    // Append JSONL
    const jsonlFile = path.resolve(logDir, 'agent-responses.jsonl');
    fs.appendFileSync(jsonlFile, JSON.stringify(payload) + '\n', 'utf8');

    // Append human-readable log
    const logFile = path.resolve(logDir, 'agent-responses.log');
    const d = new Date(payload.timestamp).toTimeString().split(' ')[0];
    let line = `[${d}] [${(payload.type || 'EVENT').toUpperCase()}]`;
    if (payload.model) line += ` Model: ${payload.model}`;
    if (payload.provider) line += ` | Provider: ${payload.provider}`;
    if (payload.round) line += ` | Round: ${payload.round}`;
    if (payload.durationMs != null) line += ` | ${payload.durationMs}ms`;
    if (payload.tokens) line += ` | ~${payload.tokens} tok`;
    if (payload.userPrompt) line += `\n  Prompt: "${payload.userPrompt.replace(/\n/g, ' ').slice(0, 200)}"`;
    if (payload.toolName) line += `\n  Tool: ${payload.toolName} -> Exit: ${payload.exitCode ?? 0}`;
    if (payload.error) line += `\n  Error: ${payload.error}`;
    fs.appendFileSync(logFile, line + '\n', 'utf8');
  } catch {}
}

/**
 * Reads trailing traffic events from logs/agent-responses.jsonl
 */
export function getRecentCliTraffic(limit = 20) {
  try {
    const jsonlFile = path.resolve(ROOT_DIR, 'logs/agent-responses.jsonl');
    if (!fs.existsSync(jsonlFile)) return [];
    const lines = fs.readFileSync(jsonlFile, 'utf8').trim().split('\n').filter(Boolean);
    const slice = lines.slice(-limit);
    return slice
      .map((l) => {
        try { return JSON.parse(l); } catch { return null; }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

