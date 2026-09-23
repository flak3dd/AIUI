import fs from 'node:fs';
import path from 'node:path';
import { ROOT_DIR, MEMPALACE_URL, normalizeSandboxPath } from '../config.mjs';

const MEMORY_DIR = path.resolve(ROOT_DIR, 'logs/agent-memory');
const AVOIDANCE_FILE = path.join(MEMORY_DIR, 'avoidance-lessons.json');

/**
 * Normalizes a bash command by stripping shell boilerplate and decorative banners.
 */
export function normalizeBashCommand(rawCmd = '') {
  let cmd = String(rawCmd || '').trim();
  // Strip leading directory transitions (e.g. cd /Users/... &&)
  cmd = cmd.replace(/^cd\s+[^&;]+\s*(?:&&|;)\s*/i, '');
  // Strip decorative echo/header statements (e.g. echo "=== ... ===" &&)
  cmd = cmd.replace(/echo\s+["'][^"']*===*[^"']*["']\s*(?:&&|;)\s*/gi, '');
  cmd = cmd.replace(/echo\s+["'][^"']*["']\s*(?:&&|;)\s*/gi, '');
  cmd = cmd.replace(/printf\s+["'][^"']*["']\s*(?:&&|;)\s*/gi, '');
  // Normalize quotes and spaces
  cmd = cmd.replace(/["']/g, '');
  cmd = cmd.replace(/\s+/g, ' ').trim().toLowerCase();
  return cmd;
}

/**
 * Computes Jaccard word token similarity between two commands.
 * Checks path arguments so commands targeting different directories/files are never marked as duplicates.
 */
export function computeTokenOverlap(cmdA, cmdB) {
  if (!cmdA || !cmdB) return 0;
  if (cmdA === cmdB) return 1;

  // Extract path or directory targets (e.g. /path/to/dir, src/, package.json)
  const getPaths = (cmd) => {
    return cmd
      .split(/\s+/)
      .filter((t) => t.includes('/') || /\.[a-z0-9]{1,5}$/i.test(t))
      .map((p) => p.replace(/\/+$/, '').toLowerCase());
  };

  const pathsA = getPaths(cmdA);
  const pathsB = getPaths(cmdB);

  // If both commands specify paths, but the paths are completely distinct,
  // they target different files/directories and are NOT fuzzy duplicates.
  if (pathsA.length > 0 && pathsB.length > 0) {
    const hasCommonPath = pathsA.some((pA) => pathsB.some((pB) => pA === pB));
    if (!hasCommonPath) {
      return 0;
    }
  }

  // Strip generic piping noise that artificially inflates Jaccard overlap (e.g. | head -30)
  const stripPipes = (c) => c.replace(/\|\s*(?:head|tail|wc|cat|grep|sort|uniq|less|more)(?:\s+-[a-z0-9]+|\s+\d+)*\b/gi, '').trim();
  const cleanA = stripPipes(cmdA);
  const cleanB = stripPipes(cmdB);

  const tokensA = new Set((cleanA || cmdA).split(/\s+/).filter(Boolean));
  const tokensB = new Set((cleanB || cmdB).split(/\s+/).filter(Boolean));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let intersection = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) intersection++;
  }
  const union = new Set([...tokensA, ...tokensB]).size;
  return union > 0 ? intersection / union : 0;
}

/**
 * One page fetch, whether it arrived as browser_open, an HTTP probe, or curl.
 * The hash is dropped because it is not sent to the server.
 */
export function canonicalFetchUrl(toolName, parsedArgs = {}, rawArgs = '') {
  const command = String(parsedArgs.command || parsedArgs.cmd || '');
  const isFetchTool = /^(?:browser_|http_)/i.test(toolName) || /probe|browse/i.test(toolName);
  const isCurl = /^\s*(?:curl|wget)\b/i.test(command);
  if (!isFetchTool && !isCurl) return null;
  const explicit = parsedArgs.url || parsedArgs.targetUrl || parsedArgs.uri || parsedArgs.href || '';
  const blob = `${explicit} ${command} ${rawArgs}`;
  const match = blob.match(/https?:\/\/[^\s"'`|<>]+/i);
  if (!match) return null;
  try {
    const url = new URL(match[0].replace(/[),;]+$/, ''));
    const page = url.pathname.replace(/\/+$/, '') || '/';
    return `${url.protocol}//${url.host}${page}`.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Computes a precise, line-range aware action signature to avoid false positives.
 */
export function computeActionSignature(toolName, parsedArgs = {}, rawArgs = '', envId = 'web_session') {
  const fetchUrl = canonicalFetchUrl(toolName, parsedArgs, rawArgs);
  if (fetchUrl) return `fetch::${fetchUrl}`;
  if (toolName === 'read_file') {
    const normPath = normalizeSandboxPath(parsedArgs.path || parsedArgs.filename || '', envId);
    const start = parsedArgs.start_line || parsedArgs.startLine || 1;
    const count = parsedArgs.line_count || parsedArgs.lineCount || 'all';
    return `read_file::${normPath}::L${start}-${count}`;
  }
  if (toolName === 'bash') {
    const raw = (parsedArgs.command || parsedArgs.cmd || rawArgs || '').trim();
    const normalized = normalizeBashCommand(raw);
    return `bash::${normalized}`;
  }
  if (toolName === 'write_file') {
    const normPath = normalizeSandboxPath(parsedArgs.path || parsedArgs.filename || '', envId);
    return `write_file::${normPath}`;
  }
  return `${toolName}::${String(rawArgs || '').trim().slice(0, 150)}`;
}

export class CircuitBreakerManager {
  constructor(workspaceDir = process.cwd(), envId = 'web_session') {
    this.workspaceDir = workspaceDir;
    this.envId = envId;
    this.actionHistory = [];
    this.failedCommandsHistory = [];
    this.historicalAvoidanceMap = new Map();
    this.loadPersistentLessons(workspaceDir);
  }

  loadPersistentLessons(workspaceDir = this.workspaceDir) {
    try {
      if (!fs.existsSync(MEMORY_DIR)) {
        fs.mkdirSync(MEMORY_DIR, { recursive: true });
      }
      if (fs.existsSync(AVOIDANCE_FILE)) {
        const raw = fs.readFileSync(AVOIDANCE_FILE, 'utf8');
        const list = JSON.parse(raw);
        if (Array.isArray(list)) {
          for (const item of list) {
            if (item && item.actionSig) {
              this.historicalAvoidanceMap.set(item.actionSig, item);
            }
          }
        }
      }
    } catch {
      // Graceful fallback on fresh workspace or locked file
    }
  }

  getHistoricalLessonsSummary(workspaceDir = this.workspaceDir) {
    const list = Array.from(this.historicalAvoidanceMap.values());
    if (list.length === 0) return [];

    const normWp = String(workspaceDir || '').toLowerCase();
    const relevant = list
      .filter((item) => {
        if (!item.workspaceDir) return true;
        const itemWp = String(item.workspaceDir).toLowerCase();
        return normWp.includes(itemWp) || itemWp.includes(normWp);
      })
      .slice(-5);

    return relevant.map((r) => `[${r.toolName.toUpperCase()}]: ${r.guidance}`);
  }

  async persistLesson(evalResult, toolName, parsedArgs = {}, workspaceDir = this.workspaceDir, envId = this.envId) {
    const actionSig = evalResult.actionSig || computeActionSignature(toolName, parsedArgs, '', envId);
    const target = parsedArgs.path || parsedArgs.filename || parsedArgs.command || parsedArgs.cmd || actionSig;
    const isBreaker = Boolean(evalResult.isCircuitBreaker);
    const triggerCount = (evalResult.previousExecutions || 1) + 1;

    let guidance = '';
    if (toolName === 'read_file') {
      guidance = `File "${target}" was repeatedly read without modification. Discovery is complete; on future sessions jump straight to write_file or verification.`;
    } else if (toolName === 'bash') {
      guidance = `Command \`${target}\` was repeatedly executed without forward progress. On future sessions, inspect or edit source files first.`;
    } else {
      guidance = `Action \`${actionSig}\` caused operational loop. Transition immediately to implementation or verification.`;
    }

    const lessonRecord = {
      id: `avoid_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      timestamp: Date.now(),
      actionSig,
      toolName,
      target,
      workspaceDir,
      envId,
      triggerCount,
      isHardBreaker: isBreaker,
      guidance,
    };

    // 1. Update in-memory Map
    this.historicalAvoidanceMap.set(actionSig, lessonRecord);

    // 2. Persist to local JSON file
    try {
      if (!fs.existsSync(MEMORY_DIR)) {
        fs.mkdirSync(MEMORY_DIR, { recursive: true });
      }
      let existing = [];
      if (fs.existsSync(AVOIDANCE_FILE)) {
        try { existing = JSON.parse(fs.readFileSync(AVOIDANCE_FILE, 'utf8')); } catch {}
      }
      if (!Array.isArray(existing)) existing = [];
      const idx = existing.findIndex((e) => e.actionSig === actionSig);
      if (idx >= 0) {
        existing[idx] = { ...existing[idx], ...lessonRecord, occurrences: (existing[idx].occurrences || 1) + 1 };
      } else {
        existing.push({ ...lessonRecord, occurrences: 1 });
      }
      fs.writeFileSync(AVOIDANCE_FILE, JSON.stringify(existing.slice(-200), null, 2));
    } catch {}

    // 3. Asynchronously Checkpoint to MemPalace (:17333)
    try {
      const targetBase = path.basename(String(target));
      fetch(`${MEMPALACE_URL}/api/checkpoint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [
            {
              wing: 'avoidance_lessons',
              title: `Anti-Loop Avoidance: ${toolName} on ${targetBase}`,
              content: `[AVOIDANCE PATTERN]: In workspace "${workspaceDir}", repetitive execution of ${toolName} on "${target}" caused anti-loop warning. Guidance: ${guidance}`,
              tags: ['anti-loop', 'circuit-breaker', 'avoidance', toolName, envId],
            },
          ],
        }),
        signal: AbortSignal.timeout(3000),
      }).catch(() => {});
    } catch {}

    return lessonRecord;
  }

  clear() {
    this.actionHistory = [];
    this.failedCommandsHistory = [];
  }

  onMutation(targetFile = '') {
    // When code is created or modified, the environment state changes.
    // Reset bash command repetition history so tests, builds, and verifications can re-run safely.
    this.actionHistory = this.actionHistory.filter((sig) => !sig.startsWith('bash::') && !sig.startsWith('fetch::'));
    this.failedCommandsHistory = [];
  }

  evaluateAction(toolName, parsedArgs = {}, rawArgs = '', envId = 'web_session') {
    const actionSig = computeActionSignature(toolName, parsedArgs, rawArgs, envId);
    let previousExecutions = this.actionHistory.filter((sig) => sig === actionSig).length;

    // Check fuzzy command overlap if bash
    let isFuzzyDuplicate = false;
    if (toolName === 'bash' && actionSig.startsWith('bash::')) {
      const currCmd = actionSig.replace('bash::', '');
      for (const prevSig of this.actionHistory.slice(-8)) {
        if (prevSig.startsWith('bash::')) {
          const prevCmd = prevSig.replace('bash::', '');
          if (prevCmd === currCmd) {
            // Handled by previousExecutions
            continue;
          }
          if (computeTokenOverlap(prevCmd, currCmd) >= 0.8) {
            isFuzzyDuplicate = true;
            break;
          }
        }
      }
    }

    // Hard Circuit Breaker: Trigger on 2nd attempt for identical or fuzzy-duplicate commands
    const isRepetitive = previousExecutions >= 1 || isFuzzyDuplicate;
    this.actionHistory.push(actionSig);

    const result = {
      actionSig,
      previousExecutions,
      isCircuitBreaker: false,
      breakerResponse: null,
      warningDirective: null,
      oscillationDirective: null,
    };

    if (isRepetitive) {
      result.isCircuitBreaker = true;
      let errorMsg;
      let directiveMsg;

      if (toolName === 'read_file') {
        const rawP = parsedArgs.path || parsedArgs.filename || 'target file';
        errorMsg = `[CIRCUIT BREAKER ACTIVATED - READ_FILE HARD-BLOCKED]: You have executed an identical read_file action on "${rawP}" without taking action.
STOP repeating this command! You ALREADY possess the file contents in your context memory.
Calling read_file or grep again for this file is STRICTLY PROHIBITED.
You MUST immediately proceed to the next concrete progressive step:
1. Call 'replace_file_content' to apply your code patch.
2. Or call 'bash' to run tests, compilation, or verification.`;
        directiveMsg = `[CRITICAL CIRCUIT BREAKER STEERING]: You were blocked from calling read_file again on "${rawP}". You have the full file in context. Your ONLY valid next step is to call 'replace_file_content' to apply code modifications, or synthesize your final response.`;
      } else if (actionSig.startsWith('fetch::')) {
        const page = actionSig.slice('fetch::'.length);
        errorMsg = `[CIRCUIT BREAKER ACTIVATED]: You already fetched "${page}". browser_open, HTTP probe, and curl of this page are the same action. Do not request it again. Answer from the response you already have.`;
        directiveMsg = `[CRITICAL CIRCUIT BREAKER STEERING]: Stop refetching ${page}. Do not switch from browser_open to http_probe or curl. Synthesize the answer from the body already in context.`;
      } else if (toolName === 'bash') {
        const cmd = parsedArgs.command || parsedArgs.cmd || 'this command';
        errorMsg = `[CIRCUIT BREAKER ACTIVATED - COMMAND HARD-BLOCKED]: You have executed the command or near-duplicate \`${cmd}\` multiple times.
STOP repeating diagnostic and shell commands! Repeating commands does not make progress.
You MUST now formulate your conclusions directly in your response or edit the necessary code files.`;
        directiveMsg = `[CRITICAL CIRCUIT BREAKER STEERING]: Shell command repetition blocked for \`${cmd}\`. Do not run diagnostic shell commands again. Answer the user prompt directly or make code changes.`;
      } else {
        errorMsg = `[CIRCUIT BREAKER ACTIVATED]: You have executed this identical ${toolName} action multiple times. STOP repeating this command! You already possess the output. Proceed immediately to concrete code modification or synthesize your answer.`;
        directiveMsg = `[CRITICAL CIRCUIT BREAKER STEERING]: Action repetition blocked for \`${toolName}\`. Proceed immediately to answer or concrete implementation.`;
      }

      result.breakerResponse = JSON.stringify({
        ok: false,
        exitCode: 1,
        error: errorMsg,
      });
      result.warningDirective = directiveMsg;
    }

    // Cyclic oscillation check (A -> B -> A -> B)
    if (this.actionHistory.length >= 4) {
      const l = this.actionHistory.length;
      if (
        this.actionHistory[l - 1] === this.actionHistory[l - 3] &&
        this.actionHistory[l - 2] === this.actionHistory[l - 4] &&
        this.actionHistory[l - 1] !== this.actionHistory[l - 2]
      ) {
        result.oscillationDirective = `[ANTI-LOOP DIRECTIVE]: You are oscillating between two actions in an alternating loop. Break the loop immediately and proceed to implementation or verification.`;
      }
    }

    return result;
  }

  evaluateFailingBashCommand(cmd) {
    if (!cmd) return null;
    this.failedCommandsHistory.push(cmd);
    const identicalCount = this.failedCommandsHistory.filter((c) => c === cmd).length;
    if (identicalCount >= 2) {
      const directive = `[ANTI-LOOP DIRECTIVE]: The command \`${cmd}\` has failed ${identicalCount} times with errors. Do NOT run this exact command again. Inspect the error and apply the necessary fix.`;
      this.persistLesson(
        { actionSig: `bash::${cmd.trim()}`, isCircuitBreaker: false, previousExecutions: identicalCount },
        'bash',
        { command: cmd },
        this.workspaceDir,
        this.envId
      );
      return directive;
    }
    return null;
  }
}

/**
 * Builds a targeted context validation recovery nudge when an edit or tool action fails.
 * Complies with Normative Workflow: Inspect -> Plan & Validate -> Surgical Execute -> Scoped Verify.
 * Instructs the agent to re-inspect the target lines rather than guessing or repeatedly failing.
 */
export function buildContextValidationErrorNudge({ toolName, parsedArgs = {}, result = {}, rawResult = '' }) {
  const filePath = parsedArgs.path || parsedArgs.filePath || parsedArgs.filename || parsedArgs.TargetFile || '';
  const errorSnippet = (result.error || result.stderr || result.message || String(rawResult || ''))
    .trim()
    .slice(0, 300);

  if (!errorSnippet && !result.isError && result.ok !== false) return null;

  if (/file not found|ENOENT|no such file/i.test(errorSnippet) && filePath) {
    return `[WORKSPACE RECONNAISSANCE NUDGE]: File "${filePath}" was not found in the workspace.
Do NOT repeat the operation with the same path or enter a retry loop.
1. Run pre-flight reconnaissance: use list_dir or grep_search to discover existing files.
2. Check for naming variations: check kebab-case vs PascalCase, and extension variants (.js vs .ts vs .mjs).
3. If an existing deliverable satisfies the requirement, reuse or verify it instead of recreating from scratch.`;
  }

  const isEditTool = /replace|write_file|patch|edit/i.test(toolName);

  if (isEditTool && filePath) {
    return `[SURGICAL CONTEXT RECOVERY NUDGE]: Edit action "${toolName}" failed on "${filePath}".
Error snippet: "${errorSnippet}"
Normative Protocol Enforcement:
1. Do NOT blind-patch or overwrite the file with write_file.
2. Call read_file on "${filePath}" with start_line and line_count covering the exact target section to verify current lines, indentation, and surrounding syntax.
3. Re-anchor your targetContent or patch to the fresh lines observed, then re-apply surgical edit.`;
  }

  if (toolName === 'bash') {
    return `[DIAGNOSTIC RECOVERY NUDGE]: Command failed: "${errorSnippet}".
Inspect error output, check targeted files, and execute a scoped fix rather than repeating the same failing command.`;
  }

  return `[CONTEXT VALIDATION NUDGE]: Tool "${toolName}" failed: "${errorSnippet}". Re-inspect target file or parameters before retrying.`;
}
