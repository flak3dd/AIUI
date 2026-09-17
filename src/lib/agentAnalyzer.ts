/**
 * Agent Progress & Anti-Loop Analyzer for web-api-app.
 * Continuously inspects agent responses, tool calls, and execution traces to:
 * 1. Continuously analyze responses and answers to prevent semantic & lexical looping.
 * 2. Detect command loops, cyclic oscillation (A -> B -> A -> B), and stagnant errors.
 * 3. Track progress toward the user's original objective and ensure forward direction.
 * 4. Generate targeted steering directives to enforce forward momentum.
 * 5. Provide circuit-breaker protection against runaway loops.
 */

export interface ActionRecord {
  round: number
  command?: string
  toolName?: string
  toolArgs?: string
  exitCode?: number
  stdoutExcerpt?: string
  stderrExcerpt?: string
  responseText?: string
  filesModified?: string[]
  filesRead?: string[]
  timestamp: number
}

export type ProgressStage = 'discovery' | 'implementation' | 'verification' | 'completion' | 'stalled'

export interface LoopAnalysisResult {
  isLooping: boolean
  loopType?:
    | 'identical_command'
    | 'stagnant_error'
    | 'cyclic_oscillation'
    | 'repetitive_response'
    | 'read_file_loop'
    | 'stalled_progress'
    | 'direction_drift'
  repeatCount: number
  repeatedAction?: string
  nudgePrompt?: string
  suggestedAction?: 'pivot_strategy' | 'inspect_files' | 'abort_runaway' | 'execute_action'
  progressMade: boolean
  progressSummary: string
  stage: ProgressStage
  directionSummary: string
}


/** User-facing prompt chips when Anti-Loop is active or the circuit breaker trips. */
export type AntiLoopSuggestion = { id: string; label: string; prompt: string }

export function getAntiLoopPromptSuggestions(
  analysis: Pick<LoopAnalysisResult, 'loopType' | 'suggestedAction' | 'repeatedAction' | 'progressSummary'>,
  goal = '',
): AntiLoopSuggestion[] {
  const goalBit = goal.trim() ? ` toward: ${goal.trim().slice(0, 160)}` : ''
  const repeated = (analysis.repeatedAction || '').trim()
  const common: AntiLoopSuggestion[] = [
    {
      id: 'pivot',
      label: 'Pivot strategy',
      prompt:
        `Stop the current approach${repeated ? ` (avoid repeating: ${repeated})` : ''}. Pick one different concrete tool action${goalBit}. No repeated explanations — edit or run something new.`,
    },
    {
      id: 'inspect',
      label: 'Inspect root cause',
      prompt:
        `Anti-loop: pause retries. Use read_file on the failing source, quote the exact defect, then write_file a minimal fix${goalBit}. Do not re-run the same failing command until the file changed.`,
    },
    {
      id: 'narrow',
      label: 'Narrow the goal',
      prompt:
        `Break the objective into the smallest next verifiable step${goalBit}. Do only that step with one tool call, then report evidence (path, exit code, or diff).`,
    },
    {
      id: 'stop-report',
      label: 'Stop & summarize',
      prompt:
        `Stop acting. Summarize what was tried, what failed (with exit codes/stderr), what files changed, and the single best next command for me to approve.`,
    },
  ]

  const byType: Partial<Record<NonNullable<LoopAnalysisResult['loopType']>, AntiLoopSuggestion[]>> = {
    read_file_loop: [
      {
        id: 'write-now',
        label: 'Write the fix now',
        prompt: `You already re-read the file. Do NOT read it again. Call write_file with the concrete fix${goalBit}, then bash a focused verification command.`,
      },
      common[2],
      common[3],
    ],
    stagnant_error: [
      {
        id: 'new-repro',
        label: 'Change the repro',
        prompt: `The same command keeps failing. Change one variable (cwd, flags, file, or env), or inspect the error site with read_file before any retry${goalBit}.`,
      },
      common[1],
      common[3],
    ],
    identical_command: [
      {
        id: 'no-rerun',
        label: 'No identical rerun',
        prompt: `Do not run the same command again. Diagnose with read_file / a different bash probe, then apply a write_file fix${goalBit}.`,
      },
      common[1],
      common[3],
    ],
    cyclic_oscillation: [
      {
        id: 'break-cycle',
        label: 'Break the A⇄B cycle',
        prompt: `You are oscillating between two approaches. Stop both. Read the relevant file once, state the root cause in one sentence, and apply one consolidated write_file fix${goalBit}.`,
      },
      common[1],
      common[3],
    ],
    repetitive_response: [
      {
        id: 'tool-not-talk',
        label: 'Tool call, not talk',
        prompt: `No more narrative repeats. Issue one tool call (read_file, write_file, or bash) that advances the goal${goalBit}. If done, give verified evidence only.`,
      },
      common[0],
      common[3],
    ],
    stalled_progress: [
      common[2],
      {
        id: 'execute',
        label: 'Execute one action',
        prompt: `The goal is actionable${goalBit}. Identify one file, write_file the change, then bash a verification. No planning-only replies.`,
      },
      common[3],
    ],
    direction_drift: [common[0], common[2], common[3]],
  }

  const typed = analysis.loopType ? byType[analysis.loopType] : undefined
  if (typed?.length) return typed.slice(0, 4)

  if (analysis.suggestedAction === 'inspect_files') return [common[1], common[0], common[3]]
  if (analysis.suggestedAction === 'execute_action') return [common[2], common[0], common[3]]
  if (analysis.suggestedAction === 'abort_runaway') return [common[3], common[0], common[1]]
  return common
}

/** Normalize error string for comparison (strip timestamps, memory addresses, temp paths) */
export function normalizeError(err: string): string {
  if (!err) return ''
  return err
    .replace(/0x[0-9a-fA-F]+/g, '0xHEX')
    .replace(/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?\b/g, '')
    .replace(/File ".*?([a-zA-Z0-9_\-]+\.py)", line \d+/g, '$1')
    .replace(/\/tmp\/spark-sandboxes\/[^\s]+/g, '/tmp/sandbox')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300)
}

/** Normalize narrative response text (strip markdown fences, code blocks, excessive whitespace) */
export function normalizeText(text: string): string {
  if (!text) return ''
  return text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]+`/g, '')
    .replace(/[#*>\-_~[\]()]/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim()
}

/** Split text into normalized sentence tokens */
export function extractSentences(text: string): string[] {
  const norm = normalizeText(text)
  if (!norm) return []
  return norm
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 15)
}

/** Compute Jaccard similarity between two word sets */
export function textSimilarity(a: string, b: string): number {
  if (!a || !b) return 0
  const wordsA = new Set(
    a
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 2)
  )
  const wordsB = new Set(
    b
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 2)
  )
  if (wordsA.size === 0 || wordsB.size === 0) return 0

  let intersection = 0
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection++
  }
  const union = wordsA.size + wordsB.size - intersection
  return union > 0 ? intersection / union : 0
}

/** Compute sentence-level overlap ratio between two texts */
export function sentenceOverlapRatio(textA: string, textB: string): number {
  const sA = extractSentences(textA)
  const sB = extractSentences(textB)
  if (sA.length === 0 || sB.length === 0) return 0

  let matches = 0
  for (const sa of sA) {
    for (const sb of sB) {
      if (sa === sb || textSimilarity(sa, sb) > 0.8) {
        matches++
        break
      }
    }
  }
  return matches / sA.length
}

export class AgentAnalyzer {
  private userGoal: string = ''
  private goalKeywords: string[] = []
  private isActionableGoal: boolean = false
  private history: ActionRecord[] = []
  private loopCounters: Record<string, number> = {}
  private inspectedFiles: Set<string> = new Set()
  private modifiedFiles: Set<string> = new Set()
  private currentStage: ProgressStage = 'discovery'

  /** Initialize a new session with the user's objective */
  public initSession(userGoal: string): void {
    this.userGoal = userGoal.trim()
    this.history = []
    this.loopCounters = {}
    this.inspectedFiles.clear()
    this.modifiedFiles.clear()
    this.currentStage = 'discovery'

    // Extract keywords (longer than 3 chars, technical tokens)
    this.goalKeywords = this.userGoal
      .toLowerCase()
      .replace(/[^a-z0-9_\-./]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 3 && !['what', 'with', 'from', 'this', 'that', 'have', 'your', 'please', 'could', 'would'].includes(w))

    // Determine if goal requests actionable changes/executions
    const actionVerbs = [
      'fix',
      'run',
      'build',
      'test',
      'create',
      'write',
      'update',
      'debug',
      'install',
      'deploy',
      'check',
      'solve',
      'implement',
      'execute',
      'add',
      'remove',
    ]
    this.isActionableGoal = actionVerbs.some((v) =>
      this.userGoal.toLowerCase().includes(v)
    )
  }

  public recordAction(action: ActionRecord): void {
    this.history.push(action)
    if (action.filesRead) {
      action.filesRead.forEach((f) => this.inspectedFiles.add(f))
    }
    if (action.filesModified) {
      action.filesModified.forEach((f) => this.modifiedFiles.add(f))
    }
  }

  public getHistory(): ActionRecord[] {
    return [...this.history]
  }

  public reset(): void {
    this.history = []
    this.loopCounters = {}
    this.inspectedFiles.clear()
    this.modifiedFiles.clear()
    this.currentStage = 'discovery'
  }

  public getUserGoal(): string {
    return this.userGoal
  }

  public getGoalKeywords(): string[] {
    return this.goalKeywords
  }

  public getStage(): ProgressStage {
    return this.currentStage
  }

  /** Compact post-run summary for MemPalace / debug. */
  public getSessionSummary(): string {
    const lines: string[] = [
      `Goal: ${this.userGoal || '(none)'}`,
      `Stage: ${this.currentStage}`,
      `Rounds: ${this.history.length}`,
      `Files read: ${[...this.inspectedFiles].join(', ') || '(none)'}`,
      `Files modified: ${[...this.modifiedFiles].join(', ') || '(none)'}`,
    ]
    const last = this.history[this.history.length - 1]
    if (last) {
      lines.push(
        `Last: tool=${last.toolName || '-'} cmd=${last.command || '-'} exit=${last.exitCode ?? '-'}`,
      )
    }
    const loops = Object.entries(this.loopCounters)
      .filter(([, n]) => n > 1)
      .map(([k, n]) => `${k}×${n}`)
    if (loops.length) lines.push(`Loop counters: ${loops.join('; ')}`)
    return lines.join('\n')
  }

  /** Compact goal/stage/avoid line for continue nudges. */
  public buildGoalAnchor(extra?: { lastFailed?: string | null; avoid?: string | null }): string {
    const parts = [`Goal: ${this.userGoal || '(none)'}`, `Stage: ${this.currentStage}`]
    if (extra?.lastFailed) parts.push(`Last failed: ${extra.lastFailed}`)
    if (extra?.avoid) parts.push(`Do not repeat: ${extra.avoid}`)
    parts.push('Next: one concrete tool action (or final verified summary if done).')
    return parts.join(' | ')
  }

  /**
   * Continuous inspection of the agent's recent action, state, and outputs
   * to prevent looping of answers and verify progress is moving in the right direction.
   */
  public analyzeStep(current: ActionRecord): LoopAnalysisResult {
    const prev = this.history[this.history.length - 1]

    let progressMade = false
    let progressSummary = 'Evaluating execution state...'

    // Update Stage Tracking
    if (current.filesModified && current.filesModified.length > 0) {
      this.currentStage = 'implementation'
    } else if (
      current.command &&
      /(test|pytest|npm test|vitest|node .*test|check|verify|curl|python3 -m unittest)/i.test(
        current.command
      )
    ) {
      this.currentStage = 'verification'
    } else if (current.exitCode === 0 && prev && prev.exitCode !== undefined && prev.exitCode !== 0) {
      this.currentStage = 'verification'
    }

    if (
      current.exitCode === 0 &&
      current.command &&
      /(test|pytest|npm test|vitest|unittest|\bcurl\b|verify)/i.test(current.command)
    ) {
      this.currentStage = 'completion'
    }

    // 1. Evaluate Forward Progress Indicators
    if (current.exitCode === 0 && prev && prev.exitCode !== undefined && prev.exitCode !== 0) {
      progressMade = true
      progressSummary = 'Command succeeded after previous error (issue resolved).'
    } else if (current.filesModified && current.filesModified.length > 0) {
      progressMade = true
      progressSummary = `Applied file modifications: ${current.filesModified.join(', ')}`
    } else if (
      current.filesRead &&
      current.filesRead.some((f) => !this.inspectedFiles.has(f))
    ) {
      progressMade = true
      progressSummary = `Discovered new context from: ${current.filesRead.filter((f) => !this.inspectedFiles.has(f)).join(', ')}`
    } else if (
      current.stderrExcerpt &&
      prev?.stderrExcerpt &&
      normalizeError(current.stderrExcerpt) !== normalizeError(prev.stderrExcerpt)
    ) {
      progressMade = true
      progressSummary = 'Error trace transitioned to a new state (diagnostic progress).'
    } else if (!this.isActionableGoal && current.responseText && current.responseText.length > 100) {
      progressMade = true
      progressSummary = 'Provided comprehensive informational response.'
    }

    // 2. Continuous Analysis of Response Text: Detect Answer Looping & Repetition
    if (current.responseText && current.responseText.length > 60) {
      // Check against all previous assistant responses
      const priorResponses = this.history
        .map((h) => h.responseText)
        .filter((t): t is string => Boolean(t && t.length > 60))

      for (let i = priorResponses.length - 1; i >= 0; i--) {
        const pastText = priorResponses[i]
        const sim = textSimilarity(current.responseText, pastText)
        const overlap = sentenceOverlapRatio(current.responseText, pastText)

        if (sim > 0.78 || overlap > 0.55) {
          const repeatCount = (this.loopCounters['text_repetition'] || 1) + 1
          this.loopCounters['text_repetition'] = repeatCount

          if (repeatCount >= 3) {
            return {
              isLooping: true,
              loopType: 'repetitive_response',
              repeatCount,
              repeatedAction: 'narrative answer',
              suggestedAction: 'abort_runaway',
              progressMade: false,
              progressSummary: 'Answer repeated across 3 rounds without tangible progress. Circuit breaker triggered.',
              stage: 'stalled',
              directionSummary: 'Halted repetitive answer loop.',
              nudgePrompt: `[CIRCUIT BREAKER]: You have repeated the same answer 3 times without making progress on the user's goal: "${this.userGoal}". Halting execution to prevent infinite loop.`,
            }
          }

          return {
            isLooping: true,
            loopType: 'repetitive_response',
            repeatCount,
            repeatedAction: 'narrative answer',
            suggestedAction: 'pivot_strategy',
            progressMade: false,
            progressSummary: `Response is ${Math.round(Math.max(sim, overlap) * 100)}% identical to a prior answer. Looping detected.`,
            stage: 'stalled',
            directionSummary: `Target: "${this.userGoal}". Required: Execute concrete action or deliver final verified outcome.`,
            nudgePrompt: `[ANTI-LOOP DIRECTIVE]: You repeated your prior answer almost verbatim (${Math.round(Math.max(sim, overlap) * 100)}% match) without taking concrete action.
• Target Goal: "${this.userGoal}"
• Problem: Repeating explanations does not advance the objective.
• Mandatory Action:
1. Do NOT repeat previous explanations or promises ("I will...", "Let me...").
2. Execute a concrete tool call (e.g. read_file to inspect, write_file to edit, or bash to run tests).
3. If the task is finished, summarize the concrete changes and verified results directly.`,
          }
        }
      }
    }

    // 3. Detect Read-File Stagnation Loop (Reading same file 3+ times without edits)
    if (current.filesRead && current.filesRead.length > 0 && (!current.filesModified || current.filesModified.length === 0)) {
      for (const rf of current.filesRead) {
        const readMatches = this.history.filter((h) => h.filesRead?.includes(rf))
        if (readMatches.length >= 2) {
          return {
            isLooping: true,
            loopType: 'read_file_loop',
            repeatCount: readMatches.length + 1,
            repeatedAction: `read_file ${rf}`,
            suggestedAction: 'pivot_strategy',
            progressMade: false,
            progressSummary: `File '${rf}' was read ${readMatches.length + 1} times without applying any edits.`,
            stage: 'stalled',
            directionSummary: `Move from discovery of ${rf} to implementation fix.`,
            nudgePrompt: `[ANTI-LOOP DIRECTIVE]: You have read \`${rf}\` multiple times without applying changes.
You already have the contents. You MUST now proceed to implementation: use \`write_file\` to apply the fix or run a verification test. Stop re-reading without acting.`,
          }
        }
      }
    }

    // 4. Detect Identical Command Repetition & Stagnant Errors
    if (current.command) {
      const normalizedCmd = current.command.trim()
      const matchingCmds = this.history.filter((h) => h.command && h.command.trim() === normalizedCmd)

      if (matchingCmds.length >= 1) {
        const lastMatching = matchingCmds[matchingCmds.length - 1]
        const errNormalized = normalizeError(current.stderrExcerpt || '')
        const prevErrNormalized = normalizeError(lastMatching.stderrExcerpt || '')

        // Check if command is failing with stagnant error
        if (current.exitCode !== 0 && errNormalized && errNormalized === prevErrNormalized) {
          const repeatCount = (this.loopCounters[normalizedCmd] || 1) + 1
          this.loopCounters[normalizedCmd] = repeatCount

          if (repeatCount >= 3) {
            return {
              isLooping: true,
              loopType: 'stagnant_error',
              repeatCount,
              repeatedAction: normalizedCmd,
              suggestedAction: 'abort_runaway',
              progressMade: false,
              progressSummary: `Command '${normalizedCmd}' failed ${repeatCount} times with identical error. Circuit breaker triggered.`,
              stage: 'stalled',
              directionSummary: 'Execution paused to prevent infinite loop.',
              nudgePrompt: `[CIRCUIT BREAKER]: The command \`${normalizedCmd}\` has failed 3 times with the exact same error. Terminating runaway loop to prevent wasted cycles. Stop repeating this action.`,
            }
          }

          return {
            isLooping: true,
            loopType: 'stagnant_error',
            repeatCount,
            repeatedAction: normalizedCmd,
            suggestedAction: 'pivot_strategy',
            progressMade: false,
            progressSummary: `Repeated command '${normalizedCmd}' produced identical error. Course-correction required.`,
            stage: 'stalled',
            directionSummary: `Goal: "${this.userGoal}". Fix required before re-executing.`,
            nudgePrompt: `[ANTI-LOOP DIRECTIVE]: You executed \`${normalizedCmd}\` again, but it returned the EXACT same failure:
\`\`\`
${(current.stderrExcerpt || '').slice(0, 250)}
\`\`\`
CRITICAL: Do NOT run this same command again without changing the underlying code or environment.
You MUST:
1. Formulate a new hypothesis.
2. Apply the necessary code/config fix using write_file or bash.
3. Verify the file modification before re-running tests.`,
          }
        }
      }
    }

    // 5. Detect Cyclic Oscillation (A -> B -> A -> B)
    if (this.history.length >= 3 && current.command) {
      const h2 = this.history[this.history.length - 2]
      const h3 = this.history[this.history.length - 3]
      if (
        h2 &&
        h3 &&
        current.command.trim() === h2.command?.trim() &&
        prev?.command?.trim() === h3.command?.trim()
      ) {
        return {
          isLooping: true,
          loopType: 'cyclic_oscillation',
          repeatCount: 2,
          repeatedAction: `${prev.command} ⇋ ${current.command}`,
          suggestedAction: 'inspect_files',
          progressMade: false,
          progressSummary: 'Oscillating back and forth between two alternate commands.',
          stage: 'stalled',
          directionSummary: 'Break cyclic oscillation and inspect root cause.',
          nudgePrompt: `[ANTI-LOOP ALERT]: You are oscillating in a cycle between:
• Approach 1: \`${prev.command}\`
• Approach 2: \`${current.command}\`
Neither approach resolved the issue. STOP switching between them. Read the file contents directly using read_file, determine the real root cause, and write a new consolidated fix.`,
        }
      }
    }

    // 6. Direction & Momentum Check: Actionable Goal with Stalled Progress
    if (this.isActionableGoal && this.history.length >= 2 && !progressMade) {
      // Check if last 2 rounds had no files modified and no new successful executions
      const recentRounds = this.history.slice(-2)
      const hadMods = recentRounds.some((r) => r.filesModified && r.filesModified.length > 0)
      const hadSuccess = recentRounds.some((r) => r.exitCode === 0)

      if (!hadMods && !hadSuccess && (!current.command && !current.toolName)) {
        return {
          isLooping: true,
          loopType: 'stalled_progress',
          repeatCount: 2,
          repeatedAction: 'passive narrative',
          suggestedAction: 'execute_action',
          progressMade: false,
          progressSummary: 'Stalled progress: discussing problem without executing required fixes or tests.',
          stage: 'stalled',
          directionSummary: `Target: "${this.userGoal}". Actionable execution required.`,
          nudgePrompt: `[DIRECTION CHECK]: The user's request is actionable: "${this.userGoal}".
You have generated narrative text without executing any tools or file edits.
To make progress in the right direction:
1. Identify the file that needs updating.
2. Use \`write_file\` to apply the solution.
3. Run verification tests using \`bash\` to confirm it works.`,
        }
      }
    }

    return {
      isLooping: false,
      repeatCount: 1,
      progressMade,
      progressSummary: progressMade ? progressSummary : 'In progress',
      stage: this.currentStage,
      directionSummary: `Progressing towards: "${this.userGoal || 'objective'}" (${this.currentStage})`,
    }
  }
}

