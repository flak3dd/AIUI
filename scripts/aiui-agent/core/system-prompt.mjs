import { isRunningOnSpark, loadOptimizerPolicy } from '../config.mjs';
import { superpowersDirective } from './superpowers-catalog.mjs';
import { WORD_CUE_SYSTEM_RULE } from '../../browser-runs/word-cues.mjs';
import { MISSING_TOOL_ACQUISITION_RULE } from '../../dynamic-tool-manager.mjs';

// ==========================================
// 🧠 System Prompt Engine & Integration Architecture
// ==========================================

// --- Optimizer policy memoization (avoids re-reading JSON from disk every round) ---
let _policyCache = { value: undefined, ts: 0 };
const POLICY_TTL_MS = 5000;
function getCachedOptimizerPolicy() {
  const now = Date.now();
  if (_policyCache.value !== undefined && now - _policyCache.ts < POLICY_TTL_MS) {
    return _policyCache.value;
  }
  const v = loadOptimizerPolicy();
  _policyCache = { value: v, ts: now };
  return v;
}

export class SystemPromptEngine {
  constructor(agent) {
    this.agent = agent;
  }

  /**
   * Layer 1: Deterministic Core System Identity & Operational Directives
   * (Static & Prefix-Cacheable on vLLM / Spark / Featherless)
   */
  getCoreIdentity() {
    return `You are Abliterated AI in AIUI Autonomous Engineer Mode — an autonomous software engineer running in a command-line terminal.
You have access to live system tools: bash, replace_file_content, multi_replace_file_content, grep_search, get_file_outline, write_file, read_file, start_daemon, read_daemon_logs, stop_daemon, list_daemons, nl_automate, browser_open, browser_screenshot, browser_click, browser_type, browser_console_logs, spawn_subagent, list_acquired_tools, remove_acquired_tool, hand_off_run, list_models, http_get_json, now, memory_search, memory_checkpoint, spawn_linux_container, destroy_linux_container, list_linux_containers, list_scaffolds, apply_scaffold, set_workspace_dir, get_workspace_dir, ssh, base64, research_and_acquire_tool.
IMPORTANT: Tool names (such as 'grep_search', 'replace_file_content', 'read_file', 'write_file', 'get_file_outline') are NATIVE AGENT TOOLS, NOT shell commands. Never attempt to run tool names inside 'bash'. Always invoke tools via native function/tool calling.

Rules & Directives:
1. ADVANCED 5-STAGE COGNITIVE PROGRESSION PROTOCOL (MANDATORY IN <think> TAGS):
   Before emitting ANY tool call, you MUST formulate your reasoning inside <think> tags strictly following this 5-stage progression:
   • STAGE 1: [OBSERVE & RECALL CONTEXT]
     - Quote the exact finding, line number, or diagnostic from previous tool outputs.
   • STAGE 2: [ORIENT: CONTEXT AUDIT & ANTI-STAGNATION CHECK]
     - Invariant 1 (The Reconnaissance Limit): Use 'grep_search' and 'get_file_outline' for rapid discovery. If a file or search result has already appeared in context memory, calling read_file or grep on it again is STRICTLY FORBIDDEN.
     - Invariant 2 (Phase Transition): Once a defect or target file is identified, transition immediately to 'replace_file_content' (to patch) or 'bash' (to test). Never stall on repeated reconnaissance.
   • STAGE 3: [DECIDE: SURGICAL DIFF SYNTHESIS]
     - Formulate the exact code replacement before emitting any tool. Write out "OLD CODE -> NEW CODE" and verify syntax integrity.
     - MANDATORY SURGICAL EDIT LAW: Overwriting whole files via 'write_file' for modifications to existing code is STRICTLY FORBIDDEN. You must use 'replace_file_content' with exact, unique target hunks to eliminate line drift, context bloat, and truncation corruption. Use 'write_file' ONLY for creating brand-new files.
   • STAGE 4: [ACT: PROGRESSIVE MUTATION EMISSION]
     - Emit 'replace_file_content' with exact unique target and replacement code. Do not hesitate or re-read what you already possess.
   • STAGE 5: [VERIFY: DIRECT PROOF]
     - Once modification completes, your immediate next action must be 'bash' to run tests, compilation, or execution confirming exit code 0.

2. ANTI-READ-LOOP & ANTI-OVERWRITE LAWS:
   - Law 1: Reading a file is a ONE-TIME discovery action. Once read, discovery is COMPLETE. Re-reading without modifying is a critical cognitive failure.
   - Law 2: If modifying existing files, always use 'replace_file_content'. Never dump whole files with 'write_file'.
   - Law 3: If a tool output or circuit breaker informs you that an action is blocked or repeated, NEVER try to repeat or re-read! Transition immediately to 'replace_file_content' or 'bash'.
   - Law 4: If you only need a specific section of a large file (>400 lines), use 'grep_search' or supply 'start_line' and 'line_count'.
   - Law 5: CONTRASTIVE PATTERN:
     ❌ FORBIDDEN: grep -> read_file -> read_file again -> write_file (entire file overwritten with truncated comments)!
     ✔ REQUIRED:  grep_search -> replace_file_content (surgical patch) -> bash (test verified exit 0).

3. Fix-Verify Loop: Inspect failure output -> adjust code/flags -> re-run verification. Never repeat an identical failing command unchanged.
4. Memory Discipline: Query memory_search before guessing past architectural decisions; checkpoint critical findings.
5. Path Safety: Files belong inside the active workspace directory. Never construct redundant nested sandbox paths.
6. Zero Base64 Pipeline Wrapping: Never wrap remote SSH commands in base64 pipes (e.g. echo ... | base64 -d | bash is strictly prohibited). Always execute commands directly via ssh or bash tools.
7. Full Objective Fulfillment: Never claim success or stop early when the prompt requests multiple tasks, further verification, or subsequent steps. Execute each requested action sequentially using your tools until all requirements are completely fulfilled.
8. Cluster Topology & Port Mapping:
   - DGX Spark (100.66.147.53): Hosts Sandbox Runner (:17330), Agent Telemetry (:17335), Chat Optimizer (:17337), containers, and sandbox workspaces. Qwen vLLM is at 192.168.4.103:8000.
   - Mac Host (192.168.4.50): Hosts MemPalace (:17333), Key Proxy (:17332), Web UI (:5173), and Self-Awareness Monitor (:17336).
   - To fetch all cluster telemetry and diagnostics cleanly without hitting SSH base64 limits, execute 'python3 scripts/cluster/fetch_cluster_telemetry.py' or inspect 'data/reports/telemetry_report.json'.
   - If a connection fails with HTTP 000 / exit code 7 (connection refused), remember loopback 127.0.0.1 inside a DGX sandbox does not route to Mac services. Pivot immediately to 'http://192.168.4.50:<port>'.
9. Strict Factual Grounding & Anti-Hallucination:
   - Never claim administrative access, privilege escalation, database extraction, or session hijacking based on public HTML strings, image paths (e.g. 'dbdapu/...'), footers (e.g. 'cookie-policy'), or author metadata.
   - An HTTP 200 on a public web page merely indicates the public web server responded with HTML; it is NOT evidence of admin credentials or database access.
   - Never invent fictitious metrics, downloaded payload sizes, or session token counts.
   - Only report factual, reproducible findings supported directly by tool stdout.
10. Strict Workspace Boundary & Environment Enforcement:
   - All code executions, file creations, test runs, and shell commands are executed strictly within the active workspace directory (${this.agent?.workspaceDir || 'current working directory'}).
   - When executing 'bash', commands run with cwd set to this workspace. Relative paths are resolved against this directory.
   - Keep modifications scoped to the target repository and project tree. Never construct artificial /tmp/spark-sandboxes paths unless explicitly configured for container isolation.
11. Advanced Task Execution Strategy & External Tool Priority:
   - Never default to crude, fragile shell one-liners when purpose-built external tools or structured python environments exist.
   - Actively prioritize specialized external tools:
     • Tabular/CSV -> 'csv_stats_analyzer' or structured Python scripts.
     • Databases -> 'sqlite_query'.
     • Identity/Cards -> 'bin_lookup'.
     • Live Search/Docs -> 'web_search_duckduckgo'.
     • Git Forensics -> 'git_blame_inspector'.
     • HTTP & Endpoint Verification -> Raw 'bash' with 'curl' or 'http_get_json'.
     • Vulnerability & CVEs -> 'cve_lookup'.
   - ${MISSING_TOOL_ACQUISITION_RULE}
12. Strategic Plan Fidelity & Milestone Realization: When an active Strategic Execution Plan is present in your working memory, you must execute the active step directly. Do not skip verification exit gates or declare completion while milestones remain unfulfilled. If a milestone is complete, immediately advance to the next step.
13. Proof-of-Work Invariant & Completion Criteria:
   - Operational Code Tasks: If code was written or files were modified, you are strictly forbidden from declaring a task finished merely by stating that code has been written. You must provide concrete execution evidence:
     1. The execution command and output of reproduction/verification tests passing with exit code 0.
     2. The execution command and output of workspace regression tests passing.
     3. The output of 'git diff --stat' showing only necessary and intended file modifications.
   - Advisory & Strategic Consultations: If the user's prompt is advisory, architectural, conceptual, or diagnostic (e.g. "how to...", "what is...", "explain...", "recommend..."), DO NOT execute redundant diagnostic shell commands or file reads. Provide your structured architectural blueprint and recommendations directly in your response.
   - When Complete: Output a concise dotpoint summary of what was accomplished with real exit codes and verification evidence (or clear recommendations if advisory).
14. Pre-Execution Context Verification Protocol:
    Before any edit to an existing file:
    1. Read the exact target lines (and imports/signatures you will touch).
    2. Confirm path, symbol names, and call contracts still match reality.
    3. Prefer surgical diffs over full-file rewrites.
    Never blind-patch: editing without those lines in context causes patch failures and redo loops.
    On tool error / empty target / patch reject: re-inspect that path before writing again.
    New files: create allowed without a prior read; if the path already exists, inspect first.
    After edits: scoped verify (touched files/symbols only) before claiming done.
15. ${WORD_CUE_SYSTEM_RULE}`;
  }

  /**
   * Layer 2: Environment & Cluster Manifest
   */
  getEnvironmentManifest() {
    const target = this.agent.target;
    const hostLabel = isRunningOnSpark()
      ? 'Native DGX Spark Linux Host'
      : target === 'dgx_spark'
        ? 'Remote DGX Spark (SSH/sandbox) — Mac paths under /Users and the local workspace still run on local_mac'
        : 'Local Mac host (filesystem tools stay local; do not SSH for /Users or workspace paths)';
    return `\n\n=== CLUSTER & WORKSPACE MANIFEST ===
Active Execution Target: ${target} (${hostLabel})
Active Workspace Directory: ${this.agent.workspaceDir}
Environment ID: ${this.agent.envId}
Routing: Commands that reference /Users/... or this workspace MUST use target local_mac. Never SSH those to Spark.`;
  }

  /**
   * Build the unified system prompt (Layer 1 + Layer 2)
   * Deterministic and cache-stable for prefix caching on vLLM
   */
  buildUnifiedSystemPrompt() {
    return this.getCoreIdentity() + this.getEnvironmentManifest() + '\n\n' + superpowersDirective();
  }

  /**
   * Layer 3: Dynamic Cognitive Register (Mental Working Memory)
   * Evaluated real-time per turn and per round
   */
  buildDynamicCognitiveRegister(round, activeGoal, steeringDirectives = []) {
    const inspected = Array.from(this.agent.filesInspected.entries());
    let phase = 'RECONNAISSANCE / DISCOVERY';

    if (inspected.length > 0) {
      phase = 'IMPLEMENTATION / MUTATION (File inspection complete; transition to write_file or bash)';
    }

    const lines = [
      '=== COGNITIVE WORKING MEMORY & ACTIVE PHASE ===',
      `• Execution Round: ${round} / ${this.agent.maxRounds}`,
      `• Current Phase: ${phase}`,
    ];

    if (inspected.length > 0) {
      lines.push('• Files In Working Context Memory (DO NOT re-read):');
      inspected.forEach(([p, info]) => {
        lines.push(`  - ${info.path || p} (lines ${info.startLine || 1}..${(info.startLine || 1) + (info.lineCount || 'all')} loaded)`);
      });
      lines.push('• Invariant: Discovery for inspected files is CLOSED. Required next tool: write_file to edit, or bash to test.');
    }

    const historicalLessons = this.agent?.circuitBreaker?.getHistoricalLessonsSummary?.(this.agent.workspaceDir) || [];
    if (historicalLessons.length > 0) {
      lines.push('• Long-Term Avoidance Memory (Learned from prior sessions in this workspace):');
      historicalLessons.forEach((lesson) => {
        lines.push(`  - ${lesson}`);
      });
      lines.push('• Invariant: Pre-existing discovery in this workspace is ACTIVE. Avoid repeating historical reconnaissance.');
    }

    if (steeringDirectives.length > 0) {
      lines.push('• Active Steering Directives:');
      steeringDirectives.forEach((d) => lines.push(`  ! ${d}`));
    }

    if (this.agent.deepBuild) {
      lines.push('• Mode: DEEP BUILD (Zero stubs/placeholders. Validate all types and run tests confirming exit code 0).');
    }

    const policy = getCachedOptimizerPolicy();
    const isOptimized = this.agent.optimize || Boolean(policy?.enabled);
    if (isOptimized && policy) {
      lines.push(`• Mode: EVOLVED AGENT POLICY (${policy.stats?.archetype || 'HIGH-ASSURANCE'}) [Fitness: ${policy.stats?.compositeFitness ? Math.round(policy.stats.compositeFitness * 100) + '%' : '85%'}]`);
      if (policy.systemNudge) {
        lines.push(`  Directive: ${policy.systemNudge}`);
      }
      const mg = policy.stats?.multiTaskGenome;
      if (mg) {
        if ((mg.code_gen?.diff_conservatism ?? 0) >= 0.8) {
          lines.push('  • [Diff Conservatism 100%]: Surgical diffs strictly required via replace_file_content. Whole-file overwrites forbidden.');
        }
        if ((mg.code_gen?.verification_depth ?? 0) >= 0.8) {
          lines.push('  • [Verification Depth]: Must execute tests/build verification verifying exit code 0 before concluding.');
        }
        if ((mg.fast_query?.direct_response_ratio ?? 0) >= 0.8) {
          lines.push('  • [Direct Response Ratio]: Answer consults, explanations, and advice directly without diagnostic shell command loops.');
        }
        if ((mg.self_healing?.anti_loop_sensitivity ?? 0) >= 0.8) {
          lines.push('  • [Anti-Loop Sensitivity]: Stop immediately upon 2nd attempt of same action; pivot strategy.');
        }
        if ((mg.systems_devops?.pre_flight_dryrun ?? 0) >= 0.8) {
          lines.push('  • [Pre-Flight Verification]: Verify path existence and target isolation prior to executing destructive commands.');
        }
      }
    }

    // Context-headroom self-awareness (approximate, derived from persistent history)
    try {
      const isSpark = this.agent?.provider === 'spark';
      const ctxLimit = isSpark
        ? parseInt(process.env.SPARK_MAX_MODEL_LEN || process.env.CTX, 10) || 32768
        : 131072;
      const charBudget = Math.floor(ctxLimit * 3.4);
      const histChars = (Array.isArray(this.agent?.messages) ? this.agent.messages : [])
        .reduce((s, m) => s + (typeof m?.content === 'string' ? m.content.length : 0), 0);
      const pct = charBudget > 0 ? Math.min(100, Math.round((histChars / charBudget) * 100)) : 0;
      lines.push(`• Context Budget: ~${pct}% of ${ctxLimit.toLocaleString()}-token window (headroom-aware compaction active)`);
    } catch {}

    if (this.agent.activePlan) {
      lines.push('\n' + this.agent.activePlan.formatForCognitiveRegister());
    }

    return lines.join('\n');
  }

  /**
   * Layer 4: Master Message Assembler & History Sanitizer
   * Assembles a strictly validated OpenAI/vLLM compliant chat payload
   */
  assembleMessages(activeGoal, round, turnMessages = [], steeringDirectives = []) {
    const systemPrompt = this.buildUnifiedSystemPrompt();
    const cognitiveRegister = this.buildDynamicCognitiveRegister(round, activeGoal, steeringDirectives);

    // Sanitize prior session history
    const sanitizedHistory = this.sanitizeHistory(this.agent.messages);

    const assembled = [
      { role: 'system', content: systemPrompt },
      ...sanitizedHistory,
    ];

    // If turnMessages is empty (round 1), add user goal with cognitive block
    if (turnMessages.length === 0) {
      assembled.push({
        role: 'user',
        content: `${activeGoal}\n\n[RUNTIME CONTEXT]\n${cognitiveRegister}`,
      });
    } else {
      // Append current turn's tool interactions
      for (const m of turnMessages) {
        assembled.push(m);
      }
      // Inject a fresh cognitive register every round so the agent operates on current
      // phase / inspected-files / plan state rather than the stale round-1 snapshot
      // baked into the initial user message.
      if (cognitiveRegister) {
        assembled.push({
          role: 'user',
          content: `[RUNTIME CONTEXT REFRESH — ROUND ${round}]\n${cognitiveRegister}`,
        });
      }
      // Steering directives appended last (most salient "what to do next").
      if (steeringDirectives.length > 0) {
        assembled.push({
          role: 'user',
          content: steeringDirectives.join('\n\n'),
        });
      }
    }

    // Apply safety context window enforcement
    return this.enforceContextWindow(assembled, activeGoal);
  }

  /**
   * Sanitizes conversation history to prevent schema violations:
   * 1. Strips stray system messages
   * 2. Eliminates orphaned tool messages lacking preceding tool_calls
   */
  sanitizeHistory(messages) {
    if (!Array.isArray(messages) || messages.length === 0) return [];

    const nonSystem = messages.filter((m) => m && m.role !== 'system');
    const result = [];

    for (let i = 0; i < nonSystem.length; i++) {
      const msg = nonSystem[i];
      if (msg.role === 'tool') {
        // Look backwards past any immediately preceding tool messages to locate parent assistant
        let parentAssistant = null;
        for (let j = result.length - 1; j >= 0; j--) {
          if (result[j].role === 'tool') continue;
          if (result[j].role === 'assistant') parentAssistant = result[j];
          break;
        }
        if (
          parentAssistant &&
          Array.isArray(parentAssistant.tool_calls) &&
          parentAssistant.tool_calls.some((tc) => tc.id === msg.tool_call_id)
        ) {
          result.push(msg);
        } else {
          continue; // Drop orphaned tool message
        }
      } else {
        result.push(msg);
      }
    }

    return result;
  }

  /**
   * Safe compaction respecting atomic turns and dynamic token/character budgets.
   * Guarantees that at least one valid 'user' message is ALWAYS retained for vLLM qwen3_coder parser.
   */
  enforceContextWindow(messages, activeGoal = null, maxItems = 28, maxTotalChars = null) {
    if (!Array.isArray(messages) || messages.length === 0) return [];

    const isSpark = this.agent?.provider === 'spark';
    const ctxLimit = isSpark
      ? parseInt(process.env.SPARK_MAX_MODEL_LEN || process.env.CTX, 10) || 32768
      : 131072;
    // Dynamically scale character budget to ~65% of model capacity
    const effectiveCharBudget = maxTotalChars || Math.floor(ctxLimit * 3.0 * 0.65);

    let working = [...messages];

    // 1. Enforce item count limit while preserving system message & primary user query
    if (working.length > maxItems) {
      const systemMsg = working[0];
      const primaryUserMsg = working.find((m) => m.role === 'user');
      const otherMsgs = working.slice(1).filter((m) => m !== primaryUserMsg);
      let startIdx = otherMsgs.length - (maxItems - 2);
      while (startIdx < otherMsgs.length && otherMsgs[startIdx].role === 'tool') {
        startIdx++; // Avoid starting on an orphaned tool message
      }
      working = [systemMsg, primaryUserMsg, ...otherMsgs.slice(startIdx)].filter(Boolean);
    }

    // 2. Enforce character/token budget: compact older tool messages if exceeding limit
    const calcTotalChars = (msgs) =>
      msgs.reduce((sum, m) => sum + (typeof m.content === 'string' ? m.content.length : 0), 0);

    let totalChars = calcTotalChars(working);
    if (totalChars > effectiveCharBudget && working.length > 4) {
      // Condense older tool messages first (preserving recent 4 messages intact)
      const preserveTailCount = 4;
      const cutoffIdx = working.length - preserveTailCount;

      for (let i = 2; i < cutoffIdx; i++) {
        const m = working[i];
        if (m.role === 'tool' && typeof m.content === 'string' && m.content.length > 600) {
          m.content =
            m.content.slice(0, 300) +
            '\n\n... [Older output compacted for context headroom] ...\n\n' +
            m.content.slice(-200);
        }
      }
      totalChars = calcTotalChars(working);
    }

    // 3. If still over budget, safely trim older completed tool rounds (NEVER delete user message)
    while (totalChars > effectiveCharBudget && working.length > 4) {
      const victimIdx = working.findIndex((m, idx) => idx > 1 && (m.role === 'assistant' || m.role === 'tool'));
      if (victimIdx === -1) break;
      let removeCount = 1;
      while (working.length > (victimIdx + removeCount) && working[victimIdx + removeCount].role === 'tool') {
        removeCount++;
      }
      working.splice(victimIdx, removeCount);
      totalChars = calcTotalChars(working);
    }

    // 3.5 Final schema reconciliation: after compaction, guarantee no dangling
    // tool_calls (assistant requests whose tool responses were dropped) and no
    // orphaned tool messages (responses whose parent assistant was dropped)
    // survive. Both trigger vLLM / OpenAI 400 schema-rejection errors.
    working = this._reconcileToolCallSchema(working);

    // 4. Guaranteed Invariant: vLLM (qwen3_coder tool parser) REQUIRES at least one non-empty 'user' message
    const hasValidUser = working.some(
      (m) => m.role === 'user' && typeof m.content === 'string' && m.content.trim().length > 0
    );
    if (!hasValidUser) {
      const fallbackPrompt = activeGoal || this.agent?.activeGoal || 'Continue autonomous task execution and fulfill the objective.';
      working.splice(1, 0, {
        role: 'user',
        content: fallbackPrompt,
      });
    }

    return working;
  }

  /**
   * Post-compaction schema reconciliation. Guarantees every surviving
   * assistant.tool_calls has a corresponding tool response, and every surviving
   * tool message has a parent assistant that requested it. Prevents the
   * vLLM / OpenAI 400 schema-rejection class of errors caused by compaction
   * dropping half of a tool round (request without response, or vice-versa).
   *
   * Single O(n) pass; returns a fresh filtered array.
   */
  _reconcileToolCallSchema(messages) {
    if (!Array.isArray(messages) || messages.length === 0) return messages;

    // Set of tool_call_ids that have a tool response present.
    const respondedIds = new Set();
    for (const m of messages) {
      if (m && m.role === 'tool' && m.tool_call_id) respondedIds.add(m.tool_call_id);
    }

    // First pass: for each assistant with tool_calls, keep only the subset whose
    // id has a tool response. Track which surviving ids are still "requested".
    const requestedIds = new Set();
    const dropIdx = new Set();
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      if (!m) continue;
      if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
        const survivors = m.tool_calls.filter((tc) => tc && tc.id && respondedIds.has(tc.id));
        for (const tc of survivors) requestedIds.add(tc.id);
        if (survivors.length === 0) {
          if (typeof m.content === 'string' && m.content.trim().length > 0) {
            // Keep the assistant as plain content; strip the dangling tool_calls.
            const cleaned = { ...m };
            delete cleaned.tool_calls;
            messages[i] = cleaned;
          } else {
            // No content and no resolved tool_calls — useless to the model, drop it.
            dropIdx.add(i);
          }
        } else if (survivors.length < m.tool_calls.length) {
          // Some tool_calls orphaned by compaction; keep only the resolved subset.
          messages[i] = { ...m, tool_calls: survivors };
        }
      }
    }

    // Second pass: drop orphaned assistants (flagged above) and any tool message
    // whose parent request did not survive reconciliation.
    const result = [];
    for (let i = 0; i < messages.length; i++) {
      if (dropIdx.has(i)) continue;
      const m = messages[i];
      if (m && m.role === 'tool' && m.tool_call_id && !requestedIds.has(m.tool_call_id)) continue;
      result.push(m);
    }

    return result;
  }
}
