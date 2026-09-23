#!/usr/bin/env node
/**
 * MemPalace MCP Bridge — exposes the mempalace-mcp stdio JSON-RPC server over HTTP.
 *
 * Listens on 0.0.0.0:17333 by default to serve both localhost and LAN/Tailscale hosts (e.g. DGX Spark).
 *
 * Local:  http://127.0.0.1:17333/health
 *         http://127.0.0.1:17333/mcp/search     (POST)
 *         http://127.0.0.1:17333/mcp/checkpoint  (POST)
 *         http://127.0.0.1:17333/mcp/status      (GET)
 */
import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.MEMPALACE_BRIDGE_PORT || 17333);
const HOST = process.env.MEMPALACE_BRIDGE_HOST || '0.0.0.0';

/** @type {import('child_process').ChildProcess | null} */
let mcpProc = null;
let mcpReady = false;
let mcpRestarting = false;

/** @type {Array<{method: string, params: any, resolve: (v:any)=>void, reject: (e:any)=>void}>} */
const rpcQueue = [];
let rpcProcessing = false;
let rpcBuffer = '';
let rpcNextId = 1;
/** @type {Map<number, {resolve: (v:any)=>void, reject: (e:any)=>void}>} */
const rpcPending = new Map();

function loadDotEnv() {
  for (const name of ['.env', '.env.local']) {
    const file = path.join(ROOT, name);
    if (!fs.existsSync(file)) continue;
    for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq < 1) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (key && process.env[key] == null) process.env[key] = val;
    }
  }
}

loadDotEnv();

function findMcpBinary() {
  if (process.env.MEMPALACE_MCP_BIN) return process.env.MEMPALACE_MCP_BIN;
  const home = process.env.HOME || '/Users';
  const candidates = [
    path.join(home, '.local/bin/mempalace-mcp'),
    '/usr/local/bin/mempalace-mcp',
    '/opt/homebrew/bin/mempalace-mcp',
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function startMcpSubprocess() {
  if (mcpRestarting) return;
  mcpRestarting = true;

  const bin = findMcpBinary();
  if (!bin) {
    console.warn('[mempalace-bridge] mempalace-mcp binary not found. Running in standalone fallback mode.');
    mcpRestarting = false;
    return;
  }

  console.log(`[mempalace-bridge] Spawning ${bin}`);
  const env = { ...process.env };
  const localBin = path.join(process.env.HOME || '', '.local/bin');
  if (localBin && !env.PATH?.includes(localBin)) {
    env.PATH = `${localBin}:${env.PATH || ''}`;
  }

  try {
    mcpProc = spawn(bin, [], {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    mcpProc.stdout?.on('data', (chunk) => {
      rpcBuffer += chunk.toString();
      let nl;
      while ((nl = rpcBuffer.indexOf('\n')) >= 0) {
        const line = rpcBuffer.slice(0, nl).trim();
        rpcBuffer = rpcBuffer.slice(nl + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line);
          handleRpcMessage(msg);
        } catch {
          // Non-JSON line — ignore
        }
      }
    });

    mcpProc.stderr?.on('data', (chunk) => {
      const text = chunk.toString().trim();
      if (text) console.error('[mempalace-mcp]', text);
    });

    mcpProc.on('exit', (code, signal) => {
      console.log(`[mempalace-bridge] mempalace-mcp exited (code=${code} signal=${signal})`);
      mcpReady = false;
      mcpProc = null;
      for (const [id, { reject }] of rpcPending) {
        reject(new Error('mempalace-mcp subprocess exited'));
      }
      rpcPending.clear();
      setTimeout(() => {
        mcpRestarting = false;
        startMcpSubprocess();
      }, 3000);
    });

    sendRpc('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'mempalace-bridge', version: '1.0' },
    }).then(() => {
      sendNotification('notifications/initialized', {});
      mcpReady = true;
      console.log('[mempalace-bridge] MCP handshake complete — palace ready');
      processRpcQueue();
    }).catch((err) => {
      console.error('[mempalace-bridge] MCP initialize failed:', err.message);
      mcpRestarting = false;
    });
  } catch (err) {
    console.error('[mempalace-bridge] Failed to spawn MCP process:', err.message);
    mcpRestarting = false;
  }
}

function handleRpcMessage(msg) {
  if (msg.id === undefined || msg.id === null) return;
  const pending = rpcPending.get(msg.id);
  if (!pending) return;
  rpcPending.delete(msg.id);
  if (msg.error) {
    pending.reject(Object.assign(new Error(msg.error.message || 'RPC error'), { rpcError: msg.error }));
  } else {
    pending.resolve(msg.result);
  }
  rpcProcessing = false;
  processRpcQueue();
}

function sendRpc(method, params) {
  return new Promise((resolve, reject) => {
    if (!mcpProc || !mcpProc.stdin) {
      reject(new Error('mempalace-mcp subprocess not running'));
      return;
    }
    const id = rpcNextId++;
    const msg = JSON.stringify({ jsonrpc: '2.0', method, params, id }) + '\n';
    rpcPending.set(id, { resolve, reject });
    mcpProc.stdin.write(msg);
    setTimeout(() => {
      if (rpcPending.has(id)) {
        rpcPending.delete(id);
        reject(new Error(`RPC timeout: ${method}`));
      }
    }, 30000);
  });
}

function sendNotification(method, params) {
  if (!mcpProc || !mcpProc.stdin) return;
  const msg = JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n';
  mcpProc.stdin.write(msg);
}

function callMcpTool(name, args) {
  return sendRpc('tools/call', { name, arguments: args || {} });
}

function processRpcQueue() {
  if (rpcProcessing || rpcQueue.length === 0 || !mcpReady) return;
  rpcProcessing = true;
  const { method, params, resolve, reject } = rpcQueue.shift();
  sendRpc(method, params).then(resolve).catch(reject).finally(() => {
    rpcProcessing = false;
    processRpcQueue();
  });
}

function enqueueRpc(method, params) {
  return new Promise((resolve, reject) => {
    rpcQueue.push({ method, params, resolve, reject });
    processRpcQueue();
  });
}

function cors(res, origin) {
  res.setHeader('Access-Control-Allow-Origin', origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('Vary', 'Origin');
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function callToolViaHttp(toolName, args, res) {
  if (!mcpReady) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, fallback: true, warning: 'MemPalace MCP subprocess offline; bridge active', results: [] }));
    return;
  }
  try {
    const result = await enqueueRpc('tools/call', { name: toolName, arguments: args });
    let text = '';
    if (result?.content && Array.isArray(result.content)) {
      text = result.content.map((c) => c.text || '').join('\n');
    }
    let parsed = text;
    try {
      parsed = JSON.parse(text);
    } catch {}
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: !result?.isError, result: parsed }));
  } catch (err) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: err.message || 'tool call failed' }));
  }
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || '*';
  cors(res, origin);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  // Health check
  if (pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      service: 'mempalace-bridge',
      port: PORT,
      host: HOST,
      mcpReady,
      mcpPid: mcpProc?.pid || null,
    }));
    return;
  }

  // Pull & Install CLI routes for network devices
  if ((pathname === '/install.sh' || pathname === '/aiui-install.sh') && req.method === 'GET') {
    const installScript = path.resolve(ROOT, 'scripts/install-device-cli.sh');
    if (fs.existsSync(installScript)) {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(fs.readFileSync(installScript, 'utf8'));
      return;
    }
  }

  if (pathname === '/dist/aiui-client.tar.gz' && req.method === 'GET') {
    const bundlePath = path.resolve(ROOT, 'dist/aiui-client.tar.gz');
    if (!fs.existsSync(bundlePath)) {
      const distDir = path.dirname(bundlePath);
      if (!fs.existsSync(distDir)) fs.mkdirSync(distDir, { recursive: true });
      try {
        const { execSync } = await import('node:child_process');
        execSync(`tar -czf "${bundlePath}" -C "${ROOT}" aiui bin package.json scripts`, { stdio: 'pipe' });
      } catch {}
    }
    if (fs.existsSync(bundlePath)) {
      res.writeHead(200, {
        'Content-Type': 'application/gzip',
        'Content-Length': fs.statSync(bundlePath).size,
      });
      fs.createReadStream(bundlePath).pipe(res);
      return;
    }
  }

  // MCP tool routes
  // MCP & API tool routes
  if ((pathname === '/mcp/status' || pathname === '/api/status') && req.method === 'GET') {
    await callToolViaHttp('mempalace_status', {}, res);
    return;
  }

  if (pathname === '/mcp/wings' && req.method === 'GET') {
    await callToolViaHttp('mempalace_list_wings', {}, res);
    return;
  }

  if ((pathname === '/mcp/search' || pathname === '/api/search' || pathname === '/api/memory/search')) {
    if (req.method === 'GET') {
      const q = url.searchParams.get('q') || url.searchParams.get('query') || '';
      const limit = parseInt(url.searchParams.get('limit') || '5', 10);
      const wing = url.searchParams.get('wing') || undefined;
      const room = url.searchParams.get('room') || undefined;
      await callToolViaHttp('mempalace_search', {
        query: q,
        limit,
        ...(wing ? { wing } : {}),
        ...(room ? { room } : {}),
      }, res);
      return;
    }

    if (req.method === 'POST') {
      const body = await readBody(req);
      try {
        const args = JSON.parse(body.toString());
        await callToolViaHttp('mempalace_search', {
          query: args.query || args.q || '',
          limit: args.limit || 5,
          ...(args.wing ? { wing: args.wing } : {}),
          ...(args.room ? { room: args.room } : {}),
        }, res);
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Invalid JSON body' }));
      }
      return;
    }
  }

  if (pathname === '/mcp/add-drawer' && req.method === 'POST') {
    const body = await readBody(req);
    try {
      const args = JSON.parse(body.toString());
      await callToolViaHttp('mempalace_add_drawer', {
        wing: args.wing,
        room: args.room,
        content: args.content,
        ...(args.added_by ? { added_by: args.added_by } : {}),
        ...(args.source_file ? { source_file: args.source_file } : {}),
      }, res);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Invalid JSON body' }));
    }
    return;
  }

  if (pathname === '/mcp/diary-write' && req.method === 'POST') {
    const body = await readBody(req);
    try {
      const args = JSON.parse(body.toString());
      await callToolViaHttp('mempalace_diary_write', {
        agent_name: args.agent_name,
        entry: args.entry,
        ...(args.topic ? { topic: args.topic } : {}),
        ...(args.wing ? { wing: args.wing } : {}),
      }, res);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Invalid JSON body' }));
    }
    return;
  }

  if (pathname === '/mcp/diary-read' && req.method === 'GET') {
    await callToolViaHttp('mempalace_diary_read', {
      agent_name: url.searchParams.get('agent_name') || '',
      last_n: parseInt(url.searchParams.get('last_n') || '10', 10),
      ...(url.searchParams.get('wing') ? { wing: url.searchParams.get('wing') } : {}),
    }, res);
    return;
  }

  if (pathname === '/mcp/kg-query' && req.method === 'POST') {
    const body = await readBody(req);
    try {
      const args = JSON.parse(body.toString());
      const direction = ['outgoing', 'incoming', 'both'].includes(args.direction) ? args.direction : 'both';
      await callToolViaHttp('mempalace_kg_query', {
        entity: args.entity,
        direction,
        ...(args.as_of ? { as_of: args.as_of } : {}),
      }, res);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Invalid JSON body' }));
    }
    return;
  }

  if (pathname === '/mcp/kg-add' && req.method === 'POST') {
    const body = await readBody(req);
    try {
      const args = JSON.parse(body.toString());
      await callToolViaHttp('mempalace_kg_add', {
        subject: args.subject,
        predicate: args.predicate,
        object: args.object,
        ...(args.valid_from ? { valid_from: args.valid_from } : {}),
      }, res);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Invalid JSON body' }));
    }
    return;
  }

  if (pathname === '/mcp/kg-invalidate' && req.method === 'POST') {
    const body = await readBody(req);
    try {
      const args = JSON.parse(body.toString());
      await callToolViaHttp('mempalace_kg_invalidate', {
        subject: args.subject,
        predicate: args.predicate,
        object: args.object,
        ...(args.ended ? { ended: args.ended } : {}),
      }, res);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Invalid JSON body' }));
    }
    return;
  }

  if (pathname === '/mcp/traverse' && req.method === 'POST') {
    const body = await readBody(req);
    try {
      const args = JSON.parse(body.toString());
      const hops = Number(args.max_hops ?? 2);
      await callToolViaHttp('mempalace_traverse', {
        start_room: args.start_room,
        max_hops: Math.min(2, Math.max(1, Number.isFinite(hops) ? hops : 2)),
      }, res);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Invalid JSON body' }));
    }
    return;
  }

  if (pathname === '/mcp/find-tunnels' && req.method === 'POST') {
    const body = await readBody(req);
    try {
      const args = JSON.parse(body.toString());
      await callToolViaHttp('mempalace_find_tunnels', {
        ...(args.wing_a ? { wing_a: args.wing_a } : {}),
        ...(args.wing_b ? { wing_b: args.wing_b } : {}),
      }, res);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Invalid JSON body' }));
    }
    return;
  }

  if ((pathname === '/mcp/checkpoint' || pathname === '/api/checkpoint' || pathname === '/api/memory/checkpoint') && req.method === 'POST') {
    const body = await readBody(req);
    try {
      const args = JSON.parse(body.toString());
      const items = Array.isArray(args.items)
        ? args.items
        : args.content
        ? [{ wing: args.wing || 'general', room: args.room || 'general', content: args.content }]
        : [];
      await callToolViaHttp('mempalace_checkpoint', {
        items,
        ...(args.diary ? { diary: args.diary } : {}),
        ...(args.dedup_threshold ? { dedup_threshold: args.dedup_threshold } : {}),
      }, res);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Invalid JSON body' }));
    }
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: false, error: `Unknown route: ${pathname}` }));
});

server.listen(PORT, HOST, () => {
  console.log(`[mempalace-bridge] Listening on http://${HOST}:${PORT}`);
  startMcpSubprocess();
});

process.on('SIGINT', () => {
  if (mcpProc) mcpProc.kill('SIGTERM');
  process.exit(0);
});
process.on('SIGTERM', () => {
  if (mcpProc) mcpProc.kill('SIGTERM');
  process.exit(0);
});
