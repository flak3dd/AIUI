#!/usr/bin/env node
/**
 * Spark GPU Memory Optimizer & Extraneous Process Reclaimer
 * DGX Spark GB10 (192.168.4.103)
 *
 * Capabilities:
 *  1. --audit        : Live inspection of GPU memory per process & KV cache allocation
 *  2. --reclaim      : Terminate/offload non-vLLM GPU processes (OmniParser, OCR worker, Ollama)
 *  3. --tune-vllm    : Optimize vLLM GPU memory utilization (default: 0.68, CTX: 32768)
 *  4. --all          : Full optimization pass (reclaim + tune + verify)
 */

import { spawn } from 'node:child_process';
import http from 'node:http';

const SSH_KEY = '/Users/adminuser/Library/Application Support/NVIDIA/Sync/config/nvsync.key';
const SPARK_HOST = process.env.SPARK_HOST || '100.66.147.53';
const SPARK_QWEN_HOST = process.env.SPARK_QWEN_HOST || '192.168.4.103';
const SPARK_USER = process.env.SPARK_USER || 'flak3dd';

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  cyan: '\x1b[36m',
  green: '\x1b[38;5;48m',
  gold: '\x1b[38;5;220m',
  red: '\x1b[38;5;196m',
  dim: '\x1b[2m',
  magenta: '\x1b[35m',
};

async function sshExec(cmd, timeoutMs = 45000) {
  return new Promise((resolve) => {
    const child = spawn(
      'ssh',
      [
        '-o', 'BatchMode=yes',
        '-o', 'ConnectTimeout=10',
        '-o', 'StrictHostKeyChecking=no',
        '-i', SSH_KEY,
        `${SPARK_USER}@${SPARK_HOST}`,
        'bash -s',
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] }
    );

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      try { child.kill('SIGTERM'); } catch {}
      resolve({ ok: false, error: 'Command timed out', stdout, stderr });
    }, timeoutMs);

    child.stdout.on('data', (d) => { stdout += d.toString('utf8'); });
    child.stderr.on('data', (d) => { stderr += d.toString('utf8'); });

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, stdout: stdout.trim(), stderr: stderr.trim(), code });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ ok: false, error: err.message, stdout, stderr, code: 1 });
    });

    child.stdin.write(cmd);
    child.stdin.end();
  });
}

function probeHttp(urlStr, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const url = new URL(urlStr);
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: 'GET',
        timeout: timeoutMs,
      },
      (res) => {
        let body = '';
        res.on('data', (d) => { body += d; });
        res.on('end', () => resolve({ ok: res.statusCode === 200, status: res.statusCode, body }));
      }
    );
    req.on('error', (e) => resolve({ ok: false, status: 0, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, status: 0, error: 'timeout' }); });
    req.end();
  });
}

async function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

async function auditGpu() {
  console.log(`\n${c.bold}${c.cyan}======================================================================${c.reset}`);
  console.log(`${c.bold}${c.gold}📊 DGX SPARK GB10 GPU MEMORY TELEMETRY & PROCESS AUDIT${c.reset}`);
  console.log(`   Target: ${SPARK_USER}@${SPARK_HOST}`);
  console.log(`${c.bold}${c.cyan}======================================================================${c.reset}\n`);

  const smiRes = await sshExec(`
    echo "=== GPU STATUS ==="
    nvidia-smi --query-gpu=name,driver_version,temperature.gpu,utilization.gpu,memory.used,memory.total,memory.free --format=csv,noheader
    echo "=== ACTIVE COMPUTE PROCESSES ==="
    nvidia-smi --query-compute-apps=pid,process_name,used_memory --format=csv,noheader
    echo "=== PROCESS DETAILS ==="
    ps aux | grep -E "vllm|gradio|dgx_worker|ollama" | grep -v grep || true
  `);

  if (!smiRes.ok) {
    console.error(`${c.red}Failed to execute audit over SSH:${c.reset}`, smiRes.error || smiRes.stderr);
    return;
  }

  console.log(smiRes.stdout);
  console.log(`\n${c.bold}${c.cyan}======================================================================${c.reset}`);
}

async function reclaimOtherProcesses() {
  console.log(`\n${c.bold}${c.gold}🧹 RECLAIMING NON-vLLM GPU MEMORY (~5.26 GiB total)...${c.reset}`);

  const killScript = `
    echo "1. Checking OmniParser (gradio_demo.py)..."
    OP_PIDS=\$(pgrep -f "gradio_demo.py" 2>/dev/null || true)
    if [ -n "\$OP_PIDS" ]; then
      echo "   Found OmniParser PID(s): \$OP_PIDS — Terminating to reclaim ~2,871 MiB VRAM..."
      kill -15 \$OP_PIDS 2>/dev/null || true
      sleep 1
      kill -9 \$OP_PIDS 2>/dev/null || true
      echo "   ✔ OmniParser stopped."
    else
      echo "   No OmniParser process running."
    fi

    echo "2. Checking OCR Runtime (dgx_worker.py)..."
    OCR_PIDS=\$(pgrep -f "dgx_worker.py" 2>/dev/null || true)
    if [ -n "\$OCR_PIDS" ]; then
      echo "   Found OCR worker PID(s): \$OCR_PIDS — Terminating to reclaim ~2,389 MiB VRAM..."
      kill -15 \$OCR_PIDS 2>/dev/null || true
      sleep 1
      kill -9 \$OCR_PIDS 2>/dev/null || true
      echo "   ✔ OCR worker stopped."
    else
      echo "   No OCR worker running."
    fi

    echo "3. Checking Ollama background server..."
    if pgrep -x "ollama" >/dev/null 2>&1; then
      echo "   Ollama daemon active. Stopping service to prevent VRAM hijacking..."
      sudo systemctl stop ollama 2>/dev/null || pkill -15 ollama 2>/dev/null || true
      echo "   ✔ Ollama stopped."
    else
      echo "   Ollama not active."
    fi

    echo "4. Memory state after process reclamation:"
    nvidia-smi --query-gpu=memory.used,memory.total,memory.free --format=csv,noheader
  `;

  const res = await sshExec(killScript);
  console.log(res.stdout || res.stderr);
}

async function tuneVllm(gpuMem = '0.68', maxCtx = '32768', maxSeqs = '4') {
  console.log(`\n${c.bold}${c.gold}⚡ TUNING vLLM MEMORY UTILIZATION ON SPARK...${c.reset}`);
  console.log(`   Parameters: --gpu-memory-utilization ${gpuMem} | --max-model-len ${maxCtx} | --max-num-seqs ${maxSeqs}`);

  const tuneScript = `
    cd ~/spark || cd ~/abliterated_ui/spark || true

    echo "1. Stopping existing container..."
    docker stop -t 3 qwen-abliterated 2>/dev/null || true
    docker rm -f qwen-abliterated 2>/dev/null || true
    sleep 2

    echo "2. Launching optimized vLLM container..."
    # If serve-qwen-flash-next.sh exists, use it with overridden env vars; otherwise run serve-qwen36-plague
    if [ "$UNRESTRICTED" = "true" ]; then
      echo "Launching container with full unrestricted context and GPU memory..."
      if [ -f "serve-qwen-abliterated.sh" ]; then
        bash serve-qwen-abliterated.sh
      elif [ -f "serve-qwen36-plague-nvfp4-mtp.sh" ]; then
        bash serve-qwen36-plague-nvfp4-mtp.sh
      elif [ -f "serve-qwen-flash-next.sh" ]; then
        bash serve-qwen-flash-next.sh
      fi
    elif [ -f "serve-qwen36-plague-nvfp4-mtp.sh" ]; then
      GPU_MEM="${gpuMem}" CTX="${maxCtx}" SEQS="${maxSeqs}" bash serve-qwen36-plague-nvfp4-mtp.sh
    elif [ -f "serve-qwen-flash-next.sh" ]; then
      GPU_MEM="${gpuMem}" CTX="${maxCtx}" SEQS="${maxSeqs}" bash serve-qwen-flash-next.sh
    elif [ -f "serve-qwen-abliterated.sh" ]; then
      GPU_MEM="${gpuMem}" CTX="${maxCtx}" SEQS="${maxSeqs}" bash serve-qwen-abliterated.sh
    else
      echo "!! No serve script found in ~/spark"
      exit 1
    fi
  `;

  const res = await sshExec(tuneScript, 60000);
  console.log(res.stdout || res.stderr);

  console.log(`\n${c.bold}${c.cyan}Waiting for vLLM ready on port 8000 (Blackwell graph compilation takes ~90-120s)...${c.reset}`);
  for (let i = 1; i <= 50; i++) {
    await sleep(4000);
    const probe = await probeHttp(`http://${SPARK_QWEN_HOST}:8000/v1/models`);
    if (probe.ok) {
      console.log(`\n${c.green}✔ vLLM is ONLINE on http://${SPARK_QWEN_HOST}:8000 with optimized memory!${c.reset}`);
      return;
    }
    const logCheck = await sshExec(`docker logs --tail 2 qwen-abliterated 2>&1 | tr '\n' ' '`);
    const recent = logCheck.stdout.slice(-100);
    process.stdout.write(`   [Attempt ${i}/50] ${recent || 'Initializing weights...'}\r`);
  }
  console.log(`\n${c.gold}Note: vLLM is still compiling CUDA graphs. Run --audit in a moment.${c.reset}`);
}

async function main() {
  const args = process.argv.slice(2);
  const doAudit = args.includes('--audit') || args.length === 0;
  const doReclaim = args.includes('--reclaim') || args.includes('--kill-other') || args.includes('--all');
  const doTune = args.includes('--tune-vllm') || args.includes('--all');

  const profileArg = args.find((a) => a.startsWith('--profile='))?.split('=')[1] || (args.includes('--extended') ? 'extended' : (args.includes('--speed') ? 'speed' : null));
  let gpuMemArg = args.find((a) => a.startsWith('--gpu-mem='))?.split('=')[1];
  let ctxArg = args.find((a) => a.startsWith('--ctx='))?.split('=')[1];
  let seqsArg = args.find((a) => a.startsWith('--seqs='))?.split('=')[1];

  if (profileArg === 'extended') {
    gpuMemArg = gpuMemArg || '0.82';
    ctxArg = ctxArg || '65536';
    seqsArg = seqsArg || '2';
  } else {
    gpuMemArg = gpuMemArg || '0.68';
    ctxArg = ctxArg || '32768';
    seqsArg = seqsArg || '4';
  }

  if (doAudit && !doReclaim && !doTune) {
    await auditGpu();
    return;
  }

  if (doReclaim) {
    await reclaimOtherProcesses();
  }

  if (doTune) {
    await tuneVllm(gpuMemArg, ctxArg, seqsArg);
  }

  console.log('\nFinal memory audit:');
  await auditGpu();
}

main().catch((err) => {
  console.error('Error during GPU optimization:', err);
  process.exit(1);
});
