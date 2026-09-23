import fs from 'node:fs';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  ROOT_DIR,
  DEFAULT_TARGET,
  SPARK_HOST,
  SPARK_QWEN_HOST,
} from './config.mjs';
import { AGENT_TOOLS } from './tools/registry.mjs';
import { dynamicToolManager } from '../dynamic-tool-manager.mjs';
import { AiuiAgent } from './core/agent.mjs';
import processManager from './core/process-manager.mjs';
import { browserOpenHandler } from './tools/handlers/browser.mjs';
import { checkServices } from './transport/telemetry.mjs';
import { getSkin, rgb, c } from './ui/skins.mjs';
import { renderCard, badge, renderStatusDashboard, LiveSpinner } from './ui/components.mjs';
import { isGitRepo, initGitRepo } from './core/workflow-optimizer.mjs';

const __filename = fileURLToPath(import.meta.url);

export async function runCli(argv = process.argv.slice(2)) {
  const options = {
    provider: process.env.AIUI_PROVIDER || null,
    target: DEFAULT_TARGET,
    model: null,
    workspaceDir: process.cwd(),
    maxRounds: parseInt(process.env.AIUI_MAX_ROUNDS, 10) || 50,
    deepBuild: false,
    optimize: false,
    verbose: false,
    plan: null,
    reviewPlan: false,
    fast: false,
    prompt: '',
    skin: process.env.AIUI_SKIN || 'cyberpunk',
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help' || a === 'help') {
      const s = getSkin(options.skin);
      const helpLines = [
        `${rgb(...s.primary)}\x1b[1mUsage:${c.reset}  aiui [command|options] [prompt]`,
        ``,
        `${rgb(...s.secondary)}\x1b[1mCommands:${c.reset}`,
        `  ${rgb(...s.primary)}aiui${c.reset}                       Launch interactive terminal REPL shell`,
        `  ${rgb(...s.primary)}aiui diff${c.reset}                  Audit git diff stat and modified hunks`,
        `  ${rgb(...s.primary)}aiui daemons${c.reset}               Inspect active background process daemons`,
        `  ${rgb(...s.primary)}aiui browser [url]${c.reset}         Headless browser audit and DOM check`,
        `  ${rgb(...s.primary)}aiui status${c.reset}                Probe & show ecosystem telemetry dashboard`,
        `  ${rgb(...s.primary)}aiui bench${c.reset}                 Run cluster performance & TTFT benchmark suite`,
        `  ${rgb(...s.primary)}aiui matrix${c.reset}                Launch Cybernetic Matrix phosphor screensaver`,
        `  ${rgb(...s.primary)}aiui tools${c.reset}                 List all active autonomous agent tools`,
        `  ${rgb(...s.primary)}aiui spark${c.reset}                 Check DGX Spark vLLM GPU container status`,
        `  ${rgb(...s.primary)}aiui monitor [flags]${c.reset}       Live stream & monitor agent traffic, LLM latency & tools`,
        `  ${rgb(...s.primary)}aiui optimize${c.reset}              Run live system, GPU & policy optimization pass`,
        ``,
        `${rgb(...s.secondary)}\x1b[1mOptions:${c.reset}`,
        `  ${rgb(...s.gold)}-P, --provider <name>${c.reset}     LLM provider: spark (local DGX vLLM) | featherless (cloud)`,
        `  ${rgb(...s.gold)}-p, --prompt <text>${c.reset}        One-shot autonomous prompt execution`,
        `  ${rgb(...s.gold)}-t, --target <target>${c.reset}      Execution target (local_mac, dgx_spark, container)`,
        `  ${rgb(...s.gold)}-m, --model <id>${c.reset}           Neural LLM model ID`,
        `  ${rgb(...s.gold)}-w, --workspace <dir>${c.reset}      Active working directory`,
        `  ${rgb(...s.gold)}--skin <name>${c.reset}              Skin: cyberpunk, matrix, ember, nord, synthwave`,
        `  ${rgb(...s.gold)}-r, --max-rounds <n>${c.reset}       Max autonomous tool turns (default: 50)`,
        `  ${rgb(...s.gold)}--plan${c.reset}                    Force 4-pillar cognitive deliberation & plan synthesis`,
        `  ${rgb(...s.gold)}--review-plan${c.reset}             Pause for plan review & steering before tool execution`,
        `  ${rgb(...s.gold)}--fast${c.reset}                    Bypass planning pass for immediate ad-hoc execution`,
        `  ${rgb(...s.gold)}--deep-build${c.reset}               Strict verification mode (zero placeholders)`,
        `  ${rgb(...s.gold)}-O, --optimize${c.reset}             Enable chat response optimizer policy`,
        `  ${rgb(...s.gold)}-s, --status${c.reset}               Probe and display ecosystem telemetry dashboard`,
        `  ${rgb(...s.gold)}-v, --verbose${c.reset}              Print verbose debug traces`,
        `  ${rgb(...s.gold)}-h, --help${c.reset}                 Show this help manual`,
        ``,
        `${rgb(...s.accent)}\x1b[1mExamples:${c.reset}`,
        `  ${rgb(...s.muted)}./aiui "Run pytest on test_api.py and fix failures"${c.reset}`,
        `  ${rgb(...s.muted)}./aiui -t dgx_spark --skin synthwave "nvidia-smi metrics"${c.reset}`,
        `  ${rgb(...s.muted)}./aiui status${c.reset}`,
        `  ${rgb(...s.muted)}./aiui matrix${c.reset}`,
        `  ${rgb(...s.muted)}./aiui   # Launches interactive REPL with live tools${c.reset}`,
      ];
      console.log(
        '\n' +
          renderCard({
            title: '⚡ AIUI AUTONOMOUS AGENT CLI',
            badge: badge('MANUAL & OPTIONS', s.primary, s.badgeBg),
            lines: helpLines,
            skin: s,
            width: 76,
          }) +
          '\n'
      );
      process.exit(0);
    } else if (a === '-s' || a === '--status' || a === 'status') {
      const s = getSkin(options.skin);
      const spin = new LiveSpinner('Probing ecosystem microservices...', s);
      spin.start();
      const status = await checkServices();
      spin.stop();
      console.log('\n' + renderStatusDashboard(status, s) + '\n');
      process.exit(0);
    } else if (a === 'bench' || a === 'benchmark' || a === '--bench') {
      const benchScript = path.resolve(ROOT_DIR, 'scripts/benchmark.mjs');
      const proc = spawn('node', [benchScript, ...argv.slice(i + 1)], { stdio: 'inherit' });
      proc.on('exit', (code) => process.exit(code || 0));
      return;
    } else if (a === 'monitor' || a === '--monitor' || a === 'traffic') {
      const monitorScript = path.resolve(ROOT_DIR, 'scripts/monitor-agent-responses.mjs');
      const proc = spawn('node', [monitorScript, ...argv.slice(i + 1)], { stdio: 'inherit' });
      proc.on('exit', (code) => process.exit(code || 0));
      return;
    } else if (a === 'matrix' || a === '--matrix') {
      const matrixScript = path.resolve(ROOT_DIR, 'scripts/matrix.sh');
      const proc = spawn('bash', [matrixScript], { stdio: 'inherit' });
      proc.on('exit', (code) => process.exit(code || 0));
      return;
    } else if (a === 'tools' || a === '--tools') {
      const s = getSkin(options.skin);
      const dynamicTools = dynamicToolManager.getActiveToolDefinitions();
      const allTools = [...AGENT_TOOLS, ...dynamicTools];
      const lines = allTools.map(
        (t) => ` ${rgb(...s.primary)}${t.function.name.padEnd(26)}${c.reset} ${rgb(...s.muted)}${t.function.description.slice(0, 68)}...${c.reset}`
      );
      console.log('\n' + renderCard({
        title: '⚡ ACTIVE AGENT CAPABILITY TOOLS',
        badge: badge(`${allTools.length} TOOLS`, s.primary, s.badgeBg),
        lines,
        skin: s,
        width: 76,
      }) + '\n');
      process.exit(0);
    } else if (a === 'spark' || a === '--spark') {
      const sparkScript = path.resolve(ROOT_DIR, 'scripts/restart-spark.mjs');
      if (fs.existsSync(sparkScript)) {
        const proc = spawn('node', [sparkScript, ...argv.slice(i + 1)], { stdio: 'inherit' });
        proc.on('exit', (code) => process.exit(code || 0));
        return;
      } else {
        const s = getSkin(options.skin);
        const spin = new LiveSpinner(`Probing DGX Spark cluster at ${SPARK_QWEN_HOST}:8000...`, s);
        spin.start();
        try {
          const res = await fetch(`http://${SPARK_QWEN_HOST}:8000/v1/models`, { signal: AbortSignal.timeout(3000) });
          spin.stop();
          if (res.ok) {
            const data = await res.json();
            const modelId = data.data?.[0]?.id || 'unknown';
            console.log(`\n${rgb(...s.success)}✔ DGX Spark vLLM is ONLINE${c.reset} (${SPARK_QWEN_HOST}:8000)`);
            console.log(`  Active Model: ${rgb(...s.primary)}${modelId}${c.reset}\n`);
          } else {
            console.log(`\n${rgb(...s.warning)}⚠️  DGX Spark returned HTTP ${res.status}${c.reset}`);
          }
        } catch (err) {
          spin.stop();
          console.log(`\n${rgb(...s.danger)}✘ DGX Spark is unreachable at http://${SPARK_QWEN_HOST}:8000/v1/models${c.reset}`);
          console.log(`  Error: ${err.message}\n`);
        }
        process.exit(0);
      }
    } else if (a === 'optimize' || a === 'optimise' || a === '--optimize-pass') {
      const agent = new AiuiAgent({ ...options, optimize: true });
      await agent.runOptimizationPass();
      process.exit(0);
    } else if (a === 'init-git' || a === 'connect-repo' || a === '--init-git' || a === '--connect-repo') {
      const s = getSkin(options.skin);
      const res = initGitRepo(options.workspaceDir);
      if (res.success) {
        console.log(`\n${rgb(...s.success)}✔ Git repository connected and initialized in ${options.workspaceDir}${c.reset}`);
        console.log(`  Initialized .git repository and created default .gitignore if missing.`);
        console.log(`  Live diff hunks, status tracking, and automated commit checkpoints are now active.\n`);
      } else {
        console.log(`\n${rgb(...s.danger)}✘ Failed to initialize Git repository: ${res.error}${c.reset}\n`);
      }
      process.exit(0);
    } else if (a === 'diff' || a === '--diff') {
      const s = getSkin(options.skin);
      if (!isGitRepo(options.workspaceDir)) {
        console.log(`\n  ${rgb(...s.warning)}⚠️  Workspace (${options.workspaceDir}) is not a Git repository.${c.reset}`);
        console.log(`  Run ${rgb(...s.primary)}aiui init-git${c.reset} or type ${rgb(...s.primary)}/connect-repo${c.reset} in REPL to initialize and connect.\n`);
        process.exit(0);
      }
      try {
        const diffStat = execSync('git diff --stat', { cwd: options.workspaceDir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
        const statusShort = execSync('git status --short', { cwd: options.workspaceDir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
        const lines = [];
        if (statusShort) {
          lines.push(`${rgb(...s.secondary)}\x1b[1mWorkspace File Status:${c.reset}`);
          statusShort.split('\n').forEach((l) => lines.push(`  ${l}`));
          lines.push('');
        }
        if (diffStat) {
          lines.push(`${rgb(...s.primary)}\x1b[1mDiff Stat (${options.workspaceDir}):${c.reset}`);
          diffStat.split('\n').forEach((l) => lines.push(`  ${l}`));
        } else {
          lines.push(`${rgb(...s.success)}✔ Working tree clean (zero uncommitted diffs)${c.reset}`);
        }
        console.log('\n' + renderCard({
          title: '🔍 GIT SURGICAL DIFF AUDIT',
          badge: badge('CODE INTEGRITY', s.primary, s.badgeBg),
          lines,
          skin: s,
          width: 76,
        }) + '\n');
      } catch (err) {
        console.error(`${c.red}Git diff audit error:${c.reset}`, err.message);
      }
      process.exit(0);
    } else if (a === 'daemons' || a === '--daemons') {
      const s = getSkin(options.skin);
      const list = processManager.list();
      const lines = [];
      if (list.length === 0) {
        lines.push(`${rgb(...s.muted)}No active background daemons managed in this standalone CLI process.${c.reset}`);
        lines.push(`${rgb(...s.muted)}Launch the interactive agent REPL ('aiui') to run background daemons with persistent supervisor lifecycle.${c.reset}`);
      } else {
        for (const d of list) {
          const status = d.alive ? `${rgb(...s.success)}ONLINE${c.reset}` : `${rgb(...s.danger)}STOPPED${c.reset}`;
          lines.push(` ${rgb(...s.gold)}[${d.id}]${c.reset} PID: ${d.pid} | Status: ${status} | Port: ${d.port || 'n/a'} | Up: ${d.uptimeSeconds}s`);
          lines.push(`   ${rgb(...s.muted)}${d.command.slice(0, 68)}${c.reset}`);
        }
      }
      console.log('\n' + renderCard({
        title: '⚡ ACTIVE BACKGROUND DAEMONS',
        badge: badge(`${list.length} DAEMONS`, s.primary, s.badgeBg),
        lines,
        skin: s,
        width: 76,
      }) + '\n');
      process.exit(0);
    } else if (a === 'browser' || a === '--browser') {
      const s = getSkin(options.skin);
      const targetUrl = argv[i + 1] && !argv[i + 1].startsWith('-') ? argv[++i] : 'http://localhost:5173';
      const spin = new LiveSpinner(`Probing headless browser at ${targetUrl}...`, s);
      spin.start();
      try {
        const raw = await browserOpenHandler({ url: targetUrl, headless: true }, { workspaceDir: options.workspaceDir });
        spin.stop();
        const res = typeof raw === 'string' ? JSON.parse(raw) : raw;
        const lines = [
          ` ${rgb(...s.primary)}Target URL:${c.reset}    ${res.url || targetUrl}`,
          ` ${rgb(...s.primary)}Page Title:${c.reset}    ${res.title || 'Untitled'}`,
          ` ${rgb(...s.primary)}Status:${c.reset}        ${res.status || 'OK'}`,
          ` ${rgb(...s.primary)}Engine:${c.reset}        ${res.engine || res.mode || 'Chromium'}`,
        ];
        if (res.errors && res.errors.length > 0) {
          lines.push(``);
          lines.push(`${rgb(...s.danger)}\x1b[1mRuntime Errors Detected (${res.errors.length}):${c.reset}`);
          res.errors.slice(0, 5).forEach((e) => lines.push(`  ${rgb(...s.danger)}✘${c.reset} ${e}`));
        } else {
          lines.push(` ${rgb(...s.success)}✔ Zero runtime / hydration console errors${c.reset}`);
        }
        console.log('\n' + renderCard({
          title: '🌐 HEADLESS BROWSER AUDIT',
          badge: badge(res.ok ? 'SUCCESS' : 'FAILED', res.ok ? s.success : s.danger, s.badgeBg),
          lines,
          skin: s,
          width: 76,
        }) + '\n');
      } catch (err) {
        spin.stop();
        console.error(`${c.red}Browser audit error:${c.reset}`, err.message);
      }
      process.exit(0);
    } else if (a === '--skin') {
      options.skin = argv[++i];
    } else if (a === '-P' || a === '--provider') {
      options.provider = argv[++i];
    } else if (a === '-t' || a === '--target') {
      options.target = argv[++i];
    } else if (a === '-m' || a === '--model') {
      options.model = argv[++i];
    } else if (a === '-w' || a === '--workspace') {
      options.workspaceDir = argv[++i];
    } else if (a === '-r' || a === '--max-rounds' || a === '--rounds') {
      options.maxRounds = parseInt(argv[++i], 10) || 50;
    } else if (a === '--deep-build') {
      options.deepBuild = true;
    } else if (a === '-O' || a === '--optimize' || a === '--optimise') {
      options.optimize = true;
    } else if (a === '-v' || a === '--verbose') {
      options.verbose = true;
    } else if (a === '--plan') {
      options.plan = true;
    } else if (a === '--review-plan' || a === '-i') {
      options.reviewPlan = true;
      options.plan = true;
    } else if (a === '--fast' || a === '--no-plan') {
      options.fast = true;
      options.plan = false;
    } else if (a === '-p' || a === '--prompt') {
      options.prompt = argv[++i];
    } else if (!a.startsWith('-')) {
      const remainingTokens = [a];
      while (i + 1 < argv.length) {
        const next = argv[i + 1];
        if (next.startsWith('-')) break;
        remainingTokens.push(next);
        i++;
      }
      options.prompt = options.prompt ? `${options.prompt} ${remainingTokens.join(' ')}` : remainingTokens.join(' ');
    }
  }

  const agent = new AiuiAgent(options);

  if (options.prompt) {
    await agent.executeTurn(options.prompt);
    process.exit(0);
  } else {
    await agent.startRepl();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  runCli().catch((err) => {
    console.error(`${c.red}Fatal Error:${c.reset}`, err);
    process.exit(1);
  });
}
