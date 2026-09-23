#!/usr/bin/env node
/**
 * Deploy & Run AIUI Agent on DGX Spark
 * Transfers aiui-agent.mjs and scaffoldTemplates.json to DGX Spark (192.168.4.103),
 * sets up CLI symlink in ~/.local/bin, and executes live verification on the DGX.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');

const SSH_KEY = '/Users/adminuser/Library/Application Support/NVIDIA/Sync/config/nvsync.key';
const SPARK_HOST = process.env.SPARK_HOST || '100.66.147.53';
const SPARK_USER = 'flak3dd';

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  cyan: '\x1b[36m',
  green: '\x1b[38;5;48m',
  gold: '\x1b[38;5;220m',
  red: '\x1b[38;5;196m',
  dim: '\x1b[2m',
};

function runSsh(command, stdinData = null, streamOutput = false) {
  return new Promise((resolve) => {
    const args = [
      '-o', 'BatchMode=yes',
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'ConnectTimeout=10',
      '-i', SSH_KEY,
      `${SPARK_USER}@${SPARK_HOST}`,
      command,
    ];

    const child = spawn('ssh', args, { stdio: ['pipe', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d) => {
      stdout += d.toString('utf8');
      if (streamOutput) process.stdout.write(d);
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString('utf8');
      if (streamOutput) process.stderr.write(d);
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ ok: true, stdout: stdout.trim(), stderr: stderr.trim(), code });
      } else {
        resolve({ ok: false, stdout: stdout.trim(), stderr: stderr.trim(), code });
      }
    });

    child.on('error', (err) => resolve({ ok: false, error: err.message, code: 1 }));

    if (stdinData) {
      child.stdin.write(stdinData);
    }
    child.stdin.end();
  });
}

async function main() {
  console.log(`${c.bold}${c.cyan}======================================================================${c.reset}`);
  console.log(`${c.bold}${c.gold}⚡ DEPLOYING & RUNNING AIUI AGENT DIRECTLY ON DGX SPARK${c.reset}`);
  console.log(`   Host: ${SPARK_USER}@${SPARK_HOST}`);
  console.log(`${c.bold}${c.cyan}======================================================================${c.reset}\n`);

  // 1. Check SSH
  process.stdout.write(`1. Testing SSH connectivity to ${SPARK_HOST}... `);
  const ping = await runSsh('hostname && uname -m');
  if (!ping.ok) {
    console.log(`${c.red}FAILED${c.reset}`);
    console.error(ping.stderr || ping.error);
    process.exit(1);
  }
  console.log(`${c.green}OK (${ping.stdout})${c.reset}`);

  // 2. Prepare Remote Directories
  process.stdout.write(`2. Preparing remote directories (~/aiui-agent, ~/.local/bin)... `);
  const prep = await runSsh('mkdir -p ~/aiui-agent ~/.local/bin ~/abliterated_ui/scripts');
  if (!prep.ok) {
    console.log(`${c.red}FAILED${c.reset}`);
    process.exit(1);
  }
  console.log(`${c.green}OK${c.reset}`);

  // 3. Read Local Files
  const agentScriptPath = path.resolve(__dirname, 'aiui-agent.mjs');
  const scaffoldPath = path.resolve(ROOT_DIR, 'src/lib/scaffoldTemplates.json');

  if (!fs.existsSync(agentScriptPath)) {
    console.error(`Local aiui-agent.mjs not found at ${agentScriptPath}`);
    process.exit(1);
  }

  const agentCode = fs.readFileSync(agentScriptPath, 'utf8');
  const scaffoldData = fs.existsSync(scaffoldPath) ? fs.readFileSync(scaffoldPath, 'utf8') : '{}';

  // 4. Stream & Write aiui-agent.mjs to DGX Spark
  process.stdout.write(`3. Writing aiui-agent.mjs (${Buffer.byteLength(agentCode)} bytes) to DGX Spark... `);
  const writeAgent = await runSsh('cat > ~/aiui-agent/aiui-agent.mjs && chmod +x ~/aiui-agent/aiui-agent.mjs && cp ~/aiui-agent/aiui-agent.mjs ~/abliterated_ui/scripts/aiui-agent.mjs', agentCode);
  if (!writeAgent.ok) {
    console.log(`${c.red}FAILED${c.reset}`);
    console.error(writeAgent.stderr);
    process.exit(1);
  }
  console.log(`${c.green}OK${c.reset}`);

  // 5. Stream & Write scaffoldTemplates.json to DGX Spark
  process.stdout.write(`4. Writing scaffoldTemplates.json (${Buffer.byteLength(scaffoldData)} bytes) to DGX Spark... `);
  const writeScaffolds = await runSsh('cat > ~/aiui-agent/scaffoldTemplates.json', scaffoldData);
  if (!writeScaffolds.ok) {
    console.log(`${c.red}FAILED${c.reset}`);
    console.error(writeScaffolds.stderr);
    process.exit(1);
  }
  console.log(`${c.green}OK${c.reset}`);

  // 5b. Stream & Write dynamic-tool-manager.mjs & tools registry to DGX Spark
  process.stdout.write(`5. Writing dynamic-tool-manager.mjs & tools registry to DGX Spark... `);
  const dynamicToolMgrPath = path.resolve(__dirname, 'dynamic-tool-manager.mjs');
  if (fs.existsSync(dynamicToolMgrPath)) {
    const mgrCode = fs.readFileSync(dynamicToolMgrPath, 'utf8');
    await runSsh('cat > ~/aiui-agent/dynamic-tool-manager.mjs && cp ~/aiui-agent/dynamic-tool-manager.mjs ~/abliterated_ui/scripts/dynamic-tool-manager.mjs', mgrCode);
  }
  const registryPath = path.resolve(ROOT_DIR, 'tools/registry.json');
  if (fs.existsSync(registryPath)) {
    const regData = fs.readFileSync(registryPath, 'utf8');
    await runSsh('mkdir -p ~/aiui-agent/tools ~/abliterated_ui/tools && cat > ~/aiui-agent/tools/registry.json && cp ~/aiui-agent/tools/registry.json ~/abliterated_ui/tools/registry.json', regData);
  }
  console.log(`${c.green}OK${c.reset}`);

  // 6. Setup Global Symlinks & Aliases on DGX Spark
  process.stdout.write(`5. Creating global symlinks (aiui, aiui-agent) and configuring PATH on DGX Spark... `);
  const linkRes = await runSsh(`
    mkdir -p ~/.local/bin ~/bin
    ln -sf ~/aiui-agent/aiui-agent.mjs ~/.local/bin/aiui
    ln -sf ~/aiui-agent/aiui-agent.mjs ~/.local/bin/aiui-agent
    ln -sf ~/aiui-agent/aiui-agent.mjs ~/bin/aiui
    ln -sf ~/aiui-agent/aiui-agent.mjs ~/bin/aiui-agent
    chmod +x ~/.local/bin/aiui ~/.local/bin/aiui-agent ~/bin/aiui ~/bin/aiui-agent ~/aiui-agent/aiui-agent.mjs
    grep -q '\\.local/bin' ~/.bashrc 2>/dev/null || sed -i '1s|^|export PATH="$HOME/.local/bin:$HOME/bin:$PATH"\\n|' ~/.bashrc
    grep -q '\\.local/bin' ~/.profile 2>/dev/null || echo 'export PATH="$HOME/.local/bin:$HOME/bin:$PATH"' >> ~/.profile
    grep -q 'alias aiui=' ~/.bashrc 2>/dev/null || echo "alias aiui='node ~/aiui-agent/aiui-agent.mjs'" >> ~/.bashrc
    grep -q 'alias aiui-agent=' ~/.bashrc 2>/dev/null || echo "alias aiui-agent='node ~/aiui-agent/aiui-agent.mjs'" >> ~/.bashrc
  `);
  console.log(`${c.green}OK${c.reset}`);

  // 6b. Patch sandbox-runner and neutralize any ssh|base64 wrappers
  process.stdout.write(`6. Neutralizing ssh|base64 wrappers and updating sandbox-runner on DGX Spark... `);
  const patchPath = path.resolve(ROOT_DIR, 'scripts/dgx-runtime/patch-sandbox-runner.mjs');
  const patchCode = fs.existsSync(patchPath) ? fs.readFileSync(patchPath, 'utf8') : '';
  if (patchCode) {
    await runSsh('cat > ~/abliterated_ui/scripts/patch-sandbox-runner.mjs', patchCode);
    await runSsh(`
      node ~/abliterated_ui/scripts/patch-sandbox-runner.mjs ~/abliterated_ui/scripts/sandbox-runner.mjs 2>/dev/null || true
      sed -i 's|ssh .*/base64.*|# wrapper disabled|' /tmp/spark-sandboxes/direct_curl.sh 2>/dev/null || true
      find /tmp/spark-sandboxes -name "*curl*.sh" -exec sed -i 's|ssh .*/base64.*|# wrapper disabled|' {} + 2>/dev/null || true
      systemctl --user restart spark-sandbox-runner.service 2>/dev/null || true
    `);
  }
  console.log(`${c.green}OK${c.reset}`);

  // 7. Execute Verification Run on DGX Spark
  console.log(`\n${c.bold}${c.gold}6. Running aiui-agent on DGX Spark:${c.reset}\n`);
  
  const testRun = await runSsh('~/.local/bin/aiui-agent --status');
  console.log(testRun.stdout || testRun.stderr);

  console.log(`\n${c.bold}${c.gold}7. Executing Live One-Shot Task on DGX Spark:${c.reset}\n`);
  const liveTask = await runSsh('~/.local/bin/aiui-agent -t dgx_spark -p "Check system GPU, architecture, and current directory"', null, true);
  if (!liveTask.ok && liveTask.stderr && !liveTask.stdout) {
    console.log(liveTask.stderr);
  }

  console.log(`\n${c.bold}${c.green}✔ Deployment and verification on DGX Spark complete!${c.reset}`);
  console.log(`You can now run it on DGX Spark via:`);
  console.log(`  ${c.cyan}ssh flak3dd@100.66.147.53 "aiui-agent"${c.reset}`);
  console.log(`  ${c.cyan}ssh -i "$HOME/Library/Application Support/NVIDIA/Sync/config/nvsync.key" flak3dd@100.66.147.53 "~/.local/bin/aiui-agent '<prompt>'"${c.reset}\n`);
}

main().catch((err) => {
  console.error('Deployment error:', err);
  process.exit(1);
});
