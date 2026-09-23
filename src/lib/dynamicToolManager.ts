/**
 * ==============================================================================
 * CLIENT-SIDE DYNAMIC TOOL MANAGER & ARCHITECTURE EXTENSION BRIDGE
 * ==============================================================================
 * Coordinates dynamic tool registration, active session tool merging,
 * and mid-response dynamic execution for AIUI web and agent runtime.
 * ==============================================================================
 */

import { executeBashCommand, getSandboxBaseUrl } from './bashShell.ts'

function encodeBase64Utf8(str: string): string {
  try {
    return btoa(unescape(encodeURIComponent(str)))
  } catch {
    return btoa(str)
  }
}

/** Short system-prompt rule: missing capability ⇒ acquire (incl. GitHub), never fake success / dead-end "I can't". */
export const MISSING_TOOL_ACQUISITION_RULE =
  'Missing-tool rule: If a turn needs a capability the registry does not have, you MUST call research_and_acquire_tool (or invoke the missing tool so JIT acquisition runs). Sourcing may search public GitHub, pin a commit SHA, and install into tools/acquired, then use the tool. Never invent a fake success and never stop with only "I can\'t" when acquisition is allowed. Refuse acquisition for signup, login, CAPTCHA solving, credential stuffing, malware, Reddit, or account creation.'

/** Patterns that must never be acquired / synthesized (mirrors scripts/dynamic-tool-manager.mjs). */
export const DISALLOWED_ACQUISITION_PATTERNS: Array<{ id: string; re: RegExp }> = [
  { id: 'signup', re: /\b(sign[\s_-]?ups?|register(?:ation)?|create[\s_-]?accounts?|account[\s_-]?creat(?:e|ion))\b/i },
  { id: 'login', re: /\b(log[\s_-]?ins?|sign[\s_-]?ins?|auth(?:enticat(?:e|ion))?[\s_-]?bypass)\b/i },
  { id: 'captcha', re: /\b(captchas?|recaptcha|hcaptcha|turnstile[\s_-]?solv)\b/i },
  {
    id: 'credential_stuffing',
    re: /\b(credential[\s_-]?stuff(?:ing|er)?|password[\s_-]?spray|brute[\s_-]?force[\s_-]?(login|auth|password)|combo[\s_-]?list)\b/i,
  },
  { id: 'malware', re: /\b(malware|ransomware|keylogger|trojan|rootkit|botnet|backdoor)\b/i },
  { id: 'reddit', re: /\breddit\b/i },
]

export type AcquisitionPolicyResult =
  | { allowed: true }
  | { allowed: false; reason: string; ruleId: string }

/** Pinned GitHub provenance stored on acquired tool meta / registry. */
export interface GitHubToolPin {
  type?: 'github'
  fullName: string
  repoUrl: string
  cloneUrl: string
  defaultBranch: string
  commitSha: string
}

/**
 * Refuse acquisition for signup / login / CAPTCHA / credential stuffing / malware / Reddit / account creation.
 */
export function assessAcquisitionPolicy(spec: Record<string, unknown> = {}): AcquisitionPolicyResult {
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
    spec.fullName,
    spec.repoUrl,
    spec.cloneUrl,
  ]
    .filter(Boolean)
    .map((v) => String(v))
  const haystack = blobs.join('\n')
  for (const rule of DISALLOWED_ACQUISITION_PATTERNS) {
    if (rule.re.test(haystack)) {
      return {
        allowed: false,
        reason: `Acquisition refused: disallowed capability (${rule.id}). Do not source tools for signup, login, CAPTCHA solving, credential stuffing, malware, Reddit, or account creation.`,
        ruleId: rule.id,
      }
    }
  }
  return { allowed: true }
}

/** Build GitHub API headers. Uses GITHUB_TOKEN from env only when set; never logs the token. */
export function githubApiHeaders(token?: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'AIUI-dynamic-tool-manager',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  const t = token !== undefined && token !== null ? token : (typeof process !== 'undefined' ? process.env?.GITHUB_TOKEN : undefined)
  if (t && String(t).trim()) {
    headers.Authorization = `Bearer ${String(t).trim()}`
  }
  return headers
}

export type GitHubSearchResult =
  | { ok: true; pin: GitHubToolPin; searchQuery: string; candidatesConsidered?: number }
  | { ok: false; error: string; refused?: boolean; ruleId?: string }

/**
 * Search public GitHub repositories for a small matching tool.
 * Primary entry point for GitHub sourcing. Inject fetchFn in tests — do not hit live API.
 */
export async function searchGitHubForTool(
  capabilityQuery: string,
  options: {
    tool_name?: string
    description?: string
    fetchFn?: typeof fetch
    token?: string | null
    timeoutMs?: number
    resolvePinFn?: (fullName: string, opts: Record<string, unknown>) => Promise<{ ok: boolean; pin?: GitHubToolPin; error?: string }>
  } = {},
): Promise<GitHubSearchResult> {
  const query = String(capabilityQuery || '').trim()
  if (!query) {
    return { ok: false, error: 'capability query required for GitHub search' }
  }

  const policy = assessAcquisitionPolicy({
    capability_needed: query,
    tool_name: options.tool_name,
    description: options.description,
  })
  if (!policy.allowed) {
    return { ok: false, refused: true, error: policy.reason, ruleId: policy.ruleId }
  }

  const fetchFn = options.fetchFn || fetch
  const token = options.token !== undefined ? options.token : (typeof process !== 'undefined' ? process.env?.GITHUB_TOKEN : undefined)
  const headers = githubApiHeaders(token)
  const q = encodeURIComponent(
    `${query} in:name,description language:Python OR language:JavaScript OR language:TypeScript`,
  )
  const url = `https://api.github.com/search/repositories?q=${q}&sort=stars&order=desc&per_page=8`

  let data: { items?: Array<Record<string, unknown>> }
  try {
    const res = await fetchFn(url, { headers, signal: AbortSignal.timeout(options.timeoutMs || 15000) })
    if (!res.ok) {
      return { ok: false, error: `GitHub search HTTP ${res.status}` }
    }
    data = (await res.json()) as { items?: Array<Record<string, unknown>> }
  } catch (err) {
    return { ok: false, error: `GitHub search failed: ${err instanceof Error ? err.message : String(err)}` }
  }

  const items = Array.isArray(data?.items) ? data.items : []
  const resolvePin =
    options.resolvePinFn ||
    ((fullName: string, opts: Record<string, unknown>) =>
      resolveGitHubPin(fullName, opts as Parameters<typeof resolveGitHubPin>[1]))

  for (const item of items) {
    const fullName = String(item.full_name || '')
    const desc = String(item.description || '')
    const repoPolicy = assessAcquisitionPolicy({
      tool_name: fullName,
      capability_needed: `${query}\n${desc}`,
      description: desc,
      full_name: fullName,
      repoUrl: item.html_url,
    })
    if (!repoPolicy.allowed) continue
    if (item.archived || item.disabled) continue
    if (typeof item.size === 'number' && item.size > 80_000) continue

    const pinRes = await resolvePin(fullName, {
      fetchFn,
      token,
      repoHint: item,
      timeoutMs: options.timeoutMs,
    })
    if (pinRes.ok && pinRes.pin) {
      return {
        ok: true,
        pin: pinRes.pin,
        searchQuery: query,
        candidatesConsidered: items.length,
      }
    }
  }

  return { ok: false, error: `No suitable public GitHub repository found for: ${query}` }
}

/**
 * Resolve default branch + commit SHA for owner/repo.
 */
export async function resolveGitHubPin(
  fullName: string,
  options: {
    fetchFn?: typeof fetch
    token?: string | null
    repoHint?: Record<string, unknown>
    timeoutMs?: number
  } = {},
): Promise<{ ok: true; pin: GitHubToolPin } | { ok: false; error: string }> {
  const name = String(fullName || '').trim()
  if (!/^[^/]+\/[^/]+$/.test(name)) {
    return { ok: false, error: 'fullName must be owner/repo' }
  }
  const fetchFn = options.fetchFn || fetch
  const token = options.token !== undefined ? options.token : (typeof process !== 'undefined' ? process.env?.GITHUB_TOKEN : undefined)
  const headers = githubApiHeaders(token)
  const hint = options.repoHint || {}

  let defaultBranch = String(hint.default_branch || '')
  let cloneUrl = String(hint.clone_url || `https://github.com/${name}.git`)
  let repoUrl = String(hint.html_url || `https://github.com/${name}`)

  try {
    if (!defaultBranch) {
      const repoRes = await fetchFn(`https://api.github.com/repos/${name}`, {
        headers,
        signal: AbortSignal.timeout(options.timeoutMs || 15000),
      })
      if (!repoRes.ok) {
        return { ok: false, error: `GitHub repo lookup HTTP ${repoRes.status}` }
      }
      const repo = (await repoRes.json()) as Record<string, unknown>
      defaultBranch = String(repo.default_branch || 'main')
      cloneUrl = String(repo.clone_url || cloneUrl)
      repoUrl = String(repo.html_url || repoUrl)
    }

    const commitRes = await fetchFn(
      `https://api.github.com/repos/${name}/commits/${encodeURIComponent(defaultBranch)}`,
      { headers, signal: AbortSignal.timeout(options.timeoutMs || 15000) },
    )
    if (!commitRes.ok) {
      return { ok: false, error: `GitHub commit lookup HTTP ${commitRes.status}` }
    }
    const commit = (await commitRes.json()) as { sha?: string }
    const commitSha = String(commit.sha || '').trim()
    if (!/^[0-9a-f]{7,40}$/i.test(commitSha)) {
      return { ok: false, error: 'GitHub commit SHA missing or invalid' }
    }

    return {
      ok: true,
      pin: {
        type: 'github',
        fullName: name,
        repoUrl,
        cloneUrl,
        defaultBranch,
        commitSha,
      },
    }
  } catch (err) {
    return { ok: false, error: `GitHub pin resolve failed: ${err instanceof Error ? err.message : String(err)}` }
  }
}

export type InstallFromGitHubResult =
  | {
      ok: true
      toolName: string
      entrypoint: string
      runtime: 'python3' | 'node'
      pin: GitHubToolPin
      message: string
    }
  | { ok: false; error: string; refused?: boolean; ruleId?: string }

/**
 * Install from a pinned GitHub commit into tools/acquired.
 * Injectable for tests — production path proxies to the CLI dynamic-tool-manager.
 */
export async function installFromGitHubPin(
  toolName: string,
  pin: GitHubToolPin,
  options: {
    capability_needed?: string
    fetchFn?: typeof fetch
    token?: string | null
    /** Test hook: skip network and record what would be installed */
    installFn?: (toolName: string, pin: GitHubToolPin) => Promise<InstallFromGitHubResult>
  } = {},
): Promise<InstallFromGitHubResult> {
  const policy = assessAcquisitionPolicy({
    tool_name: toolName,
    capability_needed: options.capability_needed || toolName,
    description: pin.repoUrl,
    full_name: pin.fullName,
    repoUrl: pin.repoUrl,
    cloneUrl: pin.cloneUrl,
  })
  if (!policy.allowed) {
    return { ok: false, refused: true, error: policy.reason, ruleId: policy.ruleId }
  }

  if (options.installFn) {
    return options.installFn(toolName, pin)
  }

  // Delegate to CLI manager via sandbox / subshell (same acquisition system)
  const spec = {
    tool_name: toolName,
    capability_needed: options.capability_needed || toolName,
    github_pin: pin,
    prefer_github: true,
  }
  const raw = await researchAndAcquireTool(JSON.stringify(spec))
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (parsed.ok && parsed.pin) {
      const p = parsed.pin as GitHubToolPin
      registerToolInSession({
        name: String(parsed.toolName || toolName),
        description: String(parsed.message || ''),
        parameters: {},
        runtime: 'python3',
        entrypoint: String(parsed.entrypoint || `tools/acquired/${toolName}`),
        installedAt: Date.now(),
        verified: true,
        source: p,
      })
      return {
        ok: true,
        toolName: String(parsed.toolName || toolName),
        entrypoint: String(parsed.entrypoint || ''),
        runtime: 'python3',
        pin: p,
        message: String(parsed.message || ''),
      }
    }
    return { ok: false, error: String(parsed.error || 'GitHub install failed') }
  } catch {
    return { ok: false, error: raw }
  }
}

export interface EnsureToolAvailableOptions {
  capability_needed?: string
  capability?: string
  reason?: string
  description?: string
  suggested_implementation?: string
  parameters_spec?: Record<string, unknown>
  /** Injected for tests — return true if tool is already present/verified. */
  hasToolFn?: (name: string) => boolean
  /** Injected for tests — perform the acquire. */
  acquireFn?: (spec: Record<string, unknown>) => Promise<Record<string, unknown>>
  /** Injected for tests — GitHub search entry point (no live API). */
  searchGitHubFn?: (query: string, opts?: Record<string, unknown>) => Promise<GitHubSearchResult>
  /** Injected for tests — install using returned clone URL + commit SHA. */
  installFromGitHubFn?: (toolName: string, pin: GitHubToolPin) => Promise<InstallFromGitHubResult>
}

/**
 * Ensure a tool is available: skip reinstall if present; otherwise search GitHub / acquire.
 * Shared by CLI/web agents that use this manager.
 */
export async function ensureToolAvailable(
  toolName: string,
  options: EnsureToolAvailableOptions = {},
): Promise<Record<string, unknown>> {
  const rawName = String(toolName || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
  if (!rawName) {
    return { ok: false, error: 'tool_name is required' }
  }

  const capability =
    options.capability_needed ||
    options.capability ||
    options.reason ||
    `Missing registry tool: ${rawName}`

  const policy = assessAcquisitionPolicy({
    tool_name: rawName,
    capability_needed: capability,
    description: options.description,
    suggested_implementation: options.suggested_implementation,
  })
  if (!policy.allowed) {
    return { ok: false, refused: true, error: policy.reason, ruleId: policy.ruleId }
  }

  const hasToolFn =
    options.hasToolFn ||
    ((name: string) => {
      const meta = dynamicToolsCache[name]
      return Boolean(meta && meta.verified !== false && meta.enabled !== false)
    })

  if (hasToolFn(rawName)) {
    const meta = dynamicToolsCache[rawName]
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
    }
  }

  // Prefer GitHub search → pin → install when hooks or default path requested
  if (options.searchGitHubFn || options.installFromGitHubFn) {
    const searchFn = options.searchGitHubFn || ((q: string) => searchGitHubForTool(q, { tool_name: rawName }))
    const search = await searchFn(capability, { tool_name: rawName })
    if (!search.ok) {
      if (search.refused) {
        return { ok: false, refused: true, error: search.error, ruleId: search.ruleId }
      }
      // Fall through to generic acquire if search misses
    } else {
      const installFn =
        options.installFromGitHubFn ||
        ((name: string, pin: GitHubToolPin) => installFromGitHubPin(name, pin, { capability_needed: capability }))
      const installed = await installFn(rawName, search.pin)
      if (installed.ok) {
        registerToolInSession({
          name: installed.toolName,
          description: installed.message,
          parameters: options.parameters_spec || {},
          runtime: installed.runtime,
          entrypoint: installed.entrypoint,
          installedAt: Date.now(),
          verified: true,
          source: installed.pin,
        })
        return {
          ok: true,
          source: 'github',
          toolName: installed.toolName,
          entrypoint: installed.entrypoint,
          pin: installed.pin,
          message: installed.message,
        }
      }
      if (installed.refused) {
        return { ok: false, refused: true, error: installed.error, ruleId: installed.ruleId }
      }
    }
  }

  const acquireFn =
    options.acquireFn ||
    (async (spec: Record<string, unknown>) => {
      const raw = await researchAndAcquireTool(JSON.stringify(spec))
      try {
        return JSON.parse(raw) as Record<string, unknown>
      } catch {
        return { ok: false, error: raw }
      }
    })

  return await acquireFn({
    tool_name: rawName,
    capability_needed: capability,
    parameters_spec: options.parameters_spec,
    suggested_implementation: options.suggested_implementation,
  })
}

/**
 * JIT path for an unknown tool call: acquire then execute (or refuse disallowed).
 */
export async function autoAcquireMissingTool(
  toolName: string,
  argsJson: string,
  options: EnsureToolAvailableOptions = {},
): Promise<Record<string, unknown>> {
  const ensure = await ensureToolAvailable(toolName, {
    ...options,
    capability_needed:
      options.capability_needed || `Automatically synthesized tool for ${toolName}`,
  })
  if (!ensure.ok) {
    return {
      ok: false,
      refused: Boolean(ensure.refused),
      error: ensure.error || `Could not acquire missing tool: ${toolName}`,
      ruleId: ensure.ruleId,
    }
  }
  if (options.acquireFn && !options.hasToolFn) {
    // Test-only path without execute
    return { ...ensure, jitAcquired: !ensure.alreadyInstalled }
  }
  const executionResult = await executeDynamicTool(toolName, argsJson)
  return {
    ok: true,
    jitAcquired: !ensure.alreadyInstalled,
    alreadyInstalled: Boolean(ensure.alreadyInstalled),
    toolName,
    definition: ensure.definition,
    executionResult,
  }
}

export interface DynamicToolMeta {
  name: string
  description: string
  parameters: Record<string, unknown>
  runtime: 'python3' | 'node'
  entrypoint: string
  dependencies?: string[]
  installedAt: number
  verified: boolean
  enabled?: boolean
  usageCount?: number
  /** Provenance when sourced from GitHub (repo URL + pinned commit SHA). */
  source?: GitHubToolPin
}

export interface DynamicToolRegistry {
  version: string
  updatedAt: number
  tools: Record<string, DynamicToolMeta>
}

export const BUILTIN_EXTERNAL_TOOLS: Record<string, DynamicToolMeta> = {
  sqlite_query: {
    name: 'sqlite_query',
    description:
      'Execute read or write SQL queries against a local SQLite database file (.db, .sqlite, .sqlite3) and return structured JSON rows.',
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
    entrypoint: 'tools/acquired/sqlite_query.py',
    installedAt: 1789834000000,
    verified: true,
    enabled: true,
  },
  csv_stats_analyzer: {
    name: 'csv_stats_analyzer',
    description:
      'Analyze CSV files: returns headers, row count, column data types, missing value percentages, and summary statistics.',
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
    entrypoint: 'tools/acquired/csv_stats_analyzer.py',
    installedAt: 1789834000000,
    verified: true,
    enabled: true,
  },
  git_blame_inspector: {
    name: 'git_blame_inspector',
    description:
      'Inspect git blame line-by-line annotations, author commits, dates, and recent modifications for any file in the workspace.',
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
    entrypoint: 'tools/acquired/git_blame_inspector.mjs',
    installedAt: 1789834000000,
    verified: true,
    enabled: true,
  },
  web_search_duckduckgo: {
    name: 'web_search_duckduckgo',
    description:
      'Perform real-time public web search using DuckDuckGo HTML parser (zero API key required) and return top snippets, titles, and URLs.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query string (keywords, dork queries, CVE IDs, technology questions)',
        },
        max_results: {
          type: 'number',
          description: 'Maximum number of search results to return (default: 5, max: 15)',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
    runtime: 'python3',
    entrypoint: 'tools/acquired/web_search_duckduckgo.py',
    installedAt: 1789834000000,
    verified: true,
    enabled: true,
  },
  bin_lookup: {
    name: 'bin_lookup',
    description:
      'Lookup payment card BIN / IIN (first 6 to 8 digits) to retrieve card brand (Visa, Mastercard, Amex), type (credit, debit, prepaid), issuer bank/institution, country code, and fraud indicators.',
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
    entrypoint: 'tools/acquired/bin_lookup.py',
    installedAt: 1789834000000,
    verified: true,
    enabled: true,
  },
  http_probe_advanced: {
    name: 'http_probe_advanced',
    description:
      'Perform advanced HTTP/HTTPS inspection on a target URL: measures DNS and TCP latency, returns response HTTP status, headers, SSL/TLS certificate details, redirect hops, and body snippet.',
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
    entrypoint: 'tools/acquired/http_probe_advanced.py',
    installedAt: 1789834000000,
    verified: true,
    enabled: true,
  },
  cve_lookup: {
    name: 'cve_lookup',
    description:
      'Lookup Common Vulnerabilities and Exposures (CVE) records by CVE ID (e.g. "CVE-2024-3094") or keyword/package name (e.g. "log4j", "xz-utils"). Returns official CVSS severity ratings, vulnerability summary, CWE weaknesses, affected configurations, and references.',
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
    entrypoint: 'tools/acquired/cve_lookup.py',
    installedAt: 1789834000000,
    verified: true,
    enabled: true,
  },
  payload_generator: {
    name: 'payload_generator',
    description:
      'Generate penetration testing payloads using msfvenom (Metasploit Framework). Supports reverse shells, bind shells, and staged/stageless payloads in multiple output formats (exe, elf, raw, py, ps1, dll). Gracefully reports if msfvenom is not installed.',
    parameters: {
      type: 'object',
      properties: {
        payload: {
          type: 'string',
          description: 'Metasploit payload string (e.g. "windows/x64/meterpreter/reverse_tcp", "linux/x64/shell_reverse_tcp")',
        },
        lhost: {
          type: 'string',
          description: 'Listener IP address for reverse connection',
        },
        lport: {
          type: 'number',
          description: 'Listener port number (1-65535)',
        },
        format: {
          type: 'string',
          description: 'Output format (default: exe). Options: exe, elf, raw, py, ps1, dll, asp, aspx, bash, c, csharp, java, war, macho',
        },
        encoder: {
          type: 'string',
          description: 'Encoder for evasion (e.g. "x86/shikata_ga_nai", "x64/zutto_dekiru")',
        },
        output_path: {
          type: 'string',
          description: 'File path to save the generated payload',
        },
      },
      required: ['payload', 'lhost', 'lport'],
      additionalProperties: false,
    },
    runtime: 'python3',
    entrypoint: 'tools/acquired/payload_generator.py',
    installedAt: 1789834000000,
    verified: true,
    enabled: true,
  },
  recon_scanner: {
    name: 'recon_scanner',
    description:
      'Multi-mode reconnaissance scanner for penetration testing. Supports subdomain enumeration, TCP port scanning, DNS record lookup, WHOIS queries, and HTTP security header analysis. Uses nmap/subfinder/dig when available, falls back to pure Python stdlib.',
    parameters: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          description: 'Target domain name or IP address to scan',
        },
        mode: {
          type: 'string',
          enum: ['subdomain', 'portscan', 'dns', 'whois', 'headers'],
          description: 'Scan mode: subdomain (enumerate subdomains), portscan (TCP port scan), dns (DNS records), whois (domain registration), headers (HTTP security headers)',
        },
        ports: {
          type: 'string',
          description: 'Port range for portscan mode (e.g. "80,443,8000-8100", default: "1-1024")',
        },
        timeout: {
          type: 'number',
          description: 'Socket timeout in seconds (default: 3)',
        },
      },
      required: ['target', 'mode'],
      additionalProperties: false,
    },
    runtime: 'python3',
    entrypoint: 'tools/acquired/recon_scanner.py',
    installedAt: 1789834000000,
    verified: true,
    enabled: true,
  },
  shellcode_builder: {
    name: 'shellcode_builder',
    description:
      'Compile C or C++ source code using gcc/g++ and optionally extract raw shellcode bytes from the .text section via objcopy. Returns compilation output path, size, warnings, and hex-encoded shellcode array. Gracefully reports if gcc is not installed.',
    parameters: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'C or C++ source code to compile',
        },
        language: {
          type: 'string',
          enum: ['c', 'cpp'],
          description: 'Programming language (default: c)',
        },
        compile_flags: {
          type: 'string',
          description: 'Additional compiler flags (e.g. "-m32 -fno-stack-protector -z execstack")',
        },
        extract_shellcode: {
          type: 'boolean',
          description: 'If true, extract raw shellcode bytes from .text section using objcopy',
        },
      },
      required: ['code'],
      additionalProperties: false,
    },
    runtime: 'python3',
    entrypoint: 'tools/acquired/shellcode_builder.py',
    installedAt: 1789834000000,
    verified: true,
    enabled: true,
  },
  wazuh_monitor: {
    name: 'wazuh_monitor',
    description:
      'Parse and analyze Wazuh SIEM alert JSON logs. Supports tailing recent alerts, keyword search, statistical aggregation (top rules, agents, source IPs, severity distribution), and severity-based filtering. Pure Python file parser, no external dependencies.',
    parameters: {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          enum: ['tail', 'search', 'stats', 'severity'],
          description: 'Analysis mode: tail (recent alerts), search (keyword match), stats (aggregated statistics), severity (filter by level)',
        },
        log_path: {
          type: 'string',
          description: 'Path to Wazuh alerts JSON log (default: /var/ossec/logs/alerts/alerts.json)',
        },
        lines: {
          type: 'number',
          description: 'Number of log lines to process (default: 20)',
        },
        query: {
          type: 'string',
          description: 'Search keyword for search mode',
        },
        min_level: {
          type: 'number',
          description: 'Minimum Wazuh alert level filter (0-15, default for severity mode: 8)',
        },
      },
      required: ['mode'],
      additionalProperties: false,
    },
    runtime: 'python3',
    entrypoint: 'tools/acquired/wazuh_monitor.py',
    installedAt: 1789834000000,
    verified: true,
    enabled: true,
  },
}

// In-memory cache of acquired dynamic tools for active session, pre-seeded with external tools
let dynamicToolsCache: Record<string, DynamicToolMeta> = { ...BUILTIN_EXTERNAL_TOOLS }
let cacheLoaded = true

/**
 * The meta-tools that empower the LLM to research, acquire, and manage tools.
 */
export const TOOL_ACQUISITION_META_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'research_and_acquire_tool',
      description:
        'Autonomously research, download, test, and hot-load a new tool into tools/acquired mid-response. REQUIRED whenever you lack a capability — never claim success without the tool and never dead-end with only "I can\'t". Refuses signup/login/CAPTCHA/credential stuffing/malware/Reddit/account creation. Once acquired, invoke it immediately.',
      parameters: {
        type: 'object',
        properties: {
          tool_name: {
            type: 'string',
            description:
              'Identifier for the new tool (e.g. sqlite_query, web_search_duckduckgo, git_blame_inspector, csv_stats_analyzer, or custom name)',
          },
          capability_needed: {
            type: 'string',
            description:
              'Detailed description of what the tool must do, expected inputs, and expected return output',
          },
          parameters_spec: {
            type: 'object',
            description:
              'Optional JSON Schema for the tool parameters (if omitted, auto-synthesized)',
          },
          suggested_implementation: {
            type: 'string',
            description:
              'Optional Python 3 or Node.js script code to use directly as the tool handler',
          },
          auto_install_deps: {
            type: 'boolean',
            description:
              'Automatically run pip or npm install for required libraries. Default: true',
          },
        },
        required: ['tool_name', 'capability_needed'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_acquired_tools',
      description:
        'List all dynamically acquired and installed tools in your architecture, their status, parameters, and usage counts.',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'remove_acquired_tool',
      description:
        'Unload and remove an acquired dynamic tool from your architecture.',
      parameters: {
        type: 'object',
        properties: {
          tool_name: {
            type: 'string',
            description: 'Name of the tool to remove',
          },
        },
        required: ['tool_name'],
        additionalProperties: false,
      },
    },
  },
]

/**
 * Loads the dynamic tool registry from disk via a quick bash query or cache.
 */
export async function loadDynamicToolRegistry(force = false): Promise<Record<string, DynamicToolMeta>> {
  if (cacheLoaded && !force && Object.keys(dynamicToolsCache).length > 0) return dynamicToolsCache
  try {
    const res = await executeBashCommand('cat tools/registry.json 2>/dev/null || echo "{}"')
    if (res.ok && res.stdout) {
      const data = JSON.parse(res.stdout) as DynamicToolRegistry
      dynamicToolsCache = {
        ...BUILTIN_EXTERNAL_TOOLS,
        ...(data.tools || {}),
      }
      cacheLoaded = true
    }
  } catch {
    /* fallback to builtin tools */
    dynamicToolsCache = { ...BUILTIN_EXTERNAL_TOOLS }
  }
  return dynamicToolsCache
}

/**
 * Returns dynamic tool definitions in OpenAI function schema format.
 */
export function getDynamicToolDefinitions(): Array<Record<string, unknown>> {
  const dynamicDefs: Array<Record<string, unknown>> = []
  for (const [, meta] of Object.entries(dynamicToolsCache)) {
    if (meta.enabled !== false && meta.verified) {
      dynamicDefs.push({
        type: 'function',
        function: {
          name: meta.name,
          description: `[EXTERNAL TOOL] ${meta.description}`,
          parameters: meta.parameters,
        },
      })
    }
  }
  return dynamicDefs
}

export type WorkflowPhase = 'inspect' | 'plan' | 'execute' | 'verify'

export interface ToolPhaseConfig {
  phase: WorkflowPhase
  isReadOnly: boolean
  keywords: string[]
}

export const TOOL_PHASE_MAP: Record<string, ToolPhaseConfig> = {
  sqlite_query: {
    phase: 'inspect',
    isReadOnly: true,
    keywords: ['sql', 'sqlite', 'query', 'database', 'table', 'db', 'select', 'rows', 'schema', 'records', 'data', 'redteam', 'cve'],
  },
  cve_lookup: {
    phase: 'inspect',
    isReadOnly: true,
    keywords: ['cve', 'vulnerability', 'cvss', 'exploit', 'security', 'cwe', 'nist', 'kev', 'flaw', 'log4j', 'xz'],
  },
  bin_lookup: {
    phase: 'inspect',
    isReadOnly: true,
    keywords: ['bin', 'card', 'issuer', 'iin', 'bank', 'visa', 'mastercard', 'payment'],
  },
  csv_stats_analyzer: {
    phase: 'inspect',
    isReadOnly: true,
    keywords: ['csv', 'stats', 'statistics', 'columns', 'mean', 'median', 'dataframe', 'metrics', 'numerical'],
  },
  git_blame_inspector: {
    phase: 'inspect',
    isReadOnly: true,
    keywords: ['git', 'blame', 'commit', 'author', 'revision', 'history', 'log'],
  },
  wazuh_monitor: {
    phase: 'inspect',
    isReadOnly: true,
    keywords: ['wazuh', 'siem', 'alert', 'logs', 'soc', 'ossec', 'agent', 'event', 'severity', 'security'],
  },
  web_search_duckduckgo: {
    phase: 'inspect',
    isReadOnly: true,
    keywords: ['search', 'web', 'internet', 'google', 'duckduckgo', 'lookup', 'find', 'documentation', 'url'],
  },
  recon_scanner: {
    phase: 'inspect',
    isReadOnly: true,
    keywords: ['recon', 'scan', 'nmap', 'port', 'subdomain', 'dns', 'whois', 'subfinder', 'target', 'network'],
  },
  payload_generator: {
    phase: 'execute',
    isReadOnly: false,
    keywords: ['payload', 'msfvenom', 'metasploit', 'shellcode', 'reverse', 'listener', 'lhost', 'lport'],
  },
  shellcode_builder: {
    phase: 'execute',
    isReadOnly: false,
    keywords: ['shellcode', 'compile', 'gcc', 'objcopy', 'assembly', 'asm', 'bytes', 'builder'],
  },
  http_probe_advanced: {
    phase: 'verify',
    isReadOnly: true,
    keywords: ['http', 'probe', 'curl', 'status', 'headers', 'latency', 'endpoint', 'api', 'response', 'check'],
  },
}

/**
 * Returns dynamic tool definitions pruned for the current workflow phase and user prompt intent.
 * Retains core base tools, includes acquisition meta tools only when relevant, and selects
 * up to maxDynamicTools matching the active phase and prompt keywords to minimize token consumption.
 */
export function getWorkflowContextTools(
  baseTools: Array<Record<string, unknown>> = [],
  userPrompt = '',
  currentPhase: WorkflowPhase = 'inspect',
  maxDynamicTools = 4,
): Array<Record<string, unknown>> {
  const dynamicDefs = getDynamicToolDefinitions()
  if (dynamicDefs.length === 0) {
    return [...baseTools, ...TOOL_ACQUISITION_META_TOOLS]
  }

  const promptLower = (userPrompt || '').toLowerCase()
  const scored: Array<{ def: Record<string, unknown>; score: number }> = []

  for (const def of dynamicDefs) {
    const fn = (def as { function?: { name?: string } }).function
    const name = fn?.name || ''
    const meta = TOOL_PHASE_MAP[name]
    let score = 0

    if (meta) {
      // Phase alignment bonus
      if (meta.phase === currentPhase) {
        score += 2
      }
      // Keyword match bonus
      for (const kw of meta.keywords) {
        if (promptLower.includes(kw)) {
          score += 3
        }
      }
    } else {
      score += 1
    }

    // Direct tool name mention
    if (promptLower.includes(name)) {
      score += 5
    }

    scored.push({ def, score })
  }

  // Sort descending by relevance score
  scored.sort((a, b) => b.score - a.score)

  // Pick top N dynamic tools
  const selectedDynamic = scored.slice(0, Math.max(2, maxDynamicTools)).map((s) => s.def)

  // Include meta tools only if prompt explicitly mentions tools, capability discovery, or installation
  const wantsToolAcquisition =
    promptLower.includes('tool') ||
    promptLower.includes('install') ||
    promptLower.includes('acquire') ||
    promptLower.includes('capability')

  const metaTools = wantsToolAcquisition ? TOOL_ACQUISITION_META_TOOLS : []

  return [...baseTools, ...metaTools, ...selectedDynamic]
}

/**
 * Returns the combined toolset: baseTools + meta acquisition tools + acquired dynamic tools.
 */
export function getCombinedAgentTools(baseTools: Array<Record<string, unknown>> = []): Array<Record<string, unknown>> {
  return [...baseTools, ...TOOL_ACQUISITION_META_TOOLS, ...getDynamicToolDefinitions()]
}

/**
 * Registers a newly acquired tool into the active session cache immediately.
 */
export function registerToolInSession(meta: DynamicToolMeta) {
  dynamicToolsCache[meta.name] = meta
  cacheLoaded = true
}

/**
 * Executes an acquired dynamic tool with fast-path HTTP endpoint (:17330) and subshell fallback.
 */
export async function executeDynamicTool(toolName: string, argsJson: string): Promise<string> {
  let parsedArgs: Record<string, unknown> = {}
  try {
    parsedArgs = typeof argsJson === 'string' ? JSON.parse(argsJson) : argsJson || {}
  } catch {
    parsedArgs = {}
  }

  // 1. Fast-Path: HTTP REST API on sandbox runner (:17330)
  try {
    const res = await fetch(`${getSandboxBaseUrl()}/api/tools/exec`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toolName, args: parsedArgs }),
      signal: AbortSignal.timeout(15000),
    })
    if (res.ok) {
      const data = await res.json()
      return JSON.stringify(data)
    }
  } catch {
    // Fast-path offline or endpoint unavailable, fall back to subshell
  }

  // 1b. Direct raw curl for http_probe_advanced to avoid base64 pipeline buffer overflows over SSH
  if (toolName === 'http_probe_advanced') {
    const rawUrl = String(parsedArgs.url || '').trim()
    if (!rawUrl) {
      return JSON.stringify({ ok: false, error: 'url parameter required' })
    }
    const method = String(parsedArgs.method || 'GET').toUpperCase()
    const redirectFlag = parsedArgs.follow_redirects !== false ? '-L' : ''
    const cmd = `curl -sS -i ${redirectFlag} -X ${method} -w "\\n__AIUI_META__:%{http_code}:%{time_total}\\n" "${rawUrl}" 2>&1`
    const res = await executeBashCommand(cmd)
    if (res.stdout) {
      const output = res.stdout
      const metaMatch = output.match(/__AIUI_META__:(\d+):([0-9.]+)/)
      const statusCode = metaMatch ? parseInt(metaMatch[1], 10) : (res.exitCode === 0 ? 200 : 0)
      const latencySec = metaMatch ? parseFloat(metaMatch[2]) : 0
      const latencyMs = Math.round(latencySec * 1000 * 10) / 10
      const cleanOutput = output.replace(/__AIUI_META__:\d+:[0-9.]+\n?/, '').trim()
      const parts = cleanOutput.split(/\r?\n\r?\n/)
      const headerBlock = parts.length > 1 ? parts[0] : ''
      const bodyBlock = parts.length > 1 ? parts.slice(1).join('\n\n') : cleanOutput
      const headers: Record<string, string> = {}
      for (const line of headerBlock.split('\n')) {
        const idx = line.indexOf(':')
        if (idx > 0) {
          headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim()
        }
      }
      return JSON.stringify({
        ok: statusCode >= 200 && statusCode < 400,
        url: rawUrl,
        statusCode,
        latencyMs,
        headers,
        bodySnippet: bodyBlock.slice(0, 3000),
        bodyLength: bodyBlock.length,
        method: 'raw_curl_verified',
      })
    }

    // Sandbox offline: probe from this process (not host shell exec)
    try {
      const t0 = performance.now()
      const resp = await fetch(rawUrl, {
        method,
        redirect: parsedArgs.follow_redirects !== false ? 'follow' : 'manual',
        signal: AbortSignal.timeout(10000),
      })
      const body = await resp.text()
      const headers: Record<string, string> = {}
      resp.headers.forEach((v, k) => {
        headers[k.toLowerCase()] = v
      })
      return JSON.stringify({
        ok: resp.status >= 200 && resp.status < 400,
        url: rawUrl,
        statusCode: resp.status,
        latencyMs: Math.round((performance.now() - t0) * 10) / 10,
        headers,
        bodySnippet: body.slice(0, 3000),
        bodyLength: body.length,
        method: 'raw_curl_verified',
      })
    } catch (err) {
      return JSON.stringify({
        ok: false,
        url: rawUrl,
        statusCode: 0,
        latencyMs: 0,
        error: err instanceof Error ? err.message : String(err),
        method: 'raw_curl_verified',
      })
    }
  }

  // 2. Direct Subshell Fallback with safe base64 encoding to prevent shell quote escaping issues
  const tnB64 = encodeBase64Utf8(toolName)
  const argsPayloadB64 = encodeBase64Utf8(JSON.stringify(parsedArgs))
  const cmd = `node -e '(async () => { const candidates = ["./scripts/dynamic-tool-manager.mjs", "/home/flak3dd/abliterated_ui/scripts/dynamic-tool-manager.mjs", (process.env.HOME || "") + "/abliterated_ui/scripts/dynamic-tool-manager.mjs", (process.env.HOME || "") + "/AIUI/scripts/dynamic-tool-manager.mjs", "/Users/adminuser/AIUI/scripts/dynamic-tool-manager.mjs"]; let m = null; for (const p of candidates) { try { m = await import(p); if (m?.dynamicToolManager) break; } catch {} } if (!m?.dynamicToolManager) { console.log(JSON.stringify({ok:false, error: "dynamic-tool-manager.mjs not found in candidates"})); process.exit(1); } const tn = Buffer.from("${tnB64}", "base64").toString("utf8"); const rawArgs = Buffer.from("${argsPayloadB64}", "base64").toString("utf8"); let args = {}; try { args = JSON.parse(rawArgs); } catch { args = rawArgs; } const r = await m.dynamicToolManager.executeTool(tn, args); console.log(typeof r === "string" ? r : JSON.stringify(r)); process.exit(0); })().catch(e => { console.log(JSON.stringify({ok:false, error: e.message})); process.exit(1); })'`
  const res = await executeBashCommand(cmd)
  if (res.ok && res.stdout) {
    return res.stdout.trim()
  }
  const rawErr = res.error || res.stderr || 'Dynamic tool execution failed'
  let suggestedFix: string | undefined
  const missingMod = rawErr.match(/No module named ['"]([^'"]+)['"]/i)
  if (missingMod) {
    suggestedFix = `pip install ${missingMod[1]}`
  }
  return JSON.stringify({
    ok: false,
    tool: toolName,
    exitCode: res.exitCode,
    error: rawErr,
    suggestedFix,
  })
}

/**
 * Researches, downloads/synthesizes, and registers a tool with fast-path HTTP and subshell fallback.
 */
export async function researchAndAcquireTool(specJson: string): Promise<string> {
  let parsedSpec: Record<string, unknown> = {}
  try {
    parsedSpec = typeof specJson === 'string' ? JSON.parse(specJson) : specJson || {}
  } catch {
    parsedSpec = {}
  }

  const policy = assessAcquisitionPolicy(parsedSpec)
  if (!policy.allowed) {
    return JSON.stringify({
      ok: false,
      refused: true,
      error: policy.reason,
      ruleId: policy.ruleId,
    })
  }

  // Present-tool short-circuit: do not reinstall if already in session cache
  const existingName = String(parsedSpec.tool_name || parsedSpec.name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
  if (existingName && dynamicToolsCache[existingName]?.verified) {
    const meta = dynamicToolsCache[existingName]
    return JSON.stringify({
      ok: true,
      alreadyInstalled: true,
      toolName: existingName,
      message: `Tool '${existingName}' is already installed; skipping reinstall.`,
      definition: {
        type: 'function',
        function: {
          name: existingName,
          description: meta.description,
          parameters: meta.parameters,
        },
      },
    })
  }

  // 1. Fast-path HTTP
  try {
    const res = await fetch(`${getSandboxBaseUrl()}/api/tools/acquire`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsedSpec),
      signal: AbortSignal.timeout(30000),
    })
    if (res.ok) {
      const parsed = await res.json()
      if (parsed.ok && parsed.toolName) {
        registerToolInSession({
          name: parsed.toolName,
          description: parsed.definition?.function?.description || parsed.message,
          parameters: parsed.definition?.function?.parameters || {},
          runtime: 'python3',
          entrypoint: parsed.entrypoint || `tools/acquired/${parsed.toolName}.py`,
          installedAt: Date.now(),
          verified: true,
        })
      }
      return JSON.stringify(parsed, null, 2)
    }
  } catch {
    // Fast-path offline, fall back to subshell
  }

  // 2. Direct Subshell Fallback with safe base64 encoding to prevent shell quote escaping issues
  const specPayloadB64 = encodeBase64Utf8(JSON.stringify(parsedSpec))
  const cmd = `node -e '(async () => { const candidates = ["./scripts/dynamic-tool-manager.mjs", "/home/flak3dd/abliterated_ui/scripts/dynamic-tool-manager.mjs", (process.env.HOME || "") + "/abliterated_ui/scripts/dynamic-tool-manager.mjs", (process.env.HOME || "") + "/AIUI/scripts/dynamic-tool-manager.mjs", "/Users/adminuser/AIUI/scripts/dynamic-tool-manager.mjs"]; let m = null; for (const p of candidates) { try { m = await import(p); if (m?.dynamicToolManager) break; } catch {} } if (!m?.dynamicToolManager) { console.log(JSON.stringify({ok:false, error: "dynamic-tool-manager.mjs not found in candidates"})); process.exit(1); } const raw = Buffer.from("${specPayloadB64}", "base64").toString("utf8"); let spec = {}; try { spec = JSON.parse(raw); } catch { spec = raw; } const r = await m.dynamicToolManager.researchAndAcquireTool(spec); console.log(JSON.stringify(r)); process.exit(0); })().catch(e => { console.log(JSON.stringify({ok:false, error: e.message})); process.exit(1); })'`
  const res = await executeBashCommand(cmd)
  if (res.ok && res.stdout) {
    try {
      const parsed = JSON.parse(res.stdout)
      if (parsed.ok && parsed.toolName) {
        registerToolInSession({
          name: parsed.toolName,
          description: parsed.definition?.function?.description || parsed.message,
          parameters: parsed.definition?.function?.parameters || {},
          runtime: 'python3',
          entrypoint: parsed.entrypoint || `tools/acquired/${parsed.toolName}.py`,
          installedAt: Date.now(),
          verified: true,
        })
      }
      return JSON.stringify(parsed, null, 2)
    } catch {
      return res.stdout.trim()
    }
  }
  return JSON.stringify({
    ok: false,
    error: res.error || res.stderr || 'Failed to research and acquire tool',
  })
}
