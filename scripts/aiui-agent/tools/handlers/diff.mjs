/**
 * Surgical Diff Engine - replace_file_content & multi_replace_file_content
 * Replaces an exact, unique block of code within a file without modifying the rest.
 * Eliminates line drift, whole-file rewrite context bloat, and truncation corruption.
 */

import fs from 'node:fs';
import path from 'node:path';
import { normalizeSandboxPath } from '../../config.mjs';
import { resolveFlexibleFilePath } from '../../core/workflow-optimizer.mjs';

/**
 * Normalizes and resolves file path within workspace or sandbox context.
 */
function resolvePath(rawPath, ctx = {}) {
  let cleanPath = String(rawPath || '').trim();
  if (!cleanPath) return null;

  // Sandbox normalization if running under sandbox context
  if (ctx.envId) {
    cleanPath = normalizeSandboxPath(cleanPath, ctx.envId);
  }

  // Relative vs absolute resolution
  let resolved = path.isAbsolute(cleanPath)
    ? cleanPath
    : path.resolve(ctx.workspaceDir || process.cwd(), cleanPath);

  if (fs.existsSync(resolved)) {
    return resolved;
  }

  // Flexible resolution fallback (casing variants, extensions, subdirectories)
  const flexible = resolveFlexibleFilePath(cleanPath, ctx.workspaceDir || process.cwd());
  if (flexible && fs.existsSync(flexible)) {
    return flexible;
  }

  return resolved;
}

/**
 * Surgically replaces an exact, unique block of code within a file.
 * @param {object|string} argsOrPath - Parameters object or path string
 * @param {string} [targetStr] - The exact code to replace (if called positionally)
 * @param {string} [replacementStr] - The replacement code
 * @param {object} [ctx] - Agent runtime context
 * @returns {string|object} - Standard JSON string or result object
 */
export async function replaceFileContentHandler(args, ctx = {}) {
  let filePath;
  let target;
  let replacement;

  if (typeof args === 'string') {
    filePath = args;
    target = arguments[1];
    replacement = arguments[2];
    ctx = arguments[3] || ctx;
  } else {
    filePath = args?.path || args?.filename || args?.filePath;
    target = args?.target;
    replacement = args?.replacement ?? '';
  }

  if (!filePath) {
    return JSON.stringify({ ok: false, error: 'Path is required', exitCode: 1 });
  }

  if (typeof target !== 'string' || target.length === 0) {
    return JSON.stringify({ ok: false, error: 'Target character sequence is required and cannot be empty', exitCode: 1 });
  }

  const resolved = resolvePath(filePath, ctx);
  if (!resolved || !fs.existsSync(resolved)) {
    return JSON.stringify({ ok: false, error: `File not found: ${filePath}`, exitCode: 1 });
  }

  try {
    const originalContent = fs.readFileSync(resolved, 'utf8');

    // Count occurrences of target to ensure exact, unambiguous match
    let count = 0;
    let pos = originalContent.indexOf(target);
    const firstPos = pos;
    while (pos !== -1) {
      count++;
      pos = originalContent.indexOf(target, pos + target.length);
    }

    if (count === 0) {
      return JSON.stringify({
        ok: false,
        error: `Target content not found in ${filePath}. Ensure exact characters, whitespace, and indentation match the file.`,
        exitCode: 1,
      });
    }

    if (count > 1) {
      // Find line number of first occurrence for helpful diagnostics
      const linesBefore = originalContent.slice(0, firstPos).split('\n').length;
      return JSON.stringify({
        ok: false,
        error: `Ambiguous target: target appears ${count} times in ${filePath} (first match at line ${linesBefore}). Target content must be unique. Provide more surrounding context lines to disambiguate.`,
        occurrences: count,
        firstMatchLine: linesBefore,
        exitCode: 1,
      });
    }

    // Apply surgical replacement
    const newContent =
      originalContent.slice(0, firstPos) +
      replacement +
      originalContent.slice(firstPos + target.length);

    fs.writeFileSync(resolved, newContent, 'utf8');

    // Invalidate working memory caches
    if (ctx.filesInspected) {
      ctx.filesInspected.delete(resolved);
      ctx.filesInspected.delete(filePath);
    }

    const byteDiff = Buffer.byteLength(newContent, 'utf8') - Buffer.byteLength(originalContent, 'utf8');
    const diffSign = byteDiff >= 0 ? `+${byteDiff}` : `${byteDiff}`;

    return JSON.stringify({
      ok: true,
      path: resolved,
      bytes: Buffer.byteLength(newContent, 'utf8'),
      byteDelta: byteDiff,
      exitCode: 0,
      message: `Surgically replaced target hunk in ${filePath} (${diffSign} bytes)`,
    });
  } catch (err) {
    return JSON.stringify({ ok: false, error: `Failed to replace file content: ${err.message}`, exitCode: 1 });
  }
}

/**
 * Multi-replace: replaces multiple unique targets in a single atomic transaction.
 * Applies replacements from highest offset to lowest offset to maintain index stability.
 */
export async function multiReplaceFileContentHandler(args, ctx = {}) {
  const filePath = args?.path || args?.filename || args?.filePath;
  const replacements = args?.replacements;

  if (!filePath) {
    return JSON.stringify({ ok: false, error: 'Path is required', exitCode: 1 });
  }

  if (!Array.isArray(replacements) || replacements.length === 0) {
    return JSON.stringify({ ok: false, error: 'Replacements array is required and must not be empty', exitCode: 1 });
  }

  const resolved = resolvePath(filePath, ctx);
  if (!resolved || !fs.existsSync(resolved)) {
    return JSON.stringify({ ok: false, error: `File not found: ${filePath}`, exitCode: 1 });
  }

  try {
    const originalContent = fs.readFileSync(resolved, 'utf8');
    const matchedHunks = [];

    // Phase 1: Validate all hunks exist and are unique
    for (let i = 0; i < replacements.length; i++) {
      const { target, replacement = '' } = replacements[i];
      if (typeof target !== 'string' || !target) {
        return JSON.stringify({ ok: false, error: `Replacement chunk #${i + 1} has empty target`, exitCode: 1 });
      }

      let count = 0;
      let pos = originalContent.indexOf(target);
      const matchPos = pos;
      while (pos !== -1) {
        count++;
        pos = originalContent.indexOf(target, pos + target.length);
      }

      if (count === 0) {
        return JSON.stringify({
          ok: false,
          error: `Target in chunk #${i + 1} not found in ${filePath}`,
          chunkIndex: i,
          exitCode: 1,
        });
      }

      if (count > 1) {
        return JSON.stringify({
          ok: false,
          error: `Target in chunk #${i + 1} appears ${count} times in ${filePath} (not unique)`,
          chunkIndex: i,
          occurrences: count,
          exitCode: 1,
        });
      }

      matchedHunks.push({
        index: i,
        start: matchPos,
        end: matchPos + target.length,
        replacement,
      });
    }

    // Check for overlapping chunks
    matchedHunks.sort((a, b) => a.start - b.start);
    for (let i = 0; i < matchedHunks.length - 1; i++) {
      if (matchedHunks[i].end > matchedHunks[i + 1].start) {
        return JSON.stringify({
          ok: false,
          error: `Overlapping replacement chunks detected between chunk #${matchedHunks[i].index + 1} and #${matchedHunks[i + 1].index + 1}`,
          exitCode: 1,
        });
      }
    }

    // Phase 2: Apply replacements from tail to head
    let result = originalContent;
    for (let i = matchedHunks.length - 1; i >= 0; i--) {
      const hunk = matchedHunks[i];
      result = result.slice(0, hunk.start) + hunk.replacement + result.slice(hunk.end);
    }

    fs.writeFileSync(resolved, result, 'utf8');

    if (ctx.filesInspected) {
      ctx.filesInspected.delete(resolved);
      ctx.filesInspected.delete(filePath);
    }

    return JSON.stringify({
      ok: true,
      path: resolved,
      hunksApplied: matchedHunks.length,
      bytes: Buffer.byteLength(result, 'utf8'),
      exitCode: 0,
      message: `Successfully applied ${matchedHunks.length} surgical hunks in ${filePath}`,
    });
  } catch (err) {
    return JSON.stringify({ ok: false, error: `Multi-replace failed: ${err.message}`, exitCode: 1 });
  }
}

// Backwards-compatible aliases
export const replace_file_content = replaceFileContentHandler;
export const multi_replace_file_content = multiReplaceFileContentHandler;

export default {
  replace_file_content,
  multi_replace_file_content,
  replaceFileContentHandler,
  multiReplaceFileContentHandler,
};
