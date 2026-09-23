import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import util from 'node:util';
import { exec, spawn } from 'node:child_process';
import {
  ROOT_DIR,
  SANDBOX_RUNNER_URL,
  SSH_KEY,
  SPARK_HOST,
  SPARK_USER,
  isRunningOnSpark,
} from '../../config.mjs';

const execP = util.promisify(exec);

/** Once Spark SSH returns connection refused, skip further SSH for this turn. */
let sparkSshDownReason = null;

export function resetSparkSshCircuit() {
  sparkSshDownReason = null;
}

export function isSparkSshDown() {
  return Boolean(sparkSshDownReason);
}

function markSparkSshDown(detail = '') {
  const msg = String(detail || 'Connection refused').trim().slice(0, 240);
  sparkSshDownReason = msg || 'Connection refused';
}

function allowHostExec() {
  return process.env.AIUI_ALLOW_HOST_EXEC === '1';
}

function isLocalMacWorkspace(workspaceDir = process.cwd()) {
  const wd = path.resolve(workspaceDir || process.cwd());
  if (wd.startsWith('/Users/')) return true;
  const root = ROOT_DIR ? path.resolve(ROOT_DIR) : '';
  if (root && (wd === root || wd.startsWith(root + path.sep))) return true;
  const home = process.env.HOME || os.homedir();
  if (home) {
    for (const leaf of ['AIUI', 'aiui']) {
      const candidate = path.resolve(home, leaf);
      if (wd === candidate || wd.startsWith(candidate + path.sep)) return true;
    }
  }
  return false;
}

function commandImpliesSparkRemote(command = '') {
  return /\/tmp\/spark-sandboxes\b|\/mnt\/nvme\b|\bnvidia-smi\b/i.test(String(command || ''));
}

/**
 * True when the command clearly targets Mac host paths / this workspace.
 * Those must never be classified as Spark SSH work.
 */
export function commandImpliesLocalMac(command = '', workspaceDir = process.cwd()) {
  const cmd = String(command || '');
  if (!cmd) return false;
  if (/(?:^|[\s"'=`])\/Users\//.test(cmd) || cmd.includes('/Users/')) return true;

  const roots = [
    ROOT_DIR,
    workspaceDir,
    process.env.HOME ? path.join(process.env.HOME, 'AIUI') : '',
    process.env.HOME ? path.join(process.env.HOME, 'aiui') : '',
  ]
    .filter(Boolean)
    .map((p) => path.resolve(p));

  for (const root of roots) {
    if (root && cmd.includes(root)) return true;
  }
  return false;
}

/**
 * Resolve the real execution target. Mac paths and the local Mac workspace
 * never route over Spark SSH, even if the model/active target says dgx_spark.
 */
export function resolveExecutionTarget(command, requestedTarget, workspaceDir = process.cwd()) {
  const raw = requestedTarget || 'local_mac';
  const t =
    raw === 'local' || raw === 'local_mac' || raw === 'local_client' ? 'local_mac' : raw;

  if (t === 'container') return 'container';

  if (commandImpliesLocalMac(command, workspaceDir)) {
    return 'local_mac';
  }

  if (t === 'dgx_spark' && isLocalMacWorkspace(workspaceDir) && !commandImpliesSparkRemote(command)) {
    return 'local_mac';
  }

  return t;
}

/** Test helper: true only when the command would still be treated as Spark remote. */
export function isClassifiedAsSparkSshCommand(
  command,
  requestedTarget = 'dgx_spark',
  workspaceDir = process.cwd(),
) {
  return resolveExecutionTarget(command, requestedTarget, workspaceDir) === 'dgx_spark';
}

function hostExecDenied(command, t0, target = 'local_mac') {
  return {
    ok: false,
    command,
    stdout: '',
    stderr:
      'Host execution is disabled by default. Set AIUI_ALLOW_HOST_EXEC=1 to override, or use the sandbox runner.',
    exitCode: 1,
    durationMs: Math.round(performance.now() - t0),
    target,
  };
}

/**
 * Resolves verification gates, non-shell tools, and assertions to safe bash commands.
 */
export function resolveVerificationGateCommand(rawGate) {
  if (!rawGate || typeof rawGate !== 'string') {
    return 'git status --short 2>/dev/null || ls -lah';
  }

  let clean = rawGate
    .replace(/\s*[/;]\s*(?:exitCode\s*===?\s*0|exit\s*0)\b/gi, '')
    .replace(/\s*&&\s*(?:exitCode\s*===?\s*0)\b/gi, '')
    .replace(/\s*\[.*exit.*\]/gi, '')
    .trim();

  if (/^grep_search\b/i.test(clean)) {
    return 'git status --short 2>/dev/null || ls -lah';
  }
  if (/^(?:replace_file_content|write_to_file|write_file|multi_replace_file_content)\b/i.test(clean)) {
    return 'git diff --stat 2>/dev/null || git status --short 2>/dev/null || ls -lah';
  }
  if (/^ast\b/i.test(clean) || /ast symbol analysis/i.test(clean)) {
    return 'node -c *.js 2>/dev/null || git status --short 2>/dev/null || ls -lah';
  }
  if (/^(?:exitCode\s*===?\s*0|exit\s*0|0)$/i.test(clean) || !clean) {
    return 'git status --short 2>/dev/null || ls -lah';
  }
  if (/^npm\s+(?:run\s+)?test\b/i.test(clean) && !clean.includes('test -f package.json')) {
    return `test -f package.json && ${clean} || { echo "ℹ️ No package.json found in workspace — checking git status:"; git status --short 2>/dev/null || ls -lah; }`;
  }
  if (/^node\s+--test\b/i.test(clean)) {
    return 'node --test 2>/dev/null || git status --short 2>/dev/null || ls -lah';
  }

  const knownBinaries = /^(?:git|npm|npx|pnpm|yarn|bun|node|python|python3|pytest|cargo|go|make|docker|kubectl|curl|sh|bash|zsh|ls|cat|find|grep|stat|head|tail|test|diff|echo|uname|whoami|hostname|pwd|date|env|printenv|which|true|false)\b/i;
  if (knownBinaries.test(clean)) {
    return clean;
  }

  return 'git status --short 2>/dev/null || ls -lah';
}

/**
 * Execute a bash command via sandbox runner by default.
 * Host exec requires AIUI_ALLOW_HOST_EXEC=1. Native Spark still runs on the sandbox host.
 * Mac-path / local-workspace commands are forced to local_mac (never Spark SSH).
 */
export async function executeBashCommand(command, target = 'local', workspaceDir = process.cwd(), envId = 'web_session') {
  const t0 = performance.now();
  const safeCmd = resolveVerificationGateCommand(command);
  const effectiveTarget = resolveExecutionTarget(safeCmd, target, workspaceDir);
  const isLocal = effectiveTarget === 'local_mac';
  const hostOk = allowHostExec();

  // Fast-path: explicit operator override for host exec
  if (isLocal && hostOk) {
    try {
      if (!fs.existsSync(workspaceDir)) {
        fs.mkdirSync(workspaceDir, { recursive: true });
      }
      const { stdout, stderr } = await execP(safeCmd, { cwd: workspaceDir, timeout: 60000 });
      return {
        ok: true,
        command: safeCmd,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: 0,
        durationMs: Math.round(performance.now() - t0),
        target: 'local_mac',
      };
    } catch (err) {
      return {
        ok: false,
        command: safeCmd,
        stdout: (err.stdout || '').trim(),
        stderr: (err.stderr || err.message || '').trim(),
        exitCode: err.code ?? 1,
        durationMs: Math.round(performance.now() - t0),
        target: 'local_mac',
      };
    }
  }

  // Fast-path: When running natively on DGX Spark, execute directly
  if (isRunningOnSpark()) {
    try {
      if (!fs.existsSync(workspaceDir)) {
        fs.mkdirSync(workspaceDir, { recursive: true });
      }
      const { stdout, stderr } = await execP(safeCmd, { cwd: workspaceDir, timeout: 60000 });
      return {
        ok: true,
        command: safeCmd,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: 0,
        durationMs: Math.round(performance.now() - t0),
        target: 'dgx_spark',
      };
    } catch (err) {
      return {
        ok: false,
        command: safeCmd,
        stdout: (err.stdout || '').trim(),
        stderr: (err.stderr || err.message || '').trim(),
        exitCode: err.code ?? 1,
        durationMs: Math.round(performance.now() - t0),
        target: 'dgx_spark',
      };
    }
  }

  // 1. Try Runner HTTP API (default path for local clients)
  // Local Mac work stays local_mac — never rewrite to dgx_spark.
  try {
    const res = await fetch(`${SANDBOX_RUNNER_URL}/api/sandbox/exec`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cmd: safeCmd,
        target: effectiveTarget,
        envId,
        cwd: workspaceDir,
      }),
      signal: AbortSignal.timeout(60000),
    });

    if (res.ok) {
      const json = await res.json();
      return {
        ok: json.exitCode === 0,
        command: safeCmd,
        stdout: json.stdout || '',
        stderr: json.stderr || '',
        exitCode: json.exitCode ?? 0,
        durationMs: Math.round(performance.now() - t0),
        target: effectiveTarget,
      };
    }
  } catch {
    // Runner unreachable
  }

  if (isLocal && !hostOk) {
    return hostExecDenied(safeCmd, t0);
  }

  // 2. Direct Fallback: SSH on Spark (Direct stdin stream — ZERO base64 pipeline)
  if (effectiveTarget === 'dgx_spark') {
    if (sparkSshDownReason) {
      return {
        ok: false,
        command: safeCmd,
        stdout: '',
        stderr: `Spark SSH is down (${SPARK_HOST}): ${sparkSshDownReason}. Not retrying SSH this turn.`,
        exitCode: 255,
        durationMs: Math.round(performance.now() - t0),
        target: 'dgx_spark',
      };
    }
    try {
      const remoteScript = `mkdir -p ${JSON.stringify(workspaceDir)} && cd ${JSON.stringify(workspaceDir)} && ${safeCmd}`;
      const keyClean = SSH_KEY.replace(/^"|"$/g, '');
      const res = await new Promise((resolve, reject) => {
        const sshArgs = [
          '-o', 'BatchMode=yes',
          '-o', 'ConnectTimeout=10',
          '-o', 'StrictHostKeyChecking=no',
        ];
        if (keyClean && fs.existsSync(keyClean)) {
          sshArgs.push('-i', keyClean);
        }
        sshArgs.push(`${SPARK_USER}@${SPARK_HOST}`, 'bash -s');
        const child = spawn('ssh', sshArgs, { stdio: ['pipe', 'pipe', 'pipe'] });

        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (d) => { stdout += d.toString(); });
        child.stderr.on('data', (d) => { stderr += d.toString(); });
        child.on('close', (code) => {
          resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: code ?? 0 });
        });
        child.on('error', reject);

        child.stdin.write(remoteScript);
        child.stdin.end();
      });

      const isSshConnError = res.exitCode !== 0 && /connect to host|connection refused|operation timed out|no route to host/i.test(res.stderr);
      if (isSshConnError) {
        markSparkSshDown(res.stderr || 'Connection refused');
        if (!hostOk) {
          return {
            ok: false,
            command: safeCmd,
            stdout: '',
            stderr:
              (res.stderr ? res.stderr + '\n' : '') +
              `Spark SSH is down (${SPARK_HOST}). Not retrying SSH this turn. Host fallback disabled (set AIUI_ALLOW_HOST_EXEC=1 to override).`,
            exitCode: 255,
            durationMs: Math.round(performance.now() - t0),
            target: 'dgx_spark',
          };
        }
        try {
          const { stdout, stderr } = await execP(safeCmd, { cwd: workspaceDir, timeout: 60000 });
          return {
            ok: true,
            command: safeCmd,
            stdout: stdout.trim(),
            stderr: (stderr ? stderr.trim() + '\n' : '') + `[NOTICE: DGX Spark (${SPARK_HOST}) SSH unreachable; executed command locally on Mac host]`,
            exitCode: 0,
            durationMs: Math.round(performance.now() - t0),
            target: 'local_mac (fallback)',
          };
        } catch (localErr) {
          return {
            ok: false,
            command: safeCmd,
            stdout: (localErr.stdout || '').trim(),
            stderr: (localErr.stderr || localErr.message || '').trim(),
            exitCode: localErr.code ?? 1,
            durationMs: Math.round(performance.now() - t0),
            target: 'local_mac (fallback)',
          };
        }
      }

      return {
        ok: res.exitCode === 0,
        command: safeCmd,
        stdout: res.stdout,
        stderr: res.stderr,
        exitCode: res.exitCode,
        durationMs: Math.round(performance.now() - t0),
        target: 'dgx_spark',
      };
    } catch (err) {
      const errMsg = err.message || String(err);
      if (/connect to host|connection refused|operation timed out|no route to host/i.test(errMsg)) {
        markSparkSshDown(errMsg);
      }
      if (!hostOk) {
        return {
          ok: false,
          command: safeCmd,
          stdout: '',
          stderr:
            (errMsg ? errMsg + '\n' : '') +
            (sparkSshDownReason
              ? `Spark SSH is down (${SPARK_HOST}). Not retrying SSH this turn. `
              : '') +
            'Host fallback disabled (set AIUI_ALLOW_HOST_EXEC=1 to override).',
          exitCode: 255,
          durationMs: Math.round(performance.now() - t0),
          target: 'dgx_spark',
        };
      }
      try {
        const { stdout, stderr } = await execP(safeCmd, { cwd: workspaceDir, timeout: 60000 });
        return {
          ok: true,
          command: safeCmd,
          stdout: stdout.trim(),
          stderr: (stderr ? stderr.trim() + '\n' : '') + `[NOTICE: DGX Spark (${SPARK_HOST}) SSH failed; executed command locally on Mac host]`,
          exitCode: 0,
          durationMs: Math.round(performance.now() - t0),
          target: 'local_mac (fallback)',
        };
      } catch (localErr) {
        return {
          ok: false,
          command: safeCmd,
          stdout: (localErr.stdout || '').trim(),
          stderr: (localErr.stderr || localErr.message || '').trim(),
          exitCode: localErr.code ?? 1,
          durationMs: Math.round(performance.now() - t0),
          target: 'local_mac (fallback)',
        };
      }
    }
  }

  if (!hostOk) {
    return hostExecDenied(safeCmd, t0);
  }

  try {
    const { stdout, stderr } = await execP(safeCmd, { cwd: workspaceDir, timeout: 60000 });
    return {
      ok: true,
      command: safeCmd,
      stdout: stdout.trim(),
      stderr: stderr.trim(),
      exitCode: 0,
      durationMs: Math.round(performance.now() - t0),
      target: 'local_mac',
    };
  } catch (err) {
    return {
      ok: false,
      command: safeCmd,
      stdout: (err.stdout || '').trim(),
      stderr: (err.stderr || err.message || '').trim(),
      exitCode: err.code ?? 1,
      durationMs: Math.round(performance.now() - t0),
      target: 'local_mac',
    };
  }
}

/**
 * Tool handler for bash
 */
export async function runBashFromCtx(ctx = {}, command, target) {
  const chosen = resolveExecutionTarget(
    command,
    target || ctx.target || 'local_mac',
    ctx.workspaceDir || process.cwd(),
  );
  if (typeof ctx.runBash === 'function') return ctx.runBash(command, chosen)
  return executeBashCommand(command, chosen, ctx.workspaceDir || process.cwd(), ctx.envId || 'web_session')
}

export async function bashToolHandler(args, ctx) {
  const res = await runBashFromCtx(ctx, args.command || args.cmd, args.target || ctx?.target)
  return JSON.stringify({
    ok: res.ok,
    command: res.command,
    exitCode: res.exitCode,
    durationMs: res.durationMs,
    target: res.target,
    stdout: res.stdout,
    stderr: res.stderr,
  });
}

/**
 * Tool handler for ssh (Zero base64 pipeline wrapping)
 */
export async function sshToolHandler(args, ctx) {
  const cmd = String(args.command || args.cmd || '').trim();
  const host = args.host || SPARK_HOST;
  const user = args.user || SPARK_USER;
  const port = args.port || 22;
  const timeoutSec = Math.min(120, Math.max(5, Number(args.timeoutSeconds || 60)));

  if (!cmd) return JSON.stringify({ ok: false, error: 'Command is required for ssh tool' });

  const t0 = performance.now();
  const isDefaultSparkHost = host === SPARK_HOST;
  if (isDefaultSparkHost && sparkSshDownReason) {
    return JSON.stringify({
      ok: false,
      command: cmd,
      host,
      user,
      port,
      stdout: '',
      stderr: `Spark SSH is down (${host}): ${sparkSshDownReason}. Not retrying SSH this turn.`,
      exitCode: 255,
      durationMs: Math.round(performance.now() - t0),
    });
  }
  try {
    const keyClean = SSH_KEY.replace(/^"|"$/g, '');
    const res = await new Promise((resolve, reject) => {
      const sshArgs = [
        '-o', 'BatchMode=yes',
        '-o', `ConnectTimeout=${Math.min(10, timeoutSec)}`,
        '-o', 'StrictHostKeyChecking=no',
        '-p', String(port),
      ];
      if (keyClean && fs.existsSync(keyClean)) {
        sshArgs.push('-i', keyClean);
      }
      sshArgs.push(`${user}@${host}`, 'bash -s');
      const child = spawn('ssh', sshArgs, { stdio: ['pipe', 'pipe', 'pipe'] });

      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => { stdout += d.toString(); });
      child.stderr.on('data', (d) => { stderr += d.toString(); });
      child.on('close', (code) => {
        resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: code ?? 0 });
      });
      child.on('error', reject);

      child.stdin.write(cmd);
      child.stdin.end();
    });

    const isSshConnError =
      res.exitCode !== 0 &&
      /connect to host|connection refused|operation timed out|no route to host/i.test(res.stderr);
    if (isDefaultSparkHost && isSshConnError) {
      markSparkSshDown(res.stderr || 'Connection refused');
    }

    return JSON.stringify({
      ok: res.exitCode === 0,
      command: cmd,
      host,
      user,
      port,
      stdout: res.stdout,
      stderr: isSshConnError
        ? `${res.stderr}\nSpark SSH is down (${host}). Not retrying SSH this turn.`
        : res.stderr,
      exitCode: res.exitCode,
      durationMs: Math.round(performance.now() - t0),
    });
  } catch (err) {
    const errMsg = err.message || String(err);
    if (isDefaultSparkHost && /connect to host|connection refused|operation timed out|no route to host/i.test(errMsg)) {
      markSparkSshDown(errMsg);
    }
    return JSON.stringify({
      ok: false,
      command: cmd,
      host,
      user,
      error: errMsg,
      exitCode: 1,
      durationMs: Math.round(performance.now() - t0),
    });
  }
}
