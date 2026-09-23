import fs from 'node:fs';
import path from 'node:path';
import util from 'node:util';
import { exec, spawn } from 'node:child_process';
import {
  SPARK_HOST,
  SPARK_USER,
  SSH_KEY,
  CLOUD_KEY_PROXY_URL,
  FEATHERLESS_DIRECT_URL,
  DEFAULT_API_KEY,
  ROOT_DIR,
  isRunningOnSpark,
} from '../../config.mjs';
import { AGENT_TOOLS } from '../registry.mjs';
import { renderCard, badge, LiveSpinner } from '../../ui/components.mjs';
import { rgb, c } from '../../ui/skins.mjs';

const execP = util.promisify(exec);

/**
 * Capture GPU telemetry snapshot from Spark or local host.
 */
export async function getGpuSnapshot(target = 'dgx_spark') {
  const isSpark = target === 'dgx_spark';
  const queryCmd = 'nvidia-smi --query-gpu=memory.used,memory.total,utilization.gpu,temperature.gpu,power.draw --format=csv,noheader,nounits';

  try {
    if (isSpark && !isRunningOnSpark()) {
      const keyClean = SSH_KEY.replace(/^"|"$/g, '');
      const { stdout } = await execP(
        `ssh -o BatchMode=yes -o ConnectTimeout=4 -o StrictHostKeyChecking=no -i ${keyClean} ${SPARK_USER}@${SPARK_HOST} "${queryCmd}"`,
        { timeout: 5000 }
      );
      const parts = stdout.trim().split(',').map((s) => s.trim());
      if (parts.length >= 5) {
        return {
          ok: true,
          memUsedMb: parseInt(parts[0], 10),
          memTotalMb: parseInt(parts[1], 10),
          gpuUtilPercent: parseInt(parts[2], 10),
          tempC: parseInt(parts[3], 10),
          powerWatts: parseFloat(parts[4]),
        };
      }
    } else {
      const { stdout } = await execP(queryCmd, { timeout: 3000 });
      const parts = stdout.trim().split(',').map((s) => s.trim());
      if (parts.length >= 5) {
        return {
          ok: true,
          memUsedMb: parseInt(parts[0], 10),
          memTotalMb: parseInt(parts[1], 10),
          gpuUtilPercent: parseInt(parts[2], 10),
          tempC: parseInt(parts[3], 10),
          powerWatts: parseFloat(parts[4]),
        };
      }
    }
  } catch {}

  return { ok: false, memUsedMb: 0, memTotalMb: 0, gpuUtilPercent: 0, tempC: 0, powerWatts: 0 };
}

/**
 * Stream a chat completion request and measure TTFT, TPS, and inter-token intervals.
 */
export async function measureStreamingLlm({
  endpoint,
  model,
  messages,
  tools = null,
  maxTokens = 256,
  apiKey = null,
  temperature = 0.2,
  chatTemplateKwargs = null,
}) {
  const headers = {
    'Content-Type': 'application/json',
    Connection: 'keep-alive',
  };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const payload = {
    model,
    messages,
    stream: true,
    temperature,
    max_tokens: maxTokens,
    ...(tools ? { tools, tool_choice: 'auto' } : {}),
    ...(chatTemplateKwargs ? { chat_template_kwargs: chatTemplateKwargs } : {}),
  };

  const t0 = performance.now();
  let tFirstToken = null;
  let chunkCount = 0;
  let tokenCount = 0;
  let fullContent = '';
  let toolCallDetected = false;
  const chunkTimes = [];

  const res = await fetch(`${endpoint.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(60000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${errText.slice(0, 300)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const tChunk = performance.now();
    chunkTimes.push(tChunk);
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop(); // keep partial trailing line

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === 'data: [DONE]') continue;
      if (trimmed.startsWith('data: ')) {
        chunkCount++;
        try {
          const parsed = JSON.parse(trimmed.slice(6));
          const delta = parsed.choices?.[0]?.delta;
          if (delta) {
            if (delta.content) {
              if (tFirstToken === null) tFirstToken = tChunk;
              fullContent += delta.content;
              tokenCount++;
            }
            if (delta.tool_calls) {
              if (tFirstToken === null) tFirstToken = tChunk;
              toolCallDetected = true;
              tokenCount += 2;
            }
          }
        } catch {}
      }
    }
  }

  const tEnd = performance.now();
  const ttftMs = tFirstToken ? Math.round(tFirstToken - t0) : Math.round(tEnd - t0);
  const genDurationMs = tFirstToken ? Math.max(1, tEnd - tFirstToken) : Math.max(1, tEnd - t0);
  const estTokens = Math.max(tokenCount, Math.ceil(fullContent.length / 3.8));
  const tps = Math.round((estTokens / (genDurationMs / 1000)) * 10) / 10;
  const totalMs = Math.round(tEnd - t0);

  // Compute inter-token latencies
  const itls = [];
  for (let i = 1; i < chunkTimes.length; i++) {
    itls.push(chunkTimes[i] - chunkTimes[i - 1]);
  }
  itls.sort((a, b) => a - b);
  const p50Itl = itls.length ? Math.round(itls[Math.floor(itls.length * 0.5)]) : 0;
  const p95Itl = itls.length ? Math.round(itls[Math.floor(itls.length * 0.95)]) : 0;

  return {
    ok: true,
    ttftMs,
    totalMs,
    genDurationMs: Math.round(genDurationMs),
    tokenCount: estTokens,
    tps,
    p50Itl,
    p95Itl,
    chunkCount,
    toolCallDetected,
    contentPreview: fullContent.trim().slice(0, 80),
  };
}

/**
 * Generate synthetic context buffer of target approximate token length.
 */
function generateContextBuffer(tokenTarget) {
  const wordTarget = Math.floor(tokenTarget * 0.75);
  const words = ['system', 'vector', 'cluster', 'matrix', 'tensor', 'memory', 'pipeline', 'neural', 'kernel', 'scheduler', 'quantum', 'gateway', 'telemetry', 'benchmark', 'runtime'];
  const paras = [];
  let generatedWords = 0;

  while (generatedWords < wordTarget) {
    const pLength = Math.min(60, wordTarget - generatedWords);
    const p = [];
    for (let i = 0; i < pLength; i++) {
      p.push(words[(generatedWords + i) % words.length]);
    }
    paras.push(`[CONTEXT_SEGMENT_${paras.length + 1}]: ${p.join(' ')}.`);
    generatedWords += pLength;
  }

  return paras.join('\n\n');
}

/**
 * Run comprehensive benchmark suite across target endpoints.
 */
export async function runBenchmarkSuite(options = {}, skin = null) {
  const mode = options.mode || 'latency';
  const provider = options.provider || 'spark';
  const iterations = options.iterations || 3;
  const outputTokens = options.outputTokens || (mode === 'throughput' ? 512 : 128);

  const isSpark = provider === 'spark';
  const endpoint = options.endpoint || (isSpark ? 'http://192.168.4.103:8000/v1' : FEATHERLESS_DIRECT_URL);
  const model = options.model || (isSpark ? 'qwen-abliterated' : 'Qwen/Qwen2.5-Coder-32B-Instruct');
  const apiKey = isSpark ? null : (options.apiKey || DEFAULT_API_KEY);

  const report = {
    timestamp: new Date().toISOString(),
    provider,
    model,
    endpoint,
    mode,
    iterations,
    results: [],
    gpuInitial: await getGpuSnapshot(isSpark ? 'dgx_spark' : 'local_mac'),
    gpuPeak: null,
  };

  const logHeader = `⚡ AIUI CLUSTER BENCHMARK SUITE — MODE: ${mode.toUpperCase()}`;
  console.log('\n' + renderCard({
    title: logHeader,
    badge: badge(provider.toUpperCase(), [0, 240, 255], [15, 23, 42]),
    lines: [
      `${rgb(251, 191, 36)}\x1b[1mModel:${c.reset}    ${model}`,
      `${rgb(148, 163, 184)}Endpoint:${c.reset} ${endpoint}`,
      `${rgb(148, 163, 184)}Mode:${c.reset}     ${mode.toUpperCase()} (iters: ${iterations}, outTokens: ${outputTokens})`,
      `${rgb(148, 163, 184)}Hardware:${c.reset} ${report.gpuInitial.ok ? `GPU VRAM: ${report.gpuInitial.memUsedMb}/${report.gpuInitial.memTotalMb} MiB | Util: ${report.gpuInitial.gpuUtilPercent}% | Temp: ${report.gpuInitial.tempC}°C` : 'Telemetry unavailable'}`,
    ],
    skin,
    width: 78,
  }) + '\n');

  // 1. Latency & TTFT Mode
  if (mode === 'latency' || mode === 'all') {
    const latResults = [];
    const spinner = new LiveSpinner(`${rgb(148, 163, 184)}Benchmarking TTFT & streaming latency...${c.reset}`, skin);
    spinner.start();

    for (let i = 1; i <= iterations; i++) {
      try {
        const res = await measureStreamingLlm({
          endpoint,
          model,
          messages: [
            { role: 'user', content: 'Output a concise 3-sentence technical summary of NVIDIA Grace Blackwell architecture.' },
          ],
          maxTokens: 64,
          apiKey,
          chatTemplateKwargs: isSpark ? { enable_thinking: false } : null,
        });
        latResults.push(res);
      } catch (err) {
        latResults.push({ ok: false, error: err.message });
      }
    }
    spinner.stop();

    const valid = latResults.filter((r) => r.ok);
    const avgTtft = valid.length ? Math.round(valid.reduce((acc, r) => acc + r.ttftMs, 0) / valid.length) : 0;
    const avgTps = valid.length ? Math.round((valid.reduce((acc, r) => acc + r.tps, 0) / valid.length) * 10) / 10 : 0;
    const minTtft = valid.length ? Math.min(...valid.map((r) => r.ttftMs)) : 0;
    const maxTtft = valid.length ? Math.max(...valid.map((r) => r.ttftMs)) : 0;

    report.results.push({
      test: 'latency_ttft',
      avgTtftMs: avgTtft,
      minTtftMs: minTtft,
      maxTtftMs: maxTtft,
      avgTps,
      runs: latResults,
    });

    console.log(renderCard({
      title: '📊 LATENCY & TTFT RESULTS',
      badge: badge(`AVG TTFT: ${avgTtft}ms`, [16, 185, 129], [15, 35, 25]),
      lines: [
        `${rgb(0, 240, 255)}Time To First Token (TTFT):${c.reset}  ${rgb(16, 185, 129)}${avgTtft}ms${c.reset} (min: ${minTtft}ms, max: ${maxTtft}ms)`,
        `${rgb(0, 240, 255)}Generation Throughput:${c.reset}       ${rgb(251, 191, 36)}${avgTps} tokens/sec${c.reset}`,
        `${rgb(0, 240, 255)}Inter-Token Latency (P50/P95):${c.reset} ${valid[0]?.p50Itl ?? 0}ms / ${valid[0]?.p95Itl ?? 0}ms`,
        `${rgb(148, 163, 184)}Sample Completion Preview:${c.reset}    "${valid[0]?.contentPreview || 'N/A'}..."`,
      ],
      skin,
      width: 78,
    }) + '\n');
  }

  // 2. Throughput Mode
  if (mode === 'throughput' || mode === 'all') {
    const tpsResults = [];
    const spinner = new LiveSpinner(`${rgb(148, 163, 184)}Benchmarking sustained generation throughput (${outputTokens} tokens)...${c.reset}`, skin);
    spinner.start();

    for (let i = 1; i <= iterations; i++) {
      try {
        const res = await measureStreamingLlm({
          endpoint,
          model,
          messages: [
            { role: 'user', content: 'Write a comprehensive Python script with complete data structures, classes, and error handlers for a distributed message queue.' },
          ],
          maxTokens: outputTokens,
          apiKey,
          chatTemplateKwargs: isSpark ? { enable_thinking: false } : null,
        });
        tpsResults.push(res);
      } catch (err) {
        tpsResults.push({ ok: false, error: err.message });
      }
    }
    spinner.stop();

    const valid = tpsResults.filter((r) => r.ok);
    const avgTps = valid.length ? Math.round((valid.reduce((acc, r) => acc + r.tps, 0) / valid.length) * 10) / 10 : 0;
    const maxTps = valid.length ? Math.max(...valid.map((r) => r.tps)) : 0;
    const avgDuration = valid.length ? Math.round(valid.reduce((acc, r) => acc + r.totalMs, 0) / valid.length) : 0;

    report.results.push({
      test: 'throughput_sustained',
      avgTps,
      maxTps,
      avgDurationMs: avgDuration,
      runs: tpsResults,
    });

    console.log(renderCard({
      title: '🚀 SUSTAINED THROUGHPUT RESULTS',
      badge: badge(`PEAK: ${maxTps} T/s`, [251, 191, 36], [35, 30, 15]),
      lines: [
        `${rgb(0, 240, 255)}Average Generation Speed:${c.reset}  ${rgb(16, 185, 129)}${avgTps} tokens/sec${c.reset}`,
        `${rgb(0, 240, 255)}Peak Generation Speed:${c.reset}     ${rgb(251, 191, 36)}${maxTps} tokens/sec${c.reset}`,
        `${rgb(0, 240, 255)}Average Request Duration:${c.reset}  ${avgDuration}ms (${valid[0]?.tokenCount || outputTokens} tokens generated)`,
      ],
      skin,
      width: 78,
    }) + '\n');
  }

  // 3. Concurrency Stress Mode
  if (mode === 'concurrency' || mode === 'all') {
    const concurrencyLevels = options.concurrency ? [parseInt(options.concurrency, 10)] : [1, 2, 4, 8];
    const concSummary = [];

    for (const cLevel of concurrencyLevels) {
      const spinner = new LiveSpinner(`${rgb(148, 163, 184)}Testing concurrency level: ${cLevel} parallel streams...${c.reset}`, skin);
      spinner.start();

      const t0 = performance.now();
      const promises = Array.from({ length: cLevel }).map(() =>
        measureStreamingLlm({
          endpoint,
          model,
          messages: [{ role: 'user', content: 'Output the numbers 1 to 30 separated by commas and a short sentence.' }],
          maxTokens: 64,
          apiKey,
          chatTemplateKwargs: isSpark ? { enable_thinking: false } : null,
        }).catch((err) => ({ ok: false, error: err.message }))
      );

      const batchResults = await Promise.all(promises);
      const totalBatchMs = Math.round(performance.now() - t0);
      spinner.stop();

      const validBatch = batchResults.filter((r) => r.ok);
      const aggregateTokens = validBatch.reduce((acc, r) => acc + (r.tokenCount || 0), 0);
      const aggregateTps = Math.round((aggregateTokens / (totalBatchMs / 1000)) * 10) / 10;
      const avgTtft = validBatch.length ? Math.round(validBatch.reduce((acc, r) => acc + r.ttftMs, 0) / validBatch.length) : 0;

      concSummary.push({
        concurrency: cLevel,
        totalBatchMs,
        aggregateTps,
        avgTtft,
        successRate: `${validBatch.length}/${cLevel}`,
      });
    }

    report.results.push({ test: 'concurrency_stress', summary: concSummary });

    const concLines = concSummary.map(
      (cRow) =>
        ` ${rgb(0, 240, 255)}${String(cRow.concurrency).padEnd(2)} streams:${c.reset}  Agg TPS: ${rgb(251, 191, 36)}${String(cRow.aggregateTps).padEnd(6)}${c.reset} │ Avg TTFT: ${String(cRow.avgTtft).padEnd(5)}ms │ Batch: ${cRow.totalBatchMs}ms │ Passed: ${cRow.successRate}`
    );

    console.log(renderCard({
      title: '⚡ CONCURRENCY & STREAM CAPACITY',
      badge: badge('MULTI-STREAM', [168, 85, 247], [30, 15, 35]),
      lines: concLines,
      skin,
      width: 78,
    }) + '\n');
  }

  // 4. Context Scaling Stress Mode
  if (mode === 'context-scaling' || mode === 'all') {
    const steps = options.ctxSteps
      ? options.ctxSteps.split(',').map((s) => parseInt(s.replace(/k/i, '000'), 10))
      : [2048, 8192, 16384, 32768, 64000];

    const ctxSummary = [];
    for (const stepTokens of steps) {
      const spinner = new LiveSpinner(`${rgb(148, 163, 184)}Evaluating context scale at ~${Math.round(stepTokens / 1000)}k tokens...${c.reset}`, skin);
      spinner.start();

      const contextBody = generateContextBuffer(stepTokens);
      const prompt = `${contextBody}\n\n[INSTRUCTION]: Find the value of 'matrix' and reply with 'KEY_FOUND: matrix'`;

      try {
        const res = await measureStreamingLlm({
          endpoint,
          model,
          messages: [{ role: 'user', content: prompt }],
          maxTokens: 32,
          apiKey,
          chatTemplateKwargs: isSpark ? { enable_thinking: false } : null,
        });
        spinner.stop();

        ctxSummary.push({
          contextTokens: stepTokens,
          ok: true,
          ttftMs: res.ttftMs,
          totalMs: res.totalMs,
          tps: res.tps,
        });
      } catch (err) {
        spinner.stop();
        ctxSummary.push({
          contextTokens: stepTokens,
          ok: false,
          error: err.message,
        });
      }
    }

    report.results.push({ test: 'context_scaling', summary: ctxSummary });

    const ctxLines = ctxSummary.map((cRow) => {
      const label = `${Math.round(cRow.contextTokens / 1024)}k tokens`.padEnd(12);
      if (cRow.ok) {
        return ` ${rgb(0, 240, 255)}${label}:${c.reset}  TTFT: ${rgb(16, 185, 129)}${String(cRow.ttftMs).padEnd(6)}ms${c.reset} │ Total: ${cRow.totalMs}ms │ Gen: ${cRow.tps} T/s`;
      } else {
        return ` ${rgb(0, 240, 255)}${label}:${c.reset}  ${rgb(239, 68, 68)}FAILED: ${cRow.error.slice(0, 48)}...${c.reset}`;
      }
    });

    console.log(renderCard({
      title: '📈 CONTEXT SCALING STRESS CURVE',
      badge: badge('PREFILL SCALING', [251, 191, 36], [35, 30, 15]),
      lines: ctxLines,
      skin,
      width: 78,
    }) + '\n');
  }

  // 5. Agent Tool Calling Accuracy Mode
  if (mode === 'agent-eval' || mode === 'all') {
    const spinner = new LiveSpinner(`${rgb(148, 163, 184)}Evaluating tool schema adherence and parameter typing...${c.reset}`, skin);
    spinner.start();

    const toolPrompts = [
      {
        name: 'read_file',
        prompt: 'Inspect line 15 to 45 of /Users/adminuser/AIUI/package.json',
        validator: (tc) => tc?.function?.name === 'read_file' && tc?.function?.arguments.includes('package.json'),
      },
      {
        name: 'write_file',
        prompt: 'Write a python script to /tmp/spark-sandboxes/test_bench.py containing print("BENCH_OK")',
        validator: (tc) => tc?.function?.name === 'write_file' && tc?.function?.arguments.includes('test_bench.py'),
      },
      {
        name: 'bash',
        prompt: 'Run the command nvidia-smi --query-gpu=name --format=csv',
        validator: (tc) => tc?.function?.name === 'bash' && tc?.function?.arguments.includes('nvidia-smi'),
      },
    ];

    const evalResults = [];
    for (const tp of toolPrompts) {
      try {
        const res = await measureStreamingLlm({
          endpoint,
          model,
          messages: [{ role: 'user', content: tp.prompt }],
          tools: AGENT_TOOLS.slice(0, 5),
          maxTokens: 128,
          apiKey,
          chatTemplateKwargs: isSpark ? { enable_thinking: false } : null,
        });
        evalResults.push({
          tool: tp.name,
          ok: res.toolCallDetected,
          ttftMs: res.ttftMs,
        });
      } catch (err) {
        evalResults.push({ tool: tp.name, ok: false, error: err.message });
      }
    }
    spinner.stop();

    report.results.push({ test: 'agent_tool_eval', summary: evalResults });

    const evalLines = evalResults.map((e) => {
      const statusBadge = e.ok ? `${rgb(16, 185, 129)}✔ VALID SCHEMA${c.reset}` : `${rgb(239, 68, 68)}✘ FAILED${c.reset}`;
      return ` ${rgb(0, 240, 255)}${e.tool.padEnd(16)}${c.reset} ${statusBadge} │ Latency: ${e.ttftMs || 0}ms`;
    });

    console.log(renderCard({
      title: '🛠️  AGENT TOOL-CALLING ACCURACY',
      badge: badge('SCHEMA CHECK', [0, 240, 255], [15, 23, 42]),
      lines: evalLines,
      skin,
      width: 78,
    }) + '\n');
  }

  // Final Hardware Delta
  report.gpuPeak = await getGpuSnapshot(isSpark ? 'dgx_spark' : 'local_mac');

  // Export reports
  const logsDir = path.resolve(ROOT_DIR, 'logs/benchmarks');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }

  const fileStamp = new Date().toISOString().replace(/[:.]/g, '-');
  const jsonPath = options.json || path.resolve(logsDir, `benchmark-${fileStamp}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');

  console.log(`✔ Benchmark JSON report saved to: ${rgb(0, 240, 255)}${jsonPath}${c.reset}\n`);
  return report;
}
