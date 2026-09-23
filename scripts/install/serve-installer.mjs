#!/usr/bin/env node
/**
 * ⚡ AIUI Universal Installer Server
 * Listens on 0.0.0.0:17333 to serve install.sh and the client bundle
 * to any device across the LAN / WiFi / Tailscale mesh.
 *
 * Usage:
 *   node ./scripts/install/serve-installer.mjs
 *   npm run serve:install
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');
const PORT = Number(process.env.AIUI_INSTALL_PORT || process.env.MEMPALACE_BRIDGE_PORT || 17333);
const HOST = process.env.AIUI_INSTALL_HOST || '0.0.0.0';

function getLocalIpAddresses() {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        ips.push({ iface: name, ip: net.address });
      }
    }
  }
  return ips;
}

function ensureBundle() {
  const bundlePath = path.resolve(ROOT_DIR, 'dist/aiui-client.tar.gz');
  if (!fs.existsSync(bundlePath)) {
    const distDir = path.dirname(bundlePath);
    if (!fs.existsSync(distDir)) fs.mkdirSync(distDir, { recursive: true });
    try {
      execSync(`node "${path.resolve(__dirname, 'build-client-dist.mjs')}"`, {
        cwd: ROOT_DIR,
        stdio: 'inherit',
      });
    } catch (err) {
      console.error('[installer-server] Error building client bundle:', err.message);
    }
  }
  return bundlePath;
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  console.log(`[installer-server] ${req.method} ${pathname} from ${req.socket.remoteAddress}`);

  // Health check
  if (pathname === '/health' || pathname === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      service: 'aiui-installer-daemon',
      port: PORT,
      host: HOST,
      timestamp: new Date().toISOString(),
    }));
    return;
  }

  // Serve installer shell script
  if (pathname === '/install.sh' || pathname === '/install' || pathname === '/aiui-install.sh') {
    const installScript = path.resolve(ROOT_DIR, 'scripts/install-device-cli.sh');
    if (fs.existsSync(installScript)) {
      res.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache',
      });
      res.end(fs.readFileSync(installScript, 'utf8'));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('install-device-cli.sh not found');
    return;
  }

  // Serve client distribution tarball
  if (pathname === '/dist/aiui-client.tar.gz' || pathname === '/aiui-client.tar.gz') {
    const bundlePath = ensureBundle();
    if (fs.existsSync(bundlePath)) {
      const stat = fs.statSync(bundlePath);
      res.writeHead(200, {
        'Content-Type': 'application/gzip',
        'Content-Length': stat.size,
        'Cache-Control': 'no-cache',
      });
      fs.createReadStream(bundlePath).pipe(res);
      return;
    }
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Failed to generate bundle');
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Route not found');
});

server.listen(PORT, HOST, () => {
  const ips = getLocalIpAddresses();
  console.log('\n⚡ ================================================================');
  console.log(`⚡ AIUI PULL & INSTALL SERVER ONLINE`);
  console.log(`⚡ Listening on http://${HOST}:${PORT}`);
  console.log('⚡ ================================================================');
  console.log('\nRun on ANY machine across the network:');
  for (const item of ips) {
    console.log(`  curl -fsSL http://${item.ip}:${PORT}/install.sh | bash`);
  }
  console.log(`\nLocalhost testing:`);
  console.log(`  curl -fsSL http://localhost:${PORT}/install.sh | bash\n`);
});
