#!/usr/bin/env node
/**
 * ==============================================================================
 * AUTONOMOUS SELF-IMPROVEMENT & META-AWARENESS MONITOR DAEMON
 * ==============================================================================
 * Continuously analyzes system telemetry + MemPalace signals to produce
 * self-awareness diagnostics and actionable improvement suggestions.
 * ==============================================================================
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '../..');
const LOG_DIR = path.resolve(ROOT, 'logs');

const PORT = Number(process.env.SELF_IMPROVEMENT_PORT || 17336);
const HOST = process.env.SELF_IMPROVEMENT_HOST || '0.0.0.0';

const isSpark = process.env.USER === 'flak3dd' || (process.arch === 'arm64' && process.platform === 'linux');
const MEMPALACE_URL = process.env.MEMPALACE_URL || (isSpark ? 'http://192.168.4.50:17333' : 'http://127.0.0.1:17333');
const AGENT_MONITOR_URL = process.env.AGENT_MONITOR_URL || (isSpark ? 'http://127.0.0.1:17335' : 'http://100.66.147.53:17335');
const SANDBOX_RUNNER_URL = process.env.SANDBOX_RUNNER_URL || 'http://127.0.0.1:17330';

const METRICS_HISTORY_FILE = path.join(LOG_DIR, 'self-improvement-metrics.json');
const SUGGESTIONS_FILE = path.join(LOG_DIR, 'self-improvement-suggestions.json');

const PALACE_PROBE_QUERIES = (
  process.env.MEMPALACE_PROBE_QUERIES ||
  'spark reboot;self improvement;sandbox runner;superserve'
)
  .split(';')
  .map((s) => s.trim())
  .filter(Boolean);

if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

const historyRing = [];
const RING_MAX = 200;

function getSystemTelemetry() {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  return {
    timestamp: Date.now(),
    system: {
      totalMemGB: Number((totalMem / 1024 ** 3).toFixed(2)),
      freeMemGB: Number((freeMem / 1024 ** 3).toFixed(2)),
      usedMemGB: Number((usedMem / 1024 ** 3).toFixed(2)),
      memUsagePct: Number(((usedMem / totalMem) * 100).toFixed(2)),
      loadAvg: os.loadavg().map((n) => Number(n.toFixed(2))),
      cpuCount: os.cpus().length,
    },
  };
}

function fetchJson(url, { method = 'GET', body, timeoutMs = 2500 } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    const u = new URL(url);
    const payload = body != null ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: `${u.pathname}${u.search}`,
        method,
        timeout: timeoutMs,
        headers: {
          Accept: 'application/json',
          ...(payload
            ? {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
              }
            : {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            done({
              ok: res.statusCode >= 200 && res.statusCode < 300,
              status: res.statusCode,
              data: JSON.parse(data),
            });
          } catch {
            done({
              ok: res.statusCode >= 200 && res.statusCode < 300,
              status: res.statusCode,
              data: null,
              raw: data,
            });
          }
        });
      },
    );
    req.on('error', (err) => done({ ok: false, error: err.message || 'Connection refused' }));
    req.on('timeout', () => {
      req.destroy();
      done({ ok: false, error: 'Timeout' });
    });
    if (payload) req.write(payload);
    req.end();
  });
}

async function fetchServiceHealth(baseUrl) {
  return fetchJson(`${baseUrl}/health`);
}

async function fetchMempalaceSignals() {
  const health = await fetchServiceHealth(MEMPALACE_URL);
  const empty = {
    online: false,
    health,
    status: null,
    wings: {},
    probes: [],
    signals: {
      mcpReady: false,
      totalDrawers: 0,
      wingCount: 0,
      testishDrawerShare: 0,
      topWings: [],
      backend: null,
      sqliteOk: null,
      palacePath: null,
    },
  };
  if (!health.ok) return empty;

  const [statusRes, wingsRes, ...probeRes] = await Promise.all([
    fetchJson(`${MEMPALACE_URL}/mcp/status`),
    fetchJson(`${MEMPALACE_URL}/mcp/wings`),
    ...PALACE_PROBE_QUERIES.map((query) =>
      fetchJson(`${MEMPALACE_URL}/mcp/search`, {
        method: 'POST',
        body: { query, limit: 5 },
        timeoutMs: 4000,
      }).then((r) => ({ query, ...r })),
    ),
  ]);

  const statusBody = statusRes.ok ? statusRes.data?.result || statusRes.data : null;
  const wingsRaw = wingsRes.ok
    ? wingsRes.data?.result?.wings || wingsRes.data?.wings || wingsRes.data?.result || {}
    : {};
  const wings = wingsRaw && typeof wingsRaw === 'object' && !Array.isArray(wingsRaw) ? wingsRaw : {};

  const wingEntries = Object.entries(wings).sort((a, b) => Number(b[1]) - Number(a[1]));
  const totalDrawers = Number(
    statusBody?.total_drawers ?? wingEntries.reduce((a, [, n]) => a + Number(n || 0), 0),
  );
  const testish = wingEntries
    .filter(([name]) => /test|smoke|browser/i.test(name))
    .reduce((sum, [, n]) => sum + Number(n || 0), 0);
  const testishDrawerShare = totalDrawers > 0 ? Number((testish / totalDrawers).toFixed(3)) : 0;

  const probes = probeRes.map((p) => {
    const results = p.ok ? p.data?.result?.results || p.data?.results || [] : [];
    const top = Array.isArray(results) ? results[0] : null;
    return {
      query: p.query,
      ok: Boolean(p.ok),
      hitCount: Array.isArray(results) ? results.length : 0,
      topSimilarity: top?.similarity ?? null,
      topWing: top?.wing ?? null,
      topRoom: top?.room ?? null,
      topSnippet: typeof top?.text === 'string' ? top.text.slice(0, 180) : null,
      error: p.ok ? null : p.error || `HTTP ${p.status}`,
    };
  });

  return {
    online: true,
    health,
    status: statusBody,
    wings,
    probes,
    signals: {
      mcpReady: health.data?.mcpReady !== false,
      totalDrawers,
      wingCount: wingEntries.length,
      testishDrawerShare,
      topWings: wingEntries.slice(0, 5).map(([name, count]) => ({ name, count: Number(count) })),
      backend: statusBody?.backend || null,
      sqliteOk: statusBody?.sqlite_integrity?.ok ?? null,
      palacePath: statusBody?.sqlite_integrity?.palace || null,
    },
  };
}

function buildPalaceSuggestions(palace) {
  const suggestions = [];
  if (!palace.online) {
    suggestions.push({
      id: 'mempalace-offline',
      category: 'Memory Subsystem',
      severity: 'MEDIUM',
      title: 'MemPalace Bridge Offline',
      observation: 'MemPalace vector memory is not answering on :17333',
      suggestedAction:
        'Start the MemPalace bridge (`npm run mempalace` / mempalace-bridge.mjs) and confirm MCP is healthy.',
      source: 'mempalace',
    });
    return suggestions;
  }

  if (palace.health?.data && palace.health.data.mcpReady === false) {
    suggestions.push({
      id: 'mempalace-mcp-not-ready',
      category: 'Memory Subsystem',
      severity: 'HIGH',
      title: 'MemPalace MCP Not Ready',
      observation: 'Bridge is up but mcpReady=false — searches will fail or return empty.',
      suggestedAction: 'Inspect bridge logs; ensure the mempalace MCP child process and Chroma palace path are healthy.',
      source: 'mempalace',
    });
  }

  if (palace.signals.sqliteOk === false) {
    suggestions.push({
      id: 'mempalace-sqlite-integrity',
      category: 'Memory Subsystem',
      severity: 'HIGH',
      title: 'MemPalace SQLite Integrity Failed',
      observation: `Palace DB integrity check failed at ${palace.signals.palacePath || '~/.mempalace/palace'}`,
      suggestedAction: 'Back up ~/.mempalace/palace then repair or restore from a known-good Chroma snapshot.',
      source: 'mempalace',
    });
  }

  if (palace.signals.totalDrawers > 800 && palace.signals.testishDrawerShare >= 0.35) {
    suggestions.push({
      id: 'mempalace-noisy-test-wings',
      category: 'Memory Hygiene',
      severity: 'MEDIUM',
      title: 'Palace Noise Dominates Recall',
      observation: `${palace.signals.totalDrawers} drawers; ~${Math.round(
        palace.signals.testishDrawerShare * 100,
      )}% in test/smoke/browser wings — ops probes will skew to old test chat.`,
      suggestedAction:
        'Run `npm run mempalace:prune:apply` to archive and purge test/smoke/browser wings from Chroma; checkpoint durable ops facts into dedicated wings + diary_write.',
      remediationUrl: '/api/remediate/prune-palace',
      source: 'mempalace',
    });
  }

  const weakProbes = (palace.probes || []).filter(
    (p) => p.ok && (p.hitCount === 0 || (p.topSimilarity != null && p.topSimilarity < 0.35)),
  );
  if (weakProbes.length >= Math.max(2, Math.ceil(PALACE_PROBE_QUERIES.length / 2))) {
    suggestions.push({
      id: 'mempalace-weak-ops-recall',
      category: 'Self-Awareness',
      severity: 'LOW',
      title: 'Weak Ops Memory Recall',
      observation: `Probe queries [${weakProbes.map((p) => p.query).join(', ')}] returned weak/empty palace hits.`,
      suggestedAction:
        'After Spark/SuperServe changes, POST /mcp/checkpoint or /mcp/diary-write so reboot/runner/sandbox facts are recallable.',
      source: 'mempalace',
    });
  }

  if (palace.signals.totalDrawers === 0) {
    suggestions.push({
      id: 'mempalace-empty',
      category: 'Memory Subsystem',
      severity: 'MEDIUM',
      title: 'Empty MemPalace',
      observation: 'Bridge is healthy but total_drawers=0.',
      suggestedAction: 'Seed with a checkpoint of current stack topology (runner :17330, AIUI, SuperServe control dirs).',
      source: 'mempalace',
    });
  }

  return suggestions;
}

async function runSelfAwarenessAudit() {
  const telemetry = getSystemTelemetry();
  const [palace, agentMonitor, sandbox] = await Promise.all([
    fetchMempalaceSignals(),
    fetchServiceHealth(AGENT_MONITOR_URL),
    fetchServiceHealth(SANDBOX_RUNNER_URL),
  ]);

  const serviceStatus = {
    mempalaceBridge: palace.online ? 'HEALTHY' : 'DEGRADED',
    agentMonitor: agentMonitor.ok ? 'HEALTHY' : 'DEGRADED',
    sandboxRunner: sandbox.ok ? 'HEALTHY' : 'DEGRADED',
  };

  const suggestions = [];

  if (telemetry.system.memUsagePct > 85) {
    suggestions.push({
      id: 'mem-high-pressure',
      category: 'System Performance',
      severity: 'HIGH',
      title: 'Memory Pressure Alert',
      observation: `System RAM usage is at ${telemetry.system.memUsagePct}% (${telemetry.system.usedMemGB}GB / ${telemetry.system.totalMemGB}GB)`,
      suggestedAction: 'Purge idle node_modules caches, restart heavy Vite processes, or increase swap.',
      source: 'system',
    });
  }

  suggestions.push(...buildPalaceSuggestions(palace));

  if (!agentMonitor.ok) {
    suggestions.push({
      id: 'agent-monitor-offline',
      category: 'Self-Improvement Telemetry',
      severity: 'LOW',
      title: 'Agent Response Monitor Idle',
      observation: `Agent response monitor daemon is inactive at ${AGENT_MONITOR_URL}`,
      suggestedAction: `Ensure agent monitor is up on DGX and reachable at ${AGENT_MONITOR_URL} (npm run monitor:agent).`,
      source: 'agent-monitor',
    });
  }

  if (!sandbox.ok) {
    suggestions.push({
      id: 'sandbox-runner-offline',
      category: 'Spark Runtime',
      severity: 'MEDIUM',
      title: 'Sandbox Runner Offline',
      observation: 'Spark ephemeral sandbox runner is not answering on :17330',
      suggestedAction: 'On Spark restart sandbox-runner.mjs (not auto-started after reboot).',
      source: 'sandbox-runner',
    });
  }

  const healthyCount = [palace.online, agentMonitor.ok, sandbox.ok].filter(Boolean).length;
  const palaceBonus =
    palace.online && palace.signals.testishDrawerShare < 0.5 && palace.signals.totalDrawers > 0 ? 10 : 0;
  const healthIndex = Math.min(
    100,
    Math.round((healthyCount / 3) * 60 + (telemetry.system.memUsagePct < 80 ? 20 : 8) + palaceBonus),
  );

  const report = {
    timestamp: Date.now(),
    healthIndex,
    serviceStatus,
    telemetry: telemetry.system,
    mempalace: {
      online: palace.online,
      signals: palace.signals,
      probes: palace.probes,
    },
    suggestionsCount: suggestions.length,
    suggestions,
    metaAwarenessDirective:
      suggestions.length === 0
        ? 'System operating at nominal self-improving performance. MemPalace + runtime pathways active.'
        : `Detected ${suggestions.length} enhancement areas (${
            suggestions.filter((s) => s.source === 'mempalace').length
          } from MemPalace). Review suggested actions.`,
  };

  historyRing.push({
    timestamp: report.timestamp,
    healthIndex: report.healthIndex,
    suggestionsCount: report.suggestionsCount,
    mempalaceDrawers: palace.signals.totalDrawers,
    mempalaceOnline: palace.online,
  });
  if (historyRing.length > RING_MAX) historyRing.shift();

  try {
    fs.writeFileSync(SUGGESTIONS_FILE, JSON.stringify(report, null, 2), 'utf8');
    fs.writeFileSync(METRICS_HISTORY_FILE, JSON.stringify(historyRing, null, 2), 'utf8');
  } catch {
    /* ignore */
  }

  return report;
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/health' || url.pathname === '/api/awareness') {
    const audit = await runSelfAwarenessAudit();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(audit, null, 2));
    return;
  }

  if (url.pathname === '/api/suggestions') {
    const audit = await runSelfAwarenessAudit();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify(
        {
          ok: true,
          suggestions: audit.suggestions,
          directive: audit.metaAwarenessDirective,
          mempalace: audit.mempalace,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (url.pathname === '/api/palace') {
    const palace = await fetchMempalaceSignals();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({ ok: true, mempalace: palace, suggestions: buildPalaceSuggestions(palace) }, null, 2),
    );
    return;
  }

  if (url.pathname === '/api/metrics') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, ring: historyRing }, null, 2));
    return;
  }

  if (url.pathname === '/api/remediate/prune-palace' && req.method === 'POST') {
    try {
      const { execSync } = await import('node:child_process');
      const scriptPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../memory/prune-mempalace-wings.mjs');
      const out = execSync(`node "${scriptPath}" --apply`, { encoding: 'utf-8' });
      const audit = await runSelfAwarenessAudit();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, output: out, audit }, null, 2));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Endpoint not found' }));
});

server.listen(PORT, HOST, () => {
  console.log(`[self-improvement] Meta-Awareness Monitor listening on http://${HOST}:${PORT}`);
  console.log(`[self-improvement] MemPalace probes: ${PALACE_PROBE_QUERIES.join(' | ')}`);
  runSelfAwarenessAudit().catch(() => {});
});

setInterval(() => {
  runSelfAwarenessAudit().catch(() => {});
}, 15000);
