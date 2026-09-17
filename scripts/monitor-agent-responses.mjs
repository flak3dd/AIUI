#!/usr/bin/env node
/**
 * ==============================================================================
 * AI AGENT RESPONSE DEBUG MONITOR
 * ==============================================================================
 * Real-time monitoring, telemetry capture, and diagnostic tool for AI agent
 * responses, tool executions, streaming latencies, and anti-loop detection.
 *
 * Usage:
 *   node ./scripts/monitor-agent-responses.mjs           # Start daemon / live monitor
 *   node ./scripts/monitor-agent-responses.mjs --probe   # Run live agent response test probe
 *   node ./scripts/monitor-agent-responses.mjs --tail    # Print recent agent response logs
 *   node ./scripts/monitor-agent-responses.mjs --once    # Snapshot status and exit
 * ==============================================================================
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const LOG_DIR = path.resolve(ROOT, 'logs');

const PORT = Number(process.env.AGENT_MONITOR_PORT || 17335);
const HOST = process.env.AGENT_MONITOR_HOST || '127.0.0.1';

const JSONL_LOG = path.join(LOG_DIR, 'agent-responses.jsonl');
const HUMAN_LOG = path.join(LOG_DIR, 'agent-responses.log');
const PID_FILE = path.join(LOG_DIR, 'monitor-agent.pid');

if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

// ANSI Color Helpers
const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m',
  white: '\x1b[37m',
  brightCyan: '\x1b[96m',
  brightGreen: '\x1b[92m',
  brightYellow: '\x1b[93m',
  brightRed: '\x1b[91m',
  bgDark: '\x1b[40m',
};

// In-Memory Ring Buffer for Recent Events
const RING_LIMIT = 100;
const eventRing = [];
const sseSubscribers = new Set();

function formatTime(ts = Date.now()) {
  const d = new Date(ts);
  return d.toTimeString().split(' ')[0] + '.' + String(d.getMilliseconds()).padStart(3, '0');
}

function writeLogs(event) {
  try {
    const rawLine = JSON.stringify(event) + '\n';
    fs.appendFileSync(JSONL_LOG, rawLine, 'utf8');

    const humanEntry = formatHumanLog(event);
    fs.appendFileSync(HUMAN_LOG, humanEntry + '\n', 'utf8');
  } catch (err) {
    console.error('Error writing to log file:', err.message);
  }
}

function formatHumanLog(e) {
  const t = formatTime(e.timestamp);
  switch (e.type) {
    case 'request':
      return `[${t}] [REQ] Model: ${e.model || 'unknown'} | Provider: ${e.provider || 'default'} | Round: ${e.round || 1}\n  User Prompt: "${(e.userPrompt || '').replace(/\n/g, ' ')}"`;
    case 'response':
      return `[${t}] [RESP] Model: ${e.model || 'unknown'} | ${e.durationMs || 0}ms | Tokens: ~${e.tokens || (e.responseText?.length ? Math.round(e.responseText.length / 4) : 0)}\n  Assistant: ${(e.responseText || '').slice(0, 300)}${e.responseText?.length > 300 ? '...' : ''}`;
    case 'thinking':
      return `[${t}] [THINK] Reasoning Trace: ${(e.thinking || '').slice(0, 200)}...`;
    case 'tool_call':
      return `[${t}] [TOOL_CALL] Tool: ${e.toolName} | Target: ${e.target || 'local'}\n  Args: ${typeof e.toolArgs === 'object' ? JSON.stringify(e.toolArgs) : e.toolArgs}`;
    case 'tool_result':
      return `[${t}] [TOOL_RESULT] Tool: ${e.toolName} | Exit: ${e.exitCode ?? 0} | Ok: ${e.exitCode === 0}\n  Output: ${(e.stdout || e.stderr || '').slice(0, 300)}`;
    case 'anti_loop': {
      const a = e.analysis || {};
      return `[${t}] [ANTI_LOOP] Looping: ${a.isLooping} | Stage: ${a.stage || 'unknown'} | LoopType: ${a.loopType || 'none'}\n  Summary: ${a.progressSummary || 'No summary'}`;
    }
    case 'error':
      return `[${t}] [ERROR] Model: ${e.model || ''} | Error: ${e.error || 'Unknown error'}`;
    default:
      return `[${t}] [EVENT:${e.type}] ${JSON.stringify(e)}`;
  }
}

function printToConsole(e) {
  const t = `${C.dim}${formatTime(e.timestamp)}${C.reset}`;
  switch (e.type) {
    case 'request':
      console.log(`\n${C.bold}${C.cyan}🤖 [AGENT REQUEST]${C.reset} ${t} ${C.brightCyan}${e.model || 'unknown'}${C.reset} (Round ${e.round || 1})`);
      if (e.provider) console.log(`   ${C.dim}Provider:${C.reset} ${e.provider}`);
      if (e.userPrompt) {
        const preview = e.userPrompt.length > 240 ? e.userPrompt.slice(0, 240) + '...' : e.userPrompt;
        console.log(`   ${C.dim}Prompt:${C.reset} ${C.white}"${preview.replace(/\n/g, ' ')}"${C.reset}`);
      }
      break;

    case 'thinking':
      console.log(`${C.magenta}🧠 [AGENT THINKING]${C.reset} ${t}`);
      if (e.thinking) {
        console.log(`   ${C.dim}${e.thinking.slice(0, 300).replace(/\n/g, ' ')}...${C.reset}`);
      }
      break;

    case 'response': {
      const ms = e.durationMs != null ? `${e.durationMs}ms` : '';
      const tokens = e.tokens ? `${e.tokens} tokens` : (e.responseText ? `~${Math.round(e.responseText.length / 4)} tokens` : '');
      const stats = [ms, tokens].filter(Boolean).join(' • ');
      console.log(`${C.bold}${C.green}⚡ [AGENT RESPONSE]${C.reset} ${t} ${stats ? `${C.dim}(${stats})${C.reset}` : ''}`);
      if (e.responseText) {
        const preview = e.responseText.length > 400 ? e.responseText.slice(0, 400) + `${C.dim}... [${e.responseText.length - 400} chars more]${C.reset}` : e.responseText;
        console.log(`   ${C.white}${preview.replace(/\n/g, '\n   ')}${C.reset}`);
      }
      break;
    }

    case 'tool_call': {
      console.log(`${C.bold}${C.yellow}🛠️  [TOOL CALL]${C.reset} ${t} ${C.brightYellow}${e.toolName}${C.reset} ${e.target ? `${C.dim}(target: ${e.target})${C.reset}` : ''}`);
      const argsStr = typeof e.toolArgs === 'object' ? JSON.stringify(e.toolArgs) : String(e.toolArgs || '');
      if (argsStr && argsStr !== '{}') {
        console.log(`   ${C.dim}Args:${C.reset} ${argsStr.slice(0, 200)}`);
      }
      break;
    }

    case 'tool_result': {
      const ok = e.exitCode === 0 || (!e.exitCode && !e.error);
      const badge = ok ? `${C.green}SUCCESS (0)${C.reset}` : `${C.red}FAIL (${e.exitCode || 1})${C.reset}`;
      console.log(`${C.bold}${C.blue}📦 [TOOL RESULT]${C.reset} ${t} ${C.brightCyan}${e.toolName}${C.reset} -> ${badge}`);
      const out = (e.stdout || e.stderr || e.rawResult || '').trim();
      if (out) {
        const preview = out.length > 300 ? out.slice(0, 300) + '...' : out;
        console.log(`   ${C.dim}Output:${C.reset} ${preview.replace(/\n/g, '\n   ')}`);
      }
      break;
    }

    case 'anti_loop': {
      const a = e.analysis || {};
      if (a.isLooping) {
        console.log(`${C.bold}${C.brightYellow}⚠️  [ANTI-LOOP ALERT]${C.reset} ${t} Loop detected: ${C.red}${a.loopType || 'stalled'}${C.reset} (Repeats: ${a.repeatCount || 1})`);
        console.log(`   ${C.yellow}Directive:${C.reset} ${a.progressSummary || a.suggestedAction || 'Pivot execution strategy'}`);
      } else {
        console.log(`${C.dim}🔄 [LOOP CHECK] ${t} Progress: ${a.progressMade ? 'YES' : 'NONE'} | Stage: ${a.stage || 'normal'} | ${a.directionSummary || 'on track'}${C.reset}`);
      }
      break;
    }

    case 'error':
      console.log(`${C.bold}${C.brightRed}❌ [AGENT ERROR]${C.reset} ${t} ${e.model ? `${C.cyan}[${e.model}]${C.reset} ` : ''}${C.red}${e.error || 'Unknown error'}${C.reset}`);
      break;

    default:
      console.log(`[${t}] [${e.type || 'INFO'}]`, JSON.stringify(e));
  }
}

function recordEvent(evt) {
  const event = {
    timestamp: Date.now(),
    ...evt,
  };

  eventRing.push(event);
  if (eventRing.length > RING_LIMIT) {
    eventRing.shift();
  }

  writeLogs(event);
  printToConsole(event);

  // Broadcast to live SSE subscribers
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of sseSubscribers) {
    try {
      client.write(payload);
    } catch {
      sseSubscribers.delete(client);
    }
  }
}

// -----------------------------------------------------------------------------
// HTTP Server (Telemetry Ingestion & SSE streaming)
// -----------------------------------------------------------------------------
function startServer() {
  const server = http.createServer((req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    // Health check
    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        service: 'agent-response-monitor',
        port: PORT,
        uptimeSeconds: Math.round(process.uptime()),
        totalRecordedEvents: eventRing.length,
        jsonlPath: JSONL_LOG,
        humanLogPath: HUMAN_LOG,
      }));
      return;
    }

    // Live SSE stream
    if (url.pathname === '/api/agent/stream') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      res.write(': agent monitor sse connected\n\n');
      sseSubscribers.add(res);
      req.on('close', () => sseSubscribers.delete(res));
      return;
    }

    // Get recent events
    if (url.pathname === '/api/agent/recent' || url.pathname === '/api/agent/events') {
      const limit = Math.min(100, Number(url.searchParams.get('limit')) || 30);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        events: eventRing.slice(-limit),
      }));
      return;
    }

    // Post agent telemetry event
    if (url.pathname === '/api/agent/event' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body || '{}');
          recordEvent(parsed);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
        }
      });
      return;
    }

    // Trigger test probe
    if (url.pathname === '/api/agent/probe' && req.method === 'POST') {
      runProbe()
        .then((result) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        })
        .catch((err) => {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: err.message }));
        });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'Not found' }));
  });

  server.listen(PORT, HOST, () => {
    fs.writeFileSync(PID_FILE, String(process.pid));
    console.log(`\n${C.bold}${C.brightGreen}======================================================================${C.reset}`);
    console.log(`${C.bold}${C.brightGreen}⚡ AI AGENT RESPONSE DEBUG MONITOR ACTIVE${C.reset}`);
    console.log(`${C.bold}${C.brightGreen}======================================================================${C.reset}`);
    console.log(`  • Telemetry Ingestion:  ${C.cyan}http://${HOST}:${PORT}/api/agent/event${C.reset}`);
    console.log(`  • SSE Live Feed:        ${C.cyan}http://${HOST}:${PORT}/api/agent/stream${C.reset}`);
    console.log(`  • Recent Events API:    ${C.cyan}http://${HOST}:${PORT}/api/agent/recent${C.reset}`);
    console.log(`  • Health Status:        ${C.cyan}http://${HOST}:${PORT}/health${C.reset}`);
    console.log(`  • Structured JSONL:     ${C.dim}${JSONL_LOG}${C.reset}`);
    console.log(`  • Human Debug Log:      ${C.dim}${HUMAN_LOG}${C.reset}`);
    console.log(`  • PID:                  ${C.yellow}${process.pid}${C.reset}`);
    console.log(`${C.bold}${C.brightGreen}======================================================================${C.reset}\n`);
    console.log(`${C.dim}Listening for real-time agent responses, tool calls, and anti-loop metrics...${C.reset}\n`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`${C.red}Error: Port ${PORT} already in use. Monitor may already be running.${C.reset}`);
      process.exit(1);
    }
    console.error('Server error:', err);
  });

  // Watcher for external log entries in jsonl
  watchExternalLogs();
}

function watchExternalLogs() {
  // If external processes append to JSONL_LOG, we don't need to re-read what we write,
  // but if other log files in abliterated_ui or AIUI exist, tail them.
  const otherLogs = [
    path.resolve(ROOT, '../abliterated_ui/logs/agent-debug.jsonl'),
  ];
  for (const f of otherLogs) {
    if (fs.existsSync(f)) {
      try {
        let size = fs.statSync(f).size;
        fs.watchFile(f, { interval: 1000 }, (curr) => {
          if (curr.size > size) {
            const stream = fs.createReadStream(f, { start: size, end: curr.size });
            let buffer = '';
            stream.on('data', (c) => { buffer += c.toString('utf8'); });
            stream.on('end', () => {
              for (const line of buffer.split('\n')) {
                if (!line.trim()) continue;
                try {
                  const data = JSON.parse(line);
                  printToConsole(data);
                } catch {}
              }
            });
            size = curr.size;
          }
        });
      } catch {}
    }
  }
}

// -----------------------------------------------------------------------------
// Live Test Probe
// -----------------------------------------------------------------------------
async function runProbe() {
  console.log(`\n${C.bold}${C.cyan}🔍 [DIAGNOSTIC PROBE] Testing AI Agent Response Pipeline...${C.reset}`);

  // Load .env keys if present
  let apiKey = '';
  let provider = 'featherless';
  let baseUrl = 'https://api.featherless.ai/v1';
  let model = 'Qwen/Qwen2.5-7B-Instruct';

  const envPath = path.join(ROOT, '.env');
  if (fs.existsSync(envPath)) {
    const raw = fs.readFileSync(envPath, 'utf8');
    for (const line of raw.split('\n')) {
      const match = line.match(/^([^=]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        const val = match[2].trim().replace(/^["']|["']$/g, '');
        if (key === 'VITE_DEFAULT_PROVIDER') provider = val;
        if (key === 'VITE_FEATHERLESS_API_KEY') apiKey = val;
        if (key === 'VITE_FEATHERLESS_BASE_URL') baseUrl = val;
      }
    }
  }

  console.log(`  • Provider: ${provider}`);
  console.log(`  • Base URL: ${baseUrl}`);
  console.log(`  • Model:    ${model}`);
  console.log(`  • Key:      ${apiKey ? apiKey.slice(0, 6) + '...' + apiKey.slice(-4) : 'NONE'}`);

  const probePayload = {
    model,
    messages: [
      { role: 'system', content: 'You are a fast diagnostic responder. Reply in under 20 words.' },
      { role: 'user', content: 'Ping! Respond with: AGENT PIPELINE VERIFIED and current status.' },
    ],
    max_tokens: 60,
    temperature: 0.2,
    stream: true,
  };

  const startTime = Date.now();
  recordEvent({
    type: 'request',
    model,
    provider,
    round: 1,
    userPrompt: 'Ping! Respond with: AGENT PIPELINE VERIFIED and current status.',
  });

  try {
    const fetchUrl = `${baseUrl}/chat/completions`;
    const res = await fetch(fetchUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'text/event-stream',
      },
      body: JSON.stringify(probePayload),
    });

    if (!res.ok) {
      const errText = await res.text();
      const errEvt = {
        type: 'error',
        model,
        error: `HTTP ${res.status}: ${errText.slice(0, 300)}`,
      };
      recordEvent(errEvt);
      return { ok: false, status: res.status, error: errText };
    }

    let responseText = '';
    let firstTokenTime = null;
    let tokenCount = 0;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('data: ') && !trimmed.includes('[DONE]')) {
          try {
            const data = JSON.parse(trimmed.slice(6));
            const delta = data.choices?.[0]?.delta?.content;
            if (delta) {
              if (firstTokenTime === null) firstTokenTime = Date.now() - startTime;
              responseText += delta;
              tokenCount++;
            }
          } catch {}
        }
      }
    }

    const durationMs = Date.now() - startTime;
    const respEvt = {
      type: 'response',
      model,
      responseText,
      durationMs,
      tokens: tokenCount,
      ttftMs: firstTokenTime,
    };
    recordEvent(respEvt);

    console.log(`\n${C.bold}${C.brightGreen}✅ Probe Success!${C.reset}`);
    console.log(`  • TTFT (Time to first token): ${firstTokenTime}ms`);
    console.log(`  • Total Duration:            ${durationMs}ms`);
    console.log(`  • Tokens:                    ${tokenCount}`);
    console.log(`  • Content:                   "${responseText.trim()}"\n`);

    return {
      ok: true,
      durationMs,
      ttftMs: firstTokenTime,
      tokenCount,
      response: responseText,
    };
  } catch (err) {
    const errEvt = {
      type: 'error',
      model,
      error: err.message,
    };
    recordEvent(errEvt);
    console.error(`\n${C.bold}${C.red}❌ Probe Failed:${C.reset}`, err.message);
    return { ok: false, error: err.message };
  }
}

// -----------------------------------------------------------------------------
// Tail Recent Logs
// -----------------------------------------------------------------------------
function tailLogs(numLines = 25) {
  if (!fs.existsSync(HUMAN_LOG)) {
    console.log(`${C.yellow}No logs found at ${HUMAN_LOG}${C.reset}`);
    return;
  }
  const content = fs.readFileSync(HUMAN_LOG, 'utf8');
  const lines = content.trim().split('\n');
  const recent = lines.slice(-numLines);
  console.log(`\n${C.bold}${C.cyan}--- Last ${recent.length} Log Entries (${HUMAN_LOG}) ---${C.reset}\n`);
  console.log(recent.join('\n'));
}

// -----------------------------------------------------------------------------
// CLI Argument Dispatcher
// -----------------------------------------------------------------------------
const args = process.argv.slice(2);

function cleanup() {
  try {
    if (fs.existsSync(PID_FILE)) {
      const pid = fs.readFileSync(PID_FILE, 'utf8').trim();
      if (pid === String(process.pid)) {
        fs.unlinkSync(PID_FILE);
      }
    }
  } catch {}
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

if (args.includes('--probe')) {
  runProbe().then((res) => {
    process.exit(res.ok ? 0 : 1);
  });
} else if (args.includes('--tail')) {
  const count = Number(args[args.indexOf('--tail') + 1]) || 30;
  tailLogs(count);
  process.exit(0);
} else if (args.includes('--once')) {
  fetch(`http://${HOST}:${PORT}/health`)
    .then((r) => r.json())
    .then((data) => {
      console.log(JSON.stringify(data, null, 2));
      process.exit(0);
    })
    .catch(() => {
      console.log(`Agent monitor is currently offline on http://${HOST}:${PORT}`);
      process.exit(1);
    });
} else {
  startServer();
}
