/**
 * Hierarchical Multi-Agent Topology: Subagent Delegation Engine
 * Spawns isolated worker subagents with scoped toolsets and clean context windows.
 * Prevents attention drift, token bloat, and context exhaustion.
 */

import { executeTool } from '../tools/executor.mjs';
import { callLlm } from '../transport/llm-client.mjs';
import { execSync } from 'node:child_process';
import { isGitRepo } from './workflow-optimizer.mjs';

// Scoped toolsets by subagent role
export const SUBAGENT_ROLES = {
  recon: {
    name: 'Reconnaissance Subagent',
    tools: ['grep_search', 'get_file_outline', 'read_file', 'bash'],
    systemDirective: `You are an expert Reconnaissance Subagent.
Your sole job is to locate relevant files, inspect AST symbols, find definitions, and identify defect locations.
Do NOT attempt to write or edit files. Return a concise JSON summary of exact line numbers and symbol structures found.`,
  },
  coder: {
    name: 'Coding & Patch Subagent',
    tools: ['replace_file_content', 'multi_replace_file_content', 'write_file', 'read_file', 'bash'],
    systemDirective: `You are a surgical Coding Subagent.
Your sole job is to formulate and apply exact code replacements using 'replace_file_content', then verify with 'bash'.
Always prefer surgical replacement over whole-file overwriting. Ensure tests pass with exit code 0 before concluding.`,
  },
  browser_qa: {
    name: 'Browser QA & Verification Subagent',
    tools: ['browser_open', 'browser_screenshot', 'browser_click', 'browser_type', 'browser_console_logs', 'start_daemon', 'read_daemon_logs', 'stop_daemon', 'bash'],
    systemDirective: `You are a Browser QA Subagent.
Your job is to start services with 'start_daemon', state the full URL, then open that allowlisted origin with 'browser_open'. Interact, check console errors, and capture a screenshot. Do not open an origin that is not on the allowlist.`,
  },
};

export class SubagentRunner {
  constructor(parentAgent) {
    this.parent = parentAgent;
  }

  /**
   * Spawns an isolated subagent to perform a bounded micro-task.
   *
   * @param {object} params
   * @param {'recon'|'coder'|'browser_qa'} params.role - Subagent specialization
   * @param {string} params.objective - Specific delegated task
   * @param {string[]} [params.targetFiles] - Specific files to focus on
   * @param {number} [params.maxRounds=10] - Turn cap for worker
   * @returns {Promise<object>} Structured result summary
   */
  async spawn({ role = 'coder', objective, targetFiles = [], maxRounds = 10 }) {
    const roleConfig = SUBAGENT_ROLES[role] || SUBAGENT_ROLES.coder;
    const allowedTools = new Set(roleConfig.tools);

    const subContext = {
      ...this.parent,
      isSubagent: true,
      subagentRole: role,
      activeGoal: objective,
      workspaceDir: this.parent.workspaceDir,
      target: this.parent.target,
      provider: this.parent.provider,
      model: this.parent.model,
      baseUrl: this.parent.baseUrl,
      apiKey: this.parent.apiKey,
      filesInspected: new Map(),
    };

    const messages = [
      {
        role: 'system',
        content: `${roleConfig.systemDirective}\nWorkspace: ${subContext.workspaceDir}\nAllowed Tools: ${roleConfig.tools.join(', ')}`,
      },
      {
        role: 'user',
        content: `Objective: ${objective}${targetFiles.length ? `\nTarget Files: ${targetFiles.join(', ')}` : ''}\n\nExecute the objective now using your tools. When done, output a final JSON summary: {"status":"success"|"failed","summary":"...","files_modified":["..."],"verification_proof":"..."}`,
      },
    ];

    let round = 0;
    const filesModified = [];
    let verificationProof = '';

    while (round < maxRounds) {
      round++;
      let response;
      try {
        response = await callLlm(messages, subContext);
      } catch (err) {
        return {
          ok: false,
          status: 'failed',
          role,
          error: `Subagent LLM call failed: ${err.message}`,
        };
      }

      if (!response) break;

      const toolCalls = response.tool_calls || [];

      if (toolCalls.length === 0) {
        // Subagent formulated completion
        const content = response.content || '';
        let structuredSummary = null;
        try {
          const match = content.match(/\{[\s\S]*"status"[\s\S]*\}/);
          if (match) {
            structuredSummary = JSON.parse(match[0]);
          }
        } catch {}

        // Gather git diff stats if any changes made in a Git repository
        let gitDiffSummary = 'No changes';
        try {
          if (isGitRepo(subContext.workspaceDir)) {
            const diffOutput = execSync('git diff --stat', {
              cwd: subContext.workspaceDir,
              encoding: 'utf8',
              stdio: ['pipe', 'pipe', 'pipe'],
            });
            if (diffOutput.trim()) gitDiffSummary = diffOutput.trim();
          }
        } catch {}

        return {
          ok: true,
          status: structuredSummary?.status || 'success',
          role,
          summary: structuredSummary?.summary || content.slice(0, 300),
          files_modified: structuredSummary?.files_modified || filesModified,
          verification_proof: structuredSummary?.verification_proof || verificationProof || 'Completed without explicit assertion',
          git_diff_summary: gitDiffSummary,
          roundsUsed: round,
        };
      }

      messages.push(response);

      for (const tc of toolCalls) {
        const name = tc.function.name;
        if (!allowedTools.has(name)) {
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            name,
            content: JSON.stringify({ ok: false, error: `Tool "${name}" is not permitted for ${roleConfig.name}` }),
          });
          continue;
        }

        let resultStr = '';
        try {
          resultStr = await executeTool(name, tc.function.arguments, subContext);
        } catch (toolErr) {
          resultStr = JSON.stringify({ ok: false, error: toolErr.message });
        }

        let parsed = {};
        try { parsed = JSON.parse(resultStr); } catch {}

        if ((name === 'replace_file_content' || name === 'write_file') && parsed.ok && (parsed.path || parsed.file)) {
          const p = parsed.path || parsed.file;
          if (!filesModified.includes(p)) filesModified.push(p);
        }

        if (name === 'bash' && parsed.ok && parsed.exitCode === 0) {
          verificationProof = `Command "${tc.function.arguments?.slice(0, 50)}" exited with code 0`;
        }

        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          name,
          content: resultStr.slice(0, 3000), // compact tool result for subagent context
        });
      }
    }

    return {
      ok: true,
      status: 'completed_max_rounds',
      role,
      summary: `Subagent reached ${maxRounds} rounds.`,
      files_modified: filesModified,
      verification_proof: verificationProof,
    };
  }
}

/**
 * Handler for spawn_subagent tool.
 */
export async function spawnSubagentHandler(args, ctx = {}) {
  const role = args?.role || 'coder';
  const objective = args?.objective || args?.task;
  const targetFiles = args?.targetFiles || args?.target_files || [];
  const maxRounds = parseInt(args?.maxRounds || args?.max_rounds || 10, 10);

  if (!objective) {
    return JSON.stringify({ ok: false, error: 'Objective is required for subagent', exitCode: 1 });
  }

  const runner = new SubagentRunner(ctx);
  const result = await runner.spawn({ role, objective, targetFiles, maxRounds });
  return JSON.stringify(result, null, 2);
}

export default {
  SubagentRunner,
  spawn_subagent: spawnSubagentHandler,
  spawnSubagentHandler,
};
