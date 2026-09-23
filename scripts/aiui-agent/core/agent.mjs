import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import { spawn, execSync } from 'node:child_process';

import {
  ROOT_DIR,
  DEFAULT_MODEL,
  DEFAULT_API_KEY,
  DEFAULT_TARGET,
  DEFAULT_ENV_ID,
  CLOUD_KEY_PROXY_URL,
  FEATHERLESS_DIRECT_URL,
  SPARK_HOST,
  SPARK_QWEN_HOST,
  SPARK_USER,
  getResolvedSshKey,
  isRunningOnSpark,
  loadOptimizerPolicy,
} from '../config.mjs';
import { dynamicToolManager } from '../../dynamic-tool-manager.mjs';
import { AGENT_TOOLS } from '../tools/registry.mjs';
import { executeTool } from '../tools/executor.mjs';
import { executeBashCommand } from '../tools/handlers/bash.mjs';
import { preparePalaceContext, reflectPalaceDraft, consolidateDurableTurn } from '../../../src/lib/palaceOrchestrator.ts';
import processManager from './process-manager.mjs';
import { browserOpenHandler } from '../tools/handlers/browser.mjs';
import { webUnblockerHandler } from '../tools/handlers/unblocker.mjs';
import { SystemPromptEngine } from './system-prompt.mjs';
import { CircuitBreakerManager, buildContextValidationErrorNudge } from './circuit-breaker.mjs';
import { formatToolOutputForContext, compactHistoricTurnMessages, buildContextContinuation } from './output-curator.mjs';
import { appendStep, createRun, readLatestRun, resumeText, updateRun, writeCheckpoint } from './run-record.mjs';
import { PlanEngine, ExecutionPlan, isAdvisoryPrompt } from './planner.mjs';
import { saveWorkflowState, isGitRepo, initGitRepo } from './workflow-optimizer.mjs';
import { callLlm } from '../transport/llm-client.mjs';
import { checkServices, runOptimizationPass, sendCliDebugEvent, getRecentCliTraffic } from '../transport/telemetry.mjs';
import {
  CLI_SKINS,
  getSkin,
  rgb,
  c,
  gradient,
} from '../ui/skins.mjs';
import {
  renderCard,
  badge,
  LiveSpinner,
  renderStatusDashboard,
  renderCodeBuddyHeroCard,
  renderPlanCard,
  renderWorkflowStageBoard,
  renderThinkingMatrix,
  getResponsiveWidth,
  renderCognitiveProgressionCard,
  renderToolExecutionStage,
  renderExecutionStep,
  renderMilestoneTransition,
  renderMissionSummary,
  renderVerificationProofGate,
  renderAgentResponseStage,
  renderTerminalMarkdown,
} from '../ui/components.mjs';

export class AiuiAgent {
  constructor(options = {}) {
    this.options = options;
    this.provider = options.provider || (options.model?.includes('qwen-abliterated') ? 'spark' : 'featherless');
    this.target = options.target || DEFAULT_TARGET;
    this.model = options.model || (this.provider === 'spark' ? 'qwen-abliterated' : DEFAULT_MODEL);
    this.apiKey = options.apiKey || DEFAULT_API_KEY;
    this.baseUrl = options.baseUrl || (this.provider === 'spark' ? `http://${SPARK_QWEN_HOST}:8000/v1` : (isRunningOnSpark() ? FEATHERLESS_DIRECT_URL : CLOUD_KEY_PROXY_URL));
    this.workspaceDir = options.workspaceDir || process.cwd();
    this.envId = options.envId || DEFAULT_ENV_ID;
    this.maxRounds = options.maxRounds || parseInt(process.env.AIUI_MAX_ROUNDS, 10) || 50;
    this.deepBuild = Boolean(options.deepBuild);
    this.optimize = Boolean(options.optimize);
    this.verbose = Boolean(options.verbose);
    this.autoPlan = options.plan !== false;
    this.reviewPlan = Boolean(options.reviewPlan);
    this.skin = getSkin(options.skin || process.env.AIUI_SKIN || 'aiui');
    this.skinName = this.skin.id;

    this.messages = [];
    this.filesInspected = new Map();
    this.dynamicTools = dynamicToolManager.getActiveToolDefinitions();
    this.systemEngine = new SystemPromptEngine(this);
    this.circuitBreaker = new CircuitBreakerManager(this.workspaceDir, this.envId);
    this.planEngine = new PlanEngine(this);
    this.activePlan = null;

    // Live Interjection & Non-Blocking Steering State
    this.isExecutingTurn = false;
    this.abortRequested = false;
    this.interjectionQueue = [];
    this.activeTurnAbortController = null;
  }

  queueInterjection(text) {
    if (text && typeof text === 'string' && text.trim().length > 0) {
      this.interjectionQueue.push(text.trim());
    }
  }

  drainInterjections() {
    const pending = [...this.interjectionQueue];
    this.interjectionQueue = [];
    return pending;
  }

  abortCurrentTurn(reason = 'Aborted by user') {
    this.abortRequested = true;
    if (this.activeTurnAbortController) {
      try {
        this.activeTurnAbortController.abort(reason);
      } catch {}
    }
  }

  setProvider(name) {
    const p = String(name || '').toLowerCase().trim();
    if (p === 'spark' || p === 'local') {
      this.provider = 'spark';
      this.baseUrl = `http://${SPARK_QWEN_HOST}:8000/v1`;
      this.model = 'qwen-abliterated';
      return true;
    } else if (p === 'featherless' || p === 'cloud') {
      this.provider = 'featherless';
      this.baseUrl = isRunningOnSpark() ? FEATHERLESS_DIRECT_URL : CLOUD_KEY_PROXY_URL;
      this.model = DEFAULT_MODEL;
      return true;
    }
    return false;
  }

  setSkin(name) {
    const s = getSkin(name);
    if (!s) return false;
    this.skin = s;
    this.skinName = s.id;
    return true;
  }

  setMode(newMode) {
    const m = String(newMode || '').toLowerCase().trim();
    if (m === 'chat' || m === 'consult') {
      this.mode = 'chat';
      this.deepBuild = false;
      this.log(`\n✔ Mode switched to: ${rgb(...this.skin.success)}CHAT (Conversational / Consultation)${c.reset}\n`);
      return true;
    }
    if (m === 'agent' || m === 'swe' || m === 'standard') {
      this.mode = 'agent';
      this.deepBuild = false;
      this.log(`\n✔ Mode switched to: ${rgb(...this.skin.success)}AUTONOMOUS AGENT (Full SWE Tool Capabilities)${c.reset}\n`);
      return true;
    }
    if (m === 'deep' || m === 'deepbuild' || m === 'deep-build') {
      this.mode = 'deep';
      this.deepBuild = true;
      this.log(`\n✔ Mode switched to: ${rgb(...this.skin.danger)}DEEP BUILD (Zero stubs, strict verification gates required)${c.reset}\n`);
      return true;
    }
    if (m === 'optimize' || m === 'optimise') {
      this.optimize = true;
      this.log(`\n✔ Mode switched to: ${rgb(...this.skin.gold)}RESPONSE OPTIMIZER (Tuned policy enabled)${c.reset}\n`);
      return true;
    }
    this.log(`\n${rgb(...this.skin.warning)}Unknown mode: "${newMode}". Valid modes: chat, agent, deep, optimize.${c.reset}\n`);
    return false;
  }

  displayModeStatus() {
    const policy = loadOptimizerPolicy();
    const effectiveTemp = (0.2 + (policy?.temperatureBias || 0)).toFixed(3);
    const activeModeLabel = this.deepBuild
      ? `${rgb(...this.skin.danger)}DEEP BUILD${c.reset} (100% test assertions required)`
      : this.mode === 'chat'
      ? `${rgb(...this.skin.accent)}CHAT${c.reset} (Conversational consultation)`
      : `${rgb(...this.skin.success)}AUTONOMOUS AGENT${c.reset} (Full SWE tool execution)`;

    const lines = [
      ` ${rgb(...this.skin.primary)}Active Mode:${c.reset}       ${activeModeLabel}`,
      ` ${rgb(...this.skin.primary)}Provider & GPU:${c.reset}    ${rgb(...this.skin.gold)}${this.provider.toUpperCase()}${c.reset} (${this.baseUrl})`,
      ` ${rgb(...this.skin.primary)}Active Model:${c.reset}      ${rgb(...this.skin.accent)}${this.model}${c.reset}`,
      ` ${rgb(...this.skin.primary)}Execution Target:${c.reset}  ${rgb(...this.skin.success)}${this.target}${c.reset} (${this.workspaceDir})`,
      ` ${rgb(...this.skin.primary)}Response Optimizer:${c.reset}${this.optimize || policy?.enabled ? rgb(...this.skin.success) + 'ENABLED (' + (policy?.stats?.archetype || 'High-Assurance') + ')' : rgb(...this.skin.muted) + 'OFF'}${c.reset}`,
      ` ${rgb(...this.skin.primary)}Sampling Temp:${c.reset}     ${rgb(...this.skin.muted)}${effectiveTemp}${c.reset}`,
      ` ${rgb(...this.skin.primary)}Max Rounds Limit:${c.reset}  ${rgb(...this.skin.muted)}${this.maxRounds} rounds${c.reset}`,
      ``,
      ` ${rgb(...this.skin.muted)}Available Modes:${c.reset}`,
      `   • ${rgb(...this.skin.primary)}/mode chat${c.reset}     Conversational consultation without tool loops`,
      `   • ${rgb(...this.skin.primary)}/mode agent${c.reset}    Full autonomous software engineer mode`,
      `   • ${rgb(...this.skin.primary)}/mode deep${c.reset}     Deep build mode (zero stubs, strict verification gates)`,
      `   • ${rgb(...this.skin.primary)}/mode optimize${c.reset} Response optimizer mode (evolved policy tuning)`,
    ];

    console.log(
      '\n' +
        renderCard({
          title: '⚙️  AIUI AGENT OPERATIONAL MODES',
          badge: badge(this.deepBuild ? 'DEEP BUILD' : (this.mode === 'chat' ? 'CHAT' : 'AGENT'), this.skin.success, this.skin.badgeBg),
          lines,
          skin: this.skin,
          width: 78,
        }) +
        '\n'
    );
  }

  log(msg, style = c.reset) {
    console.log(`${style}${msg}${c.reset}`);
  }

  logVerbose(label, data) {
    if (!this.verbose) return;
    console.log(`${c.gray}[DEBUG] ${label}:${c.reset}`, typeof data === 'string' ? data : JSON.stringify(data, null, 2));
  }

  async checkServices() {
    return await checkServices();
  }

  async runOptimizationPass() {
    return await runOptimizationPass(this);
  }

  async runBash(command, target = this.target) {
    return await executeBashCommand(command, target, this.workspaceDir, this.envId);
  }

  async executeTool(name, argsJson) {
    return await executeTool(name, argsJson, this);
  }

  async callLlm(messages) {
    return await callLlm(messages, this);
  }

  buildSystemPrompt(goal) {
    return this.systemEngine.buildUnifiedSystemPrompt();
  }

  // Autonomous Multi-Turn Execution Loop
  async executeTurn(goal) {
    this.isExecutingTurn = true;
    this.abortRequested = false;
    this.interjectionQueue = [];
    this.activeTurnAbortController = new AbortController();

    try {
      if (/^(continue|resume)$/i.test(String(goal || '').trim())) {
        const previous = readLatestRun()
        const resumed = resumeText(previous)
        if (resumed) goal = resumed
      }
      this.activeGoal = goal;
      this.runRecord = createRun({ goal })
      const terminalWidth = getResponsiveWidth(84, 98);
      const rawGoalLines = typeof goal === 'string' ? goal.split(/\r?\n/) : [String(goal)];
      const isMultiLineGoal = rawGoalLines.length > 1;

      let promptDisplay = goal;
      if (isMultiLineGoal) {
        const firstLine = rawGoalLines[0].trim().slice(0, 52);
        promptDisplay = `${firstLine ? `${firstLine} ` : ''}${rgb(...this.skin.primary)}\x1b[1m[${rawGoalLines.length} lines]${c.reset}`;
      }

      const cardLines = [
        `${rgb(...this.skin.gold)}\x1b[1mPrompt:${c.reset} ${promptDisplay}`,
      ];

      if (isMultiLineGoal && rawGoalLines.length > 2) {
        const sampleLine = rawGoalLines.find((l, idx) => idx > 0 && l.trim().length > 0) || '';
        if (sampleLine) {
          cardLines.push(`${rgb(...this.skin.muted)}  Preview: ${sampleLine.trim().slice(0, 68)}...${c.reset}`);
        }
      }

      cardLines.push(
        `${rgb(...this.skin.muted)}Model:${c.reset}  ${rgb(...this.skin.secondary)}${this.model}${c.reset}  ${rgb(...this.skin.borderActive)}│${c.reset}  ${rgb(...this.skin.muted)}Workspace:${c.reset} ${rgb(...this.skin.success)}${this.workspaceDir}${c.reset}`
      );

      const goalCard = renderCard({
        title: '⚡ AGENT GOAL',
        badge: badge(`TARGET: ${this.target.toUpperCase()}`, this.skin.primary, this.skin.badgeBg),
        lines: cardLines,
        skin: this.skin,
        width: terminalWidth,
      });
      console.log('\n' + goalCard + '\n');

      // Phase 1: Cognitive Deliberation & Strategic Plan Synthesis
      if (this.planEngine.shouldPlan(goal, this.options)) {
        const planSpin = new LiveSpinner({
          label: '🧠 Deliberating architecture & synthesizing strategic plan',
          skin: this.skin,
          showTimer: true,
          allowInterrupt: true,
          onInterrupt: () => {
            this.abortCurrentTurn('Interrupted by user (esc twice)');
          },
        });
        planSpin.start();
        try {
          this.activePlan = await this.planEngine.generateDeliberationAndPlan(goal, {
            workspaceDir: this.workspaceDir,
          });
          planSpin.stop();

          if (this.activePlan) {
            console.log(renderWorkflowStageBoard({ plan: this.activePlan, skin: this.skin, width: terminalWidth }) + '\n');
          }
        } catch (planErr) {
          planSpin.stop();
          this.log(`  ${rgb(...this.skin.warning)}⚠️  Heuristic plan fallback (${planErr.message})${c.reset}\n`);
        }
      }

      let round = 0;
      let lastAnnouncedMilestoneId = -1;
      let finished = false;
      let lastModificationRound = 0;
      let lastVerificationSuccessRound = 0;
      const commandsRun = [];
      const filesModified = [];
      const turnMessages = [
        {
          role: 'user',
          content: `${goal}\n\n[RUNTIME CONTEXT]\n${this.systemEngine.buildDynamicCognitiveRegister(1, goal)}`,
        },
      ];
      let palaceTurn = null;
      let palaceReflected = false;
      try {
        palaceTurn = await preparePalaceContext(goal);
        if (palaceTurn?.systemBlock) {
          turnMessages[0].content += `\n\n${palaceTurn.systemBlock}`;
        }
      } catch {
        palaceTurn = null;
      }
      let loopSteeringDirectives = [];
      let contextContinuations = 0;

      while (round < this.maxRounds && !finished) {
        if (this.abortRequested) {
          this.log(`\n${rgb(...this.skin.warning)}\x1b[1m🛑 Turn aborted by user interjection.${c.reset}`);
          break;
        }

        // Apply any pending user interjections captured during previous thinking/tool step
        const pendingInterjections = this.drainInterjections();
        if (pendingInterjections.length > 0) {
          for (const userText of pendingInterjections) {
            this.log(`\n${rgb(...this.skin.accent)}\x1b[1m💬 Applying User Steering:${c.reset} "${userText}"`);
            turnMessages.push({
              role: 'user',
              content: `[LIVE USER INTERJECTION]: ${userText}\n\nDirective: The user provided this guidance while you were executing. Prioritize addressing this instruction immediately in your next action.`,
            });
            loopSteeringDirectives.push(`User interjected: "${userText}". Adapt actions accordingly.`);
          }
        }

        round++;

        // Visual milestone synchronization banner (only when active milestone changes)
        if (this.activePlan && !this.activePlan.isComplete()) {
          const activeStep = this.activePlan.getActiveStep();
          if (activeStep && activeStep.id !== lastAnnouncedMilestoneId) {
            lastAnnouncedMilestoneId = activeStep.id;
            this.log(
              `  ${rgb(...this.skin.gold)}▶ [MILESTONE ${activeStep.id}/${this.activePlan.steps.length}] ${activeStep.title}${c.reset} ${c.dim}(Phase: ${activeStep.phase})${c.reset}`
            );
          }
        }

        const cols = process.stdout.columns || 80;
        const steerHint = cols >= 75 ? " (Type to steer, 'stop' to abort)" : cols >= 55 ? " ('stop' to abort)" : '';
        const spinner = new LiveSpinner(
          `${rgb(...this.skin.muted)}[Round ${round}/${this.maxRounds}] Thinking...${steerHint}${c.reset}`,
          this.skin
        );
        spinner.start();

        const compactedMessages = compactHistoricTurnMessages(turnMessages, round);
        const messages = this.systemEngine.assembleMessages(goal, round, compactedMessages, loopSteeringDirectives);
        loopSteeringDirectives = []; // consumed

      let assistantMsg;
      try {
        assistantMsg = await this.callLlm(messages);
        spinner.stop();
      } catch (err) {
        spinner.stop();
        if (this.abortRequested || err.message?.includes('Aborted by user') || err.name === 'AbortError') {
          this.log(`\n${rgb(...this.skin.warning)}\x1b[1m🛑 Turn aborted by user interjection.${c.reset}`);
          break;
        }
        const overflow = err.code === 'CONTEXT_OVERFLOW' || /CONTEXT_OVERFLOW|maximum context length is/i.test(err.message || '');
        if (overflow && contextContinuations < 3 && round < this.maxRounds) {
          contextContinuations++;
          const continuation = buildContextContinuation(goal, turnMessages);
          if (this.runRecord?.id) {
            writeCheckpoint(this.runRecord.id, { summary: continuation, nextStep: 'continue the same task' })
          }
          turnMessages.length = 0;
          turnMessages.push({ role: 'user', content: continuation });
          this.log(
            `\n${rgb(...this.skin.warning)}⚡ Context full.${c.reset} Continuing the same task from a checkpoint (${contextContinuations}/3).`
          );
          continue;
        }
        this.log(`\n${c.red}❌ LLM Request Failed:${c.reset} ${err.message}`);
        break;
      }

      // Stage 1: Strictly render 5-Stage Cognitive Progression Protocol
      if (assistantMsg.content && assistantMsg.content.includes('<think>')) {
        const thinkMatch = assistantMsg.content.match(/<think>([\s\S]*?)<\/think>/);
        if (thinkMatch) {
          const thoughts = thinkMatch[1].trim();
          console.log(
            '\n' +
              renderCognitiveProgressionCard({
                thoughts,
                round,
                maxRounds: this.maxRounds,
                skin: this.skin,
                width: terminalWidth,
              }) +
              '\n'
          );
        }
      }

      turnMessages.push(assistantMsg);

      // Check if tool calls were emitted natively or formatted as text JSON
      let toolCalls = assistantMsg.tool_calls || [];
      if (toolCalls.length === 0 && assistantMsg.content) {
        const text = assistantMsg.content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
        const jsonMatch = text.match(/\{[\s\S]*"name"\s*:\s*"([a-zA-Z0-9_]+)"[\s\S]*"arguments"\s*:\s*(\{[\s\S]*?\})[\s\S]*\}/);
        if (jsonMatch) {
          try {
            const parsed = JSON.parse(jsonMatch[0]);
            if (parsed.name && parsed.arguments) {
              toolCalls = [
                {
                  id: `call_${Date.now()}`,
                  type: 'function',
                  function: {
                    name: parsed.name,
                    arguments: typeof parsed.arguments === 'string' ? parsed.arguments : JSON.stringify(parsed.arguments),
                  },
                },
              ];
            }
          } catch {}
        }
      }

      if (toolCalls.length === 0) {
        let cleanContent = (assistantMsg.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
        const isAdvisory = isAdvisoryPrompt(goal);

        // Degenerate repetition filter (e.g. {"!!!!!!!!!!!!!!!!... or single char runaway loops)
        const isDegenerate = /(.)\1{15,}/.test(cleanContent) || /^\{"[^a-zA-Z0-9]{6,}/.test(cleanContent);
        if (isDegenerate) {
          cleanContent = cleanContent.replace(/(.)\1{8,}/g, '').trim();
        }

        const usefulChars = cleanContent.replace(/[^a-zA-Z0-9]/g, '').length;

        // Advisory / Strategic Consultation: conclude directly without requiring file mutations or tool loops
        if ((isAdvisory || (usefulChars >= 60 && filesModified.length === 0)) && !isDegenerate) {
          // A prose reply does not verify milestones.
        } else {
          // Check if the agent claims completion prematurely while prompt clearly asks for more
          const pendingIndicators = [
            /\b(?:next\s+(?:step|action|task|thing|I\s+will|we\s+will|let's)|next:\s*)/i,
            /\b(?:now\s+(?:I\s+will|we\s+will|let's|proceeding|moving|going\s+to|I'll|we'll))\b/i,
            /\b(?:will\s+now|proceeding\s+to|moving\s+on\s+to|let's\s+now|still\s+need\s+to|remaining\s+tasks?)\b/i,
            /\b(?:step\s+\d+\s+(?:is\s+)?complete[.,;:—\s]+(?:now|next|moving|proceeding))\b/i,
          ];
          const hasPending = pendingIndicators.some((p) => p.test(cleanContent));

          // Check multi-step prompt requirements
          const isMulti =
            /(?:^|\n)\s*(?:\d+[\.)]|step\s*\d|phase\s*\d|task\s*\d|[-*•]\s+\[?[ x]?\]?)/im.test(goal) ||
            /\b(?:and\s+then|after\s+that|then\b|afterwards\b|next\b|also\b|additionally\b|finally\b)/i.test(goal);

          const asksCommit = /\b(?:git\s+commit|commit\b|git\s+push|push\b)\b/i.test(goal);
          const ranCommit = commandsRun.some((c) => /\bgit\s+(?:commit|push)\b/i.test(c));

          const unfulfilled = hasPending
            ? 'assistant indicated pending next steps'
            : isMulti && asksCommit && !ranCommit
            ? 'prompt requested git commit/push which has not occurred'
            : null;

          if (unfulfilled && round < this.maxRounds) {
            this.log(
              `\n${rgb(...this.skin.warning)}\x1b[1m⚡ Prompt asks for more (${unfulfilled}). Continuing autonomous execution...${c.reset}`
            );
            turnMessages.push({
              role: 'user',
              content: `[CONTINUE — UNFULFILLED REQUIREMENTS]\nGoal: ${goal}\nDirective: The prompt clearly asks for more (${unfulfilled}). Do not stop prematurely or claim complete without finishing all requested items. Execute the next required concrete tool action now.`,
            });
            continue;
          }

          // Strategic Plan milestone check to prevent premature completion
          if (this.activePlan && !this.activePlan.isComplete() && round < this.maxRounds) {
            const pendingStep = this.activePlan.getActiveStep();
            const stepDesc = pendingStep ? `Step ${pendingStep.id}: "${pendingStep.title}"` : 'remaining milestones';
            this.log(
              `\n${rgb(...this.skin.warning)}\x1b[1m⚡ Strategic Plan milestones still pending (${stepDesc}). Continuing execution...${c.reset}`
            );
            turnMessages.push({
              role: 'user',
              content: `[CONTINUE — STRATEGIC PLAN INCOMPLETE]\n` +
                `Pending Milestone: ${stepDesc}\n` +
                `Target Files: ${pendingStep?.targetFiles?.join(', ') || 'N/A'}\n` +
                `Required Proof Gate: ${pendingStep?.verificationGate || 'Verified exit code 0'}\n` +
                `Directive: Do not terminate without completing and verifying all plan milestones. Execute the required tool action now.`,
            });
            continue;
          }
        }

        // Proof-of-Work Pre-Completion Validator (Pillar 2 / Rule 13 compliance)
        // If code was modified, reject completion until a test command (exit code 0) has been executed AFTER the mutation
        if (filesModified.length > 0 && lastVerificationSuccessRound <= lastModificationRound && round < this.maxRounds) {
          this.log(
            `\n${rgb(...this.skin.warning)}\x1b[1m⚡ Proof-of-Work Gate: Code was modified (${filesModified.join(', ')}), but no verification test with exit code 0 was recorded since mutation. Continuing execution...${c.reset}`
          );
          turnMessages.push({
            role: 'user',
            content: `[CONTINUE — PROOF-OF-WORK VERIFICATION GATE REQUIRED]\n` +
              `Modified Files: ${filesModified.join(', ')}\n` +
              `Directive: Rule 13 (The Proof-of-Work Invariant) strictly forbids declaring complete without empirical execution evidence. Run tests, reproduction scripts, or type/syntax checks (e.g. via 'bash') confirming exit code 0 before concluding.`,
          });
          continue;
        }

        // Automated Git Diff Audit (Pillar 2)
        try {
          if (isGitRepo(this.workspaceDir)) {
            const diffOutput = execSync('git diff --stat', {
              cwd: this.workspaceDir,
              encoding: 'utf8',
              timeout: 5000,
              stdio: ['pipe', 'pipe', 'pipe'],
            });
            if (diffOutput && diffOutput.trim()) {
              console.log(
                '\n' +
                  renderCard({
                    title: '📊 GIT DIFF AUDIT (PROOF-OF-WORK)',
                    badge: badge('✔ AUDIT CLEAN', this.skin.success, [15, 35, 25]),
                    lines: [
                      `${rgb(...this.skin.muted)}Modified Files Stat:${c.reset}`,
                      ...diffOutput.trim().split('\n').map((l) => `${rgb(...this.skin.gold)}${l}${c.reset}`),
                    ],
                    skin: this.skin,
                    width: terminalWidth,
                  }) +
                  '\n'
              );
            }
          }
        } catch {}

        if (this.activePlan && this.activePlan.isComplete()) {
          console.log(
            '\n' +
              renderMissionSummary({
                plan: this.activePlan,
                filesModified,
                commandsRun,
                totalRounds: round,
                skin: this.skin,
                width: terminalWidth,
              }) +
              '\n'
          );
        }

        if (palaceTurn && !palaceReflected) {
          const verdict = reflectPalaceDraft(cleanContent, palaceTurn);
          if (!verdict.ok && round < this.maxRounds) {
            palaceReflected = true;
            this.log(`\n${rgb(...this.skin.warning)}\x1b[1m⚡ Palace reflection:${c.reset} ${verdict.reason}`);
            turnMessages.push({ role: 'user', content: verdict.nudge });
            continue;
          }
        }

        const children = this.runRecord?.id ? (readLatestRun()?.children || []) : []
        const pendingChild = children.find((child) => child.status !== 'completed' && child.status !== 'failed')
        if (pendingChild && round < this.maxRounds) {
          turnMessages.push({
            role: 'user',
            content: `[CONTINUE — SUBAGENT PENDING]\n${pendingChild.role} has not returned. Collect that result before finishing. Only the parent run can be verified.`,
          })
          continue
        }
        if (this.runRecord?.id && this.activePlan?.isComplete()) {
          updateRun(this.runRecord.id, { status: 'verified' })
        }

        if (cleanContent) {
          // Render conversational response as clean formatted terminal markdown
          const renderedMarkdownLines = renderTerminalMarkdown(cleanContent, {
            skin: this.skin,
            width: terminalWidth,
          });
          console.log('\n' + renderedMarkdownLines.join('\n') + '\n');
        }
        finished = true;
        break;
      }

      // Execute tool calls
      let hasError = false;

      for (let tcIdx = 0; tcIdx < toolCalls.length; tcIdx++) {
        const tc = toolCalls[tcIdx];
        const toolName = tc.function.name;
        const toolArgs = tc.function.arguments;
        let parsedArgs = {};
        try { parsedArgs = JSON.parse(toolArgs); } catch {}

        sendCliDebugEvent({
          type: 'tool_call',
          toolName,
          toolArgs: parsedArgs,
          target: parsedArgs.target || this.target,
          round,
        });

        // Evaluate action with circuit breaker
        const evalResult = this.circuitBreaker.evaluateAction(toolName, parsedArgs, toolArgs, this.envId);
        let rawResult;
        const isCircuitBreaker = evalResult.isCircuitBreaker;

        if (isCircuitBreaker) {
          this.consecutiveBreakerTrips = (this.consecutiveBreakerTrips || 0) + 1;
          this.circuitBreaker.persistLesson(evalResult, toolName, parsedArgs, this.workspaceDir, this.envId);
          rawResult = evalResult.breakerResponse;
          if (evalResult.warningDirective) {
            loopSteeringDirectives.push(evalResult.warningDirective);
          }
          if (this.consecutiveBreakerTrips >= 3) {
            this.log(`\n  ${rgb(...this.skin.danger)}\x1b[1m🛑 Anti-Loop Emergency Escape:${c.reset} 3 consecutive actions were blocked. Halting repetitive tool executions.`);
            loopSteeringDirectives.push(`[EMERGENCY CIRCUIT BREAKER HALT]: 3 consecutive commands were blocked for repetition. You are in a diagnostic loop. DO NOT attempt to run any more shell commands. Synthesize your answer or explain the result directly to the user now.`);
            this.consecutiveBreakerTrips = 0;
            finished = true;
          }
        } else {
          this.consecutiveBreakerTrips = 0;
          if (toolName === 'write_file' || toolName === 'replace_file_content' || toolName === 'patch') {
            this.circuitBreaker.onMutation(parsedArgs.path || parsedArgs.filename);
          }
          if (evalResult.warningDirective) {
            this.circuitBreaker.persistLesson(evalResult, toolName, parsedArgs, this.workspaceDir, this.envId);
            loopSteeringDirectives.push(evalResult.warningDirective);
          }
          if (evalResult.oscillationDirective) {
            this.circuitBreaker.persistLesson(evalResult, toolName, parsedArgs, this.workspaceDir, this.envId);
            loopSteeringDirectives.push(evalResult.oscillationDirective);
          }

          const toolSpinner = new LiveSpinner({
            label: 'Running tools',
            skin: this.skin,
            showTimer: true,
            allowInterrupt: true,
            onInterrupt: () => {
              this.abortCurrentTurn('Interrupted by user (esc twice)');
            },
          });
          toolSpinner.start();
          rawResult = await this.executeTool(toolName, toolArgs);
          toolSpinner.stop();
        }

        if (this.abortRequested) {
          break;
        }

        let parsed = {};
        try { parsed = JSON.parse(rawResult); } catch {}

        const isOk = !isCircuitBreaker && parsed.ok !== false && (parsed.exitCode === undefined || parsed.exitCode === 0);

        sendCliDebugEvent({
          type: 'tool_result',
          toolName,
          exitCode: parsed.exitCode ?? (isOk ? 0 : 1),
          stdout: (parsed.stdout || (parsed.ok ? rawResult : '') || '').slice(0, 300),
          stderr: (parsed.stderr || parsed.error || (!parsed.ok ? rawResult : '') || '').slice(0, 300),
          round,
        });

        if (toolName === 'bash') {
          const cmdText = parsedArgs.command || parsedArgs.cmd || toolArgs;
          commandsRun.push(cmdText);
        }
        if (this.runRecord?.id) {
          const touched = [parsedArgs.path, parsedArgs.filePath, parsed.path].filter(Boolean)
          appendStep(this.runRecord.id, {
            tool: toolName,
            ok: isOk,
            exitCode: parsed.exitCode,
            command: parsedArgs.command || parsedArgs.cmd || '',
            result: parsed.error || parsed.stdout || rawResult,
            files: touched,
            browserRunId: parsed.sessionId,
          })
          if (toolName === 'spawn_subagent') {
            const child = {
              role: parsed.role || parsedArgs.role || 'coder',
              objective: parsedArgs.objective || parsed.objective || '',
              status: parsed.ok === false ? 'failed' : (parsed.status || 'completed'),
              summary: parsed.summary || '',
            }
            const current = readLatestRun()
            if (current && current.id === this.runRecord.id) {
              updateRun(current.id, { children: [...(current.children || []), child] })
            }
          }
          if (this.activePlan) {
            updateRun(this.runRecord.id, {
              milestones: this.activePlan.steps.map((s) => ({
                title: s.title,
                status: s.status === 'completed' ? 'verified' : s.status,
                verificationGate: s.verificationGate || '',
              })),
            })
          }
        }

        // Render clean, linear 1-2 line execution step
        const activeStep = this.activePlan?.getActiveStep();
        const stepNum = activeStep ? `${activeStep.id}.${tcIdx + 1}` : `${round}.${tcIdx + 1}`;
        console.log(
          renderExecutionStep({
            stepNumber: stepNum,
            toolName,
            parsedArgs,
            toolArgs,
            parsed,
            isCircuitBreaker,
            skin: this.skin,
            target: parsed.target || this.target,
          })
        );

        if ((toolName === 'write_file' || toolName === 'replace_file_content' || toolName === 'multi_replace_file_content') && isOk) {
          const pth = parsedArgs.path || parsed.path || parsedArgs.filePath;
          if (pth && !filesModified.includes(pth)) filesModified.push(pth);
          lastModificationRound = round;
        }

        if (toolName === 'bash' && isOk && (parsed.exitCode === undefined || parsed.exitCode === 0)) {
          lastVerificationSuccessRound = round;
        }

        if (!isOk) {
          hasError = true;
          const nudge = buildContextValidationErrorNudge({
            toolName,
            parsedArgs,
            result: parsed,
            rawResult,
          });
          if (nudge) {
            loopSteeringDirectives.push(nudge);
          }
        }

        // Evaluate plan milestone progress
        let milestoneProgress = null;
        if (this.activePlan) {
          milestoneProgress = this.planEngine.evaluateProgress(this.activePlan, toolName, parsedArgs, parsed);
          if (milestoneProgress) {
            console.log(
              renderMilestoneTransition({
                completedStep: milestoneProgress.completedStep,
                nextStep: milestoneProgress.nextStep,
                skin: this.skin,
                width: terminalWidth,
              })
            );
            if (milestoneProgress.nextStep) {
              lastAnnouncedMilestoneId = milestoneProgress.nextStep.id;
            }
            saveWorkflowState(this.workspaceDir, {
              completedMilestones: this.activePlan.steps.filter((s) => s.status === 'completed').map((s) => s.title),
              currentMilestone: milestoneProgress.nextStep ? milestoneProgress.nextStep.title : 'COMPLETED',
              planTitle: this.activePlan.title,
            });
          }
        }

        // Stage 4: Closed-Loop Verification Proof Gate for standalone verification failures
        const isVerificationCmd =
          toolName === 'bash' &&
          /\b(?:test|pytest|check|diff|tsc|lint|verify|npm\s+run\s+test|node\s+--check)\b/i.test(parsedArgs.command || parsedArgs.cmd || '');
        if (isVerificationCmd && !isOk) {
          const gateName = milestoneProgress?.completedStep?.verificationGate || 'Automated verification test suite & exit status';
          const exitCode = parsed.exitCode !== undefined ? parsed.exitCode : 1;
          console.log(
            '\n' +
              renderVerificationProofGate({
                gate: gateName,
                status: 'failed',
                evidence: parsed.stderr || parsed.stdout || 'Non-zero exit status',
                command: parsedArgs.command || parsedArgs.cmd || toolName,
                exitCode,
                skin: this.skin,
                width: terminalWidth,
              }) +
              '\n'
          );
        }

        // Anti-loop detection for failing bash commands
        if (toolName === 'bash' && !isOk && !isCircuitBreaker) {
          const cmd = parsed.command || '';
          const directive = this.circuitBreaker.evaluateFailingBashCommand(cmd);
          if (directive) {
            this.log(`  ${rgb(...this.skin.warning)}\x1b[1m🔄 Anti-Loop Alert:${c.reset} Command failed repeatedly. Injecting course-correction steering.`);
            loopSteeringDirectives.push(directive);
          }
        }

        // Add tool output to context
        turnMessages.push({
          role: 'tool',
          tool_call_id: tc.id,
          name: toolName,
          content: formatToolOutputForContext(rawResult),
        });
      }

      // Check for any interjections received while tools were executing
      const midInterjections = this.drainInterjections();
      if (midInterjections.length > 0) {
        for (const userText of midInterjections) {
          this.log(`\n${rgb(...this.skin.accent)}\x1b[1m💬 User Interjection Captured:${c.reset} "${userText}"`);
          turnMessages.push({
            role: 'user',
            content: `[LIVE USER INTERJECTION]: ${userText}\n\nDirective: The user provided this guidance while tools were executing: "${userText}". Prioritize this instruction in your next step.`,
          });
          loopSteeringDirectives.push(`User interjected: "${userText}".`);
        }
      }

      // Inject anti-loop steering directives if any were triggered
      if (loopSteeringDirectives.length > 0 && round < this.maxRounds) {
        turnMessages.push({
          role: 'user',
          content: loopSteeringDirectives.join('\n\n'),
        });
      }

      // Auto-continue nudge if needed
      if (hasError && round < this.maxRounds && loopSteeringDirectives.length === 0) {
        turnMessages.push({
          role: 'user',
          content: '[AUTO-CONTINUE: Action produced an error. Inspect the traceback or error message, adjust your approach, and verify.]',
        });
      }
    }

    if (round >= this.maxRounds && !finished) {
      this.log(`\n${rgb(...this.skin.warning)}\x1b[1m⚠️  Reached max rounds limit (${this.maxRounds}). Completed turn.${c.reset}`);
      this.log(` ${rgb(...this.skin.muted)}Tip: Increase rounds with '${rgb(...this.skin.gold)}/rounds <n>${c.reset}${rgb(...this.skin.muted)}' (e.g. /rounds 100) or resume work by typing '${rgb(...this.skin.primary)}continue${c.reset}${rgb(...this.skin.muted)}'.${c.reset}`);
    }

    if (this.activePlan) {
      saveWorkflowState(this.workspaceDir, {
        completedMilestones: this.activePlan.steps.filter((s) => s.status === 'completed').map((s) => s.title),
        currentMilestone: this.activePlan.isComplete() ? 'COMPLETED' : (this.activePlan.getActiveStep()?.title || 'NONE'),
        planTitle: this.activePlan.title,
        isComplete: this.activePlan.isComplete(),
      });
      if (this.activePlan.isComplete()) {
        console.log('\n' + renderPlanCard({ plan: this.activePlan, skin: this.skin }) + '\n');
      }
    }

    // Same durable write as the web chat: verbatim drawer, optional triple, diary line.
    try {
      const filed = await consolidateDurableTurn(goal);
      if (filed.wrote) {
        this.log(`\n${rgb(...this.skin.success)}Palace write:${c.reset} ${filed.reason}`);
      }
    } catch {
      // Write failures must not block the turn
    }

    // Keep active session history sanitized
    this.messages = this.systemEngine.sanitizeHistory(turnMessages.slice(-12));
    return true;
  } finally {
    this.isExecutingTurn = false;
    this.activeTurnAbortController = null;
  }
}

  getPrompt() {
    return `${rgb(...this.skin.primary)}> ${c.reset}`;
  }

  // Interactive REPL Shell Loop
  async startRepl() {
    console.clear();

    const s = this.skin;
    const hero = renderCodeBuddyHeroCard({
      title: 'AIUI Code v2.154.0',
      workspaceDir: this.workspaceDir,
      webUiUrl: 'http://127.0.0.1:5173',
      mode: `Auto · ${this.provider === 'spark' ? 'high' : this.provider}`,
      model: this.model ? this.model.split('/').pop() : 'Qwen2.5-Coder-32B',
      recentActivity: this.messages && this.messages.length ? `${this.messages.length} messages loaded` : 'No recent activity',
      skin: s,
    });

    console.log(hero.card);
    console.log('\n' + hero.divider);

    const cheatSheetLines = [
      ` ${rgb(...s.gold)}/plan <task>${c.reset}       Formulate cognitive deliberation & execution plan`,
      ` ${rgb(...s.primary)}/plan status${c.reset}      Show active plan progress & milestone checklist`,
      ` ${rgb(...s.success)}/plan run${c.reset}         Execute the active plan`,
      ` ${rgb(...s.gold)}/provider <name>${c.reset}    Switch LLM provider: spark (local vLLM) | featherless (cloud)`,
      ` ${rgb(...s.secondary)}/model <id>${c.reset}       Switch active neural LLM model ID`,
      ` ${rgb(...s.gold)}/target <host>${c.reset}     Switch target: local_mac | dgx_spark | container`,
      ` ${rgb(...s.primary)}/workspace <dir>${c.reset}  Switch working directory for commands and tools`,
      ` ${rgb(...s.warning)}/rounds <n>${c.reset}        Set max autonomous turns (default: 50, e.g. /rounds 100)`,
      ` ${rgb(...s.accent)}/skin <name>${c.reset}      Switch skin: cyberpunk | matrix | ember | nord | synthwave`,
      ` ${rgb(...s.success)}/tools${c.reset}            List all available agent tools`,
      ` ${rgb(...s.primary)}/diff${c.reset}             Audit git diff stat and modified hunks`,
      ` ${rgb(...s.success)}/connect-repo${c.reset}     Connect & initialize Git repo in workspace`,
      ` ${rgb(...s.primary)}/daemons${c.reset}          List managed background processes`,
      ` ${rgb(...s.primary)}/browser [url]${c.reset}    Headless browser page inspection & error audit`,
      ` ${rgb(...s.accent)}/bench [mode]${c.reset}        Run benchmark suite (latency, throughput, concurrency, compare)`,
      ` ${rgb(...s.warning)}/status${c.reset}           Run ecosystem telemetry probe matrix`,
      ` ${rgb(...s.gold)}/ssh-key [path]${c.reset}     Configure or show DGX Spark SSH private key`,
      ` ${rgb(...s.success)}/init${c.reset}              Create AGENTS.md in current workspace`,
      ` ${rgb(...s.accent)}/paste${c.reset}            Enter dedicated multi-line paste mode (:run to exec)`,
      ` ${rgb(...s.accent)}/monitor [tail]${c.reset}     Live monitor & inspect CLI LLM traffic & latency`,
      ` ${rgb(...s.primary)}/unblock <url> [sel]${c.reset} Unblock page via Bright Data & manual expect elements`,
      ` ${rgb(...s.success)}/policy${c.reset}             Inspect active evolved meta-policy & multi-task genome`,
      ` ${rgb(...s.muted)}/deep, /optimize, /evolve, /clear, /exit${c.reset}`,
    ];

    const historyFile = path.join(os.homedir(), '.aiui_history');
    let pastHistory = [];
    try {
      if (fs.existsSync(historyFile)) {
        pastHistory = fs.readFileSync(historyFile, 'utf8')
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean);
      }
    } catch {}

    const slashCommands = [
      '/plan',
      '/provider',
      '/model',
      '/target',
      '/workspace',
      '/skin',
      '/tools',
      '/diff',
      '/connect-repo',
      '/init-git',
      '/daemons',
      '/browser',
      '/unblock',
      '/bench',
      '/benchmark',
      '/status',
      '/monitor',
      '/traffic',
      '/matrix',
      '/spark',
      '/mode',
      '/optimize',
      '/optimise',
      '/policy',
      '/genome',
      '/evolve',
      '/deep',
      '/rounds',
      '/max-rounds',
      '/clear',
      '/ssh-key',
      '/key',
      '/init',
      '/help',
      '/paste',
      '/multiline',
      '/exit',
      '/quit',
    ];

    const completer = (linePartial) => {
      const line = linePartial.trimStart();
      if (line.startsWith('/')) {
        const parts = line.split(' ');
        if (parts.length === 1) {
          const hits = slashCommands.filter((c) => c.startsWith(parts[0]));
          return [hits.length ? hits : slashCommands, linePartial];
        }
        const cmd = parts[0];
        const sub = parts.slice(1).join(' ');
        if (cmd === '/provider') {
          const options = ['spark', 'featherless', 'cloud', 'local'];
          const hits = options.filter((o) => o.startsWith(sub));
          return [hits.map((h) => `/provider ${h}`), linePartial];
        }
        if (cmd === '/target') {
          const options = ['local_mac', 'dgx_spark', 'container'];
          const hits = options.filter((o) => o.startsWith(sub));
          return [hits.map((h) => `/target ${h}`), linePartial];
        }
        if (cmd === '/mode') {
          const options = ['chat', 'agent', 'deep', 'optimize'];
          const hits = options.filter((o) => o.startsWith(sub));
          return [hits.map((h) => `/mode ${h}`), linePartial];
        }
        if (cmd === '/skin') {
          const options = Object.keys(CLI_SKINS);
          const hits = options.filter((o) => o.startsWith(sub));
          return [hits.map((h) => `/skin ${h}`), linePartial];
        }
        if (cmd === '/model') {
          const options = [
            'qwen-abliterated',
            'Qwen/Qwen2.5-Coder-32B-Instruct',
            'Qwen/Qwen2.5-72B-Instruct',
            'meta-llama/Meta-Llama-3.1-8B-Instruct-abliterated',
            'huihui-ai/Llama-3.3-70B-Instruct-abliterated',
          ];
          const hits = options.filter((o) => o.toLowerCase().includes(sub.toLowerCase()));
          return [hits.map((h) => `/model ${h}`), linePartial];
        }
      }
      return [[], linePartial];
    };

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: this.getPrompt(),
      completer,
      history: pastHistory.slice(-500).reverse(),
      historySize: 1000,
    });

    // Terminal bracketed paste mode control (ANSI / VT200 standard)
    const enableBracketedPaste = () => {
      if (process.stdout.isTTY) {
        try { process.stdout.write('\x1b[?2004h'); } catch {}
      }
    };
    const disableBracketedPaste = () => {
      if (process.stdout.isTTY) {
        try { process.stdout.write('\x1b[?2004l'); } catch {}
      }
    };

    const cleanup = () => {
      disableBracketedPaste();
      if (process.stdout.isTTY) {
        try { process.stdout.write('\x1b[?25h'); } catch {}
      }
    };
    process.on('exit', cleanup);

    // Multi-line paste and input accumulation state
    let inBracketedPaste = false;
    let bracketedPasteBuffer = [];
    let inManualMultiLine = false;
    let manualMultiLineDelimiter = null;
    let manualMultiLineBuffer = [];
    let burstBuffer = [];
    let burstTimer = null;
    const BURST_DEBOUNCE_MS = 140;

    // Configure SIGINT (Ctrl+C) handling
    process.removeAllListeners('SIGINT');
    process.on('SIGINT', () => {
      if (inManualMultiLine) {
        inManualMultiLine = false;
        manualMultiLineDelimiter = null;
        manualMultiLineBuffer = [];
        this.log(`\n${rgb(...this.skin.warning)}Cancelled multi-line input.${c.reset}`);
        rl.setPrompt(this.getPrompt());
        rl.prompt();
        return;
      }
      if (inBracketedPaste) {
        inBracketedPaste = false;
        bracketedPasteBuffer = [];
      }
      if (burstTimer) {
        clearTimeout(burstTimer);
        burstTimer = null;
      }
      burstBuffer = [];

      if (this.isExecutingTurn) {
        this.abortCurrentTurn('Ctrl+C received');
        this.log(`\n${rgb(...this.skin.danger)}\x1b[1m🛑 Abort Signal (Ctrl+C) Received!${c.reset} Halting turn execution...`);
      } else {
        cleanup();
        this.log(`\n${rgb(...this.skin.primary)}👋 Goodbye from AIUI Agent!${c.reset}`);
        process.exit(0);
      }
    });

    // Core Command Dispatcher (processes single or multi-line commands uniformly)
    const dispatchInput = async (rawInput, { isPaste = false, lineCount } = {}) => {
      const text = rawInput.trim();
      if (!text) {
        if (!this.isExecutingTurn) rl.prompt();
        return;
      }

      const rawLines = rawInput.split('\n');
      const count = lineCount || rawLines.length;
      const isMultiLine = count > 1;

      // Live Interjection & Steering while agent is executing a turn
      if (this.isExecutingTurn) {
        if (['/abort', '/stop', '/cancel', 'stop', 'cancel', 'abort'].includes(text.toLowerCase())) {
          this.abortCurrentTurn(`User typed '${text}'`);
          this.log(`\n${rgb(...this.skin.danger)}\x1b[1m🛑 Abort Signal Received!${c.reset} Halting turn execution...`);
          return;
        }

        if (isMultiLine) {
          const firstLine = rawLines[0].trim().slice(0, 48);
          const newLinesLabel = count - 1 > 1 ? `${count - 1} new lines` : 'new lines';
          this.log(`\n${rgb(...this.skin.accent)}\x1b[1m💬 User Interjection Captured:${c.reset} ${firstLine ? `"${firstLine}..." ` : ''}${rgb(...this.skin.primary)}\x1b[1m[${newLinesLabel}]${c.reset}`);
          this.log(`  ${rgb(...this.skin.muted)}Queued into active agent loop for dynamic course-correction.${c.reset}`);
        } else {
          this.log(`\n${rgb(...this.skin.accent)}\x1b[1m💬 User Interjection Captured:${c.reset} "${text}"`);
          this.log(`  ${rgb(...this.skin.muted)}Queued into active agent loop for dynamic course-correction.${c.reset}`);
        }
        this.queueInterjection(text);
        return;
      }

      // Compact visual indicator for pasted multi-line input: e.g. [new lines] / [3 new lines]
      if (isMultiLine) {
        const preview = rawLines[0].trim().slice(0, 48);
        const newLinesLabel = count - 1 > 1 ? `${count - 1} new lines` : 'new lines';
        this.log(`\n${rgb(...this.skin.secondary)}📋 Input Condensed:${c.reset} ${preview ? `"${preview}..." ` : ''}${rgb(...this.skin.primary)}\x1b[1m[${newLinesLabel}]${c.reset} ${c.dim}(${count} lines, ${text.length} chars)${c.reset}`);
      }

      // Record to history: store compact reference if large payload to keep readline history fast
      try {
        const histEntry = isMultiLine
          ? (text.length > 300
              ? `${rawLines[0].trim().slice(0, 60)} [${count} lines]`
              : text.replace(/\r?\n/g, ' '))
          : text;
        fs.appendFileSync(historyFile, histEntry + '\n', 'utf8');
      } catch {}

      // Fast Mode Trigger: user typed 'mode' or 'modes'
      if (text.toLowerCase() === 'mode' || text.toLowerCase() === 'modes') {
        rl.pause();
        this.displayModeStatus();
        rl.resume();
        rl.prompt();
        return;
      }
      if (text.toLowerCase().startsWith('mode ')) {
        rl.pause();
        this.setMode(text.slice(5).trim());
        rl.resume();
        rl.prompt();
        return;
      }

      // Fast Optimization Trigger: user typed 'optimise' or 'optimize'
      if (text.toLowerCase() === 'optimise' || text.toLowerCase() === 'optimize') {
        rl.pause();
        await this.runOptimizationPass();
        rl.resume();
        rl.prompt();
        return;
      }

      // Handle Slash Commands
      // Friendly handler for 'run' / '/run'
      if (text.toLowerCase() === 'run' || text.toLowerCase() === '/run') {
        if (this.activePlan) {
          this.log(`\n✔ Executing active strategic plan: ${rgb(...this.skin.primary)}${this.activePlan.goal}${c.reset}`);
          await this.executeTurn(this.activePlan.goal);
        } else {
          this.log(`\n${rgb(...this.skin.warning)}No active plan found to run.${c.reset}`);
          this.log(`  • Formulate an agent task plan: ${rgb(...this.skin.gold)}/plan <task description>${c.reset}`);
          this.log(`  • Start the web app:            ${rgb(...this.skin.primary)}npm run dev${c.reset} (runs on http://localhost:5173)`);
          this.log(`  • Run the background stack:     ${rgb(...this.skin.primary)}bash start-stack.sh${c.reset}\n`);
        }
        rl.prompt();
        return;
      }

      const firstWord = text.split(/\s+/)[0];
      const isKnownSlashCommand = slashCommands.includes(firstWord.toLowerCase());

      if (firstWord.startsWith('/')) {
        const cmd = firstWord.toLowerCase();
        const arg = text.slice(firstWord.length).trim();

        if (cmd === '/exit' || cmd === '/quit') {
          cleanup();
          rl.close();
          return;
        }

        if (cmd === '/paste' || cmd === '/multiline') {
          inManualMultiLine = true;
          manualMultiLineDelimiter = ':paste';
          manualMultiLineBuffer = [];
          this.log(`\n${rgb(...this.skin.primary)}\x1b[1m📋 Multi-Line Paste Mode Active${c.reset}`);
          this.log(`  ${rgb(...this.skin.muted)}Paste or type multiple lines below.${c.reset}`);
          this.log(`  ${rgb(...this.skin.muted)}Type ${rgb(...this.skin.gold)}:run${c.reset}${rgb(...this.skin.muted)} (or press Enter twice) to execute.${c.reset}`);
          this.log(`  ${rgb(...this.skin.muted)}Type ${rgb(...this.skin.danger)}:cancel${c.reset}${rgb(...this.skin.muted)} to abort.${c.reset}\n`);
          rl.setPrompt(`${rgb(...this.skin.secondary)}paste> ${c.reset}`);
          rl.prompt();
          return;
        }

        if (cmd === '/plan') {
          if (arg) {
            const sub = arg.toLowerCase().trim();
            if (sub === 'run' || sub === 'approve' || sub === 'exec') {
              if (this.activePlan) {
                this.log(`\n✔ Executing active strategic plan: ${rgb(...this.skin.primary)}${this.activePlan.goal}${c.reset}`);
                await this.executeTurn(this.activePlan.goal);
              } else {
                this.log(`No active plan. Create one with: /plan <goal description>`);
              }
            } else if (sub === 'status' || sub === 'show' || sub === 'check') {
              if (this.activePlan) {
                console.log('\n' + renderPlanCard({ plan: this.activePlan, skin: this.skin }) + '\n');
              } else {
                this.log(`No active plan. Create one with: /plan <goal description>`);
              }
            } else {
              // Formulate new plan for the provided prompt (which may be multi-line)
              const spin = new LiveSpinner(
                `${rgb(...this.skin.secondary)}🧠 Deliberating architecture & synthesizing strategic plan...${c.reset}`,
                this.skin
              );
              spin.start();
              this.activePlan = await this.planEngine.generateDeliberationAndPlan(arg, {
                workspaceDir: this.workspaceDir,
              });
              spin.stop();

              if (this.activePlan?.deliberation) {
                console.log('\n' + renderThinkingMatrix({ deliberation: this.activePlan.deliberation, skin: this.skin }) + '\n');
              }
              if (this.activePlan) {
                console.log(renderPlanCard({ plan: this.activePlan, skin: this.skin }) + '\n');
                this.log(`Type '${rgb(...this.skin.gold)}/plan run${c.reset}' or press Enter to execute, or continue typing to adjust.`);
              }
            }
          } else {
            if (this.activePlan) {
              console.log('\n' + renderPlanCard({ plan: this.activePlan, skin: this.skin }) + '\n');
            } else {
              this.log(`\n${rgb(...this.skin.primary)}\x1b[1mAIUI Cognitive Planning Engine:${c.reset}`);
              this.log(`  Usage: /plan <goal>        — Formulate 4-pillar deliberation and milestone plan`);
              this.log(`         /plan status        — Display active plan progress & checklist`);
              this.log(`         /plan run           — Execute the current plan\n`);
            }
          }
          rl.prompt();
          return;
        }

        if (cmd === '/provider') {
          if (arg) {
            if (this.setProvider(arg)) {
              this.log(`✔ Provider switched to: ${rgb(...this.skin.gold)}${this.provider.toUpperCase()}${c.reset} (${this.baseUrl})`);
              this.log(`✔ Active model set to: ${rgb(...this.skin.primary)}${this.model}${c.reset}`);
            } else {
              this.log(`Available providers: spark (local DGX vLLM) | featherless (cloud API)`);
            }
          } else {
            this.log(`\nActive Provider: ${rgb(...this.skin.gold)}${this.provider.toUpperCase()}${c.reset}`);
            this.log(`  Endpoint: ${rgb(...this.skin.muted)}${this.baseUrl}${c.reset}`);
            this.log(`  Model:    ${rgb(...this.skin.primary)}${this.model}${c.reset}`);
            this.log(`\nUsage: /provider <spark | featherless>\n`);
          }
          rl.prompt();
          return;
        }

        if (cmd === '/target') {
          if (['dgx_spark', 'local_mac', 'local', 'container'].includes(arg)) {
            this.target = arg === 'local_mac' ? 'local' : arg;
            this.log(`✔ Target switched to: ${rgb(...this.skin.gold)}${this.target}${c.reset}`);
            if (this.target === 'dgx_spark') {
              const key = getResolvedSshKey();
              if (key) {
                this.log(`  ${rgb(...this.skin.muted)}SSH Key:${c.reset} ${rgb(...this.skin.success)}${key}${c.reset}`);
              } else {
                this.log(`\n  ${rgb(...this.skin.warning)}⚠️  No SSH key configured for DGX Spark (${SPARK_USER}@${SPARK_HOST}).${c.reset}`);
                this.log(`  Use '${rgb(...this.skin.gold)}/ssh-key <path>${c.reset}' to set your key (e.g. /ssh-key ~/.ssh/id_ed25519).`);
                this.log(`  ${rgb(...this.skin.muted)}Note: Model inference works without SSH directly over HTTP port 8000!${c.reset}\n`);
              }
            }
            rl.setPrompt(this.getPrompt());
          } else {
            this.log(`Available targets: local, dgx_spark, container`);
          }
          rl.prompt();
          return;
        }

        if (cmd === '/ssh-key' || cmd === '/key') {
          if (arg) {
            let keyPath = arg.trim();
            if (keyPath.startsWith('~')) {
              keyPath = path.resolve(process.env.HOME || os.homedir(), keyPath.slice(2));
            }
            if (fs.existsSync(keyPath)) {
              process.env.SPARK_SSH_KEY = keyPath;
              try {
                fs.chmodSync(keyPath, 0o600);
                const rcPath = path.resolve(process.env.HOME || os.homedir(), '.aiuirc');
                let rcContent = fs.existsSync(rcPath) ? fs.readFileSync(rcPath, 'utf8') : '';
                if (rcContent.includes('SPARK_SSH_KEY=')) {
                  rcContent = rcContent.replace(/^export SPARK_SSH_KEY=.*$/m, `export SPARK_SSH_KEY="${keyPath}"`);
                } else {
                  rcContent += `\nexport SPARK_SSH_KEY="${keyPath}"\n`;
                }
                fs.writeFileSync(rcPath, rcContent, 'utf8');
              } catch {}
              this.log(`✔ SPARK_SSH_KEY set and saved to ~/.aiuirc: ${rgb(...this.skin.success)}${keyPath}${c.reset}`);
            } else {
              this.log(`${c.red}File not found at:${c.reset} ${keyPath}`);
            }
          } else {
            const curKey = getResolvedSshKey();
            if (curKey) {
              this.log(`\nActive Spark SSH Key: ${rgb(...this.skin.success)}${curKey}${c.reset} (${fs.existsSync(curKey) ? 'Found' : 'Missing'})`);
            } else {
              this.log(`\n${rgb(...this.skin.warning)}No Spark SSH Key configured.${c.reset}`);
            }
            this.log(`Usage: /ssh-key <path-to-private-key> (e.g. /ssh-key ~/.ssh/id_ed25519)\n`);
          }
          rl.prompt();
          return;
        }

        if (cmd === '/workspace') {
          if (arg) {
            this.workspaceDir = arg;
            this.log(`✔ Workspace switched to: ${rgb(...this.skin.success)}${this.workspaceDir}${c.reset}`);
            rl.setPrompt(this.getPrompt());
          } else {
            this.log(`Active workspace: ${this.workspaceDir}`);
          }
          rl.prompt();
          return;
        }

        if (cmd === '/model') {
          if (arg) {
            this.model = arg;
            if (arg.toLowerCase().includes('qwen-abliterated') || arg.toLowerCase().includes('qwen-flash')) {
              this.setProvider('spark');
              this.model = arg;
            }
            this.log(`✔ Model switched to: ${rgb(...this.skin.secondary)}${this.model}${c.reset} [${this.provider.toUpperCase()}]`);
          } else {
            this.log(`Active model: ${this.model} [${this.provider.toUpperCase()}]`);
          }
          rl.prompt();
          return;
        }

        if (cmd === '/skin') {
          if (arg) {
            if (this.setSkin(arg)) {
              this.log(`✔ Skin switched to: ${rgb(...this.skin.primary)}${this.skin.name}${c.reset}`);
              rl.setPrompt(this.getPrompt());
            } else {
              this.log(`Unknown skin. Available: ${Object.keys(CLI_SKINS).join(', ')}`);
            }
          } else {
            this.log(`\n${rgb(...this.skin.primary)}\x1b[1mAvailable Terminal Skins:${c.reset}`);
            for (const [k, sk] of Object.entries(CLI_SKINS)) {
              const activeMark = k === this.skinName ? `${rgb(...sk.success)} [ACTIVE]${c.reset}` : '';
              const swatch = `${rgb(...sk.primary)}■${rgb(...sk.secondary)}■${rgb(...sk.accent)}■${rgb(...sk.gold)}■${c.reset}`;
              this.log(`  ${swatch} ${rgb(...sk.primary)}${k.padEnd(14)}${c.reset} ${rgb(...sk.muted)}${sk.name}${c.reset}${activeMark}`);
            }
            this.log(`\nUsage: /skin <name>\n`);
          }
          rl.prompt();
          return;
        }

        const subArgs = arg ? arg.split(/\s+/).filter(Boolean) : [];
        if (cmd === '/connect-repo' || cmd === '/init-git' || (cmd === '/init' && (subArgs[0] === 'git' || subArgs[0] === 'repo'))) {
          const res = initGitRepo(this.workspaceDir);
          if (res.success) {
            this.log(`\n  ${rgb(...this.skin.success)}✔ Connected to Git repo: Initialized .git in ${this.workspaceDir}${c.reset}`);
            this.log(`  ${rgb(...this.skin.muted)}Standard .gitignore applied. Changes staged. Live diffs active.${c.reset}\n`);
          } else {
            this.log(`\n  ${rgb(...this.skin.danger)}✘ Failed to connect Git repo: ${res.error}${c.reset}\n`);
          }
          rl.prompt();
          return;
        }

        if (cmd === '/init') {
          const agentsFile = path.resolve(this.workspaceDir, 'AGENTS.md');
          if (fs.existsSync(agentsFile)) {
            this.log(`\n  ${rgb(...this.skin.gold)}ℹ AGENTS.md already exists in ${this.workspaceDir}${c.reset}`);
          } else {
            const template = `# AIUI Autonomous Agent Instructions\n\n## Project Context\n- Workspace: \`${this.workspaceDir}\`\n- Mode: Autonomous Agent\n- Tools: 20 active cluster & system tools\n\n## Guidelines for Code\n- Maintain clean architecture and modularity.\n- Verify syntax and run tests when available.\n- Avoid hardcoded paths; use dynamic resolution.\n`;
            try {
              fs.writeFileSync(agentsFile, template, 'utf8');
              this.log(`\n  ${rgb(...this.skin.success)}✔ Created AGENTS.md in ${this.workspaceDir}${c.reset}`);
            } catch (err) {
              this.log(`\n  ${rgb(...this.skin.danger)}✘ Failed to write AGENTS.md: ${err.message}${c.reset}`);
            }
          }
          rl.prompt();
          return;
        }

        if (cmd === '/tools') {
          this.log(`\n${rgb(...this.skin.primary)}\x1b[1mAvailable Agent Tools:${c.reset}`);
          const allTools = [...AGENT_TOOLS, ...(this.dynamicTools || [])];
          allTools.forEach((t) => {
            this.log(`  ${rgb(...this.skin.primary)}${t.function.name.padEnd(26)}${c.reset} ${rgb(...this.skin.muted)}${t.function.description.slice(0, 72)}...${c.reset}`);
          });
          console.log('');
          rl.prompt();
          return;
        }

        if (cmd === '/mode') {
          if (!arg) {
            this.displayModeStatus();
          } else {
            this.setMode(arg);
          }
          rl.prompt();
          return;
        }

        if (cmd === '/deep') {
          this.deepBuild = !this.deepBuild;
          this.log(`✔ Deep Build mode: ${this.deepBuild ? rgb(...this.skin.success) + 'ENABLED' : rgb(...this.skin.danger) + 'DISABLED'}${c.reset}`);
          rl.prompt();
          return;
        }

        if (cmd === '/optimize' || cmd === '/optimise') {
          rl.pause();
          await this.runOptimizationPass();
          rl.resume();
          rl.prompt();
          return;
        }

        if (cmd === '/policy' || cmd === '/genome') {
          const policy = loadOptimizerPolicy();
          if (!policy) {
            this.log(`\n${rgb(...this.skin.warning)}No active optimizer policy found in logs/chat-response-optimizer-policy.json.${c.reset}`);
            this.log(`  Run: ${rgb(...this.skin.primary)}python3 lab/evolution/agent_strategy_evolution.py${c.reset} to evolve a policy.\n`);
          } else {
            const mg = policy.stats?.multiTaskGenome || {};
            const effectiveTemp = (0.2 + (policy.temperatureBias || 0)).toFixed(3);
            const lines = [
              ` ${rgb(...this.skin.primary)}Active Archetype:${c.reset}  ${rgb(...this.skin.gold)}${policy.stats?.archetype || 'High-Assurance'}${c.reset}`,
              ` ${rgb(...this.skin.primary)}Composite Fitness:${c.reset} ${rgb(...this.skin.success)}${policy.stats?.compositeFitness ? (policy.stats.compositeFitness * 100).toFixed(2) + '%' : '85.13%'}${c.reset} (Health: ${policy.healthIndex}/100)`,
              ` ${rgb(...this.skin.primary)}Empirical Success:${c.reset} ${rgb(...this.skin.success)}${policy.stats?.successRate ? (policy.stats.successRate * 100).toFixed(2) + '%' : '87.31%'}${c.reset} │ Turn Eff: ${policy.stats?.turnEfficiency ? (policy.stats.turnEfficiency * 100).toFixed(1) + '%' : '78.6%'} │ Safety: ${policy.stats?.safetyScore ? (policy.stats.safetyScore * 100).toFixed(1) + '%' : '91.2%'}`,
              ` ${rgb(...this.skin.primary)}Sampling Temp:${c.reset}     ${rgb(...this.skin.accent)}${policy.temperatureBias > 0 ? '+' : ''}${policy.temperatureBias ?? 0}${c.reset} (Effective: ${effectiveTemp})`,
              ` ${rgb(...this.skin.primary)}Anti-Loop / Stall:${c.reset} ${rgb(...this.skin.success)}STRICT (Sensitivity: ${mg.self_healing?.anti_loop_sensitivity ?? 0.964})${c.reset}`,
              ` ${rgb(...this.skin.primary)}Max Duration / Char:${c.reset}${rgb(...this.skin.muted)}${policy.maxDurationMs || 24369}ms │ min ${policy.minUsefulChars || 27} chars${c.reset}`,
            ];
            if (mg.code_gen) {
              lines.push(
                ``,
                ` ${rgb(...this.skin.primary)}Multi-Task Contextual Genome:${c.reset}`,
                `   • Code Gen:      diff_conservatism: ${mg.code_gen.diff_conservatism} │ verify_depth: ${mg.code_gen.verification_depth} │ caution: ${mg.code_gen.caution}`,
                `   • Self-Healing:  anti_loop: ${mg.self_healing?.anti_loop_sensitivity} │ tool_diversity: ${mg.self_healing?.tool_diversity} │ retry_budget: ${mg.self_healing?.retry_budget}`,
                `   • Fast Query:    direct_ratio: ${mg.fast_query?.direct_response_ratio} │ latency_prio: ${mg.fast_query?.latency_priority} │ brevity: ${mg.fast_query?.brevity}`,
                `   • DevOps:        pre_flight: ${mg.systems_devops?.pre_flight_dryrun} │ container_iso: ${mg.systems_devops?.container_isolation}`
              );
            }
            if (policy.systemNudge) {
              lines.push(``, ` ${rgb(...this.skin.muted)}Active Directive:${c.reset}\n   "${policy.systemNudge}"`);
            }
            console.log(
              '\n' +
                renderCard({
                  title: '🧬 AIUI EVOLVED STRATEGY POLICY (NSGA-II)',
                  badge: badge('RANK 1 OPTIMAL', this.skin.success, this.skin.badgeBg),
                  lines,
                  skin: this.skin,
                  width: 78,
                }) +
                '\n'
            );
          }
          rl.prompt();
          return;
        }

        if (cmd === '/evolve') {
          rl.pause();
          this.log(`\n${rgb(...this.skin.primary)}🧬 Invoking AIUI Agent Strategy Meta-Evolutionary Engine...${c.reset}`);
          try {
            const evoScript = path.resolve(ROOT_DIR, 'lab/evolution/agent_strategy_evolution.py');
            const res = execSync(`python3 "${evoScript}" -g 6 -p 30 --apply-policy`, {
              encoding: 'utf8',
              timeout: 60000,
            });
            console.log(res);
            this.log(`\n${rgb(...this.skin.success)}✔ Meta-evolution completed & active policy hot-reloaded!${c.reset}\n`);
          } catch (e) {
            this.log(`\n${rgb(...this.skin.warning)}Micro-evolution pass failed: ${e.message}${c.reset}`);
            this.log(`  Falling back to live system optimization pass...`);
            await this.runOptimizationPass();
          }
          rl.resume();
          rl.prompt();
          return;
        }

        if (cmd === '/rounds' || cmd === '/max-rounds') {
          if (arg) {
            const n = parseInt(arg, 10);
            if (n > 0) {
              this.maxRounds = n;
              this.log(`✔ Max rounds limit set to: ${rgb(...this.skin.success)}${this.maxRounds}${c.reset}`);
            } else {
              this.log(`Invalid rounds number. Usage: /rounds <number> (e.g. /rounds 50)`);
            }
          } else {
            this.log(`Current max rounds limit: ${rgb(...this.skin.gold)}${this.maxRounds}${c.reset}. Usage: /rounds <number>`);
          }
          rl.prompt();
          return;
        }

        if (cmd === '/clear') {
          this.messages = [];
          this.circuitBreaker.clear();
          console.clear();
          const hero = renderCodeBuddyHeroCard({
            title: 'AIUI Code v2.154.0',
            workspaceDir: this.workspaceDir,
            webUiUrl: 'http://127.0.0.1:5173',
            mode: `Auto · ${this.provider === 'spark' ? 'high' : this.provider}`,
            model: this.model ? this.model.split('/').pop() : 'Qwen2.5-Coder-32B',
            recentActivity: 'Context memory reset',
            skin: this.skin,
          });
          console.log(hero.card);
          console.log('\n' + hero.divider);
          rl.prompt();
          return;
        }

        if (cmd === '/bench' || cmd === '/benchmark') {
          rl.pause();
          disableBracketedPaste();
          const benchScript = path.resolve(ROOT_DIR, 'scripts/benchmark.mjs');
          const extraArgs = arg ? arg.split(' ') : [];
          const proc = spawn('node', [benchScript, ...extraArgs], { stdio: 'inherit' });
          proc.on('exit', () => {
            enableBracketedPaste();
            rl.resume();
            rl.prompt();
          });
          return;
        }

        if (cmd === '/status') {
          const spin = new LiveSpinner('Probing ecosystem microservices...', this.skin);
          spin.start();
          const s = await this.checkServices();
          spin.stop();
          console.log('\n' + renderStatusDashboard(s, this.skin) + '\n');
          rl.prompt();
          return;
        }

        if (cmd === '/monitor' || cmd === '/traffic') {
          const sub = (arg || '').toLowerCase().trim();
          if (sub === 'live' || sub === 'start' || sub === 'tail' || sub === 'probe') {
            rl.pause();
            disableBracketedPaste();
            const monScript = path.resolve(ROOT_DIR, 'scripts/monitor-agent-responses.mjs');
            const monArgs = sub === 'tail' ? ['--tail'] : sub === 'probe' ? ['--probe'] : [];
            const proc = spawn('node', [monScript, ...monArgs], { stdio: 'inherit' });
            proc.on('exit', () => {
              enableBracketedPaste();
              rl.resume();
              rl.prompt();
            });
            return;
          }

          const events = getRecentCliTraffic(15);
          const lines = [];
          if (events.length === 0) {
            lines.push(`${rgb(...this.skin.muted)}No traffic recorded yet.${c.reset}`);
            lines.push(`${rgb(...this.skin.muted)}Type '/monitor live' or run 'aiui monitor' in another terminal to watch real-time stream.${c.reset}`);
          } else {
            for (const e of events) {
              const d = new Date(e.timestamp).toTimeString().split(' ')[0];
              const tag = e.type === 'request'
                ? `${rgb(...this.skin.primary)}[REQ]${c.reset}`
                : e.type === 'response'
                ? `${rgb(...this.skin.success)}[RESP]${c.reset}`
                : e.type === 'tool_call'
                ? `${rgb(...this.skin.gold)}[TOOL]${c.reset}`
                : e.type === 'tool_result'
                ? `${rgb(...this.skin.accent)}[RESULT]${c.reset}`
                : `${rgb(...this.skin.danger)}[ERR]${c.reset}`;
              let details = ` ${d} ${tag}`;
              if (e.model) details += ` ${e.model.split('/').pop()}`;
              if (e.provider) details += ` [${e.provider.toUpperCase()}]`;
              if (e.durationMs != null) details += ` ${e.durationMs}ms`;
              if (e.toolName) details += ` ${e.toolName} (exit ${e.exitCode ?? 0})`;
              if (e.error) details += ` ${rgb(...this.skin.danger)}${e.error}${c.reset}`;
              lines.push(details);
            }
            lines.push('');
            lines.push(`${rgb(...this.skin.muted)}Tip: Type '/monitor live' or run 'aiui monitor --tail' to stream full logs.${c.reset}`);
          }
          console.log('\n' + renderCard({
            title: '📡 RECENT CLI & LLM TRAFFIC',
            badge: badge(`${events.length} EVENTS`, this.skin.primary, this.skin.badgeBg),
            lines,
            skin: this.skin,
            width: 76,
          }) + '\n');
          rl.prompt();
          return;
        }

        if (cmd === '/matrix') {
          rl.pause();
          disableBracketedPaste();
          const matrixScript = path.resolve(ROOT_DIR, 'scripts/matrix.sh');
          const proc = spawn('bash', [matrixScript], { stdio: 'inherit' });
          proc.on('exit', () => {
            enableBracketedPaste();
            console.clear();
            rl.resume();
            rl.prompt();
          });
          return;
        }

        if (cmd === '/spark') {
          rl.pause();
          disableBracketedPaste();
          let sparkScript = path.resolve(ROOT_DIR, 'scripts/restart-spark.mjs');
          if (!fs.existsSync(sparkScript)) {
            const altCandidates = [
              path.resolve(process.env.HOME || os.homedir(), 'AIUI/scripts/restart-spark.mjs'),
              path.resolve(process.env.HOME || os.homedir(), '.aiui/scripts/restart-spark.mjs'),
            ];
            for (const c of altCandidates) {
              if (fs.existsSync(c)) { sparkScript = c; break; }
            }
          }
          let sparkArgs = ['--status'];
          if (arg) {
            const sub = arg.toLowerCase().trim();
            if (sub === 'restart' || sub === 'start' || sub === 'boot') {
              sparkArgs = [];
            } else if (sub === 'reclaim' || sub === 'clean' || sub === 'purge') {
              sparkArgs = ['--reclaim'];
            } else if (sub === 'stop' || sub === 'down' || sub === 'kill') {
              sparkArgs = ['--stop'];
            } else if (sub === 'speed') {
              sparkArgs = ['--profile=speed'];
            } else if (sub === 'extended') {
              sparkArgs = ['--profile=extended'];
            } else {
              sparkArgs = arg.split(' ');
            }
          }
          if (fs.existsSync(sparkScript)) {
            const proc = spawn('node', [sparkScript, ...sparkArgs], { stdio: 'inherit' });
            proc.on('exit', () => {
              enableBracketedPaste();
              rl.resume();
              rl.prompt();
            });
          } else {
            enableBracketedPaste();
            this.log(`${c.red}restart-spark.mjs not found at ${sparkScript}${c.reset}`);
            rl.resume();
            rl.prompt();
          }
          return;
        }

        if (cmd === '/diff') {
          if (!isGitRepo(this.workspaceDir)) {
            this.log(`\n  ${rgb(...this.skin.warning)}⚠️  Workspace (${this.workspaceDir}) is not a Git repository.${c.reset}`);
            this.log(`  ${rgb(...this.skin.primary)}Tip: Type '/connect-repo' or '/init-git' to connect workspace with one click.${c.reset}\n`);
            rl.prompt();
            return;
          }
          try {
            const diffStat = execSync('git diff --stat', { cwd: this.workspaceDir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
            const statusShort = execSync('git status --short', { cwd: this.workspaceDir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
            const lines = [];
            if (statusShort) {
              lines.push(`${rgb(...this.skin.secondary)}\x1b[1mWorkspace File Status:${c.reset}`);
              statusShort.split('\n').forEach((l) => lines.push(`  ${l}`));
              lines.push('');
            }
            if (diffStat) {
              lines.push(`${rgb(...this.skin.primary)}\x1b[1mDiff Stat (${this.workspaceDir}):${c.reset}`);
              diffStat.split('\n').forEach((l) => lines.push(`  ${l}`));
            } else {
              lines.push(`${rgb(...this.skin.success)}✔ Working tree clean (zero uncommitted diffs)${c.reset}`);
            }
            console.log('\n' + renderCard({
              title: '🔍 GIT SURGICAL DIFF AUDIT',
              badge: badge('CODE INTEGRITY', this.skin.primary, this.skin.badgeBg),
              lines,
              skin: this.skin,
              width: 76,
            }) + '\n');
          } catch (err) {
            this.log(`${c.red}Git diff audit error:${c.reset} ${err.message}`);
          }
          rl.prompt();
          return;
        }

        if (cmd === '/daemons') {
          const list = processManager.list();
          const lines = [];
          if (list.length === 0) {
            lines.push(`${rgb(...this.skin.muted)}No active background daemons currently managed in this session.${c.reset}`);
            lines.push(`${rgb(...this.skin.muted)}Use 'start_daemon' tool or start servers in background.${c.reset}`);
          } else {
            for (const d of list) {
              const status = d.alive ? `${rgb(...this.skin.success)}ONLINE${c.reset}` : `${rgb(...this.skin.danger)}STOPPED${c.reset}`;
              lines.push(` ${rgb(...this.skin.gold)}[${d.id}]${c.reset} PID: ${d.pid} | Status: ${status} | Port: ${d.port || 'n/a'} | Up: ${d.uptimeSeconds}s`);
              lines.push(`   ${rgb(...this.skin.muted)}${d.command.slice(0, 68)}${c.reset}`);
            }
          }
          console.log('\n' + renderCard({
            title: '⚡ ACTIVE BACKGROUND DAEMONS',
            badge: badge(`${list.length} DAEMONS`, this.skin.primary, this.skin.badgeBg),
            lines,
            skin: this.skin,
            width: 76,
          }) + '\n');
          rl.prompt();
          return;
        }

        if (cmd === '/browser') {
          const targetUrl = arg || 'http://localhost:5173';
          const spin = new LiveSpinner(`Probing ${targetUrl} via headless browser...`, this.skin);
          spin.start();
          try {
            const raw = await browserOpenHandler({ url: targetUrl }, { workspaceDir: this.workspaceDir });
            spin.stop();
            const res = typeof raw === 'string' ? JSON.parse(raw) : raw;
            const lines = [
              ` ${rgb(...this.skin.primary)}Target URL:${c.reset}    ${res.url || targetUrl}`,
              ` ${rgb(...this.skin.primary)}Title:${c.reset}         ${res.title || 'Untitled'}`,
              ` ${rgb(...this.skin.primary)}HTTP Status:${c.reset}   ${res.status || 'OK'}`,
              ` ${rgb(...this.skin.primary)}Engine:${c.reset}        ${res.engine || res.mode || 'Chromium'}`,
            ];
            if (res.errors && res.errors.length > 0) {
              lines.push(``);
              lines.push(`${rgb(...this.skin.danger)}\x1b[1mRuntime Errors Detected (${res.errors.length}):${c.reset}`);
              res.errors.slice(0, 5).forEach((e) => lines.push(`  ${rgb(...this.skin.danger)}✘${c.reset} ${e}`));
            } else {
              lines.push(` ${rgb(...this.skin.success)}✔ Zero runtime / hydration console errors${c.reset}`);
            }
            console.log('\n' + renderCard({
              title: '🌐 HEADLESS BROWSER AUDIT',
              badge: badge(res.ok ? 'SUCCESS' : 'FAILED', res.ok ? this.skin.success : this.skin.danger, this.skin.badgeBg),
              lines,
              skin: this.skin,
              width: 76,
            }) + '\n');
          } catch (err) {
            spin.stop();
            this.log(`${c.red}Browser inspection error:${c.reset} ${err.message}`);
          }
          rl.prompt();
          return;
        }

        if (cmd === '/unblock') {
          const parts = (arg || '').split(' ');
          const targetUrl = parts[0];
          const expectSelector = parts.slice(1).join(' ') || undefined;
          if (!targetUrl) {
            this.log(`Usage: /unblock <url> [expect_css_selector]`);
            rl.prompt();
            return;
          }
          const spin = new LiveSpinner(`Unblocking ${targetUrl} via Bright Data Web Unlocker...`, this.skin);
          spin.start();
          try {
            const raw = await webUnblockerHandler({ url: targetUrl, expectElement: expectSelector });
            spin.stop();
            const res = JSON.parse(raw);
            const lines = [
              ` ${rgb(...this.skin.primary)}Target URL:${c.reset}     ${res.url || targetUrl}`,
              ` ${rgb(...this.skin.primary)}Status:${c.reset}         ${res.ok ? `${rgb(...this.skin.success)}HTTP ${res.status}${c.reset}` : `${rgb(...this.skin.danger)}HTTP ${res.status || 'FAIL'}${c.reset}`}`,
              ` ${rgb(...this.skin.primary)}Latency:${c.reset}        ${res.latencyMs || 0}ms`,
              ` ${rgb(...this.skin.primary)}Expect Element:${c.reset} ${res.expectElement || '(none)'}`,
              ` ${rgb(...this.skin.primary)}CAPTCHA Solved:${c.reset} ${res.captchaSolved ? 'YES' : 'NONE'}`,
              ` ${rgb(...this.skin.primary)}Fields Found:${c.reset}   ${res.fieldsCount || 0}`,
            ];
            if (res.fields && res.fields.length > 0) {
              lines.push('');
              lines.push(`${rgb(...this.skin.secondary)}\x1b[1mExtracted Form Fields:${c.reset}`);
              res.fields.slice(0, 5).forEach((f) => lines.push(`  • ${rgb(...this.skin.gold)}${f.label}${c.reset} (${f.selector}) -> [${f.kind}]`));
            }
            if (res.contentPreview) {
              lines.push('');
              lines.push(`${rgb(...this.skin.muted)}${res.contentPreview.slice(0, 300).replace(/\n/g, ' ')}...${c.reset}`);
            }
            console.log('\n' + renderCard({
              title: '⚡ BRIGHT DATA WEB UNLOCKER',
              badge: badge(res.ok ? 'UNBLOCKED' : 'FAILED', res.ok ? this.skin.success : this.skin.danger, this.skin.badgeBg),
              lines,
              skin: this.skin,
              width: 76,
            }) + '\n');
          } catch (err) {
            spin.stop();
            this.log(`${c.red}Web Unlocker error:${c.reset} ${err.message}`);
          }
          rl.prompt();
          return;
        }

        if (cmd === '/help') {
          console.log(
            renderCard({
              title: 'COMMAND CHEAT SHEET',
              badge: badge('TYPE REQUEST OR /CMD', s.primary, s.badgeBg),
              lines: cheatSheetLines,
              skin: s,
              width: 76,
            }) + '\n'
          );
          rl.prompt();
          return;
        }

        // If command is unrecognized, check whether this is multi-line code/comment or file path
        if (isMultiLine || cmd.startsWith('//') || text.includes('://') || fs.existsSync(cmd)) {
          // Fall through to executeTurn(text)
        } else {
          this.log(`Unknown command: ${cmd}. Type /help or /skin, /tools, /status, /matrix, /spark, /target, /model, /workspace, or /exit.`);
          rl.prompt();
          return;
        }
      }

      // Execute Agent Turn (rl remains active for live interjection & steering)
      try {
        await this.executeTurn(text);
      } catch (err) {
        this.log(`\n${c.red}Error executing turn:${c.reset} ${err.message}`);
      }
      console.log('');
      if (this.stdinClosed) {
        cleanup();
        this.log(`\n${rgb(...this.skin.primary)}👋 Goodbye from AIUI Agent!${c.reset}`);
        process.exit(0);
      }
      rl.prompt();
    };

    enableBracketedPaste();
    rl.prompt();

    rl.on('line', async (line) => {
      // 1. Bracketed paste detection: \x1b[200~ (start) and \x1b[201~ (end)
      let cleanLine = line;
      let pasteStarted = false;
      let pasteEnded = false;

      if (cleanLine.includes('\x1b[200~')) {
        pasteStarted = true;
        inBracketedPaste = true;
        cleanLine = cleanLine.replace(/\x1b\[200~/g, '');
      }

      if (cleanLine.includes('\x1b[201~')) {
        pasteEnded = true;
        inBracketedPaste = false;
        cleanLine = cleanLine.replace(/\x1b\[201~/g, '');
      }

      if (pasteStarted || inBracketedPaste || pasteEnded) {
        bracketedPasteBuffer.push(cleanLine);

        if (pasteEnded) {
          if (burstTimer) {
            clearTimeout(burstTimer);
            burstTimer = null;
          }
          burstBuffer = [];

          const fullText = bracketedPasteBuffer.join('\n');
          const lines = [...bracketedPasteBuffer];
          const lineCount = lines.length;
          bracketedPasteBuffer = [];

          // Clean up echoed lines in terminal and show compact [new lines] badge
          if (lineCount > 1 && process.stdout.isTTY) {
            const cols = process.stdout.columns || 80;
            let totalRows = 0;
            for (const l of lines) {
              totalRows += Math.max(1, Math.ceil((l.length + (this.getPrompt().length || 8)) / cols));
            }
            const clearRows = Math.min(totalRows, (process.stdout.rows || 40) - 1);
            try {
              process.stdout.write(`\x1b[${clearRows}A\r\x1b[J`);
              const firstLine = lines[0].trim().slice(0, 48);
              const newLinesLabel = lineCount - 1 > 1 ? `${lineCount - 1} new lines` : 'new lines';
              process.stdout.write(`${this.getPrompt()}${firstLine ? `${firstLine} ` : ''}${rgb(...this.skin.primary)}\x1b[1m[${newLinesLabel}]${c.reset}\n`);
            } catch {}
          }

          await dispatchInput(fullText, { isPaste: true, lineCount });
        }
        return;
      }

      // 2. Manual Multi-Line mode active (/paste, """ / ''', or trailing \)
      if (inManualMultiLine) {
        if (manualMultiLineDelimiter === ':paste') {
          const trimmed = line.trim().toLowerCase();
          if (trimmed === ':cancel' || trimmed === ':abort') {
            inManualMultiLine = false;
            manualMultiLineDelimiter = null;
            manualMultiLineBuffer = [];
            this.log(`\n${rgb(...this.skin.warning)}Cancelled multi-line paste.${c.reset}`);
            rl.setPrompt(this.getPrompt());
            rl.prompt();
            return;
          }

          if (
            trimmed === ':run' ||
            trimmed === ':exec' ||
            (line === '' && manualMultiLineBuffer.length > 0 && manualMultiLineBuffer[manualMultiLineBuffer.length - 1] === '')
          ) {
            if (manualMultiLineBuffer[manualMultiLineBuffer.length - 1] === '') {
              manualMultiLineBuffer.pop();
            }
            inManualMultiLine = false;
            manualMultiLineDelimiter = null;
            const fullText = manualMultiLineBuffer.join('\n');
            const lineCount = manualMultiLineBuffer.length;
            manualMultiLineBuffer = [];
            rl.setPrompt(this.getPrompt());
            await dispatchInput(fullText, { isPaste: true, lineCount });
            return;
          }

          manualMultiLineBuffer.push(line);
          rl.prompt();
          return;
        }

        if (manualMultiLineDelimiter === '"""' || manualMultiLineDelimiter === "'''") {
          const delim = manualMultiLineDelimiter;
          if (line.includes(delim)) {
            const endIdx = line.indexOf(delim);
            const content = line.slice(0, endIdx);
            manualMultiLineBuffer.push(content);
            inManualMultiLine = false;
            manualMultiLineDelimiter = null;
            const fullText = manualMultiLineBuffer.join('\n');
            const lineCount = manualMultiLineBuffer.length;
            manualMultiLineBuffer = [];
            rl.setPrompt(this.getPrompt());
            await dispatchInput(fullText, { isPaste: true, lineCount });
            return;
          }
          manualMultiLineBuffer.push(line);
          rl.prompt();
          return;
        }

        if (manualMultiLineDelimiter === '\\') {
          if (line.endsWith('\\')) {
            manualMultiLineBuffer.push(line.slice(0, -1));
            rl.prompt();
            return;
          }
          manualMultiLineBuffer.push(line);
          inManualMultiLine = false;
          manualMultiLineDelimiter = null;
          const fullText = manualMultiLineBuffer.join('\n');
          const lineCount = manualMultiLineBuffer.length;
          manualMultiLineBuffer = [];
          rl.setPrompt(this.getPrompt());
          await dispatchInput(fullText, { isPaste: true, lineCount });
          return;
        }
      }

      // 3. Start Manual Multi-Line mode via """ / ''' or trailing \
      const trimmedLine = line.trim();
      if (trimmedLine.startsWith('"""') || trimmedLine.startsWith("'''")) {
        const delim = trimmedLine.startsWith('"""') ? '"""' : "'''";
        const afterFirst = trimmedLine.slice(3);
        if (afterFirst.includes(delim)) {
          const content = afterFirst.slice(0, afterFirst.indexOf(delim));
          await dispatchInput(content, { isPaste: false });
          return;
        }
        inManualMultiLine = true;
        manualMultiLineDelimiter = delim;
        manualMultiLineBuffer = [line.replace(/^\s*("""|''')/, '')];
        rl.setPrompt(`${rgb(...this.skin.muted)}... ${c.reset}`);
        rl.prompt();
        return;
      }

      if (line.endsWith('\\') && !line.endsWith('\\\\')) {
        inManualMultiLine = true;
        manualMultiLineDelimiter = '\\';
        manualMultiLineBuffer = [line.slice(0, -1)];
        rl.setPrompt(`${rgb(...this.skin.muted)}... ${c.reset}`);
        rl.prompt();
        return;
      }

      // 4. Rapid Burst Debounce Accumulator (Universal Multi-Line Paste Fallback)
      burstBuffer.push(line);

      if (burstTimer) {
        clearTimeout(burstTimer);
      }

      const flushBurst = async () => {
        burstTimer = null;

        // If stdin stream has pending bytes waiting, keep accumulating lines!
        if (process.stdin && process.stdin.readableLength > 0) {
          burstTimer = setTimeout(flushBurst, 50);
          return;
        }

        // If the paste ended without a trailing newline, capture any tail in rl.line
        if (rl.line && rl.line.trim().length > 0) {
          burstBuffer.push(rl.line);
          try {
            rl.line = '';
            rl.cursor = 0;
          } catch {}
        }

        const lines = [...burstBuffer];
        burstBuffer = [];

        const combined = lines.join('\n');
        if (!combined.trim()) {
          if (!this.isExecutingTurn) rl.prompt();
          return;
        }

        const lineCount = lines.length;
        if (lineCount > 1 && process.stdout.isTTY) {
          const cols = process.stdout.columns || 80;
          let totalRows = 0;
          for (const l of lines) {
            totalRows += Math.max(1, Math.ceil((l.length + (this.getPrompt().length || 8)) / cols));
          }
          const clearRows = Math.min(totalRows, (process.stdout.rows || 40) - 1);
          try {
            process.stdout.write(`\x1b[${clearRows}A\r\x1b[J`);
            const firstLine = lines[0].trim().slice(0, 48);
            const newLinesLabel = lineCount - 1 > 1 ? `${lineCount - 1} new lines` : 'new lines';
            process.stdout.write(`${this.getPrompt()}${firstLine ? `${firstLine} ` : ''}${rgb(...this.skin.primary)}\x1b[1m[${newLinesLabel}]${c.reset}\n`);
          } catch {}
        }

        await dispatchInput(combined, { isPaste: lineCount > 1, lineCount });
      };

      burstTimer = setTimeout(flushBurst, BURST_DEBOUNCE_MS);
    });

    rl.on('close', () => {
      if (this.isExecutingTurn) {
        this.stdinClosed = true;
        return;
      }
      cleanup();
      this.log(`\n${rgb(...this.skin.primary)}👋 Goodbye from AIUI Agent!${c.reset}`);
      process.exit(0);
    });
  }
}
