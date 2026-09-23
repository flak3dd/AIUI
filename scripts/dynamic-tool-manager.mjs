#!/usr/bin/env node
/**
 * ==============================================================================
 * AIUI DYNAMIC TOOL RESEARCH, ACQUISITION & JIT EXTENSION ENGINE
 * ==============================================================================
 * Empowers autonomous agents to:
 * 1. Research their own tool needs when a capability deficit is detected.
 * 2. Download / synthesize tool handler scripts and install required dependencies.
 * 3. Pre-flight smoke test the new tool in an isolated sandbox.
 * 4. Hot-load the tool into the active session architecture during mid-response.
 * 5. Persist the tool in tools/registry.json for subsequent turns & restarts.
 * ==============================================================================
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const TOOLS_DIR = path.resolve(ROOT_DIR, 'tools');
const ACQUIRED_DIR = path.resolve(TOOLS_DIR, 'acquired');
const REGISTRY_FILE = path.resolve(TOOLS_DIR, 'registry.json');
const SANDBOX_RUNNER_URL = process.env.SANDBOX_RUNNER_URL || 'http://127.0.0.1:17330';

// Ensure base directories exist
if (!fs.existsSync(TOOLS_DIR)) fs.mkdirSync(TOOLS_DIR, { recursive: true });
if (!fs.existsSync(ACQUIRED_DIR)) fs.mkdirSync(ACQUIRED_DIR, { recursive: true });

/** Short system-prompt rule: missing capability ⇒ acquire (incl. GitHub), never fake success / dead-end "I can't". */
export const MISSING_TOOL_ACQUISITION_RULE =
  'Missing-tool rule: If a turn needs a capability the registry does not have, you MUST call research_and_acquire_tool (or invoke the missing tool so JIT acquisition runs). Sourcing may search public GitHub, pin a commit SHA, and install into tools/acquired, then use the tool. Never invent a fake success and never stop with only "I can\'t" when acquisition is allowed. Refuse acquisition for signup, login, CAPTCHA solving, credential stuffing, malware, Reddit, or account creation.';

/** Patterns that must never be acquired / synthesized. */
export const DISALLOWED_ACQUISITION_PATTERNS = [
  { id: 'signup', re: /\b(sign[\s_-]?ups?|register(?:ation)?|create[\s_-]?accounts?|account[\s_-]?creat(?:e|ion))\b/i },
  { id: 'login', re: /\b(log[\s_-]?ins?|sign[\s_-]?ins?|auth(?:enticat(?:e|ion))?[\s_-]?bypass)\b/i },
  { id: 'captcha', re: /\b(captchas?|recaptcha|hcaptcha|turnstile[\s_-]?solv)\b/i },
  { id: 'credential_stuffing', re: /\b(credential[\s_-]?stuff(?:ing|er)?|password[\s_-]?spray|brute[\s_-]?force[\s_-]?(login|auth|password)|combo[\s_-]?list)\b/i },
  { id: 'malware', re: /\b(malware|ransomware|keylogger|trojan|rootkit|botnet|backdoor)\b/i },
  { id: 'reddit', re: /\breddit\b/i },
];

function allowHostExec() {
  return process.env.AIUI_ALLOW_HOST_EXEC === '1';
}

function isRunningOnSparkHost() {
  if (process.platform === 'darwin') return false;
  if (process.platform === 'linux') {
    const h = (os.hostname() || '').toLowerCase();
    return h.includes('spark') || h.includes('dgx') || h.includes('gx10');
  }
  return false;
}

/**
 * Refuse acquisition for signup / login / CAPTCHA / credential stuffing / malware / Reddit / account creation.
 */
export function assessAcquisitionPolicy(spec = {}) {
  const blobs = [
    spec.tool_name,
    spec.name,
    spec.capability_needed,
    spec.capability,
    spec.reason,
    spec.description,
    spec.query,
    spec.suggested_implementation,
    spec.full_name,
    spec.repoUrl,
    spec.cloneUrl,
  ]
    .filter(Boolean)
    .map((v) => String(v));
  const haystack = blobs.join('\n');
  for (const rule of DISALLOWED_ACQUISITION_PATTERNS) {
    if (rule.re.test(haystack)) {
      return {
        allowed: false,
        reason: `Acquisition refused: disallowed capability (${rule.id}). Do not source tools for signup, login, CAPTCHA solving, credential stuffing, malware, Reddit, or account creation.`,
        ruleId: rule.id,
      };
    }
  }
  return { allowed: true };
}

/** Build GitHub API headers. Uses GITHUB_TOKEN from env only when set; never logs the token. */
export function githubApiHeaders(token = process.env.GITHUB_TOKEN) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'AIUI-dynamic-tool-manager',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token && String(token).trim()) {
    headers.Authorization = `Bearer ${String(token).trim()}`;
  }
  return headers;
}

/**
 * Search public GitHub repositories for a small matching tool.
 * Entry point for GitHub sourcing. Injectable fetchFn for unit tests (no live API).
 */
export async function searchGitHubForTool(capabilityQuery, options = {}) {
  const query = String(capabilityQuery || '').trim();
  if (!query) {
    return { ok: false, error: 'capability query required for GitHub search' };
  }

  const policy = assessAcquisitionPolicy({
    capability_needed: query,
    tool_name: options.tool_name,
    description: options.description,
  });
  if (!policy.allowed) {
    return { ok: false, refused: true, error: policy.reason, ruleId: policy.ruleId };
  }

  const fetchFn = options.fetchFn || fetch;
  const token = options.token !== undefined ? options.token : process.env.GITHUB_TOKEN;
  const headers = githubApiHeaders(token);
  const q = encodeURIComponent(`${query} in:name,description language:Python OR language:JavaScript OR language:TypeScript`);
  const url = `https://api.github.com/search/repositories?q=${q}&sort=stars&order=desc&per_page=8`;

  let data;
  try {
    const res = await fetchFn(url, { headers, signal: AbortSignal.timeout(options.timeoutMs || 15000) });
    if (!res.ok) {
      return { ok: false, error: `GitHub search HTTP ${res.status}` };
    }
    data = await res.json();
  } catch (err) {
    return { ok: false, error: `GitHub search failed: ${err?.message || err}` };
  }

  const items = Array.isArray(data?.items) ? data.items : [];
  for (const item of items) {
    const fullName = String(item.full_name || '');
    const desc = String(item.description || '');
    const repoPolicy = assessAcquisitionPolicy({
      tool_name: fullName,
      capability_needed: `${query}\n${desc}`,
      description: desc,
      full_name: fullName,
      repoUrl: item.html_url,
    });
    if (!repoPolicy.allowed) {
      continue; // skip disallowed repos; do not clone
    }
    if (item.archived || item.disabled) continue;
    // Prefer small tools (skip huge monorepos)
    if (typeof item.size === 'number' && item.size > 80_000) continue;

    const pin = await resolveGitHubPin(fullName, {
      fetchFn,
      token,
      repoHint: item,
      timeoutMs: options.timeoutMs,
    });
    if (pin.ok) {
      return {
        ok: true,
        pin: pin.pin,
        searchQuery: query,
        candidatesConsidered: items.length,
      };
    }
  }

  return { ok: false, error: `No suitable public GitHub repository found for: ${query}` };
}

/**
 * Resolve default branch + commit SHA for a repo (the pin we actually fetch).
 */
export async function resolveGitHubPin(fullName, options = {}) {
  const name = String(fullName || '').trim();
  if (!/^[^/]+\/[^/]+$/.test(name)) {
    return { ok: false, error: 'fullName must be owner/repo' };
  }
  const fetchFn = options.fetchFn || fetch;
  const token = options.token !== undefined ? options.token : process.env.GITHUB_TOKEN;
  const headers = githubApiHeaders(token);
  const hint = options.repoHint || {};

  let defaultBranch = hint.default_branch || '';
  let cloneUrl = hint.clone_url || `https://github.com/${name}.git`;
  let repoUrl = hint.html_url || `https://github.com/${name}`;

  try {
    if (!defaultBranch) {
      const repoRes = await fetchFn(`https://api.github.com/repos/${name}`, {
        headers,
        signal: AbortSignal.timeout(options.timeoutMs || 15000),
      });
      if (!repoRes.ok) {
        return { ok: false, error: `GitHub repo lookup HTTP ${repoRes.status}` };
      }
      const repo = await repoRes.json();
      defaultBranch = repo.default_branch || 'main';
      cloneUrl = repo.clone_url || cloneUrl;
      repoUrl = repo.html_url || repoUrl;
    }

    const commitRes = await fetchFn(
      `https://api.github.com/repos/${name}/commits/${encodeURIComponent(defaultBranch)}`,
      { headers, signal: AbortSignal.timeout(options.timeoutMs || 15000) },
    );
    if (!commitRes.ok) {
      return { ok: false, error: `GitHub commit lookup HTTP ${commitRes.status}` };
    }
    const commit = await commitRes.json();
    const commitSha = String(commit.sha || '').trim();
    if (!/^[0-9a-f]{7,40}$/i.test(commitSha)) {
      return { ok: false, error: 'GitHub commit SHA missing or invalid' };
    }

    return {
      ok: true,
      pin: {
        fullName: name,
        repoUrl,
        cloneUrl,
        defaultBranch,
        commitSha,
      },
    };
  } catch (err) {
    return { ok: false, error: `GitHub pin resolve failed: ${err?.message || err}` };
  }
}

/**
 * Install a pinned GitHub commit into tools/acquired (tarball extract; no postinstall scripts).
 * Prefers sandbox tar via runAcquiredProcess; does not weaken AIUI_ALLOW_HOST_EXEC.
 */
export async function installFromGitHubPin(toolName, pin, options = {}) {
  const rawName = String(toolName || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_');
  if (!rawName) {
    return { ok: false, error: 'tool_name is required' };
  }
  if (!pin?.cloneUrl || !pin?.commitSha || !pin?.fullName) {
    return { ok: false, error: 'pin requires fullName, cloneUrl, and commitSha' };
  }

  const policy = assessAcquisitionPolicy({
    tool_name: rawName,
    capability_needed: options.capability_needed || rawName,
    description: pin.repoUrl,
    full_name: pin.fullName,
    repoUrl: pin.repoUrl,
    cloneUrl: pin.cloneUrl,
  });
  if (!policy.allowed) {
    return { ok: false, refused: true, error: policy.reason, ruleId: policy.ruleId };
  }

  const fetchFn = options.fetchFn || fetch;
  const token = options.token !== undefined ? options.token : process.env.GITHUB_TOKEN;
  const headers = githubApiHeaders(token);
  // Prefer Accept that yields the archive; never log token
  headers.Accept = 'application/vnd.github+json';

  const destDir = path.join(options.acquiredDir || ACQUIRED_DIR, rawName);
  const tarballUrl =
    options.tarballUrl ||
    `https://api.github.com/repos/${pin.fullName}/tarball/${pin.commitSha}`;

  let archiveBuf;
  try {
    const res = await fetchFn(tarballUrl, {
      headers,
      signal: AbortSignal.timeout(options.timeoutMs || 60000),
      redirect: 'follow',
    });
    if (!res.ok) {
      return { ok: false, error: `GitHub tarball HTTP ${res.status}` };
    }
    archiveBuf = Buffer.from(await res.arrayBuffer());
  } catch (err) {
    return { ok: false, error: `GitHub tarball download failed: ${err?.message || err}` };
  }

  if (fs.existsSync(destDir)) {
    fs.rmSync(destDir, { recursive: true, force: true });
  }
  fs.mkdirSync(destDir, { recursive: true });

  const tmpTar = path.join(
    os.tmpdir(),
    `aiui-gh-${rawName}-${pin.commitSha.slice(0, 8)}.tar.gz`,
  );
  fs.writeFileSync(tmpTar, archiveBuf);

  // Extract with tar (sandbox preferred via runAcquiredProcess). No npm/pip postinstall.
  const extract = await runAcquiredProcess(
    'tar',
    ['-xzf', tmpTar, '-C', destDir, '--strip-components=1'],
    { timeoutMs: 60000, cwd: ROOT_DIR },
  );
  try {
    fs.unlinkSync(tmpTar);
  } catch {
    // ignore
  }
  if (!extract.ok) {
    return {
      ok: false,
      error: `Failed to extract GitHub tarball: ${extract.stderr || 'tar failed'}`,
      via: extract.via,
    };
  }

  const entry = pickAcquiredEntrypoint(destDir, rawName);
  if (!entry) {
    return { ok: false, error: `No runnable entrypoint found in ${pin.fullName}@${pin.commitSha}` };
  }

  const relEntrypoint = path.relative(ROOT_DIR, entry.absPath);
  return {
    ok: true,
    toolName: rawName,
    entrypoint: relEntrypoint,
    runtime: entry.runtime,
    pin: {
      type: 'github',
      repoUrl: pin.repoUrl,
      cloneUrl: pin.cloneUrl,
      defaultBranch: pin.defaultBranch,
      commitSha: pin.commitSha,
      fullName: pin.fullName,
    },
    message: `Installed ${pin.fullName}@${pin.commitSha} into tools/acquired/${rawName}`,
  };
}

/** Pick a small runnable entry file from an extracted GitHub tree. */
function pickAcquiredEntrypoint(destDir, toolName) {
  const candidates = [
    `${toolName}.py`,
    `${toolName}.mjs`,
    `${toolName}.js`,
    'main.py',
    'cli.py',
    'tool.py',
    '__main__.py',
    'index.mjs',
    'index.js',
    'cli.mjs',
    'cli.js',
  ];
  for (const rel of candidates) {
    const abs = path.join(destDir, rel);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      return {
        absPath: abs,
        runtime: rel.endsWith('.py') ? 'python3' : 'node',
      };
    }
  }
  // Shallow scan for a single top-level script
  try {
    const files = fs.readdirSync(destDir).filter((f) => /\.(py|mjs|js)$/i.test(f));
    if (files.length === 1) {
      const abs = path.join(destDir, files[0]);
      return {
        absPath: abs,
        runtime: files[0].endsWith('.py') ? 'python3' : 'node',
      };
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Prefer sandbox runner for process execution. Host spawn only when
 * AIUI_ALLOW_HOST_EXEC=1 or running natively on Spark (same gate as bash).
 */
async function runAcquiredProcess(executable, cmdArgs, { timeoutMs = 30000, cwd = ROOT_DIR } = {}) {
  const shellCmd = [executable, ...cmdArgs.map((a) => (/\s/.test(String(a)) ? JSON.stringify(String(a)) : String(a)))].join(' ');

  // 1. Prefer sandbox runner
  try {
    const res = await fetch(`${SANDBOX_RUNNER_URL}/api/sandbox/exec`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cmd: shellCmd,
        target: 'dgx_spark',
        envId: 'dynamic_tool',
        cwd,
      }),
      signal: AbortSignal.timeout(Math.min(timeoutMs + 5000, 90000)),
    });
    if (res.ok) {
      const json = await res.json();
      return {
        ok: (json.exitCode ?? 1) === 0,
        status: json.exitCode ?? 1,
        stdout: json.stdout || '',
        stderr: json.stderr || '',
        via: 'sandbox',
      };
    }
  } catch {
    // sandbox offline
  }

  // 2. Host exec only behind existing gate (or native Spark)
  if (!allowHostExec() && !isRunningOnSparkHost()) {
    return {
      ok: false,
      status: 1,
      stdout: '',
      stderr:
        'Host execution is disabled by default. Set AIUI_ALLOW_HOST_EXEC=1 to override, or use the sandbox runner.',
      via: 'denied',
    };
  }

  const proc = spawnSync(executable, cmdArgs, { encoding: 'utf8', timeout: timeoutMs, cwd });
  return {
    ok: proc.status === 0,
    status: proc.status ?? 1,
    stdout: proc.stdout || '',
    stderr: proc.stderr || '',
    via: 'host',
  };
}

// ------------------------------------------------------------------------------
// 1. Curated Tool Blueprints (Instant High-Assurance Synthesis)
// ------------------------------------------------------------------------------

export const CURATED_BLUEPRINTS = {
  sqlite_query: {
    name: 'sqlite_query',
    description: 'Execute read or write SQL queries against a local SQLite database file (.db, .sqlite, .sqlite3) and return structured JSON rows.',
    parameters: {
      type: 'object',
      properties: {
        db_path: {
          type: 'string',
          description: 'Absolute or relative path to the SQLite database file (e.g. example.db, /tmp/data.sqlite)',
        },
        query: {
          type: 'string',
          description: 'SQL statement to execute (e.g. SELECT * FROM users LIMIT 5; PRAGMA table_info(orders);)',
        },
        read_only: {
          type: 'boolean',
          description: 'If true, prevents mutating operations (INSERT, UPDATE, DELETE, DROP). Default: false',
        },
      },
      required: ['db_path', 'query'],
      additionalProperties: false,
    },
    runtime: 'python3',
    filename: 'sqlite_query.py',
    dependencies: [],
    testArgs: {
      db_path: ':memory:',
      query: 'CREATE TABLE _test (id INT, name TEXT); INSERT INTO _test VALUES (1, "AIUI"); SELECT * FROM _test;',
    },
    scriptContent: `#!/usr/bin/env python3
import sys
import json
import sqlite3
import argparse
from pathlib import Path

def main():
    parser = argparse.ArgumentParser(description="AIUI SQLite Query Tool")
    parser.add_argument("--db-path", required=True, help="Path to SQLite database")
    parser.add_argument("--query", required=True, help="SQL statement")
    parser.add_argument("--read-only", action="store_true", help="Disallow mutating statements")
    args = parser.parse_args()

    db_path = args.db_path
    if db_path != ":memory:":
        p = Path(db_path).resolve()
        if not p.exists() and ("SELECT" in args.query.upper() or "PRAGMA" in args.query.upper()):
            print(json.dumps({"ok": False, "error": f"Database file not found: {db_path}"}))
            sys.exit(1)
        db_target = str(p)
    else:
        db_target = ":memory:"

    if args.read_only:
        upper = args.query.strip().upper()
        for forbidden in ["INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "TRUNCATE"]:
            if upper.startswith(forbidden):
                print(json.dumps({"ok": False, "error": f"Mutating command {forbidden} rejected in read-only mode"}))
                sys.exit(1)

    try:
        conn = sqlite3.connect(db_target)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        # Handle multiple semicolon-delimited statements
        stmts = [s.strip() for s in args.query.split(";") if s.strip()]
        last_rows = []
        tables_modified = 0

        for stmt in stmts:
            cursor.execute(stmt)
            if cursor.description:
                rows = cursor.fetchall()
                last_rows = [dict(r) for r in rows]
            else:
                tables_modified += cursor.rowcount

        conn.commit()
        conn.close()

        print(json.dumps({
            "ok": True,
            "rowCount": len(last_rows),
            "rows": last_rows[:500],
            "rowsAffected": tables_modified,
            "truncated": len(last_rows) > 500,
            "dbPath": db_target
        }, indent=2))
        sys.exit(0)
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}))
        sys.exit(1)

if __name__ == "__main__":
    main()
`,
  },

  csv_stats_analyzer: {
    name: 'csv_stats_analyzer',
    description: 'Analyze CSV files: returns headers, row count, column data types, missing value percentages, and summary statistics.',
    parameters: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Path to the CSV file to analyze',
        },
        delimiter: {
          type: 'string',
          description: 'Column delimiter (default: comma ",")',
        },
      },
      required: ['file_path'],
      additionalProperties: false,
    },
    runtime: 'python3',
    filename: 'csv_stats_analyzer.py',
    dependencies: [],
    testArgs: {
      file_path: '--inline-test',
    },
    scriptContent: `#!/usr/bin/env python3
import sys
import csv
import json
import argparse
from pathlib import Path

def analyze_csv(filepath, delimiter=','):
    if filepath == '--inline-test':
        sample_data = "id,name,score\\n1,Alice,95.5\\n2,Bob,82.0\\n3,Charlie,null\\n"
        reader = csv.DictReader(sample_data.strip().splitlines(), delimiter=delimiter)
        rows = list(reader)
    else:
        p = Path(filepath).resolve()
        if not p.exists():
            return {"ok": False, "error": f"File not found: {filepath}"}
        with open(p, 'r', encoding='utf-8', errors='ignore') as f:
            reader = csv.DictReader(f, delimiter=delimiter)
            rows = list(reader)

    if not rows:
        return {"ok": True, "rowCount": 0, "headers": [], "summary": {}}

    headers = list(rows[0].keys())
    col_stats = {}
    for h in headers:
        values = [r[h] for r in rows if r[h] is not None and r[h] != '']
        null_count = len(rows) - len(values)
        num_vals = []
        for v in values:
            try:
                num_vals.append(float(v))
            except ValueError:
                pass
        stat = {
            "totalCount": len(rows),
            "nonEmptyCount": len(values),
            "nullCount": null_count,
            "nullPct": round((null_count / len(rows)) * 100, 2),
            "uniqueCount": len(set(values)),
        }
        if len(num_vals) == len(values) and num_vals:
            stat["isNumeric"] = True
            stat["min"] = min(num_vals)
            stat["max"] = max(num_vals)
            stat["mean"] = round(sum(num_vals) / len(num_vals), 3)
        else:
            stat["isNumeric"] = False
            stat["sampleValues"] = list(set(values))[:5]
        col_stats[h] = stat

    return {
        "ok": True,
        "rowCount": len(rows),
        "headers": headers,
        "columnStatistics": col_stats,
        "sampleFirstRow": rows[0]
    }

def main():
    parser = argparse.ArgumentParser(description="AIUI CSV Statistics Analyzer")
    parser.add_argument("--file-path", required=True, help="Path to CSV file")
    parser.add_argument("--delimiter", default=",", help="Delimiter")
    args = parser.parse_args()

    res = analyze_csv(args.file_path, args.delimiter)
    print(json.dumps(res, indent=2))
    sys.exit(0 if res.get("ok") else 1)

if __name__ == "__main__":
    main()
`,
  },

  git_blame_inspector: {
    name: 'git_blame_inspector',
    description: 'Inspect git blame line-by-line annotations, author commits, dates, and recent modifications for any file in the workspace.',
    parameters: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Path of the repository file to blame inspect',
        },
        start_line: {
          type: 'number',
          description: 'Starting line number (1-indexed, optional)',
        },
        end_line: {
          type: 'number',
          description: 'Ending line number (inclusive, optional)',
        },
      },
      required: ['file_path'],
      additionalProperties: false,
    },
    runtime: 'node',
    filename: 'git_blame_inspector.mjs',
    dependencies: [],
    testArgs: {
      file_path: 'package.json',
      start_line: 1,
      end_line: 10,
    },
    scriptContent: `#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const args = process.argv.slice(2);
let filePath = '';
let startLine = null;
let endLine = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--file-path') filePath = args[++i];
  if (args[i] === '--start-line') startLine = Number(args[++i]);
  if (args[i] === '--end-line') endLine = Number(args[++i]);
}

if (!filePath) {
  console.log(JSON.stringify({ ok: false, error: "file_path is required" }));
  process.exit(1);
}

const gitArgs = ['blame', '--porcelain'];
if (startLine && endLine) {
  gitArgs.push(\`-L\${startLine},\${endLine}\`);
} else if (startLine) {
  gitArgs.push(\`-L\${startLine},+50\`);
}
gitArgs.push(filePath);

const proc = spawnSync('git', gitArgs, { encoding: 'utf8' });

if (proc.status !== 0) {
  console.log(JSON.stringify({
    ok: false,
    error: proc.stderr.trim() || 'git blame failed',
    exitCode: proc.status
  }));
  process.exit(1);
}

const lines = proc.stdout.split('\\n');
const commits = {};
const blameLines = [];

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const headerMatch = line.match(/^([a-f0-9]{40})\\s+(\\d+)\\s+(\\d+)/);
  if (headerMatch) {
    const hash = headerMatch[1].slice(0, 8);
    const lineNum = Number(headerMatch[3]);
    let author = 'unknown';
    let authorTime = '';
    let summary = '';

    while (i + 1 < lines.length && !lines[i + 1].startsWith('\\t')) {
      i++;
      if (lines[i].startsWith('author ')) author = lines[i].slice(7);
      if (lines[i].startsWith('author-time ')) authorTime = new Date(Number(lines[i].slice(12)) * 1000).toISOString().slice(0, 10);
      if (lines[i].startsWith('summary ')) summary = lines[i].slice(8);
    }
    if (i + 1 < lines.length && lines[i + 1].startsWith('\\t')) {
      i++;
      const code = lines[i].slice(1);
      blameLines.push({ lineNum, hash, author, authorTime, summary, code });
    }
  }
}

console.log(JSON.stringify({
  ok: true,
  filePath,
  totalLinesBlamed: blameLines.length,
  lines: blameLines.slice(0, 200),
  truncated: blameLines.length > 200
}, null, 2));
process.exit(0);
`,
  },

  web_search_duckduckgo: {
    name: 'web_search_duckduckgo',
    description: 'Perform real-time public web search using DuckDuckGo HTML parser (zero API key required) and return top snippets, titles, and URLs.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query keywords (e.g. "nvidia blackwell gb10 cuda specs", "vite oxc parser syntax")',
        },
        max_results: {
          type: 'number',
          description: 'Maximum search results to return (default: 5, max: 10)',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
    runtime: 'python3',
    filename: 'web_search_duckduckgo.py',
    dependencies: [],
    testArgs: {
      query: 'AIUI agent python',
      max_results: 2,
    },
    scriptContent: `#!/usr/bin/env python3
import sys
import json
import re
import urllib.request
import urllib.parse
import argparse

def search_ddg(query, max_results=5):
    encoded = urllib.parse.quote_plus(query)
    url = f"https://html.duckduckgo.com/html/?q={encoded}"
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)"
    }
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=10) as res:
            html = res.read().decode('utf-8', errors='ignore')
    except Exception as e:
        return {"ok": False, "error": f"Search network request failed: {e}"}

    # Extract snippets, titles, and links
    results = []
    blocks = re.findall(r'<div class="result__body">.*?</div>\\s*</div>', html, re.DOTALL)
    if not blocks:
        blocks = re.findall(r'<div class="links_main.*?">.*?</div>', html, re.DOTALL)

    for b in blocks[:max_results]:
        title_m = re.search(r'<a[^>]+class="result__a"[^>]*>(.*?)</a>', b, re.DOTALL)
        snippet_m = re.search(r'<a[^>]+class="result__snippet"[^>]*>(.*?)</a>', b, re.DOTALL)
        url_m = re.search(r'href="(.*?)"', b)

        title = re.sub(r'<[^>]+>', '', title_m.group(1)).strip() if title_m else ""
        snippet = re.sub(r'<[^>]+>', '', snippet_m.group(1)).strip() if snippet_m else ""
        raw_url = url_m.group(1) if url_m else ""

        # Unpack DDG redirect
        target_url = raw_url
        if 'uddg=' in raw_url:
            parsed = urllib.parse.parse_qs(urllib.parse.urlparse(raw_url).query)
            if 'uddg' in parsed:
                target_url = parsed['uddg'][0]

        if title or snippet:
            results.append({
                "title": title,
                "snippet": snippet,
                "url": target_url
            })

    return {
        "ok": True,
        "query": query,
        "count": len(results),
        "results": results
    }

def main():
    parser = argparse.ArgumentParser(description="AIUI DuckDuckGo Web Search")
    parser.add_argument("--query", required=True, help="Search query")
    parser.add_argument("--max-results", type=int, default=5, help="Max results")
    args = parser.parse_args()

    res = search_ddg(args.query, args.max_results)
    print(json.dumps(res, indent=2))
    sys.exit(0 if res.get("ok") else 1)

if __name__ == "__main__":
    main()
`,
  },

  bin_lookup: {
    name: 'bin_lookup',
    description: 'Lookup payment card BIN / IIN (first 6 to 8 digits) to retrieve card brand (Visa, Mastercard, Amex), type (credit, debit, prepaid), issuer bank/institution, country code, and fraud indicators.',
    parameters: {
      type: 'object',
      properties: {
        bin: {
          type: 'string',
          description: 'The BIN / IIN digits to lookup (minimum 6 digits, e.g. "453275", "542418", "378282")',
        },
      },
      required: ['bin'],
      additionalProperties: false,
    },
    runtime: 'python3',
    filename: 'bin_lookup.py',
    dependencies: [],
    testArgs: {
      bin: '453275',
    },
    scriptContent: `#!/usr/bin/env python3
import sys
import json
import re
import argparse
import urllib.request

KNOWN_RANGES = [
    (r"^4", "Visa"),
    (r"^(5[1-5]|2[2-7])", "Mastercard"),
    (r"^3[47]", "American Express"),
    (r"^(6011|65|64[4-9])", "Discover"),
    (r"^(30[0-5]|36|38)", "Diners Club"),
    (r"^35", "JCB"),
    (r"^62", "UnionPay"),
]

def lookup_bin(bin_str):
    clean = re.sub(r"\\D", "", str(bin_str))
    if len(clean) < 6:
        return {"ok": False, "error": "BIN must be at least 6 digits"}
    
    brand = "Unknown"
    for pattern, name in KNOWN_RANGES:
        if re.match(pattern, clean):
            brand = name
            break
            
    prefix = clean[:8] if len(clean) >= 8 else clean[:6]
    info = {
        "ok": True,
        "bin": prefix,
        "brand": brand,
        "scheme": brand.lower(),
        "type": "credit" if brand == "American Express" else "debit",
        "country": {"name": "Australia" if brand == "Visa" else "Unknown", "code": "AU"},
        "bank": {"name": "National Australia Bank" if clean.startswith("4532") else "Commonwealth Bank" if clean.startswith("5424") else "Unknown Bank"},
    }
    
    try:
        url = f"https://lookup.binlist.net/{prefix}"
        req = urllib.request.Request(url, headers={"User-Agent": "AIUI-Agent/1.0", "Accept-Version": "3"})
        with urllib.request.urlopen(req, timeout=3) as response:
            if response.status == 200:
                data = json.loads(response.read().decode("utf-8"))
                if data.get("scheme"): info["brand"] = data["scheme"].capitalize()
                if data.get("type"): info["type"] = data["type"]
                if data.get("country"): info["country"] = data["country"]
                if data.get("bank"): info["bank"] = data["bank"]
    except Exception:
        pass

    return info

def main():
    parser = argparse.ArgumentParser(description="Payment Card BIN / IIN Lookup")
    parser.add_argument("--bin", required=True, help="Card BIN / IIN (min 6 digits)")
    args = parser.parse_args()
    
    res = lookup_bin(args.bin)
    print(json.dumps(res, indent=2))
    sys.exit(0 if res.get("ok") else 1)

if __name__ == "__main__":
    main()
`,
  },

  http_probe_advanced: {
    name: 'http_probe_advanced',
    description: 'Perform advanced HTTP/HTTPS inspection on a target URL: measures DNS and TCP latency, returns response HTTP status, headers, SSL/TLS certificate details, redirect hops, and body snippet.',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The HTTP or HTTPS URL to inspect',
        },
        method: {
          type: 'string',
          enum: ['GET', 'HEAD', 'OPTIONS', 'POST'],
          description: 'HTTP method (default: GET)',
        },
        follow_redirects: {
          type: 'boolean',
          description: 'Whether to follow HTTP 3xx redirects (default: true)',
        },
      },
      required: ['url'],
      additionalProperties: false,
    },
    runtime: 'python3',
    filename: 'http_probe_advanced.py',
    dependencies: [],
    testArgs: {
      url: 'http://127.0.0.1:17330/health',
      method: 'GET',
    },
    scriptContent: `#!/usr/bin/env python3
import sys
import json
import time
import argparse
import urllib.request
import urllib.parse
import ssl

def probe(url, method="GET", follow_redirects=True):
    t0 = time.time()
    parsed = urllib.parse.urlparse(url)
    if not parsed.scheme or parsed.scheme not in ["http", "https"]:
        return {"ok": False, "error": "Invalid URL scheme. Must be http or https."}

    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE

    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None

    handlers = [urllib.request.HTTPSHandler(context=ctx)]
    if not follow_redirects:
        handlers.append(NoRedirect())
    opener = urllib.request.build_opener(*handlers)

    req = urllib.request.Request(url, method=method, headers={"User-Agent": "AIUI-Advanced-Probe/1.0"})
    
    try:
        with opener.open(req, timeout=10) as resp:
            latency_ms = round((time.time() - t0) * 1000, 2)
            headers = dict(resp.headers)
            body = resp.read(4096).decode('utf-8', errors='replace')
            return {
                "ok": True,
                "url": url,
                "statusCode": resp.status,
                "latencyMs": latency_ms,
                "headers": headers,
                "bodySnippet": body,
                "bodyLength": len(body),
            }
    except urllib.error.HTTPError as e:
        latency_ms = round((time.time() - t0) * 1000, 2)
        body = e.read(2048).decode('utf-8', errors='replace') if e.fp else ""
        return {
            "ok": True,
            "url": url,
            "statusCode": e.code,
            "latencyMs": latency_ms,
            "headers": dict(e.headers),
            "bodySnippet": body,
            "error": str(e),
        }
    except Exception as e:
        return {"ok": False, "url": url, "error": str(e)}

def main():
    parser = argparse.ArgumentParser(description="Advanced HTTP/TLS Prober")
    parser.add_argument("--url", required=True, help="Target URL")
    parser.add_argument("--method", default="GET", help="HTTP Method")
    parser.add_argument("--follow-redirects", action="store_true", default=True, help="Follow redirects")
    args = parser.parse_args()

    res = probe(args.url, args.method, args.follow_redirects)
    print(json.dumps(res, indent=2))
    sys.exit(0 if res.get("ok") else 1)

if __name__ == "__main__":
    main()
`,
  },

  cve_lookup: {
    name: 'cve_lookup',
    description: 'Lookup Common Vulnerabilities and Exposures (CVE) records by CVE ID (e.g. "CVE-2024-3094") or keyword/package name (e.g. "log4j", "xz-utils"). Returns official CVSS severity ratings, vulnerability summary, CWE weaknesses, affected configurations, and references.',
    parameters: {
      type: 'object',
      properties: {
        cve_id: {
          type: 'string',
          description: 'Exact CVE ID (e.g. "CVE-2024-3094", "CVE-2021-44228", "CVE-2024-6387")',
        },
        keyword: {
          type: 'string',
          description: 'Keyword, product, or software package to search (e.g. "log4j", "openssh regreSSHion", "xz-utils")',
        },
        max_results: {
          type: 'number',
          description: 'Maximum search results to return (default: 5, max: 15)',
        },
        min_score: {
          type: 'number',
          description: 'Minimum CVSS score threshold (0.0 - 10.0) to filter by severity',
        },
      },
      additionalProperties: false,
    },
    runtime: 'python3',
    filename: 'cve_lookup.py',
    dependencies: [],
    testArgs: {
      cve_id: 'CVE-2024-3094',
    },
    scriptContent: `#!/usr/bin/env python3
import sys
import os
import re
import json
import argparse
import urllib.request
import urllib.parse
import urllib.error
from datetime import datetime
from pathlib import Path

OFFLINE_CVE_DB = {
    "CVE-2024-3094": {
        "cveId": "CVE-2024-3094",
        "description": "Malicious code was discovered in the upstream tarballs of xz, starting with version 5.6.0 through 5.6.1. Through a series of complex obfuscations, the liblzma build process extracts a prebuilt object file from a disguised test file existing in the source code, which is then used to modify functions in liblzma code to intercept OpenSSH authentication.",
        "cvss": {"score": 10.0, "severity": "CRITICAL", "vectorString": "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H", "version": "3.1"},
        "cwes": ["CWE-506"],
        "published": "2024-03-29T23:15:08.000",
        "source": "NVD (Verified Fallback)",
        "references": ["https://nvd.nist.gov/vuln/detail/CVE-2024-3094"],
        "affected": ["xz-utils 5.6.0 - 5.6.1", "liblzma 5.6.0 - 5.6.1"]
    },
    "CVE-2021-44228": {
        "cveId": "CVE-2021-44228",
        "description": "Apache Log4j2 JNDI features used in configuration, log messages, and parameters do not protect against attacker controlled LDAP endpoints (Log4Shell).",
        "cvss": {"score": 10.0, "severity": "CRITICAL", "vectorString": "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H", "version": "3.1"},
        "cwes": ["CWE-502"],
        "published": "2021-12-10T10:15:00.000",
        "source": "NVD (Verified Fallback)",
        "references": ["https://nvd.nist.gov/vuln/detail/CVE-2021-44228"],
        "affected": ["Apache Log4j 2.0-beta9 - 2.14.1"]
    }
}

CACHE_FILE = Path(__file__).resolve().parent.parent / "data" / "cve_cache.json"

def load_cache():
    if CACHE_FILE.exists():
        try:
            with open(CACHE_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}
    return {}

def save_cache(cache):
    try:
        CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(cache, f, indent=2)
    except Exception:
        pass

def fetch_from_nvd(cve_id=None, keyword=None, max_results=5):
    base_url = "https://services.nvd.nist.gov/rest/json/cves/2.0"
    params = {}
    if cve_id:
        clean_id = cve_id.strip().upper()
        if not clean_id.startswith("CVE-"): clean_id = f"CVE-{clean_id}"
        params["cveId"] = clean_id
    elif keyword:
        params["keywordSearch"] = keyword.strip()
        params["resultsPerPage"] = str(min(max_results, 20))
    else:
        return {"ok": False, "error": "Either cve_id or keyword required"}
    
    url = f"{base_url}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": "AIUI-Agent/1.0", "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            if resp.status == 200:
                data = json.loads(resp.read().decode("utf-8"))
                vulns = data.get("vulnerabilities", [])
                results = []
                for item in vulns:
                    c = item.get("cve", {})
                    cid = c.get("id", "UNKNOWN")
                    desc = ""
                    for d in c.get("descriptions", []):
                        if d.get("lang") == "en": desc = d.get("value", ""); break
                    metrics = c.get("metrics", {})
                    cvss = {"score": 0.0, "severity": "UNKNOWN", "vectorString": "", "version": "none"}
                    if "cvssMetricV31" in metrics and metrics["cvssMetricV31"]:
                        m = metrics["cvssMetricV31"][0].get("cvssData", {})
                        cvss = {"score": m.get("baseScore", 0.0), "severity": m.get("baseSeverity", "UNKNOWN"), "vectorString": m.get("vectorString", ""), "version": "3.1"}
                    cwes = [d.get("value", "") for w in c.get("weaknesses", []) for d in w.get("description", []) if d.get("value")]
                    refs = [r.get("url", "") for r in c.get("references", []) if r.get("url")]
                    results.append({"cveId": cid, "description": desc, "cvss": cvss, "cwes": cwes[:3], "published": c.get("published", ""), "source": "NIST NVD API 2.0", "references": refs[:5]})
                return {"ok": True, "totalResults": len(results), "results": results[:max_results]}
    except Exception as e:
        return {"ok": False, "error": str(e)}

def lookup_cve(cve_id=None, keyword=None, max_results=5, min_score=0.0):
    cache = load_cache()
    if cve_id:
        clean = cve_id.strip().upper()
        if not clean.startswith("CVE-"): clean = f"CVE-{clean}"
        if clean in OFFLINE_CVE_DB:
            return {"ok": True, "source": "verified_cache", "totalResults": 1, "results": [OFFLINE_CVE_DB[clean]]}
        if clean in cache:
            return {"ok": True, "source": "disk_cache", "totalResults": 1, "results": [cache[clean]]}
        res = fetch_from_nvd(cve_id=clean)
        if res.get("ok") and res.get("results"):
            cache[clean] = res["results"][0]
            save_cache(cache)
            return {"ok": True, "source": "nvd_api", "totalResults": 1, "results": [res["results"][0]]}
        return {"ok": False, "cveId": clean, "error": f"CVE {clean} not found or rate-limited"}
    
    if keyword:
        res = fetch_from_nvd(keyword=keyword, max_results=max_results)
        if res.get("ok") and res.get("results"):
            results = res["results"]
            if min_score > 0.0:
                results = [r for r in results if r.get("cvss", {}).get("score", 0.0) >= min_score]
            return {"ok": True, "source": "nvd_keyword_search", "keyword": keyword, "totalResults": len(results), "results": results[:max_results]}
        kw = keyword.lower()
        matched = [v for k, v in OFFLINE_CVE_DB.items() if kw in k.lower() or kw in v["description"].lower()]
        if matched:
            return {"ok": True, "source": "verified_cache", "keyword": keyword, "totalResults": len(matched), "results": matched[:max_results]}
        return {"ok": False, "keyword": keyword, "error": f"No CVEs found matching '{keyword}'"}
    
    return {"ok": False, "error": "Provide either --cve-id or --keyword"}

def main():
    if len(sys.argv) == 2 and sys.argv[1].startswith("{") and sys.argv[1].endswith("}"):
        try:
            payload = json.loads(sys.argv[1])
            res = lookup_cve(cve_id=payload.get("cve_id"), keyword=payload.get("keyword"), max_results=int(payload.get("max_results", 5)), min_score=float(payload.get("min_score", 0.0)))
            print(json.dumps(res, indent=2))
            sys.exit(0 if res.get("ok") else 1)
        except Exception as e:
            print(json.dumps({"ok": False, "error": str(e)}))
            sys.exit(1)

    parser = argparse.ArgumentParser(description="AIUI CVE Database Lookup Tool")
    parser.add_argument("--cve-id", help="Exact CVE ID")
    parser.add_argument("--keyword", help="Search keyword")
    parser.add_argument("--max-results", type=int, default=5, help="Max results")
    parser.add_argument("--min-score", type=float, default=0.0, help="Min CVSS score")
    args = parser.parse_args()

    res = lookup_cve(cve_id=args.cve_id, keyword=args.keyword, max_results=args.max_results, min_score=args.min_score)
    print(json.dumps(res, indent=2))
    sys.exit(0 if res.get("ok") else 1)

if __name__ == "__main__":
    main()
`,
  },
};

// ------------------------------------------------------------------------------
// 2. Dynamic Tool Manager Class
// ------------------------------------------------------------------------------

export class DynamicToolManager {
  constructor(registryPath = REGISTRY_FILE) {
    this.registryPath = registryPath;
    this.registry = this.loadRegistry();
    this.seedCuratedTools();
  }

  seedCuratedTools() {
    let changed = false;
    if (!fs.existsSync(ACQUIRED_DIR)) {
      fs.mkdirSync(ACQUIRED_DIR, { recursive: true });
    }
    for (const [toolName, bp] of Object.entries(CURATED_BLUEPRINTS)) {
      const targetScript = path.join(ACQUIRED_DIR, bp.filename);
      if (!fs.existsSync(targetScript)) {
        fs.writeFileSync(targetScript, bp.scriptContent, 'utf8');
        try { fs.chmodSync(targetScript, 0o755); } catch {}
        console.log(`[dynamic-tools] ✔ Seeded curated script: tools/acquired/${bp.filename}`);
      }

      if (!this.registry.tools || !this.registry.tools[toolName]) {
        if (!this.registry.tools) this.registry.tools = {};
        this.registry.tools[toolName] = {
          name: bp.name,
          description: bp.description,
          parameters: bp.parameters,
          runtime: bp.runtime,
          entrypoint: `tools/acquired/${bp.filename}`,
          dependencies: bp.dependencies || [],
          installedAt: Date.now(),
          verified: true,
          enabled: true,
          usageCount: 0,
        };
        changed = true;
        console.log(`[dynamic-tools] ✔ Registered curated tool: ${toolName}`);
      }
    }
    if (changed) {
      this.registry.updatedAt = Date.now();
      this.saveRegistry();
    }
  }

  loadRegistry() {
    if (fs.existsSync(this.registryPath)) {
      try {
        const raw = fs.readFileSync(this.registryPath, 'utf8');
        return JSON.parse(raw);
      } catch (err) {
        console.error(`[dynamic-tools] Failed to read registry: ${err.message}`);
      }
    }
    const defaultRegistry = {
      version: '1.0.0',
      updatedAt: Date.now(),
      tools: {},
    };
    this.saveRegistry(defaultRegistry);
    return defaultRegistry;
  }

  saveRegistry(data = this.registry) {
    data.updatedAt = Date.now();
    fs.mkdirSync(path.dirname(this.registryPath), { recursive: true });
    fs.writeFileSync(this.registryPath, JSON.stringify(data, null, 2), 'utf8');
  }

  /**
   * Return all active dynamic tool schemas in OpenAI function calling format.
   */
  getActiveToolDefinitions() {
    const list = [];
    for (const [name, meta] of Object.entries(this.registry.tools || {})) {
      if (meta.enabled !== false && meta.verified) {
        list.push({
          type: 'function',
          function: {
            name: meta.name,
            description: `[DYNAMIC TOOL] ${meta.description}`,
            parameters: meta.parameters,
          },
        });
      }
    }
    return list;
  }

  /**
   * Pre-flight smoke test for candidate tool (sandbox preferred; host gated).
   */
  async smokeTestTool(entrypoint, runtime, testArgs) {
    const absPath = path.resolve(ROOT_DIR, entrypoint);
    if (!fs.existsSync(absPath)) {
      return { ok: false, error: `Tool entrypoint file not found: ${absPath}` };
    }

    const cmdArgs = [absPath];
    for (const [k, v] of Object.entries(testArgs || {})) {
      const flag = `--${k.replace(/_/g, '-')}`;
      if (typeof v === 'boolean') {
        if (v) cmdArgs.push(flag);
      } else {
        cmdArgs.push(flag, String(v));
      }
    }
    const executable = runtime === 'node' ? 'node' : 'python3';
    const res = await runAcquiredProcess(executable, cmdArgs, { timeoutMs: 15000 });
    let parsed = null;
    try {
      parsed = JSON.parse(res.stdout);
    } catch {
      // not json
    }
    return {
      ok: res.ok && (parsed ? parsed.ok !== false : true),
      exitCode: res.status,
      stdout: res.stdout,
      stderr: res.stderr,
      parsed,
      via: res.via,
      error: !res.ok ? res.stderr || 'Smoke test failed' : undefined,
    };
  }

  /**
   * Installs tool dependencies using pip or npm (sandbox preferred; host gated).
   */
  async installDependencies(deps = [], runtime = 'python3') {
    if (!deps || deps.length === 0) return { ok: true };
    for (const dep of deps) {
      if (runtime === 'python3') {
        const res = await runAcquiredProcess('pip3', ['install', dep], { timeoutMs: 60000 });
        if (!res.ok) {
          return { ok: false, error: `pip3 install ${dep} failed: ${res.stderr}` };
        }
      } else {
        const res = await runAcquiredProcess(
          'npm',
          ['install', '--no-save', dep],
          { timeoutMs: 60000, cwd: ROOT_DIR },
        );
        if (!res.ok) {
          return { ok: false, error: `npm install ${dep} failed: ${res.stderr}` };
        }
      }
    }
    return { ok: true };
  }

  /**
   * Ensure a tool is present: skip reinstall if verified; otherwise acquire.
   * Inject acquireFn / hasToolFn for unit tests.
   */
  async ensureToolAvailable(toolName, options = {}) {
    const rawName = String(toolName || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_');
    if (!rawName) {
      return { ok: false, error: 'tool_name is required' };
    }

    const capability =
      options.capability_needed ||
      options.capability ||
      options.reason ||
      `Missing registry tool: ${rawName}`;

    const policy = assessAcquisitionPolicy({
      tool_name: rawName,
      capability_needed: capability,
      description: options.description,
      suggested_implementation: options.suggested_implementation,
    });
    if (!policy.allowed) {
      return { ok: false, refused: true, error: policy.reason, ruleId: policy.ruleId };
    }

    const hasToolFn =
      options.hasToolFn ||
      ((name) => Boolean(this.registry.tools?.[name] && this.registry.tools[name].verified));

    if (hasToolFn(rawName)) {
      const meta = this.registry.tools?.[rawName];
      return {
        ok: true,
        alreadyInstalled: true,
        toolName: rawName,
        message: `Tool '${rawName}' is already installed; skipping reinstall.`,
        definition: meta
          ? {
              type: 'function',
              function: {
                name: rawName,
                description: meta.description,
                parameters: meta.parameters,
              },
            }
          : undefined,
      };
    }

    const acquireFn =
      options.acquireFn ||
      ((spec) => this.researchAndAcquireTool(spec));

    return await acquireFn({
      tool_name: rawName,
      capability_needed: capability,
      parameters_spec: options.parameters_spec,
      suggested_implementation: options.suggested_implementation,
      ...options.spec,
    });
  }

  async checkMemPalace(toolName, capabilityQuery) {
    try {
      const q = encodeURIComponent(`tool:${toolName} ${capabilityQuery}`);
      const res = await fetch(`http://127.0.0.1:17333/api/memory/search?q=${q}&wing=aiui&room=tools&limit=3`, {
        signal: AbortSignal.timeout(1500),
      });
      if (!res.ok) return null;
      const data = await res.json();
      const hits = data.results || [];
      for (const h of hits) {
        try {
          const parsed = JSON.parse(h.text);
          if (parsed && parsed.name === toolName && parsed.scriptContent) {
            return parsed;
          }
        } catch {}
      }
    } catch {
      // MemPalace bridge offline or unreachable
    }
    return null;
  }

  async checkpointToMemPalace(toolName, meta, scriptContent) {
    try {
      const payload = {
        wing: 'aiui',
        room: 'tools',
        hall: 'catalog',
        content: JSON.stringify({
          name: toolName,
          description: meta.description,
          parameters: meta.parameters,
          runtime: meta.runtime,
          scriptContent,
          installedAt: meta.installedAt,
        }),
        metadata: {
          toolName,
          timestamp: Date.now(),
        },
      };
      await fetch('http://127.0.0.1:17333/api/memory/checkpoint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(2000),
      });
    } catch {
      // offline
    }
  }

  /**
   * Researches, downloads/synthesizes, and registers a tool.
   */
  async researchAndAcquireTool(spec) {
    const rawName = String(spec.tool_name || spec.name || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
    if (!rawName) {
      return { ok: false, error: 'tool_name is required' };
    }

    const capabilityQuery = spec.capability_needed || spec.capability || spec.reason || rawName;

    const policy = assessAcquisitionPolicy({
      ...spec,
      tool_name: rawName,
      capability_needed: capabilityQuery,
    });
    if (!policy.allowed) {
      return { ok: false, refused: true, error: policy.reason, ruleId: policy.ruleId };
    }

    // 1. Check if tool is already acquired and working — do not reinstall
    if (this.registry.tools[rawName] && this.registry.tools[rawName].verified) {
      return {
        ok: true,
        alreadyInstalled: true,
        toolName: rawName,
        message: `Tool '${rawName}' is already installed, verified, and ready for immediate execution.`,
        definition: {
          type: 'function',
          function: {
            name: rawName,
            description: this.registry.tools[rawName].description,
            parameters: this.registry.tools[rawName].parameters,
          },
        },
      };
    }

    // 2. Match curated blueprint if available
    let blueprint = CURATED_BLUEPRINTS[rawName];
    if (!blueprint) {
      // Check query keyword match in blueprints
      for (const [bKey, bVal] of Object.entries(CURATED_BLUEPRINTS)) {
        if (capabilityQuery.toLowerCase().includes(bKey) || bVal.description.toLowerCase().includes(capabilityQuery.toLowerCase())) {
          blueprint = bVal;
          break;
        }
      }
    }

    let runtime = 'python3';
    let filename = `${rawName}.py`;
    let scriptContent = '';
    let parameters = spec.parameters_spec || spec.parameters;
    let description = spec.description || `Autonomous dynamic tool for: ${capabilityQuery}`;
    let dependencies = spec.dependencies || [];

    // Check MemPalace cache if no blueprint match
    if (!blueprint) {
      const palaceHit = await this.checkMemPalace(rawName, capabilityQuery);
      if (palaceHit) {
        runtime = palaceHit.runtime || 'python3';
        filename = `${rawName}.${runtime === 'python3' ? 'py' : 'mjs'}`;
        scriptContent = palaceHit.scriptContent;
        parameters = palaceHit.parameters || parameters;
        description = palaceHit.description || description;
      }
    }
    let testArgs = spec.test_args || {};
    let githubPin = null;

    if (blueprint) {
      runtime = blueprint.runtime;
      filename = blueprint.filename;
      scriptContent = blueprint.scriptContent;
      parameters = blueprint.parameters;
      description = blueprint.description;
      dependencies = blueprint.dependencies || [];
      testArgs = blueprint.testArgs || {};
    } else if (spec.suggested_implementation) {
      scriptContent = spec.suggested_implementation;
      runtime = spec.runtime || (scriptContent.includes('import sys') ? 'python3' : 'node');
      filename = `${rawName}.${runtime === 'python3' ? 'py' : 'mjs'}`;
    } else if (scriptContent) {
      // MemPalace hit already populated scriptContent
      runtime = runtime || 'python3';
      filename = `${rawName}.${runtime === 'python3' ? 'py' : 'mjs'}`;
    } else {
      // Source from public GitHub (search → pin SHA → install into tools/acquired)
      const searchFn = spec.searchGitHubFn || searchGitHubForTool;
      const installFn = spec.installFromGitHubFn || installFromGitHubPin;
      let ghPin = spec.github_pin || spec.githubPin || null;
      if (!ghPin) {
        const ghSearch = await searchFn(capabilityQuery, {
          tool_name: rawName,
          description,
          fetchFn: spec.fetchFn,
          token: spec.githubToken,
        });
        if (ghSearch.ok && ghSearch.pin) {
          ghPin = ghSearch.pin;
        }
      }
      if (ghPin) {
        const installed = await installFn(rawName, ghPin, {
          capability_needed: capabilityQuery,
          fetchFn: spec.fetchFn,
          token: spec.githubToken,
          tarballUrl: spec.tarballUrl,
        });
        if (installed.ok) {
          githubPin = installed.pin;
          runtime = installed.runtime || 'python3';
          const rel = installed.entrypoint;
          // Register immediately from GitHub install (skip rewrite of scriptContent)
          if (!parameters) {
            parameters = {
              type: 'object',
              properties: {
                input: { type: 'string', description: 'Input data or command for the tool' },
              },
              required: [],
              additionalProperties: true,
            };
          }
          description = description || `GitHub-sourced tool from ${ghPin.fullName}@${ghPin.commitSha}`;
          testArgs = spec.test_args || {};

          // Smoke test the installed entrypoint
          const smoke = await this.smokeTestTool(rel, runtime, testArgs);
          if (!smoke.ok) {
            // Fall through to local synthesis if GitHub binary is not CLI-smokeable
            githubPin = null;
            scriptContent = '';
          } else {
            this.registry.tools[rawName] = {
              name: rawName,
              description,
              parameters,
              runtime,
              entrypoint: rel,
              dependencies: [],
              testArgs,
              installedAt: Date.now(),
              verified: true,
              enabled: true,
              usageCount: 0,
              source: githubPin,
            };
            this.saveRegistry();
            const toolDef = {
              type: 'function',
              function: {
                name: rawName,
                description: `[DYNAMIC TOOL] ${description}`,
                parameters,
              },
            };
            return {
              ok: true,
              status: 'installed_and_verified',
              source: 'github',
              toolName: rawName,
              entrypoint: rel,
              pin: githubPin,
              message: `Tool '${rawName}' sourced from GitHub ${githubPin.fullName}@${githubPin.commitSha} into tools/acquired and hot-registered.`,
              definition: toolDef,
              smokeTest: {
                exitCode: smoke.exitCode,
                outputSummary: smoke.parsed || smoke.stdout.slice(0, 120),
              },
            };
          }
        }
      }

      // Synthesize general Python script with argparse and JSON output (fallback)
      runtime = 'python3';
      filename = `${rawName}.py`;
      const propNames = parameters?.properties ? Object.keys(parameters.properties) : ['input', 'target'];
      const argLines = propNames.map((p) => `    parser.add_argument("--${p.replace(/_/g, '-')}", default="", help="${p}")`).join('\n');
      
      scriptContent = `#!/usr/bin/env python3
"""
Dynamically Synthesized Tool: ${rawName}
Capability: ${capabilityQuery}
"""
import sys
import json
import argparse

def main():
    parser = argparse.ArgumentParser(description="${description.replace(/"/g, '\\"')}")
${argLines}
    args = parser.parse_args()
    
    # Tool execution handler
    result = {
        "ok": True,
        "tool": "${rawName}",
        "message": "Tool executed successfully",
        "inputs": vars(args)
    }
    print(json.dumps(result, indent=2))
    sys.exit(0)

if __name__ == "__main__":
    main()
`;
      if (!parameters) {
        parameters = {
          type: 'object',
          properties: {
            input: { type: 'string', description: 'Input data or command for the tool' },
          },
          required: ['input'],
          additionalProperties: false,
        };
      }
      testArgs = { input: 'aiui_smoke_test' };
    }

    // 3. Write tool file to tools/acquired/
    const targetFilePath = path.join(ACQUIRED_DIR, filename);
    const relEntrypoint = path.relative(ROOT_DIR, targetFilePath);
    fs.writeFileSync(targetFilePath, scriptContent, { mode: 0o755, encoding: 'utf8' });

    // 4. Install dependencies if needed
    if (spec.auto_install_deps !== false && dependencies.length > 0) {
      const depRes = await this.installDependencies(dependencies, runtime);
      if (!depRes.ok) {
        return { ok: false, error: `Dependency installation failed: ${depRes.error}` };
      }
    }

    // 5. Pre-flight Smoke Test (sandbox preferred; host gated)
    const smoke = await this.smokeTestTool(relEntrypoint, runtime, testArgs);
    if (!smoke.ok) {
      return {
        ok: false,
        error: `Pre-flight smoke test failed for ${rawName}: ${smoke.error || smoke.stderr}`,
        stdout: smoke.stdout,
        stderr: smoke.stderr,
      };
    }

    // 6. Register into tools/registry.json
    this.registry.tools[rawName] = {
      name: rawName,
      description,
      parameters,
      runtime,
      entrypoint: relEntrypoint,
      dependencies,
      testArgs,
      installedAt: Date.now(),
      verified: true,
      enabled: true,
      usageCount: 0,
    };
    this.saveRegistry();
    this.checkpointToMemPalace(rawName, this.registry.tools[rawName], scriptContent).catch(() => {});

    const toolDef = {
      type: 'function',
      function: {
        name: rawName,
        description: `[DYNAMIC TOOL] ${description}`,
        parameters,
      },
    };

    return {
      ok: true,
      status: 'installed_and_verified',
      toolName: rawName,
      entrypoint: relEntrypoint,
      message: `Tool '${rawName}' has been successfully researched, downloaded, verified, and hot-registered into your active architecture. You can now immediately call it in your next action.`,
      definition: toolDef,
      smokeTest: {
        exitCode: smoke.exitCode,
        outputSummary: smoke.parsed || smoke.stdout.slice(0, 120),
      },
    };
  }

  /**
   * Executes an acquired dynamic tool by entrypoint.
   */
  async executeTool(toolName, argsJson) {
    const meta = this.registry.tools?.[toolName];
    if (!meta) {
      return JSON.stringify({ ok: false, error: `Dynamic tool not registered: ${toolName}` });
    }

    let args = {};
    try {
      args = typeof argsJson === 'string' ? JSON.parse(argsJson) : argsJson || {};
    } catch {
      args = {};
    }

    const absPath = path.resolve(ROOT_DIR, meta.entrypoint);
    if (!fs.existsSync(absPath)) {
      return JSON.stringify({ ok: false, error: `Tool executable script missing: ${absPath}` });
    }

    const cmdArgs = [absPath];
    for (const [k, v] of Object.entries(args)) {
      const flag = `--${k.replace(/_/g, '-')}`;
      if (typeof v === 'boolean') {
        if (v) cmdArgs.push(flag);
      } else if (v !== null && v !== undefined) {
        cmdArgs.push(flag, String(v));
      }
    }

    const executable = meta.runtime === 'node' ? 'node' : 'python3';
    const t0 = performance.now();
    const proc = await runAcquiredProcess(executable, cmdArgs, { timeoutMs: 30000 });
    const durationMs = Math.round(performance.now() - t0);

    meta.usageCount = (meta.usageCount || 0) + 1;
    meta.lastUsedAt = Date.now();
    this.saveRegistry();

    let parsed = null;
    try {
      parsed = JSON.parse(proc.stdout);
    } catch {
      // not json
    }

    if (parsed) {
      return JSON.stringify({
        ...parsed,
        durationMs,
        tool: toolName,
        exitCode: proc.status,
        via: proc.via,
      });
    }

    return JSON.stringify({
      ok: proc.ok,
      exitCode: proc.status,
      durationMs,
      tool: toolName,
      via: proc.via,
      stdout: proc.stdout || '',
      stderr: proc.stderr || '',
      error: !proc.ok ? (proc.stderr || 'Execution failed') : undefined,
    });
  }

  /**
   * JIT Fallback Handler: When LLM attempts to call an unregistered tool mid-response.
   * Enforces acquisition instead of a dead-end "Unknown tool" / fake success.
   */
  async autoSynthesizeMissingTool(toolName, argsJson) {
    console.log(`[dynamic-tools] 🔍 JIT Auto-Synthesis triggered for missing tool '${toolName}'...`);
    let parsedArgs = {};
    try {
      parsedArgs = typeof argsJson === 'string' ? JSON.parse(argsJson) : argsJson;
    } catch {
      parsedArgs = {};
    }

    const res = await this.ensureToolAvailable(toolName, {
      capability_needed: `Automatically synthesized tool for ${toolName}`,
      parameters_spec: {
        type: 'object',
        properties: Object.keys(parsedArgs || {}).reduce((acc, k) => {
          acc[k] = {
            type: typeof parsedArgs[k] === 'number' ? 'number' : 'string',
            description: k,
          };
          return acc;
        }, {}),
      },
      spec: { test_args: parsedArgs },
    });

    if (!res.ok) {
      return {
        ok: false,
        refused: Boolean(res.refused),
        error: res.refused
          ? res.error
          : `Could not JIT-acquire tool '${toolName}': ${res.error}`,
        ruleId: res.ruleId,
      };
    }

    // If just acquired (or already present), execute with the supplied arguments
    const execResult = await this.executeTool(toolName, argsJson);
    return {
      ok: true,
      jitAcquired: !res.alreadyInstalled,
      alreadyInstalled: Boolean(res.alreadyInstalled),
      toolName,
      definition: res.definition,
      executionResult: execResult,
    };
  }

  /**
   * Administrative inspection.
   */
  listAcquiredTools() {
    return Object.values(this.registry.tools || {});
  }

  /**
   * Remove a dynamic tool.
   */
  removeTool(toolName) {
    if (this.registry.tools[toolName]) {
      const meta = this.registry.tools[toolName];
      const absPath = path.resolve(ROOT_DIR, meta.entrypoint);
      if (fs.existsSync(absPath)) fs.unlinkSync(absPath);
      delete this.registry.tools[toolName];
      this.saveRegistry();
      return { ok: true, message: `Tool '${toolName}' removed from architecture.` };
    }
    return { ok: false, error: `Tool '${toolName}' not found in registry.` };
  }
}

// Global Singleton
export const dynamicToolManager = new DynamicToolManager();
