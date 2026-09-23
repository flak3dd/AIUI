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

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function getSshKey() {
  if (process.env.SPARK_SSH_KEY) {
    const clean = process.env.SPARK_SSH_KEY.replace(/^"|"$/g, '');
    if (fs.existsSync(clean)) return clean;
  }
  const home = process.env.HOME || os.homedir();
  const candidates = [
    path.resolve(home, 'Library/Application Support/NVIDIA/Sync/config/nvsync.key'),
    path.resolve(home, '.ssh/nvsync.key'),
    path.resolve(home, '.ssh/id_ed25519'),
    path.resolve(home, '.ssh/id_rsa'),
    path.resolve(home, '.ssh/spark.key'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return '';
}

const SSH_KEY = getSshKey();
let ACTIVE_HOST = process.env.SPARK_HOST || '100.66.147.53';
const SPARK_USER = process.env.SPARK_USER || 'flak3dd';

async function sshExec(cmd, timeoutMs = 30000, host = ACTIVE_HOST) {
  const keyClean = SSH_KEY.replace(/^"|"$/g, '');
  return new Promise((resolve) => {
    let sshArgs = [
      '-o', 'BatchMode=yes',
      '-o', 'ConnectTimeout=8',
      '-o', 'StrictHostKeyChecking=no',
    ];

    if (host === 'flak3dd' || host === 'sync-flak3dd') {
      sshArgs.push(host, 'bash -s');
    } else {
      if (keyClean && fs.existsSync(keyClean)) {
        sshArgs.push('-i', keyClean);
      }
      sshArgs.push(`${SPARK_USER}@${host}`, 'bash -s');
    }

    const child = spawn('ssh', sshArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      try { child.kill('SIGTERM'); } catch {}
      resolve({ ok: false, error: `Command timed out after ${timeoutMs}ms`, stdout, stderr });
    }, timeoutMs);

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        ok: code === 0,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        error: code === 0 ? null : (stderr.trim() || stdout.trim() || `SSH exit code ${code}`),
      });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ ok: false, error: err.message, stdout, stderr });
    });

    child.stdin.write(cmd);
    child.stdin.end();
  });
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const isStatusOnly = process.argv.includes('--status');
  const isStopOnly = process.argv.includes('--stop') || process.argv.includes('--shutdown') || process.argv.includes('--down');
  const isReclaimOnly = process.argv.includes('--reclaim');

  // Profile resolution: speed (32k, MTP=3) vs extended (65k, MTP=0/1)
  const profileArg = process.argv.find(a => a.startsWith('--profile='))?.split('=')[1] || (process.argv.includes('--extended') ? 'extended' : (process.argv.includes('--speed') ? 'speed' : null));
  
  let targetProfile = profileArg || 'speed';
  let customCtx, customMem, customSeqs, customMtp, customBatched;

  if (targetProfile === 'extended') {
    customCtx = process.argv.find(a => a.startsWith('--ctx='))?.split('=')[1] || process.env.CTX || '65536';
    customMem = process.argv.find(a => a.startsWith('--gpu-mem='))?.split('=')[1] || process.env.GPU_MEM || '0.82';
    customSeqs = process.argv.find(a => a.startsWith('--seqs='))?.split('=')[1] || process.env.SEQS || '2';
    customMtp = process.argv.find(a => a.startsWith('--mtp='))?.split('=')[1] || process.env.MTP || '0';
    customBatched = '16384';
  } else {
    // Default 'speed' profile
    customCtx = process.argv.find(a => a.startsWith('--ctx='))?.split('=')[1] || process.env.CTX || '32768';
    customMem = process.argv.find(a => a.startsWith('--gpu-mem='))?.split('=')[1] || process.env.GPU_MEM || '0.68';
    customSeqs = process.argv.find(a => a.startsWith('--seqs='))?.split('=')[1] || process.env.SEQS || '4';
    customMtp = process.argv.find(a => a.startsWith('--mtp='))?.split('=')[1] || process.env.MTP || '3';
    customBatched = '32768';
  }

  console.log('====================================================');
  if (isStopOnly) {
    console.log('🛑 SPARK SERVICE SHUTDOWN & VRAM RECLAMATION');
  } else if (isReclaimOnly) {
    console.log('🧹 SPARK VRAM RECLAMATION & PROCESS PURGE');
  } else if (isStatusOnly) {
    console.log('📊 SPARK SERVICE TELEMETRY & RUNTIME STATUS');
  } else {
    console.log(`⚡ SPARK ORCHESTRATION: PROFILE [${targetProfile.toUpperCase()}]`);
    console.log(`   CTX: ${customCtx} | GPU_MEM: ${customMem} | SEQS: ${customSeqs} | MTP: ${customMtp} | BATCHED: ${customBatched}`);
  }
  console.log('====================================================\n');

  // 1. Direct SSH Connection Check with multi-host fallback
  const candidateHosts = [
    process.env.SPARK_HOST,
    '100.66.147.53',
    '192.168.4.103',
    'gx10',
    'gx10.local',
    'gx10-d0e7.local',
    'flak3dd',
    'sync-flak3dd',
  ].filter(Boolean);

  console.log(`1. Testing SSH connectivity to Spark...`);
  let connected = false;
  let lastErrors = [];

  for (const host of candidateHosts) {
    process.stdout.write(`   • Probing ${host}... `);
    const ping = await sshExec('hostname && uname -a', 6000, host);
    if (ping.ok) {
      ACTIVE_HOST = host;
      connected = true;
      console.log(`ONLINE ✔ (${ping.stdout.split('\n')[0]})`);
      break;
    } else {
      const errDetail = ping.error || ping.stderr || 'Connection failed';
      console.log(`OFFLINE (${errDetail})`);
      lastErrors.push(`${host}: ${errDetail}`);
    }
  }

  if (!connected) {
    console.error('\n❌ SSH connection failed to all Spark endpoints:');
    lastErrors.forEach((err) => console.error(`   - ${err}`));
    console.error('\nTroubleshooting Checklist:');
    console.error('   1. Ensure the DGX Spark machine is turned on and connected to the local network.');
    console.error('   2. Verify that this Mac and Spark are on the same Wi-Fi / subnet (or NVIDIA Sync / Tailscale is active).');
    console.error('   3. If the IP address changed on your router, specify it via: SPARK_HOST=<new-ip> npm run spark:status');
    console.error('   4. AIUI will continue operating automatically via Featherless Cloud fallback in the meantime.\n');
    process.exit(1);
  }

  // Standalone or pre-emptive VRAM sweep: Kill OmniParser (~2.87GB) & OCR worker (~2.39GB)
  if (isReclaimOnly || !isStatusOnly) {
    console.log('\n🧹 Sweeping extraneous background GPU processes to reclaim ~5.26 GiB VRAM...');
    const sweep = await sshExec(`
      echo "   • Purging OmniParser (gradio_demo.py)..."
      pkill -9 -f "gradio_demo.py" 2>/dev/null || true
      echo "   • Purging OCR worker (dgx_worker.py)..."
      pkill -9 -f "dgx_worker.py" 2>/dev/null || true
      echo "   • Purging background Ollama..."
      pkill -15 ollama 2>/dev/null || true
      echo "   ✔ GPU processes swept."
    `);
    console.log(sweep.stdout || sweep.stderr);
    if (isReclaimOnly) {
      const smi = await sshExec('nvidia-smi --query-gpu=memory.used,memory.total,memory.free --format=csv');
      console.log('\nGPU Memory Post-Reclaim:');
      console.log(smi.stdout);
      return;
    }
  }

  if (isStopOnly) {
    console.log('\n2. Stopping and removing qwen-abliterated container...');
    await sshExec('docker stop -t 5 qwen-abliterated 2>/dev/null || true');
    await sshExec('docker rm -f qwen-abliterated 2>/dev/null || true');
    console.log('   ✔ Container stopped and removed.');

    console.log('\n3. Current GPU status after shutdown:');
    const smi = await sshExec('nvidia-smi --query-gpu=memory.used,memory.total,memory.free --format=csv');
    console.log(smi.stdout || smi.stderr);
    console.log('\n✔ Qwen LLM is shut down. VRAM has been reclaimed.\n');
    return;
  }

  if (isStatusOnly) {
    const smi = await sshExec('nvidia-smi --query-compute-apps=pid,process_name,used_memory --format=csv && nvidia-smi --query-gpu=memory.used,memory.total,memory.free --format=csv');
    console.log('\n=== NVIDIA-SMI PROCESSES & MEMORY ===');
    console.log(smi.stdout || smi.stderr);
    console.log('=====================================\n');

    console.log('\n2. Fetching container & vLLM engine status...');
    const ps = await sshExec('docker ps -a --filter name=qwen-abliterated --format "{{.Names}}|{{.Status}}|{{.Image}}"');
    console.log(`   Docker: ${ps.stdout || 'None'}`);

    console.log('\n3. Recent engine logs:');
    const logs = await sshExec('docker logs --tail 35 qwen-abliterated 2>&1');
    console.log(logs.stdout || 'No logs available.');

    console.log('\n4. Probing HTTP endpoints:');
    const httpHost = process.env.SPARK_QWEN_HOST || '192.168.4.103';
    const check = await requestJson(`http://${httpHost}:8000/v1/models`, { timeout: 3000 });
    console.log(`   • Port 8000 (vLLM):  ${check.status === 200 ? 'ONLINE ✔' : 'HTTP ' + check.status + ' (Loading weights)'}`);
    if (check.status === 200 && check.data) {
      console.log(`     Available Models: ${JSON.stringify(check.data.data?.map(m => m.id) || check.data)}`);

      // Quick test completion
      const testComp = await requestJson(`http://${httpHost}:8000/v1/chat/completions`, { method: 'POST', timeout: 8000 }, {
        model: 'qwen-abliterated',
        messages: [{ role: 'user', content: 'Reply with SMOKE_OK and nothing else.' }],
        max_tokens: 16,
      });
      if (testComp.data?.choices?.[0]?.message?.content) {
        console.log(`     Test Inference:   "${testComp.data.choices[0].message.content.trim()}" ✔`);
      }
    }

    const imgCheck = await requestJson(`http://${httpHost}:7860/health`, { timeout: 2000 });
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

  // 3. Launch Qwen Abliterated with active profile parameters
  console.log(`\n3. Launching Qwen Abliterated [${targetProfile.toUpperCase()}] profile...`);
  const startRes = await sshExec(`
    cd ~/spark || cd ~/abliterated_ui/spark || cd ~
    export GPU_MEM="${customMem}"
    export CTX="${customCtx}"
    export SEQS="${customSeqs}"
    export MTP="${customMtp}"
    export MAX_NUM_BATCHED_TOKENS="${customBatched}"
    if [ -f "serve-qwen-abliterated.sh" ]; then
      echo "Executing serve-qwen-abliterated.sh (GPU_MEM=${customMem}, CTX=${customCtx}, SEQS=${customSeqs}, MTP=${customMtp})..."
      bash serve-qwen-abliterated.sh
    elif [ -f "serve-qwen36-plague-nvfp4-mtp.sh" ]; then
      echo "Executing serve-qwen36-plague-nvfp4-mtp.sh (GPU_MEM=${customMem}, CTX=${customCtx}, SEQS=${customSeqs}, MTP=${customMtp})..."
      bash serve-qwen36-plague-nvfp4-mtp.sh
    elif [ -f "serve-qwen-flash-next.sh" ]; then
      echo "Executing serve-qwen-flash-next.sh (GPU_MEM=${customMem}, CTX=${customCtx})..."
      bash serve-qwen-flash-next.sh
    else
      FOUND=$(find ~/spark ~/abliterated_ui -maxdepth 2 -name "serve*.sh" 2>/dev/null | head -n 1)
      if [ -n "$FOUND" ]; then
        echo "Executing $FOUND (GPU_MEM=${customMem}, CTX=${customCtx})..."
        bash "$FOUND"
      else
        echo "No serve script found on Spark"
      fi
    fi
  `, 60000);

  console.log(startRes.stdout || startRes.stderr);

  // 4. Poll for vLLM ready on :8000
  const httpHost = process.env.SPARK_QWEN_HOST || '192.168.4.103';
  console.log(`\n4. Polling http://${httpHost}:8000/v1/models for readiness (Blackwell compilation takes ~60-120s)...`);
  const maxAttempts = 60;
  for (let i = 1; i <= maxAttempts; i++) {
    await sleep(4000);
    const check = await requestJson(`http://${httpHost}:8000/v1/models`, { timeout: 3000 });
    const logCheck = await sshExec(`docker ps --filter name=qwen-abliterated --format "{{.Status}}" && docker logs --tail 2 qwen-abliterated 2>&1 | tr '\n' ' '`);

    const statusLine = logCheck.stdout.split('\n')[0] || 'starting';
    const recentLog = logCheck.stdout.split('\n')[1] || '';

    console.log(`   [Attempt ${i}/${maxAttempts}] Container: ${statusLine} | Status: ${check.status === 200 ? 'ONLINE ✔' : 'LOADING...'} | Log: ${recentLog.slice(-90)}`);

    if (check.status === 200) {
      console.log('\n====================================================');
      console.log(`🚀 SPARK QWEN-ABLITERATED [${targetProfile.toUpperCase()}] IS ONLINE AND READY!`);
      console.log('====================================================');
      console.log(`• Profile Active:   ${targetProfile.toUpperCase()} (CTX: ${customCtx}, MTP: ${customMtp})`);
      console.log(`• Models Available: ${JSON.stringify(check.data?.data?.map(m => m.id) || check.data)}`);
      console.log(`• Direct Endpoint:  http://${httpHost}:8000/v1/models`);
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
