#!/usr/bin/env node

/**
 * ==============================================================================
 * ⚡ AIUI CLUSTER & AGENT BENCHMARKING CLI
 * ==============================================================================
 * Comprehensive performance suite evaluating:
 * - TTFT (Time To First Token) & sustained TPS (Tokens Per Second)
 * - Concurrency & stream capacity under multi-client load
 * - Context scaling stress curve (2k -> 8k -> 16k -> 32k -> 64k -> 128k)
 * - Autonomous agent tool schema & argument parsing accuracy
 * - Side-by-side Spark (local NVFP4 GB10) vs Featherless Cloud comparisons
 * ==============================================================================
 */

import { runBenchmarkSuite } from './aiui-agent/tools/handlers/benchmark.mjs';
import { getSkin, rgb, c } from './aiui-agent/ui/skins.mjs';
import { renderCard, badge } from './aiui-agent/ui/components.mjs';

async function main() {
  const args = process.argv.slice(2);
  const options = {
    mode: 'latency',
    provider: 'spark',
    model: null,
    iterations: 3,
    outputTokens: null,
    concurrency: null,
    ctxSteps: null,
    skin: process.env.AIUI_SKIN || 'cyberpunk',
    json: null,
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-h' || a === '--help' || a === 'help') {
      const s = getSkin(options.skin);
      console.log(
        '\n' +
          renderCard({
            title: '⚡ AIUI BENCHMARKING SUITE',
            badge: badge('MANUAL & MODES', s.primary, s.badgeBg),
            lines: [
              `${rgb(...s.primary)}\x1b[1mUsage:${c.reset}  node scripts/benchmark.mjs [options]`,
              `        aiui bench [options]`,
              ``,
              `${rgb(...s.secondary)}\x1b[1mBenchmark Modes (--mode):${c.reset}`,
              `  ${rgb(...s.gold)}latency${c.reset}          Measure Time To First Token (TTFT) and fast inference`,
              `  ${rgb(...s.gold)}throughput${c.reset}       Measure sustained tokens/second generation speed`,
              `  ${rgb(...s.gold)}concurrency${c.reset}      Measure parallel multi-stream capacity (1, 2, 4, 8)`,
              `  ${rgb(...s.gold)}context-scaling${c.reset}  Step through input context sizes (2k, 8k, 16k, 32k, 64k)`,
              `  ${rgb(...s.gold)}agent-eval${c.reset}       Validate tool-calling JSON schema accuracy`,
              `  ${rgb(...s.gold)}compare${c.reset}          Direct shootout: Spark vLLM local vs Featherless Cloud`,
              `  ${rgb(...s.gold)}all${c.reset}              Run complete 5-phase evaluation suite`,
              ``,
              `${rgb(...s.secondary)}\x1b[1mOptions:${c.reset}`,
              `  ${rgb(...s.primary)}-P, --provider <name>${c.reset}   spark (default) | featherless`,
              `  ${rgb(...s.primary)}-m, --mode <mode>${c.reset}       Benchmark mode (default: latency)`,
              `  ${rgb(...s.primary)}-i, --iterations <n>${c.reset}    Measurement samples per test (default: 3)`,
              `  ${rgb(...s.primary)}-o, --output-tokens <n>${c.reset} Target output tokens (default: 128 / 512)`,
              `  ${rgb(...s.primary)}-c, --concurrency <n>${c.reset}   Concurrency stream count for stress test`,
              `  ${rgb(...s.primary)}--ctx-steps <list>${c.reset}      Custom context steps (e.g. 2k,8k,16k,32k,64k)`,
              `  ${rgb(...s.primary)}--skin <name>${c.reset}           Terminal skin (cyberpunk, matrix, ember, etc.)`,
              `  ${rgb(...s.primary)}--json <path>${c.reset}           Custom path to export JSON telemetry record`,
              ``,
              `${rgb(...s.accent)}\x1b[1mExamples:${c.reset}`,
              `  node scripts/benchmark.mjs --mode=latency`,
              `  node scripts/benchmark.mjs --mode=throughput --output-tokens=512`,
              `  node scripts/benchmark.mjs --mode=concurrency --concurrency=4`,
              `  node scripts/benchmark.mjs --mode=context-scaling --ctx-steps=2k,8k,16k,32k`,
              `  node scripts/benchmark.mjs --mode=compare`,
            ],
            skin: s,
            width: 78,
          }) +
          '\n'
      );
      process.exit(0);
    } else if (a === '-m' || a === '--mode') {
      options.mode = args[++i];
    } else if (a.startsWith('--mode=')) {
      options.mode = a.split('=')[1];
    } else if (a === '-P' || a === '--provider') {
      options.provider = args[++i];
    } else if (a.startsWith('--provider=')) {
      options.provider = a.split('=')[1];
    } else if (a === '--model') {
      options.model = args[++i];
    } else if (a.startsWith('--model=')) {
      options.model = a.split('=')[1];
    } else if (a === '-i' || a === '--iterations') {
      options.iterations = parseInt(args[++i], 10);
    } else if (a.startsWith('--iterations=')) {
      options.iterations = parseInt(a.split('=')[1], 10);
    } else if (a === '-o' || a === '--output-tokens') {
      options.outputTokens = parseInt(args[++i], 10);
    } else if (a.startsWith('--output-tokens=')) {
      options.outputTokens = parseInt(a.split('=')[1], 10);
    } else if (a === '-c' || a === '--concurrency') {
      options.concurrency = parseInt(args[++i], 10);
    } else if (a.startsWith('--concurrency=')) {
      options.concurrency = parseInt(a.split('=')[1], 10);
    } else if (a === '--ctx-steps') {
      options.ctxSteps = args[++i];
    } else if (a.startsWith('--ctx-steps=')) {
      options.ctxSteps = a.split('=')[1];
    } else if (a === '--skin') {
      options.skin = args[++i];
    } else if (a.startsWith('--skin=')) {
      options.skin = a.split('=')[1];
    } else if (a === '--json') {
      options.json = args[++i];
    } else if (a.startsWith('--json=')) {
      options.json = a.split('=')[1];
    }
  }

  const skin = getSkin(options.skin);

  // Side-by-Side Comparison Shootout
  if (options.mode === 'compare') {
    console.log(`\n${rgb(...skin.gold)}\x1b[1m⚔️  INITIATING SIDE-BY-SIDE SHOOTOUT: SPARK LOCAL vs FEATHERLESS CLOUD...${c.reset}\n`);

    console.log(`${rgb(...skin.primary)}[Phase 1/2]: Benchmarking Spark vLLM (GB10 Local)...${c.reset}`);
    const sparkReport = await runBenchmarkSuite({ ...options, provider: 'spark', mode: 'latency' }, skin);

    console.log(`${rgb(...skin.secondary)}[Phase 2/2]: Benchmarking Featherless AI (Cloud API)...${c.reset}`);
    const cloudReport = await runBenchmarkSuite({ ...options, provider: 'featherless', mode: 'latency' }, skin);

    const sparkLat = sparkReport.results.find((r) => r.test === 'latency_ttft') || {};
    const cloudLat = cloudReport.results.find((r) => r.test === 'latency_ttft') || {};

    const shootoutLines = [
      ` ${rgb(...skin.primary)}Metric${c.reset}                          ${rgb(...skin.gold)}DGX Spark (Local GB10)${c.reset}    ${rgb(...skin.accent)}Featherless (Cloud)${c.reset}`,
      ` ${rgb(...skin.border)}────────────────────────────────────────────────────────────────────────${c.reset}`,
      ` Average TTFT:                   ${rgb(...skin.success)}${String(sparkLat.avgTtftMs || 0).padEnd(6)}ms${c.reset}              ${String(cloudLat.avgTtftMs || 0).padEnd(6)}ms`,
      ` Peak Generation Speed:          ${rgb(...skin.success)}${String(sparkLat.avgTps || 0).padEnd(6)}T/s${c.reset}             ${String(cloudLat.avgTps || 0).padEnd(6)}T/s`,
      ` Network Hop:                    ${rgb(...skin.success)}LAN (<1ms)${c.reset}                 WAN internet (25-45ms)`,
      ` Data Confinement:               ${rgb(...skin.success)}100% On-Premise Svrn${c.reset}       Cloud Multi-tenant`,
      ` Unified VRAM Footprint:         ${sparkReport.gpuPeak?.memUsedMb || 'N/A'} MiB                N/A (Managed API)`,
    ];

    console.log(
      '\n' +
        renderCard({
          title: '⚔️  CLUSTER SHOOTOUT SUMMARY MATRIX',
          badge: badge('SPARK vs CLOUD', skin.gold, skin.badgeBg),
          lines: shootoutLines,
          skin,
          width: 78,
        }) +
        '\n'
    );
    return;
  }

  await runBenchmarkSuite(options, skin);
}

main().catch((err) => {
  console.error(`${c.red}Benchmark error:${c.reset}`, err);
  process.exit(1);
});
