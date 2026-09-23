import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  SANDBOX_RUNNER_URL,
  SSH_KEY,
  SPARK_HOST,
  SPARK_USER,
  isRunningOnSpark,
  normalizeSandboxPath,
} from '../../config.mjs';
import { resolveFlexibleFilePath } from '../../core/workflow-optimizer.mjs';
import { runBashFromCtx, resolveExecutionTarget } from './bash.mjs';

// In-memory read file cache (20s TTL)
export const fileReadCache = new Map();

function allowHostExec() {
  return process.env.AIUI_ALLOW_HOST_EXEC === '1';
}

function assertWithinWorkspace(dest, workspaceDir) {
  const root = path.resolve(workspaceDir || process.cwd());
  const resolved = path.resolve(dest);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`Path escapes workspace: ${dest}`);
  }
  return resolved;
}

/**
 * Handle write_file tool invocation.
 * Supports direct local/Spark filesystem write (host override only), runner API, and SSH stdin streaming (zero base64).
 */
export async function writeFileHandler(args, ctx) {
  fileReadCache.clear();
  const rawPath = String(args.path || args.filename || '').trim();
  const content = String(args.content ?? '');
  const target = resolveExecutionTarget(
    rawPath,
    args.target || ctx.target,
    ctx.workspaceDir || process.cwd(),
  );
  if (!rawPath) return JSON.stringify({ ok: false, error: 'Path required' });

  const normalized = normalizeSandboxPath(rawPath, ctx.envId);
  if (ctx.filesInspected) {
    ctx.filesInspected.delete(normalized);
    ctx.filesInspected.delete(rawPath);
  }

  // Strip any accidental line numbers from write_file content
  let cleanContent = content;
  if (/^\s*\d{1,5}\s*\|\s/m.test(cleanContent)) {
    cleanContent = cleanContent.replace(/^\s*\d{1,5}\s*\|\s?/gm, '');
  }

  const isLocalTarget = target === 'local' || target === 'local_mac' || target === 'local_client';
  // Direct host filesystem write only with explicit operator override (or native Spark)
  if ((isLocalTarget && allowHostExec()) || isRunningOnSpark()) {
    try {
      const dest = path.isAbsolute(rawPath) ? rawPath : path.resolve(ctx.workspaceDir, rawPath);
      assertWithinWorkspace(dest, ctx.workspaceDir);
      if (ctx.filesInspected) {
        ctx.filesInspected.delete(dest);
      }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, cleanContent, 'utf8');
      return JSON.stringify({
        ok: true,
        path: dest,
        bytes: Buffer.byteLength(cleanContent, 'utf8'),
        exitCode: 0,
        message: `Successfully wrote ${dest} (${cleanContent.length} bytes)`,
      });
    } catch (err) {
      return JSON.stringify({ ok: false, error: err.message });
    }
  }

  // Attempt runner materialize API first
  try {
    const res = await fetch(`${SANDBOX_RUNNER_URL}/api/sandbox/materialize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        envId: ctx.envId,
        target,
        files: { [normalized]: { content } },
        replaceAll: false,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) {
      return JSON.stringify({
        ok: true,
        path: normalized,
        bytes: Buffer.byteLength(content, 'utf8'),
        exitCode: 0,
        message: `Successfully wrote ${normalized} (${content.length} bytes)`,
      });
    }
  } catch {}

  // Direct SSH stdin streaming write fallback (ZERO base64)
  if (target === 'dgx_spark' && !isRunningOnSpark()) {
    try {
      const keyClean = SSH_KEY.replace(/^"|"$/g, '');
      const dirName = path.dirname(normalized);
      await new Promise((resolve, reject) => {
        const child = spawn(
          'ssh',
          [
            '-o', 'BatchMode=yes',
            '-o', 'ConnectTimeout=10',
            '-o', 'StrictHostKeyChecking=no',
            '-i', keyClean,
            `${SPARK_USER}@${SPARK_HOST}`,
            `mkdir -p ${JSON.stringify(dirName)} && cat > ${JSON.stringify(normalized)}`,
          ],
          { stdio: ['pipe', 'pipe', 'pipe'] }
        );
        child.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`SSH write exit code ${code}`));
        });
        child.on('error', reject);
        child.stdin.write(content);
        child.stdin.end();
      });
      return JSON.stringify({
        ok: true,
        path: normalized,
        bytes: Buffer.byteLength(content, 'utf8'),
        exitCode: 0,
        message: `Successfully wrote ${normalized} (${content.length} bytes)`,
      });
    } catch {}
  }

  // Local or container heredoc fallback
  const delim = '__AIUI_EOF_' + Math.random().toString(36).slice(2) + '__';
  const cmd = `mkdir -p "$(dirname "${normalized}")" && cat << '${delim}' > "${normalized}"\n${content}\n${delim}`;
  const bRes = await runBashFromCtx(ctx, cmd, target);
  return JSON.stringify({
    ok: bRes.ok,
    path: normalized,
    bytes: Buffer.byteLength(content, 'utf8'),
    exitCode: bRes.exitCode,
    error: bRes.ok ? undefined : bRes.stderr,
  });
}

/**
 * Handle read_file tool invocation.
 * Supports line slicing, numbered formatting, and memory inspection cache.
 */
export async function readFileHandler(args, ctx) {
  const rawPath = String(args.path || args.filename || '').trim();
  const target = resolveExecutionTarget(
    rawPath,
    args.target || ctx.target,
    ctx.workspaceDir || process.cwd(),
  );
  if (!rawPath) return JSON.stringify({ ok: false, error: 'Path required' });

  const startLine = Math.max(1, parseInt(args.start_line || args.startLine, 10) || 1);
  const lineCount = parseInt(args.line_count || args.lineCount || args.lines, 10) || null;
  const normalized = normalizeSandboxPath(rawPath, ctx.envId);

  // Fast-path: local host read only with explicit override (or native Spark)
  if (
    ((target === 'local' || target === 'local_mac' || target === 'local_client') && allowHostExec()) ||
    isRunningOnSpark()
  ) {
    try {
      let dest = path.isAbsolute(rawPath) ? rawPath : path.resolve(ctx.workspaceDir, rawPath);
      assertWithinWorkspace(dest, ctx.workspaceDir);
      if (!fs.existsSync(dest)) {
        const flexible = resolveFlexibleFilePath(rawPath, ctx.workspaceDir);
        if (flexible && fs.existsSync(flexible)) {
          dest = flexible;
        }
      }

      if (fs.existsSync(dest)) {
        const rawContent = fs.readFileSync(dest, 'utf8');
        const allLines = rawContent.split('\n');
        const totalLines = allLines.length;

        const sliceCount = lineCount ? Math.min(lineCount, totalLines - startLine + 1) : totalLines;
        const selectedLines = allLines.slice(startLine - 1, startLine - 1 + sliceCount);

        const numberedLines = selectedLines
          .map((line, idx) => `${String(startLine + idx).padStart(4, ' ')} | ${line}`)
          .join('\n');

        if (ctx.filesInspected) {
          ctx.filesInspected.set(dest, {
            path: dest,
            startLine,
            lineCount: selectedLines.length,
            totalLines,
            ts: Date.now(),
          });
        }

        return JSON.stringify({
          ok: true,
          path: dest,
          startLine,
          lineCount: selectedLines.length,
          totalLines,
          content: numberedLines,
          exitCode: 0,
        });
      } else {
        return JSON.stringify({ ok: false, error: `File not found: ${dest}`, exitCode: 1 });
      }
    } catch (err) {
      return JSON.stringify({ ok: false, error: err.message, exitCode: 1 });
    }
  }

  const cacheKey = `${target}:${normalized}:${startLine}:${lineCount || 'all'}`;
  const cached = fileReadCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < 20000) {
    return JSON.stringify({
      ok: cached.exitCode === 0,
      path: normalized,
      content: cached.content,
      cached: true,
    });
  }

  const cmd = lineCount
    ? `sed -n '${startLine},${startLine + lineCount - 1}p' "${normalized}" | awk '{printf "%4d | %s\\n", NR+${startLine - 1}, $0}'`
    : `awk '{printf "%4d | %s\\n", NR, $0}' "${normalized}"`;
  const res = await runBashFromCtx(ctx, cmd, target);
  if (res.ok) {
    fileReadCache.set(cacheKey, { content: res.stdout, exitCode: res.exitCode, ts: Date.now() });
    if (ctx.filesInspected) {
      ctx.filesInspected.set(normalized, {
        path: normalized,
        startLine,
        lineCount: lineCount || 'all',
        ts: Date.now(),
      });
    }
  }
  return JSON.stringify({
    ok: res.ok,
    path: normalized,
    content: res.stdout,
    exitCode: res.exitCode,
    error: res.ok ? undefined : res.stderr,
  });
}
