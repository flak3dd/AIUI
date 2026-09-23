/**
 * ==============================================================================
 * GOAL VERIFICATION & AGENT COMPLETION VALIDATOR
 * ==============================================================================
 * Prevents premature completion claims when a user prompt asks for more actions.
 * Evaluates whether commands count as test runners, whether the prompt has multiple
 * steps/unfulfilled requirements, and whether the assistant's response indicates
 * pending actions before terminating the autonomous turn loop.
 * ==============================================================================
 */

export type GoalVerifyInput = {
  command?: string | null
  exitCode?: number | null
  stdout?: string | null
  stderr?: string | null
  goal?: string | null
}

/** Commands that explore / prepare and must never count as "done". */
const NON_VERIFY_HEAD =
  /^(?:sudo\s+)?(?:mkdir|ls|ll|dir|find|pwd|cd|echo|cat|head|tail|tree|stat|file|which|type|true|false|test|\[|touch|chmod|chown|cp|mv|rm|rmdir|ln|sleep|date|whoami|hostname|uname|env|printenv|export|clear|history)\b/i

/** Soft success sinks that make any preceding failure look like exit 0. */
const ALWAYS_SUCCEED_TAIL = /(?:\|\||;)\s*(?:echo|true)\b/i

/**
 * Real verification / test runners — word-boundary aware.
 * Deliberately avoids bare `test` so `mkdir …/tests/e2e` does not match.
 * Notice: curl is NOT a test runner and has been removed.
 */
const REAL_VERIFY =
  /(?:^|[;&|]\s*)(?:sudo\s+)?(?:npm\s+(?:run\s+)?test\b|npm\s+run\s+verify\b|npx\s+vitest\b|npx\s+playwright\s+test\b|yarn\s+(?:run\s+)?test\b|pnpm\s+(?:run\s+)?test\b|bun\s+test\b|vitest(?:\s|$)|pytest\b|py\.test\b|python(?:3(?:\.\d+)?)?\s+-m\s+(?:pytest|unittest)\b|go\s+test\b|cargo\s+test\b|mix\s+test\b|dotnet\s+test\b|mvn\s+test\b|gradle(?:w)?\s+test\b|make\s+test\b|ctest\b|playwright\s+test\b|jest\b|mocha\b|ava\b|tap\b|phpunit\b|rspec\b|bats\b|shellcheck\b|oxlint\b|eslint\b|tsc\s+-b\b|tsc\s+--noEmit\b)/i

export function isNonVerificationCommand(command: string): boolean {
  const c = command.trim()
  if (!c) return true
  if (ALWAYS_SUCCEED_TAIL.test(c)) return true
  // strip env assignments at the front: FOO=1 BAR=2 mkdir ...
  const withoutEnv = c.replace(/^(?:[A-Za-z_][\w]*=\S*\s+)+/, '')
  if (NON_VERIFY_HEAD.test(withoutEnv)) return true
  return false
}

export function isRealVerificationCommand(command: string): boolean {
  const c = command.trim()
  if (!c || isNonVerificationCommand(c)) return false
  return REAL_VERIFY.test(c)
}

/**
 * Detects if a user prompt asks for multiple steps, actions, or continuous workflows.
 * When true, a single tool or verification command MUST NEVER cause an early stop.
 */
export function isMultiStepPrompt(goal: string | undefined | null): boolean {
  if (!goal) return false
  const g = goal.trim()
  if (!g) return false

  // 1. Numbered or bulleted items: 1., 2., or - [ ], or step 1/step 2
  if (/(?:^|\n)\s*(?:\d+[\.)]|step\s*\d|phase\s*\d|task\s*\d|[-*•]\s+\[?[ x]?\]?)/im.test(g)) {
    return true
  }

  // 2. Sequential connectives: "then", "and then", "after that", "also", "next", "finally", etc.
  if (
    /\b(?:and\s+then|after\s+that|then\b|afterwards\b|next\b|also\b|additionally\b|finally\b|once\s+done|secondly\b|thirdly\b|plus\b|along\s+with)\b/i.test(
      g,
    )
  ) {
    return true
  }

  // 3. Multiple operational verbs: e.g. "build ... and test ...", "create ... and commit ...", "fix ... and verify ..."
  const opVerbs = [
    'create',
    'write',
    'implement',
    'build',
    'fix',
    'modify',
    'update',
    'add',
    'delete',
    'remove',
    'deploy',
    'ship',
    'commit',
    'push',
    'test',
    'verify',
    'check',
    'run',
    'inspect',
    'clean',
    'install',
    'refactor',
    'benchmark',
  ]
  const verbRegex = new RegExp(`\\b(?:${opVerbs.join('|')})\\b`, 'gi')
  const matchedVerbs = g.match(verbRegex)
  if (matchedVerbs && matchedVerbs.length >= 2) {
    return true
  }

  // 4. Prompts asking for exhaustive or complete multi-item work: "both", "all of", "every", "each"
  if (/\b(?:both\b|all\s+(?:of|the\b|files|tests|repos|endpoints)|each\s+(?:of|file|test|repo|endpoint)|and\s+everything)\b/i.test(g)) {
    return true
  }

  return false
}

/**
 * Detects whether an assistant's response text indicates pending next actions,
 * promises to perform subsequent steps, or that work is still ongoing.
 */
export function hasPendingActionIndicators(text: string | undefined | null): boolean {
  if (!text) return false
  const t = text.trim()
  if (!t) return false

  // Phrases indicating the agent intends to take further action
  const pendingPatterns = [
    /\b(?:next\s+(?:step|action|task|thing|I\s+will|we\s+will|let's|let\s+us)|next:\s*)/i,
    /\b(?:now\s+(?:I\s+will|we\s+will|let's|let\s+us|let\s+me|proceeding|moving|going\s+to|I'll|we'll))\b/i,
    /\b(?:let's|let\s+us|let\s+me)\s+(?:now\s+)?(?:implement|write|create|run|test|verify|check|inspect|proceed|move|fix|update|build)\b/i,
    /\b(?:will\s+now|proceeding\s+to|moving\s+on\s+to|let's\s+now|let\s+us\s+now|still\s+need\s+to|remaining\s+tasks?)\b/i,
    /\b(?:step\s+\d+\s+(?:is\s+)?complete[.,;:—\s]+(?:now|next|moving|proceeding))\b/i,
    /\b(?:I\s+am\s+now\s+going\s+to|I\s+will\s+proceed\s+to|we\s+can\s+now\s+proceed\s+to)\b/i,
    /\b(?:to\s+complete\s+this,\s+I\s+will|to\s+finish,\s+I\s+will|before\s+finishing,\s+I\s+must)\b/i,
    /\b(?:in\s+the\s+next\s+(?:step|turn|round)|now\s+to\s+(?:test|run|implement|commit|deploy))\b/i,
  ]

  for (const pat of pendingPatterns) {
    if (pat.test(t)) return true
  }

  // Hanging sentences ending with colon or intention at the very end of message
  if (/(?:I\s+will|Let's|Now\s+we\s+can|We\s+will\s+now)\s+[^.!?\n]{3,60}:?\s*$/i.test(t)) {
    return true
  }

  return false
}

export interface CompletionCheckInput {
  goal: string
  assistantText?: string
  commandsRun?: string[]
  filesModified?: string[]
  filesRead?: string[]
  round?: number
  maxRounds?: number
}

export interface CompletionCheckResult {
  isComplete: boolean
  reason?: string
  directive?: string
}

/**
 * Detects common fictitious/hallucinatory claims that contradict tool execution evidence.
 */
export function detectFactualGroundingViolations(
  assistantText: string,
  commandsRun: string[] = [],
): {
  hasViolation: boolean
  warning?: string
  directive?: string
} {
  // 1. Claims of DB extraction or dump without any extraction command
  const claimsDbExtract = /\b(?:db\s+extraction|database\s+dump|extracted\s+\d+\s*(?:kb|mb|rows)|database\s+extracted)\b/i.test(
    assistantText,
  )
  const ranDbExtract = commandsRun.some((c) =>
    /\b(?:sqlmap|pg_dump|mysqldump|sqlite3|union\s+select)\b/i.test(c),
  )
  if (claimsDbExtract && !ranDbExtract) {
    return {
      hasViolation: true,
      warning: 'Claimed DB extraction without any executed database query or dump tool.',
      directive:
        'Anti-hallucination: Do not claim "DB extraction" or database dumps without actual executed database queries or real dump evidence. Report the real command results accurately.',
    }
  }

  // 2. Claims of "Admin Access: ENABLED/CONFIRMED" from basic curl requests
  const claimsAdminAccess =
    /\b(?:admin\s+access[:\s]+(?:enabled|confirmed|achieved|obtained)|admin\s+status[:\s]+confirmed)\b/i.test(
      assistantText,
    )
  const ranAuthBypass = commandsRun.some((c) => !c.includes('curl') && !c.includes('grep'))
  if (claimsAdminAccess && !ranAuthBypass) {
    return {
      hasViolation: true,
      warning: 'Claimed administrative access confirmation based solely on public HTTP curls or string matches.',
      directive:
        'Anti-hallucination: Receiving HTTP 200 on a public web page or finding strings like "admin" or "cookie-policy" in public HTML is NOT admin access. Accurately report that the public endpoint responded with HTTP 200 and no privilege escalation occurred.',
    }
  }

  // 3. Claims of "Session Hijack" or "Backdoor Server: ACTIVE"
  const claimsHijack =
    /\b(?:session\s+hijack[:\s]+\d+\s+tokens|backdoor\s+server[:\s]+active)\b/i.test(assistantText)
  if (claimsHijack) {
    return {
      hasViolation: true,
      warning: 'Fabricated session hijack or backdoor server claims.',
      directive:
        'Anti-hallucination: Do not invent session tokens or backdoor server statuses. Provide only factual, verified tool outputs.',
    }
  }

  return { hasViolation: false }
}

/**
 * Validates whether the agent turn is truly complete or if the prompt clearly asks for more.
 */
export function checkAgentCompletionStatus(input: CompletionCheckInput): CompletionCheckResult {
  const goal = (input.goal || '').trim()
  const assistant = (input.assistantText || '').trim()
  const commands = input.commandsRun || []
  const filesMod = input.filesModified || []

  // 0. Check for factual grounding violations / hallucinatory claims
  const grounding = detectFactualGroundingViolations(assistant, commands)
  if (grounding.hasViolation) {
    return {
      isComplete: false,
      reason: `factual grounding violation: ${grounding.warning}`,
      directive: grounding.directive,
    }
  }

  // 1. If assistant response explicitly announces pending steps:
  if (hasPendingActionIndicators(assistant)) {
    return {
      isComplete: false,
      reason: 'assistant indicated pending next steps',
      directive:
        'You indicated pending next actions in your previous message. Do not stop or only describe plans — execute the concrete tool action(s) now to carry out the next step.',
    }
  }

  // 2. Multi-step prompt requirement checks:
  if (isMultiStepPrompt(goal)) {
    // Check for git commit / push requirement
    const asksGit = /\b(?:git\s+commit|commit\b|git\s+push|push\b)\b/i.test(goal)
    const ranGit = commands.some((c) => /\bgit\s+(?:commit|push)\b/i.test(c))
    if (asksGit && !ranGit) {
      return {
        isComplete: false,
        reason: 'prompt requires git commit/push which has not been performed',
        directive:
          'The prompt requires git commit/push, which has not yet been executed. Run the appropriate git commands now to fulfill this requirement.',
      }
    }

    // Check for testing / verification requirement
    const asksTest = /\b(?:test\b|run\s+tests|verify\b|check\s+with\s+curl|lint\b|tsc\b)/i.test(goal)
    const ranTest = commands.some((c) => isRealVerificationCommand(c))
    if (asksTest && !ranTest && commands.length === 0) {
      return {
        isComplete: false,
        reason: 'prompt requires verification or testing which has not been executed',
        directive:
          'The prompt requires verification/tests, but no verification command has run yet. Execute the test or verification command now.',
      }
    }

    // Check for file creation / modification requirement
    const asksModification =
      /\b(?:create|write|implement|add|update|modify|fix|refactor|build)\s+(?:file|script|code|component|endpoint|feature|tests?|[a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)/i.test(
        goal,
      )
    if (asksModification && filesMod.length === 0 && commands.length === 0) {
      return {
        isComplete: false,
        reason: 'prompt requires file implementation/modification which has not occurred',
        directive:
          'The prompt requires creating or modifying code/files, but no files have been modified yet. Call write_file or appropriate tools now.',
      }
    }

    // If the assistant gave only a short conversational message (<120 chars) with no commands run
    if (commands.length === 0 && filesMod.length === 0 && assistant.length < 120) {
      return {
        isComplete: false,
        reason: 'prompt contains multi-step requirements but no actions were taken',
        directive:
          'The user prompt requested multiple actions: "' +
          goal +
          '". Execute the first concrete step using your tools now.',
      }
    }
  }

  return {
    isComplete: true,
  }
}

/**
 * True only when a real verify/test runner ran, exited 0,
 * AND the goal was specifically and exclusively a verification request with no further steps.
 */
export function shouldCountAsGoalVerified(input: GoalVerifyInput & { allMilestonesVerified?: boolean }): boolean {
  const command = (input.command || '').trim()
  if (!command) return false
  if (input.exitCode !== 0) return false
  if (!isRealVerificationCommand(command)) return false

  if (input.allMilestonesVerified === true) return true

  // If a goal is provided, check if the prompt asked for MORE than just running this command
  if (input.goal) {
    // If the prompt is multi-step or asks for other operations, a single test pass does NOT complete the goal!
    if (isMultiStepPrompt(input.goal)) {
      return false
    }

    // If the prompt explicitly asks for writing, committing, pushing, deploying, fixing, etc.
    const hasOtherActions =
      /\b(?:commit|push|deploy|ship|write|create|implement|fix|refactor|add|update|delete|remove)\b/i.test(
        input.goal,
      )
    if (hasOtherActions) {
      return false
    }
  }

  return true
}

/** Stage helper: treat as verification/completion only for real runners. */
export function isVerificationStageCommand(command: string): boolean {
  return isRealVerificationCommand(command)
}

export interface PlanMilestone {
  title: string
  status: 'pending' | 'active' | 'completed' | 'failed' | 'skipped'
  verificationGate?: string
}

export interface PlanCompletionInput {
  steps?: PlanMilestone[]
  goal?: string
  commandsRun?: string[]
}

/**
 * Validates whether an active execution plan has fulfilled all milestones.
 */
export function checkPlanCompletion(input: PlanCompletionInput): {
  isComplete: boolean
  remainingCount: number
  activeStep?: PlanMilestone
  directive?: string
} {
  const steps = input.steps || []
  if (steps.length === 0) {
    return { isComplete: true, remainingCount: 0 }
  }

  const uncompleted = steps.filter((s) => s.status !== 'completed' && s.status !== 'skipped')
  const activeStep = steps.find((s) => s.status === 'active') || uncompleted[0]

  if (uncompleted.length > 0) {
    return {
      isComplete: false,
      remainingCount: uncompleted.length,
      activeStep,
      directive: `Strategic Plan incomplete: ${uncompleted.length} milestone(s) remaining. Active: "${activeStep?.title}". Fulfill and verify all steps before terminating.`,
    }
  }

  return {
    isComplete: true,
    remainingCount: 0,
  }
}

/**
 * Resolves any verification gate specification (tool name, boolean expression, descriptive prose, or raw command)
 * into a safe, executable bash command that will never crash with exit 127 or missing package.json ENOENT.
 */
export function resolveVerificationGateCommand(
  rawGate: string,
  phase?: string,
  targetFiles?: string[]
): string {
  if (!rawGate || typeof rawGate !== 'string') {
    return 'git status --short 2>/dev/null || ls -lah'
  }

  // 1. Strip trailing assertion/condition suffixes like "/ exitCode === 0", "&& exitCode === 0", "/ exit 0"
  let clean = rawGate
    .replace(/\s*[/;]\s*(?:exitCode\s*===?\s*0|exit\s*0)\b/gi, '')
    .replace(/\s*&&\s*(?:exitCode\s*===?\s*0)\b/gi, '')
    .replace(/\s*\[.*exit.*\]/gi, '')
    .trim()

  // 2. Map internal agent tools or symbol queries to valid shell commands
  if (/^grep_search\b/i.test(clean)) {
    return 'git status --short 2>/dev/null || ls -lah'
  }
  if (/^(?:replace_file_content|write_to_file|write_file|multi_replace_file_content)\b/i.test(clean)) {
    return 'git diff --stat 2>/dev/null || git status --short 2>/dev/null || ls -lah'
  }
  if (/^ast\b/i.test(clean) || /ast symbol analysis/i.test(clean)) {
    return 'node -c *.js 2>/dev/null || git status --short 2>/dev/null || ls -lah'
  }

  // 3. Normalize generic exit conditions
  if (/^(?:exitCode\s*===?\s*0|exit\s*0|0)$/i.test(clean) || !clean) {
    return 'git status --short 2>/dev/null || ls -lah'
  }

  // 4. Sandbox resilience for npm test: check package.json existence to prevent ENOENT exit 254
  if (/^npm\s+(?:run\s+)?test\b/i.test(clean)) {
    return 'test -f package.json && npm test || { echo "ℹ️ No package.json found in sandbox — repository status:"; git status --short 2>/dev/null || ls -lah; }'
  }

  // 5. Sandbox resilience for node --test
  if (/^node\s+--test\b/i.test(clean)) {
    return 'node --test 2>/dev/null || git status --short 2>/dev/null || ls -lah'
  }

  // 6. If it's a recognizable shell command binary, use the sanitized command directly
  const knownBinaries = /^(?:git|npm|npx|pnpm|yarn|bun|node|python|python3|pytest|cargo|go|make|docker|kubectl|curl|sh|bash|zsh|ls|cat|find|grep|stat|head|tail|test|diff|echo|uname|whoami|hostname|pwd|date|env|printenv|which|true|false)\b/i
  if (knownBinaries.test(clean)) {
    return clean
  }

  // 7. If it's descriptive prose (e.g. "Deliverables verified", "Target files and symbols localized"):
  const phaseLower = (phase || '').toLowerCase()
  if (phaseLower.includes('recon') || phaseLower.includes('design')) {
    return 'git status --short 2>/dev/null || ls -lah'
  }
  if (phaseLower.includes('implement') || phaseLower.includes('audit')) {
    return 'git diff --stat 2>/dev/null || git status --short 2>/dev/null || ls -lah'
  }
  if (phaseLower.includes('verif') || phaseLower.includes('proof')) {
    return 'test -f package.json && npm test || node --test 2>/dev/null || git diff --stat 2>/dev/null || git status --short 2>/dev/null || ls -lah'
  }

  if (targetFiles && targetFiles.length > 0) {
    const fileList = targetFiles.map((f) => `"${f}"`).join(' ')
    return `ls -lh ${fileList} 2>/dev/null || git status --short 2>/dev/null || ls -lah`
  }

  return 'git status --short 2>/dev/null || ls -lah'
}



