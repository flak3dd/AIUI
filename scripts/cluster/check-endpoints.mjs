#!/usr/bin/env node
/**
 * ==============================================================================
 * COMPREHENSIVE ENDPOINT HEALTH & DIAGNOSTIC AUDITOR
 * ==============================================================================
 * Tests and verifies all local and remote endpoints across the AIUI architecture:
 * - Frontend Web Dev Server (:5173 / :5174)
 * - Sandbox Runner (:17330)
 * - SpaceDrop / Key Proxy (:17332)
 * - MemPalace Context Engine (:17333)
 * - Agent Telemetry Monitor (:17335)
 * - Self-Awareness Daemon (:17336)
 * - Chat Response Optimizer (:17337)
 * - Remote GX10 Spark vLLM (192.168.4.103:8000)
 * ==============================================================================
 */

import http from 'node:http';

const TIMEOUT_MS = 4000;

async function probeEndpoint({ name, url, method = 'GET', body = null, headers = {} }) {
  const start = Date.now();
  return new Promise((resolve) => {
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch (e) {
      return resolve({
        name,
        url,
        status: 'INVALID_URL',
        code: 0,
        latencyMs: 0,
        ok: false,
        error: e.message,
      });
    }

    const reqOpts = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method,
      headers: {
        'User-Agent': 'AIUI-Endpoint-Checker/1.0',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      timeout: TIMEOUT_MS,
    };

    const req = http.request(reqOpts, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        const latencyMs = Date.now() - start;
        let json = null;
        try {
          json = JSON.parse(data);
        } catch {}

        resolve({
          name,
          url,
          code: res.statusCode,
          latencyMs,
          ok: res.statusCode >= 200 && res.statusCode < 400,
          data: json,
          raw: data.slice(0, 150),
        });
      });
    });

    req.on('error', (err) => {
      resolve({
        name,
        url,
        code: 0,
        latencyMs: Date.now() - start,
        ok: false,
        error: err.code || err.message,
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({
        name,
        url,
        code: 0,
        latencyMs: TIMEOUT_MS,
        ok: false,
        error: 'TIMED_OUT',
      });
    });

    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

const ENDPOINTS_TO_CHECK = [
  // 1. Web Frontend UI
  { name: 'Vite UI (Primary :5173)', url: 'http://127.0.0.1:5173/' },

  // 2. Ephemeral Sandbox Runner (:17330)
  { name: 'Sandbox /health', url: 'http://127.0.0.1:17330/health' },
  { name: 'Sandbox /api/sandbox/health', url: 'http://127.0.0.1:17330/api/sandbox/health' },
  {
    name: 'Sandbox /api/sandbox/exec',
    url: 'http://127.0.0.1:17330/api/sandbox/exec',
    method: 'POST',
    body: { envId: 'probe', cmd: 'echo "sandbox-runner-live"', target: 'dgx_spark' },
  },
  { name: 'Sandbox /api/sandbox/container/list', url: 'http://127.0.0.1:17330/api/sandbox/container/list' },
  { name: 'Sandbox /api/sandbox/jobs', url: 'http://127.0.0.1:17330/api/sandbox/jobs' },
  { name: 'Sandbox /api/tools/dynamic', url: 'http://127.0.0.1:17330/api/tools/dynamic' },

  // 3. Cloud Key / SpaceDrop Proxy (:17332)
  { name: 'Cloud Key Proxy /health', url: 'http://127.0.0.1:17332/health' },
  { name: 'Cloud Key Proxy /spark/health', url: 'http://127.0.0.1:17332/spark/health' },

  // 4. MemPalace Memory Engine (:17333)
  { name: 'MemPalace /health', url: 'http://127.0.0.1:17333/health' },
  { name: 'MemPalace /mcp/status', url: 'http://127.0.0.1:17333/mcp/status' },
  {
    name: 'MemPalace /mcp/search',
    url: 'http://127.0.0.1:17333/mcp/search',
    method: 'POST',
    body: { query: 'test', limit: 1 },
  },

  // 5. Agent Telemetry Monitor (:17335)
  { name: 'Agent Telemetry Monitor (:17335)', url: 'http://127.0.0.1:17335/health' },

  // 6. Self-Awareness Monitor (:17336)
  { name: 'Self-Awareness Monitor (:17336)', url: 'http://127.0.0.1:17336/health' },

  // 7. Chat Response Optimizer (:17337)
  { name: 'Chat Optimizer Policy (:17337)', url: 'http://127.0.0.1:17337/api/policy' },

  // 8. Spark vLLM on both NICs, plus the UI switch proxies
  { name: 'vLLM LAN /health', url: 'http://192.168.4.103:8000/health' },
  { name: 'vLLM LAN /v1/models', url: 'http://192.168.4.103:8000/v1/models' },
  { name: 'vLLM Tailscale /health', url: 'http://100.66.147.53:8000/health' },
  { name: 'vLLM Tailscale /v1/models', url: 'http://100.66.147.53:8000/v1/models' },
  { name: 'Vite /vllm-lan/v1/models', url: 'http://127.0.0.1:5173/vllm-lan/v1/models' },
  { name: 'Vite /vllm-ts/v1/models', url: 'http://127.0.0.1:5173/vllm-ts/v1/models' },
  { name: 'Vite /spark-vllm/v1/models', url: 'http://127.0.0.1:5173/spark-vllm/v1/models' },
  { name: 'Proxy spark LAN models', url: 'http://127.0.0.1:17332/spark/192.168.4.103/8000/v1/models' },
  { name: 'Proxy spark Tailscale models', url: 'http://127.0.0.1:17332/spark/100.66.147.53/8000/v1/models' },
];

async function main() {
  console.log('\n========================================================================');
  console.log('📡 AIUI ARCHITECTURE & ENDPOINT HEALTH AUDIT');
  console.log('========================================================================\n');

  const results = await Promise.all(ENDPOINTS_TO_CHECK.map(probeEndpoint));

  let onlineCount = 0;
  let offlineCount = 0;

  console.log(
    'STATUS'.padEnd(10) +
    'CODE'.padEnd(7) +
    'LATENCY'.padEnd(10) +
    'SERVICE & ENDPOINT'.padEnd(36) +
    'DETAILS'
  );
  console.log('-'.repeat(85));

  for (const r of results) {
    if (r.ok) {
      onlineCount++;
      const statusStr = '\x1b[32m✔ ONLINE\x1b[0m'.padEnd(19);
      const codeStr = String(r.code).padEnd(7);
      const latStr = `${r.latencyMs}ms`.padEnd(10);
      const nameStr = r.name.padEnd(36);

      let detail = '';
      if (r.data) {
        if (r.data.status) detail = `status: ${r.data.status}`;
        else if (r.data.tools) detail = `${Object.keys(r.data.tools).length} tools loaded`;
        else if (r.data.models) detail = `${r.data.models.length || 0} models`;
        else if (r.data.data && Array.isArray(r.data.data)) detail = `${r.data.data.map(m => m.id).join(', ')}`;
        else if (r.data.policy) detail = `gen: ${r.data.policy.generation || 0}`;
        else if (r.data.rows) detail = `${r.data.rows.length} rows returned`;
        else if (r.data.stdout) detail = `stdout: "${r.data.stdout.trim()}"`;
        else detail = JSON.stringify(r.data).slice(0, 45);
      } else if (r.raw) {
        detail = r.raw.slice(0, 45).replace(/\s+/g, ' ');
      }

      console.log(`${statusStr}${codeStr}${latStr}${nameStr}${detail}`);
    } else {
      offlineCount++;
      const statusStr = '\x1b[31m✘ OFFLINE\x1b[0m'.padEnd(19);
      const codeStr = (r.code ? String(r.code) : '---').padEnd(7);
      const latStr = `${r.latencyMs}ms`.padEnd(10);
      const nameStr = r.name.padEnd(36);
      const detail = `\x1b[90m${r.error || (r.code ? `HTTP ${r.code}` : 'Unavailable')}\x1b[0m`;

      console.log(`${statusStr}${codeStr}${latStr}${nameStr}${detail}`);
    }
  }

  console.log('-'.repeat(85));
  console.log(`\nSummary: \x1b[32m${onlineCount} Online\x1b[0m | \x1b[31m${offlineCount} Offline / Standby\x1b[0m out of ${results.length} tested endpoints.`);

  if (offlineCount > 0) {
    console.log('\n🔧 \x1b[1mSelf-Healing & Service Recovery Recommendations:\x1b[0m');
    const offlineNames = results.filter(r => !r.ok).map(r => r.name);
    if (offlineNames.some(n => n.includes('17335'))) {
      console.log('  • Start Agent Monitor (:17335):        npm run monitor:agent');
    }
    if (offlineNames.some(n => n.includes('17336'))) {
      console.log('  • Start Self-Awareness (:17336):       npm run monitor:self-awareness');
    }
    if (offlineNames.some(n => n.includes('17337'))) {
      console.log('  • Start Chat Optimizer (:17337):       npm run optimize');
    }
    if (offlineNames.some(n => n.includes('17333'))) {
      console.log('  • Start MemPalace Bridge (:17333):     node scripts/mempalace-bridge.mjs');
    }
    if (offlineNames.some(n => n.includes('17330'))) {
      console.log('  • Start Sandbox Runner (:17330):       node scripts/sandbox-runner.mjs');
    }
    console.log('');
  }
}

main().catch((err) => {
  console.error('Audit failed:', err);
  process.exit(1);
});
