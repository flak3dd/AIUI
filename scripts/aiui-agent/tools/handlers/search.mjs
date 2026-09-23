/**
 * Fast Code Discovery with Ripgrep and Symbol Outlines
 * Provides grep_search and get_file_outline capabilities.
 * Enables surgical inspection without dumping entire files into context memory.
 */

import { execFileSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { normalizeSandboxPath } from '../../config.mjs';
import { resolveFlexibleFilePath } from '../../core/workflow-optimizer.mjs';

/**
 * Resolves path in workspace or sandbox.
 */
function resolvePath(rawPath, ctx = {}) {
  let cleanPath = String(rawPath || '').trim();
  if (!cleanPath) return null;
  if (ctx.envId) {
    cleanPath = normalizeSandboxPath(cleanPath, ctx.envId);
  }
  let resolved = path.isAbsolute(cleanPath)
    ? cleanPath
    : path.resolve(ctx.workspaceDir || process.cwd(), cleanPath);

  if (fs.existsSync(resolved)) {
    return resolved;
  }

  const flexible = resolveFlexibleFilePath(cleanPath, ctx.workspaceDir || process.cwd());
  if (flexible && fs.existsSync(flexible)) {
    return flexible;
  }

  return resolved;
}

/**
 * Fast code search using ripgrep (rg) with fallback to grep.
 * Supports regex, literal, glob filters, and path scoping.
 *
 * @param {object|string} args - Search options or pattern string
 * @param {object} [ctx] - Runtime context
 * @returns {string} - JSON string response
 */
export async function grepSearchHandler(args, ctx = {}) {
  let pattern;
  let targetPath;
  let globFilter;
  let caseSensitive = false;
  let maxResults = 50;

  if (typeof args === 'string') {
    pattern = args;
    targetPath = arguments[1];
    globFilter = arguments[2];
  } else {
    pattern = args?.pattern || args?.query;
    targetPath = args?.path || args?.cwd || args?.targetPath;
    globFilter = args?.glob;
    caseSensitive = Boolean(args?.case_sensitive || args?.caseSensitive);
    maxResults = parseInt(args?.max_results || args?.limit, 10) || 50;
  }

  if (!pattern || typeof pattern !== 'string') {
    return JSON.stringify({ ok: false, error: 'Search pattern is required', exitCode: 1 });
  }

  const effectiveCwd = ctx.workspaceDir || process.cwd();
  const searchRoot = targetPath ? resolvePath(targetPath, ctx) : effectiveCwd;

  // Build ripgrep arguments
  const rgArgs = [
    '-n',
    '--column',
    '--hidden',
    '--no-heading',
    '--color=never',
    '--max-count', String(maxResults),
    '--glob', '!**/node_modules/**',
    '--glob', '!**/.git/**',
    '--glob', '!**/dist/**',
    '--glob', '!**/build/**',
  ];

  if (!caseSensitive) {
    rgArgs.push('-i');
  }

  if (globFilter) {
    rgArgs.push('--glob', globFilter);
  }

  rgArgs.push('-e', pattern);
  rgArgs.push(searchRoot);

  try {
    const stdout = execFileSync('rg', rgArgs, {
      cwd: effectiveCwd,
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const lines = stdout.trim().split('\n').filter(Boolean);
    const matches = [];

    for (const line of lines.slice(0, maxResults)) {
      // rg format: file:line:col:content
      const match = line.match(/^([^:]+):(\d+):(\d+):(.*)$/);
      if (match) {
        const fileRelative = path.relative(effectiveCwd, match[1]) || match[1];
        matches.push({
          file: fileRelative,
          line: parseInt(match[2], 10),
          column: parseInt(match[3], 10),
          text: match[4].trim(),
        });
      }
    }

    const summaryText = matches
      .map((m) => `${m.file}:${m.line}:${m.column}: ${m.text}`)
      .join('\n');

    return JSON.stringify({
      ok: true,
      pattern,
      matchCount: matches.length,
      matches,
      output: summaryText || 'No matches found.',
      exitCode: 0,
    });
  } catch (err) {
    // ripgrep exit code 1 means 0 matches found (not a system error)
    if (err.status === 1) {
      return JSON.stringify({
        ok: true,
        pattern,
        matchCount: 0,
        matches: [],
        output: `No matches found for "${pattern}"`,
        exitCode: 0,
      });
    }

    // If rg command not found, fallback to standard grep
    try {
      const grepCmd = `grep -rnI --exclude-dir=node_modules --exclude-dir=.git "${pattern.replace(/"/g, '\\"')}" "${searchRoot}" | head -n ${maxResults}`;
      const fallbackOutput = execSync(grepCmd, { cwd: effectiveCwd, encoding: 'utf8' });
      const lines = fallbackOutput.trim().split('\n').filter(Boolean);
      return JSON.stringify({
        ok: true,
        pattern,
        matchCount: lines.length,
        output: lines.join('\n'),
        exitCode: 0,
      });
    } catch {
      return JSON.stringify({
        ok: true,
        pattern,
        matchCount: 0,
        matches: [],
        output: `No matches found for "${pattern}"`,
        exitCode: 0,
      });
    }
  }
}

/**
 * Extracts function, class, and interface signatures with line numbers using regex AST.
 *
 * @param {object|string} args - File path or parameters
 * @param {object} [ctx] - Runtime context
 * @returns {string} - JSON string outline
 */
export async function getFileOutlineHandler(args, ctx = {}) {
  const rawPath = typeof args === 'string' ? args : (args?.filePath || args?.path || args?.filename);
  if (!rawPath) {
    return JSON.stringify({ ok: false, error: 'File path is required', exitCode: 1 });
  }

  let resolved = resolvePath(rawPath, ctx);
  if (!resolved || !fs.existsSync(resolved)) {
    resolved = resolveFlexibleFilePath(rawPath, ctx.workspaceDir || process.cwd());
  }
  if (!resolved || !fs.existsSync(resolved)) {
    return JSON.stringify({ ok: false, error: `File not found: ${rawPath}`, exitCode: 1 });
  }

  try {
    const content = fs.readFileSync(resolved, 'utf8');
    const lines = content.split('\n');
    const outline = [];

    const patterns = [
      { regex: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/, type: 'function' },
      { regex: /^(?:export\s+)?class\s+(\w+)(?:\s+extends\s+\w+)?/, type: 'class' },
      { regex: /^(?:export\s+)?interface\s+(\w+)/, type: 'interface' },
      { regex: /^(?:export\s+)?type\s+(\w+)\s*=/, type: 'type' },
      { regex: /^(?:export\s+)?enum\s+(\w+)/, type: 'enum' },
      { regex: /^(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*(?:=>|:)/, type: 'arrow_function' },
      { regex: /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*[:=]/, type: 'variable' },
      { regex: /^\s*(?:static\s+)?(?:async\s+)?(\w+)\s*\(([^)]*)\)\s*\{/, type: 'method' },
      { regex: /^\s*(?:get|set)\s+(\w+)\s*\(/, type: 'accessor' },
    ];

    lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
        return;
      }

      for (const { regex, type } of patterns) {
        const match = trimmed.match(regex);
        if (match) {
          const symbolName = match[1];
          // Skip common non-symbol noise
          if (['if', 'for', 'while', 'switch', 'catch'].includes(symbolName)) continue;

          outline.push({
            name: symbolName,
            type,
            line: index + 1,
            signature: trimmed.slice(0, 100),
          });
          break;
        }
      }
    });

    return JSON.stringify({
      ok: true,
      path: rawPath,
      totalLines: lines.length,
      symbolCount: outline.length,
      symbols: outline,
      exitCode: 0,
    });
  } catch (err) {
    return JSON.stringify({ ok: false, error: `Failed to outline file: ${err.message}`, exitCode: 1 });
  }
}

// Backwards-compatible aliases
export const grep_search = grepSearchHandler;
export const get_file_outline = getFileOutlineHandler;

export default {
  grep_search,
  get_file_outline,
  grepSearchHandler,
  getFileOutlineHandler,
};
