#!/usr/bin/env node
import http from 'node:http';

function requestJson(urlStr, options = {}, data = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const reqOpts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
      timeout: options.timeout || 120000,
    };

    const req = http.request(reqOpts, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          const json = body ? JSON.parse(body) : null;
          resolve({ status: res.statusCode, data: json, raw: body });
        } catch {
          resolve({ status: res.statusCode, raw: body });
        }
      });
    });

    req.on('error', (err) => resolve({ error: err.message, status: 0 }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ error: 'Request timed out', status: 0 });
    });

    if (data) {
      req.write(typeof data === 'string' ? data : JSON.stringify(data));
    }
    req.end();
  });
}

import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execP = promisify(exec);
const SSH_KEY = '"/Users/adminuser/Library/Application Support/NVIDIA/Sync/config/nvsync.key"';
const SPARK_HOST = '192.168.4.103';
const SPARK_USER = 'flak3dd';

async function sshExec(cmd, timeoutMs = 30000) {
  try {
    const encoded = Buffer.from(cmd).toString('base64');
    const { stdout, stderr } = await execP(
      `ssh -o BatchMode=yes -o ConnectTimeout=8 -o StrictHostKeyChecking=no -i ${SSH_KEY} ${SPARK_USER}@${SPARK_HOST} "echo ${encoded} | base64 -d | bash"`,
      { timeout: timeoutMs }
    );
    return { ok: true, stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (err) {
    return { ok: false, error: err.message, stdout: (err.stdout || '').trim(), stderr: (err.stderr || '').trim() };
  }
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const isStatusOnly = process.argv.includes('--status');

  console.log('====================================================');
  console.log(isStatusOnly ? '📊 SPARK SERVICE TELEMETRY & RUNTIME STATUS' : '⚡ SPARK DIAGNOSTIC & SERVICE RESTART ORCHESTRATION');
  console.log('====================================================\n');

  // 1. Direct SSH Connection Check
  console.log(`1. Testing SSH connectivity to ${SPARK_USER}@${SPARK_HOST}...`);
  const ping = await sshExec('hostname && uname -a');
  if (!ping.ok) {
    console.error('❌ SSH connection failed:', ping.error);
    process.exit(1);
  }
  console.log(`✔ Connected to Spark: ${ping.stdout.split('\n')[0]}`);

  if (isStatusOnly) {
    console.log('\n2. Fetching container & vLLM engine status...');
    const ps = await sshExec('docker ps -a --filter name=qwen-abliterated --format "{{.Names}}|{{.Status}}|{{.Image}}"');
    console.log(`   Docker: ${ps.stdout || 'None'}`);

    console.log('\n3. Recent engine logs:');
    const logs = await sshExec('docker logs --tail 8 qwen-abliterated 2>&1');
    console.log(logs.stdout || 'No logs available.');

    console.log('\n4. Probing HTTP endpoints:');
    const check = await requestJson('http://192.168.4.103:8000/v1/models', { timeout: 3000 });
    console.log(`   • Port 8000 (vLLM):  ${check.status === 200 ? 'ONLINE ✔' : 'HTTP ' + check.status + ' (Loading weights)'}`);
    if (check.status === 200 && check.data) {
      console.log(`     Available Models: ${JSON.stringify(check.data.data?.map(m => m.id) || check.data)}`);

      // Quick test completion
      const testComp = await requestJson('http://192.168.4.103:8000/v1/chat/completions', { method: 'POST', timeout: 8000 }, {
        model: 'qwen-abliterated',
        messages: [{ role: 'user', content: 'Reply with SMOKE_OK and nothing else.' }],
        max_tokens: 16,
      });
      if (testComp.data?.choices?.[0]?.message?.content) {
        console.log(`     Test Inference:   "${testComp.data.choices[0].message.content.trim()}" ✔`);
      }
    }

    const imgCheck = await requestJson('http://192.168.4.103:7860/health', { timeout: 2000 });
    console.log(`   • Port 7860 (Image): ${imgCheck.status === 200 ? 'ONLINE ✔' : 'HTTP ' + imgCheck.status}`);

    console.log('\n====================================================\n');
    return;
  }

  // 2. Stop and remove existing container cleanly
  console.log('\n2. Ensuring old container is stopped...');
  await sshExec(`docker stop -t 2 qwen-abliterated 2>/dev/null || true`);
  await sleep(2000);
  await sshExec(`docker rm -f qwen-abliterated 2>/dev/null || true`);
  await sleep(2000);

  // 3. Launch Huihui Qwen 27B Abliterated via ~/spark/serve-qwen-abliterated.sh
  console.log('\n3. Launching Huihui Qwen 27B Abliterated via ~/spark/serve-qwen-abliterated.sh...');
  const startRes = await sshExec(`
    cd ~/spark
    bash serve-qwen-abliterated.sh
  `, 60000);

  console.log(startRes.stdout || startRes.stderr);

  // 4. Poll for vLLM ready on :8000
  console.log('\n4. Polling http://192.168.4.103:8000/v1/models for readiness...');
  const maxAttempts = 40;
  for (let i = 1; i <= maxAttempts; i++) {
    await sleep(4000);
    const check = await requestJson('http://192.168.4.103:8000/v1/models', { timeout: 3000 });
    const logCheck = await sshExec(`docker ps --filter name=qwen-abliterated --format "{{.Status}}" && docker logs --tail 2 qwen-abliterated 2>&1 | tr '\n' ' '`);

    const statusLine = logCheck.stdout.split('\n')[0] || 'starting';
    const recentLog = logCheck.stdout.split('\n')[1] || '';

    console.log(`   [Attempt ${i}/${maxAttempts}] Container: ${statusLine} | Status: ${check.status === 200 ? 'ONLINE ✔' : 'LOADING...'} | Log: ${recentLog.slice(-90)}`);

    if (check.status === 200) {
      console.log('\n====================================================');
      console.log('🚀 SPARK QWEN-ABLITERATED IS ONLINE AND READY!');
      console.log('====================================================');
      console.log(`• Models Available: ${JSON.stringify(check.data?.data?.map(m => m.id) || check.data)}`);
      console.log(`• Direct Endpoint:  http://192.168.4.103:8000/v1/models`);
      console.log(`• Vite Proxy:       http://localhost:5174/spark-vllm/v1/models`);
      console.log('====================================================\n');
      return;
    }
  }

  console.log('\n⏳ vLLM model weights are still loading into VRAM. Container status:');
  const finalLogs = await sshExec(`docker logs --tail 20 qwen-abliterated 2>&1`);
  console.log(finalLogs.stdout);
}

main().catch((err) => {
  console.error('Fatal error restarting spark:', err);
  process.exit(1);
});

main().catch((err) => {
  console.error('Fatal error restarting spark:', err);
  process.exit(1);
});
