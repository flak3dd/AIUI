#!/usr/bin/env node
import os from 'node:os';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const home = process.env.HOME || os.homedir();
const keyCandidates = [
  path.resolve(home, 'Library/Application Support/NVIDIA/Sync/config/nvsync.key'),
  path.resolve(home, '.ssh/nvsync.key'),
  path.resolve(home, '.ssh/id_ed25519'),
  path.resolve(home, '.ssh/id_rsa'),
  path.resolve(home, '.ssh/spark.key'),
];
const SSH_KEY = keyCandidates.find((c) => fs.existsSync(c)) || '';

function probePort(host, port, timeoutMs = 400) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let status = false;

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => {
      status = true;
      socket.destroy();
      resolve(true);
    });

    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });

    socket.once('error', () => {
      socket.destroy();
      resolve(false);
    });

    socket.connect(port, host);
  });
}

function testSsh(host, user = 'flak3dd', timeoutMs = 4000) {
  return new Promise((resolve) => {
    const args = [
      '-o', 'BatchMode=yes',
      '-o', `ConnectTimeout=${Math.ceil(timeoutMs / 1000)}`,
      '-o', 'StrictHostKeyChecking=no',
    ];
    if (SSH_KEY) {
      args.push('-i', SSH_KEY);
    }
    args.push(`${user}@${host}`, 'hostname');

    const child = spawn('ssh', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    const timer = setTimeout(() => {
      try { child.kill('SIGTERM'); } catch {}
      resolve({ ok: false, error: 'Timed out' });
    }, timeoutMs);

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, hostname: stdout.trim() });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ ok: false, error: err.message });
    });
  });
}

async function main() {
  console.log('====================================================');
  console.log('🔍 SCANNING LOCAL SUBNET FOR DGX SPARK MACHINE');
  console.log('====================================================\n');

  // Detect Mac's local subnet
  const nets = os.networkInterfaces();
  const subnets = new Set();

  for (const name of Object.keys(nets)) {
    for (const netInfo of nets[name] || []) {
      if (
        netInfo.family === 'IPv4' &&
        !netInfo.internal &&
        (netInfo.address.startsWith('192.168.') ||
          netInfo.address.startsWith('10.') ||
          /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(netInfo.address))
      ) {
        const parts = netInfo.address.split('.');
        subnets.add(`${parts[0]}.${parts[1]}.${parts[2]}`);
        console.log(`• Mac Network Interface: ${name} (${netInfo.address})`);
      }
    }
  }

  if (subnets.size === 0) {
    subnets.add('192.168.4');
  }

  for (const prefix of subnets) {
    console.log(`\n• Scanning subnet ${prefix}.1 - ${prefix}.254 on ports 22 (SSH) & 8000 (vLLM)...`);
    const openHosts = [];

    // Probe in concurrent chunks of 25
    const ips = Array.from({ length: 254 }, (_, i) => `${prefix}.${i + 1}`);
    const chunkSize = 35;

    for (let i = 0; i < ips.length; i += chunkSize) {
      const chunk = ips.slice(i, i + chunkSize);
      const results = await Promise.all(
        chunk.map(async (ip) => {
          const [sshOpen, vllmOpen] = await Promise.all([
            probePort(ip, 22, 500),
            probePort(ip, 8000, 500),
          ]);
          return { ip, sshOpen, vllmOpen };
        })
      );

      for (const res of results) {
        if (res.sshOpen || res.vllmOpen) {
          openHosts.push(res);
          const services = [];
          if (res.sshOpen) services.push('Port 22 (SSH)');
          if (res.vllmOpen) services.push('Port 8000 (vLLM)');
          console.log(`   ✔ Host responded at ${res.ip}: [${services.join(', ')}]`);
        }
      }
    }

    if (openHosts.length === 0) {
      console.log(`   ❌ No responsive hosts found on subnet ${prefix}.* with port 22 or 8000 open.`);
      continue;
    }

    console.log(`\n• Testing SSH authentication on responsive hosts...`);
    let foundSpark = null;

    for (const hostInfo of openHosts) {
      if (hostInfo.sshOpen) {
        process.stdout.write(`   • Authenticating flak3dd@${hostInfo.ip}... `);
        const res = await testSsh(hostInfo.ip, 'flak3dd');
        if (res.ok) {
          console.log(`MATCHED! Hostname: "${res.hostname}" 🎯`);
          foundSpark = { ip: hostInfo.ip, hostname: res.hostname };
          break;
        } else {
          console.log(`failed`);
        }
      }
    }

    if (foundSpark) {
      console.log('\n====================================================');
      console.log(`🎉 DGX SPARK LOCATED AT: ${foundSpark.ip} (${foundSpark.hostname})`);
      console.log('====================================================');
      console.log('\nTo restart Spark on this IP, run:');
      console.log(`  export SPARK_HOST=${foundSpark.ip} && npm run spark:restart\n`);
      console.log('Or update your .env:');
      console.log(`  VITE_SPARK_HOST=${foundSpark.ip}\n`);
      return;
    }
  }

  console.log('\n====================================================');
  console.log('❌ DGX Spark was not found on the active subnet.');
  console.log('====================================================');
  console.log('Next checks:');
  console.log('1. Is the DGX Spark machine physically turned ON? (Check power LED/fans)');
  console.log('2. Is the Ethernet/Wi-Fi connected to the same router as this Mac?');
  console.log('3. If using NVIDIA Sync, ensure the NVIDIA Sync app is running.');
  console.log('====================================================\n');
}

main().catch(console.error);
