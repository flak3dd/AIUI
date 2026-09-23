import path from 'node:path';
import { rgb, c } from '../ui/skins.mjs';
import { determineStartingPoint, scanWorkspace, isMultiStepPrompt } from './workflow-optimizer.mjs';

/**
 * Represents a single concrete action step in an execution plan.
 */
export class PlanStep {
  constructor({
    id,
    phase = 'Execution',
    title,
    description = '',
    targetFiles = [],
    tool = 'auto',
    verificationGate = '',
    status = 'pending',
    evidence = '',
    error = '',
  }) {
    this.id = id;
    this.phase = phase;
    this.title = title;
    this.description = description;
    this.targetFiles = Array.isArray(targetFiles) ? targetFiles : (targetFiles ? [targetFiles] : []);
    this.tool = tool;
    this.verificationGate = verificationGate;
    this.status = status; // 'pending' | 'active' | 'completed' | 'failed' | 'skipped'
    this.evidence = evidence;
    this.error = error;
  }
}

/**
 * Structured Execution Plan managing milestones, progress tracking, and verification gates.
 */
export class ExecutionPlan {
  constructor({
    goal,
    title = 'Execution Plan',
    phases = [],
    steps = [],
    risks = [],
    verificationCriteria = [],
    deliberation = null,
  }) {
    this.goal = goal;
    this.title = title;
    this.phases = phases;
    this.steps = steps.map((s, idx) => (s instanceof PlanStep ? s : new PlanStep({ id: idx + 1, ...s })));
    this.risks = risks;
    this.verificationCriteria = verificationCriteria;
    this.deliberation = deliberation;
    this.createdAt = Date.now();
    this.activeStepIndex = this.steps.findIndex((s) => s.status === 'active' || s.status === 'pending');
    if (this.activeStepIndex >= 0 && this.steps[this.activeStepIndex].status === 'pending') {
      this.steps[this.activeStepIndex].status = 'active';
    }
  }

  getActiveStep() {
    if (this.activeStepIndex >= 0 && this.activeStepIndex < this.steps.length) {
      return this.steps[this.activeStepIndex];
    }
    return null;
  }

  markStepActive(idx) {
    if (idx >= 0 && idx < this.steps.length) {
      this.steps.forEach((s, i) => {
        if (s.status === 'active' && i !== idx) s.status = 'pending';
      });
      this.steps[idx].status = 'active';
      this.activeStepIndex = idx;
    }
  }

  markStepComplete(idx, evidence = '') {
    if (idx >= 0 && idx < this.steps.length) {
      this.steps[idx].status = 'completed';
      if (evidence) this.steps[idx].evidence = evidence;

      // Find next pending step and mark it active
      const nextIdx = this.steps.findIndex((s, i) => i > idx && s.status === 'pending');
      if (nextIdx >= 0) {
        this.steps[nextIdx].status = 'active';
        this.activeStepIndex = nextIdx;
      } else {
        this.activeStepIndex = -1; // All steps done
      }
    }
  }

  markStepFailed(idx, error = '') {
    if (idx >= 0 && idx < this.steps.length) {
      this.steps[idx].status = 'failed';
      if (error) this.steps[idx].error = error;
    }
  }

  isComplete() {
    return this.steps.length > 0 && this.steps.every((s) => s.status === 'completed' || s.status === 'skipped');
  }

  getCompletedCount() {
    return this.steps.filter((s) => s.status === 'completed').length;
  }

  getPendingCount() {
    return this.steps.filter((s) => s.status === 'pending' || s.status === 'active').length;
  }

  getProgressRatio() {
    if (this.steps.length === 0) return 1.0;
    return this.getCompletedCount() / this.steps.length;
  }

  /**
   * Format structured status for injection into Layer 3 Cognitive Working Memory
   */
  formatForCognitiveRegister() {
    const lines = [
      '=== STRATEGIC EXECUTION PLAN & MILESTONE TRACKER ===',
      `Goal: "${this.goal}"`,
      `Progress: ${this.getCompletedCount()}/${this.steps.length} steps completed (${Math.round(this.getProgressRatio() * 100)}%)`,
    ];

    lines.push('\nMilestone Status Checklist:');
    this.steps.forEach((step, idx) => {
      let icon = '[○ PENDING]';
      if (step.status === 'completed') icon = '[✔ DONE]   ';
      else if (step.status === 'active') icon = '[▶ ACTIVE] ';
      else if (step.status === 'failed') icon = '[✘ FAILED] ';
      else if (step.status === 'skipped') icon = '[⊘ SKIP]   ';

      const targetStr = step.targetFiles.length ? ` (target: ${step.targetFiles.join(', ')})` : '';
      const gateStr = step.verificationGate ? ` [gate: ${step.verificationGate}]` : '';
      lines.push(`  ${icon} Step ${idx + 1}: ${step.title}${targetStr}${gateStr}`);
    });

    const active = this.getActiveStep();
    if (active) {
      lines.push(`\nCurrent Active Objective: Step ${active.id} — "${active.title}"`);
      if (active.description) lines.push(`  Directive: ${active.description}`);
      if (active.targetFiles.length) lines.push(`  Target Files: ${active.targetFiles.join(', ')}`);
      if (active.verificationGate) lines.push(`  Required Proof to Complete Step: ${active.verificationGate}`);
    } else if (this.isComplete()) {
      lines.push('\nAll plan milestones completed! Formulate final dotpoint evidence summary.');
    }

    return lines.join('\n');
  }
}

/**
 * Determines whether a goal is primarily advisory/conceptual rather than operational code mutation.
 */
export function isAdvisoryPrompt(goal = '') {
  if (!goal || typeof goal !== 'string') return false;
  const clean = goal.trim();
  const advisoryPattern = /^(?:how\s+(?:to|can|do|should|would)|what\s+(?:is|are|would)|why\b|explain\b|recommend\b|suggestions?\b|design\s+(?:ideas?|patterns?)|ideas?\s+for|architecture\s+overview|review\s+(?:strategy|approach)|assessment\b|compare\b)\b/i;
  const operationalPattern = /\b(?:and\s+(?:implement|fix|build|test|commit|push|run|edit|code))\b/i;
  return advisoryPattern.test(clean) && !operationalPattern.test(clean);
}

/**
 * Cognitive Deliberation Engine formulating 4-pillar reasoning & structured plans.
 */
export class PlanEngine {
  constructor(agent) {
    this.agent = agent;
  }

  /**
   * Evaluates whether a prompt warrants an explicit planning phase
   */
  shouldPlan(goal, options = {}) {
    if (options.fast) return false;
    if (options.plan || this.agent.options?.plan) return true;

    if (!goal || typeof goal !== 'string') return false;
    const clean = goal.trim();

    // Advisory and conceptual queries do NOT warrant an operational code execution plan
    if (isAdvisoryPrompt(clean)) {
      return false;
    }

    // Very short single queries (e.g. "what time is it", "git status", "show files")
    if (clean.length < 20 && !clean.includes(' and ') && !clean.includes(',')) {
      return false;
    }

    // Trivial direct informational requests
    if (/^(?:what is|who are|time|date|pwd|which|where is)\b/i.test(clean)) {
      return false;
    }

    // Multi-step prompts or operational tasks warrant planning
    if (isMultiStepPrompt(clean)) return true;

    // Presence of engineering verbs and file references
    const engineeringPatterns = [
      /\b(?:implement|refactor|fix|bug|build|architect|migrate|rewrite|integrate|deploy|create\s+(?:module|service|api|app|component))\b/i,
      /\b(?:test|verify|benchmark|validate|audit)\b/i,
      /\b(?:across|multiple|both|all|system|pipeline|database|schema)\b/i,
    ];

    return engineeringPatterns.some((pat) => pat.test(clean));
  }

  /**
   * Synthesize cognitive deliberation and structured execution plan
   */
  async generateDeliberationAndPlan(goal, context = {}) {
    const workspace = context.workspaceDir || this.agent.workspaceDir || process.cwd();
    const startPoint = determineStartingPoint(workspace, goal);

    // 1. VERIFICATION MODE Fast-path: All deliverables exist and tests pass
    if (startPoint.mode === 'VERIFICATION') {
      const relTest = startPoint.testFile ? path.relative(workspace, startPoint.testFile) : '';
      const testCmd = relTest ? `node --test "${relTest}"` : 'node --test';
      const steps = [
        new PlanStep({
          id: 1,
          phase: 'Verification',
          title: `Execute deterministic test suite (${path.basename(startPoint.testFile || 'test-suite')})`,
          description: `Run test suite to verify baseline invariant assertions: ${testCmd}`,
          targetFiles: startPoint.testFile ? [startPoint.testFile] : [],
          tool: 'bash',
          verificationGate: 'All test assertions pass with exit code 0',
          status: 'active',
        }),
        new PlanStep({
          id: 2,
          phase: 'Verification & Proof',
          title: 'Verify deliverables and synthesize completion report',
          description: 'Inspect deliverables against requirements and formulate comprehensive proof report.',
          targetFiles: [
            startPoint.scan?.implementation,
            startPoint.scan?.testFile,
            startPoint.scan?.complexityAnalysis,
            startPoint.scan?.distributedAnalysis,
          ].filter(Boolean),
          tool: 'auto',
          verificationGate: 'Deliverables verified and proof documented',
          status: 'pending',
        }),
      ];

      return new ExecutionPlan({
        goal,
        title: `Verification & Quality Gate: ${startPoint.scan?.implementation ? path.basename(startPoint.scan.implementation) : 'Deliverables'}`,
        phases: ['Verification & Proof', 'Evidence Synthesis'],
        steps,
        risks: ['Preserve existing verified implementations and avoid redundant rebuilds.'],
        verificationCriteria: ['Test suite exit code 0', 'All deliverables accounted for'],
        deliberation: {
          title: 'Direct Verification of Complete Deliverables',
          intent: 'All deliverables exist and test assertions pass. Formulating rapid proof and evidence summary.',
          decomposition: [
            '1. Run test suite to verify all test assertions pass deterministically',
            '2. Confirm deliverables completeness and compile final proof',
          ],
          architecture: [
            startPoint.scan?.implementation,
            startPoint.scan?.testFile,
            startPoint.scan?.complexityAnalysis,
            startPoint.scan?.distributedAnalysis,
          ].filter(Boolean).map((p) => path.relative(workspace, p)),
          risks: ['Avoid modifying working files unnecessarily'],
          verificationCriteria: ['All tests pass with exit code 0'],
        },
      });
    }

    // 2. DEBUG MODE Fast-path: Deliverables exist but tests fail
    if (startPoint.mode === 'DEBUG') {
      const relTest = startPoint.testFile ? path.relative(workspace, startPoint.testFile) : '';
      const steps = [
        new PlanStep({
          id: 1,
          phase: 'Reconnaissance',
          title: `Inspect failing assertions in ${path.basename(startPoint.testFile || 'test suite')}`,
          description: 'Analyze failing test outputs and pinpoint mismatch in implementation invariants.',
          targetFiles: [startPoint.testFile, startPoint.scan?.implementation].filter(Boolean),
          tool: 'read_file',
          verificationGate: 'Failing assertions and root causes identified',
          status: 'active',
        }),
        new PlanStep({
          id: 2,
          phase: 'Implementation',
          title: `Apply surgical fix to ${path.basename(startPoint.scan?.implementation || 'implementation')}`,
          description: 'Correct logic defect using replace_file_content to fulfill failing invariant.',
          targetFiles: startPoint.scan?.implementation ? [startPoint.scan.implementation] : [],
          tool: 'replace_file_content',
          verificationGate: 'Code updated surgically without regressions',
          status: 'pending',
        }),
        new PlanStep({
          id: 3,
          phase: 'Verification',
          title: 'Run test suite to prove exit code 0',
          description: `Execute test runner to confirm all tests pass: node --test "${relTest}"`,
          targetFiles: startPoint.testFile ? [startPoint.testFile] : [],
          tool: 'bash',
          verificationGate: 'All tests pass with exit code 0',
          status: 'pending',
        }),
      ];

      return new ExecutionPlan({
        goal,
        title: `Targeted Debug Plan: ${startPoint.scan?.implementation ? path.basename(startPoint.scan.implementation) : 'TestSuite'}`,
        phases: ['Reconnaissance & Analysis', 'Implementation & Fix', 'Verification & Proof'],
        steps,
        risks: ['Focus only on fixing failing assertions to prevent regressions.'],
        verificationCriteria: ['All tests pass with exit code 0'],
        deliberation: {
          title: 'Targeted Debugging Plan',
          intent: 'Existing deliverables have test failures. Isolating defect and validating fix.',
          decomposition: [
            '1. Inspect failing test assertions',
            '2. Apply surgical fix to implementation',
            '3. Run test suite to verify exit 0',
          ],
          architecture: [startPoint.scan?.implementation, startPoint.testFile].filter(Boolean).map((p) => path.relative(workspace, p)),
          risks: ['Avoid breaking passing tests'],
          verificationCriteria: ['All tests pass with exit code 0'],
        },
      });
    }

    // 3. Synthesize 4-Pillar Deliberation with discovered workspace context
    const deliberation = await this.synthesizeDeliberation(goal, workspace, startPoint);

    // 4. Synthesize Steps from Deliberation
    const steps = this.synthesizePlanSteps(goal, deliberation);

    return new ExecutionPlan({
      goal,
      title: deliberation.title || 'Autonomous Systems Action Plan',
      phases: ['Reconnaissance & Architecture', 'Implementation & Mutation', 'Verification & Proof'],
      steps,
      risks: deliberation.risks,
      verificationCriteria: deliberation.verificationCriteria,
      deliberation,
    });
  }

  /**
   * Formulate deep 4-pillar deliberation
   */
  async synthesizeDeliberation(goal, workspace, startPoint = null) {
    // Check if neural LLM call is available for dynamic plan synthesis
    let planData = null;

    if (this.agent && this.agent.callLlm) {
      try {
        const scan = startPoint?.scan || scanWorkspace(workspace);
        const discoveredImpl = scan.implementations?.map((p) => path.relative(workspace, p)).join(', ') || 'None';
        const discoveredTests = scan.tests?.map((p) => path.relative(workspace, p)).join(', ') || 'None';
        const discoveredDocs = scan.docs?.map((p) => path.relative(workspace, p)).join(', ') || 'None';

        const planningPrompt = [
          {
            role: 'system',
            content: `You are a Principal Systems Architect and Deliberation Engine.
Given a user goal and workspace context, perform an exhaustive 4-pillar architectural breakdown and return a JSON object with this EXACT structure:
{
  "title": "Short descriptive title of plan (3-7 words)",
  "intent": "Concise summary of true user intent and core requirement",
  "decomposition": [
    "1. Detailed sub-objective 1",
    "2. Detailed sub-objective 2"
  ],
  "architecture": [
    "Target file/module or interface to inspect or modify",
    "Dependency, topology, or system invariant"
  ],
  "risks": [
    "Potential breaking change, loop trap, or failure mode to avoid"
  ],
  "verificationCriteria": [
    "Deterministic verification gate (e.g. exit code 0 on tests, syntax check, curl response)"
  ],
  "steps": [
    {
      "phase": "Reconnaissance",
      "title": "Inspect target files and schema",
      "description": "Locate files, inspect existing implementations, and understand invariants.",
      "targetFiles": ["path/to/target"],
      "tool": "read_file",
      "verificationGate": "Target file structure and invariants confirmed"
    },
    {
      "phase": "Implementation",
      "title": "Implement modification or patch",
      "description": "Apply complete surgical modifications without placeholders.",
      "targetFiles": ["path/to/target"],
      "tool": "write_file",
      "verificationGate": "File written and syntax validated"
    },
    {
      "phase": "Verification",
      "title": "Run verification tests and prove exit 0",
      "description": "Execute test suite, compilation, or smoke verification to validate behavior.",
      "targetFiles": [],
      "tool": "bash",
      "verificationGate": "Automated test passes with exit code 0"
    }
  ]
}
Output pure valid JSON with NO markdown wrappers, backticks, or chatter.`,
          },
          {
            role: 'user',
            content: `Workspace: ${workspace}
Goal: ${goal}

Discovered Pre-Flight Workspace Context:
- Reconnaissance Mode: ${startPoint?.mode || 'FRESH'}
- Discovered Implementation Files: ${discoveredImpl}
- Discovered Test Files: ${discoveredTests}
- Discovered Documentation: ${discoveredDocs}

Instructions:
Match existing workspace file names and casing conventions (e.g. kebab-case vs PascalCase, .js vs .ts). Do NOT invent non-existent file names when existing files are present.`,
          },
        ];

        const response = await this.agent.callLlm(planningPrompt);
        if (response && response.content) {
          const raw = response.content.replace(/```(?:json)?/g, '').replace(/```/g, '').trim();
          planData = JSON.parse(raw);
        }
      } catch {
        // Fallback to deterministic heuristic synthesis
        planData = null;
      }
    }

    if (planData && Array.isArray(planData.steps) && planData.steps.length > 0) {
      return planData;
    }

    // Deterministic Heuristic Synthesis fallback
    return this.heuristicDeliberation(goal, workspace, startPoint);
  }

  /**
   * Deterministic heuristic deliberation when LLM is offline or fast mode
   */
  heuristicDeliberation(goal, workspace) {
    const isTestGoal = /\b(?:test|pytest|vitest|verify|check)\b/i.test(goal);
    const isFixGoal = /\b(?:fix|bug|issue|error|fail|patch)\b/i.test(goal);
    const isCreateGoal = /\b(?:create|new|implement|add|scaffold|generate)\b/i.test(goal);

    const fileMatches = goal.match(/(?:[\w.-]+\/)+[\w.-]+\.[a-zA-Z0-9]+|[\w.-]+\.[a-zA-Z0-9]+/g) || [];
    const uniqueFiles = [...new Set(fileMatches.filter((f) => f.includes('.')))];

    const risks = [
      'Avoid read loops: inspect discovered files once and transition immediately to editing.',
      'Maintain syntax integrity and preserve existing working features.',
      'Ensure changes are factual and validated with exit code 0.',
    ];

    const verificationCriteria = [
      isTestGoal ? 'Test runner execution completes with exit code 0.' : 'Syntax validation, build, or smoke check returns 0.',
    ];

    const steps = [];

    // Phase 1: Reconnaissance
    steps.push({
      phase: 'Reconnaissance',
      title: uniqueFiles.length ? `Inspect ${uniqueFiles[0]} and related context` : 'Audit workspace & locate target code',
      description: 'Review existing implementations, schema, and dependencies before modifying code.',
      targetFiles: uniqueFiles.slice(0, 2),
      tool: uniqueFiles.length ? 'read_file' : 'grep_search',
      verificationGate: 'Context, symbol structures, and line numbers identified',
    });

    // Phase 2: Implementation
    if (isFixGoal) {
      steps.push({
        phase: 'Implementation',
        title: 'Formulate & apply surgical bug fix',
        description: 'Update codebase using replace_file_content to resolve defect without regressions.',
        targetFiles: uniqueFiles,
        tool: 'replace_file_content',
        verificationGate: 'Target hunks surgically modified and validated',
      });
    } else if (isCreateGoal) {
      steps.push({
        phase: 'Implementation',
        title: 'Synthesize module & write clean implementation',
        description: 'Create requested files adhering to modular architecture.',
        targetFiles: uniqueFiles,
        tool: 'write_file',
        verificationGate: 'New code written without placeholders',
      });
    } else {
      steps.push({
        phase: 'Implementation',
        title: 'Execute core operational tasks',
        description: 'Fulfill all requested requirements surgically.',
        targetFiles: uniqueFiles,
        tool: 'replace_file_content',
        verificationGate: 'Required mutations applied surgically',
      });
    }

    // Phase 3: Verification
    steps.push({
      phase: 'Verification',
      title: 'Run automated proof and verify exit 0',
      description: 'Execute reproduction test, regression suite, or browser verification to prove correctness.',
      targetFiles: [],
      tool: 'bash',
      verificationGate: 'Reproduction/regression tests pass with exit code 0',
    });

    return {
      title: isFixGoal ? 'Surgical Defect Remediation Plan' : isCreateGoal ? 'Feature Implementation Plan' : 'Objective Execution Plan',
      intent: goal,
      decomposition: [
        '1. Inspect target files, symbols, and workspace invariants',
        '2. Execute required modifications with surgical precision',
        '3. Run proof verification ensuring exit code 0',
      ],
      architecture: uniqueFiles.length ? uniqueFiles : [`Workspace: ${workspace}`],
      risks,
      verificationCriteria,
      steps,
    };
  }

  synthesizePlanSteps(goal, deliberation) {
    if (Array.isArray(deliberation.steps) && deliberation.steps.length > 0) {
      return deliberation.steps.map((s, idx) => new PlanStep({
        id: idx + 1,
        verificationGate: s.verificationGate || 'Verified with exit code 0',
        ...s,
      }));
    }
    return [
      new PlanStep({ id: 1, phase: 'Reconnaissance', title: 'Audit workspace context & locate files', tool: 'grep_search', verificationGate: 'Target files and symbols localized' }),
      new PlanStep({ id: 2, phase: 'Implementation', title: 'Execute required changes surgically', tool: 'replace_file_content', verificationGate: 'Code hunks updated without corruption' }),
      new PlanStep({ id: 3, phase: 'Verification', title: 'Verify exit code 0 and confirm objective', tool: 'bash', verificationGate: 'Automated test suite completes with exit code 0' }),
    ];
  }

  /**
   * Evaluates whether a completed tool output satisfies the active milestone
   */
  evaluateProgress(plan, toolName, parsedArgs = {}, toolResult = {}) {
    if (!plan || plan.isComplete()) return null;

    const activeStep = plan.getActiveStep();
    if (!activeStep) return null;

    const isOk = toolResult.ok !== false && (toolResult.exitCode === undefined || toolResult.exitCode === 0);

    // If active step is Reconnaissance and a file/symbol was inspected
    if (activeStep.phase.toLowerCase().includes('recon') || activeStep.tool === 'read_file' || activeStep.tool === 'grep_search' || activeStep.tool === 'get_file_outline') {
      if ((toolName === 'read_file' || toolName === 'grep_search' || toolName === 'get_file_outline') && isOk) {
        const targetLabel = parsedArgs.path || parsedArgs.pattern || parsedArgs.filePath || '';
        plan.markStepComplete(activeStep.id - 1, `Inspected ${targetLabel}`);
        return {
          completedStep: activeStep,
          nextStep: plan.getActiveStep(),
          message: `✔ Milestone [Step ${activeStep.id}] Complete: ${activeStep.title}`,
        };
      }
    }

    // If active step is Implementation and write_file or replace_file_content succeeded
    if (activeStep.phase.toLowerCase().includes('implement') || activeStep.tool === 'write_file' || activeStep.tool === 'replace_file_content' || activeStep.tool === 'multi_replace_file_content') {
      if ((toolName === 'replace_file_content' || toolName === 'multi_replace_file_content' || toolName === 'write_file') && isOk) {
        const targetPath = parsedArgs.path || parsedArgs.filePath || '';
        plan.markStepComplete(activeStep.id - 1, `Modified ${targetPath}`);
        return {
          completedStep: activeStep,
          nextStep: plan.getActiveStep(),
          message: `✔ Milestone [Step ${activeStep.id}] Complete: ${activeStep.title}`,
        };
      }
    }

    // If active step is Verification and bash, browser, inspection, or synthesis verification succeeded
    if (activeStep.phase.toLowerCase().includes('verify') || activeStep.tool === 'bash' || activeStep.tool === 'browser_open' || activeStep.tool === 'auto') {
      if ((toolName === 'bash' || toolName === 'browser_open' || toolName === 'browser_screenshot' || toolName === 'read_file' || activeStep.tool === 'auto') && isOk) {
        const cmd = parsedArgs.command || parsedArgs.cmd || parsedArgs.url || parsedArgs.path || toolName;
        plan.markStepComplete(activeStep.id - 1, `Verified: ${String(cmd).slice(0, 40)} (exit 0)`);
        return {
          completedStep: activeStep,
          nextStep: plan.getActiveStep(),
          message: `✔ Milestone [Step ${activeStep.id}] Complete: ${activeStep.title}`,
        };
      }
    }

    return null;
  }
}
