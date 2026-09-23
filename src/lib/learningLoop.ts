/**
 * One pass through look → try → check → remember → next.
 * A repeated phase is a loop. Only a change or a failed try becomes a lesson.
 */
import { textSimilarity } from './agentAnalyzer.ts'

export type LearningPhase = 'look' | 'try' | 'check' | 'remember' | 'next'

export interface LearningAction {
  command?: string
  toolName?: string
  exitCode?: number
  filesModified?: string[]
  filesRead?: string[]
  reasoning?: string
  responseText?: string
}

export interface LearningState {
  phase: LearningPhase
  lessons: string[]
  reasoning: string[]
  reasoningRepeats: number
  excuseRepeats: number
}

export interface LearningStep {
  phase: LearningPhase
  repeated: boolean
  lesson: string | null
  nudge: string | null
}

const SECRET = /\b(api[_ ]?key|password|secret|token|sk-[a-z0-9])/i

export function freshLearningState(): LearningState {
  return { phase: 'next', lessons: [], reasoning: [], reasoningRepeats: 0, excuseRepeats: 0 }
}

export function lessonFromAction(action: LearningAction): string | null {
  const blob = `${action.command || ''} ${action.toolName || ''}`
  if (SECRET.test(blob)) return null
  if (action.filesModified && action.filesModified.length > 0) {
    return `Changed ${action.filesModified.slice(0, 3).join(', ')}. Do not redo that edit.`
  }
  if (action.command && action.exitCode !== undefined && action.exitCode !== 0) {
    const cmd = action.command.replace(/\s+/g, ' ').slice(0, 140)
    return `Failed: ${cmd} (exit ${action.exitCode}). Do not run that command unchanged.`
  }
  return null
}

function phaseOf(action: LearningAction, lesson: string | null): LearningPhase {
  if (lesson) return 'remember'
  if (action.exitCode !== undefined || (action.filesModified && action.filesModified.length > 0)) return 'check'
  if (action.command || (action.toolName && action.toolName !== 'read_file' && action.toolName !== 'grep_search')) return 'try'
  if (action.filesRead?.length || action.toolName === 'read_file' || action.toolName === 'grep_search' || action.toolName === 'pdf_ocr') return 'look'
  return 'next'
}

export function applyLearningStep(state: LearningState, action: LearningAction): { state: LearningState; step: LearningStep } {
  const lesson = lessonFromAction(action)
  const phase = phaseOf(action, lesson)
  const repeated = phase === state.phase && phase !== 'next' && phase !== 'remember'
  const lessons = lesson && !state.lessons.includes(lesson) ? [...state.lessons, lesson].slice(-8) : state.lessons
  let nudge: string | null = null
  if (lesson) nudge = `Remember: ${lesson}\nThe next phase must be a different action.`
  if (repeated) {
    nudge = `Phase "${phase}" repeated. Stop this phase. Do one different action, or answer with the evidence you already have.`
  }
  const reasoning = observeReasoning(state, action.reasoning)
  if (reasoning.nudge) nudge = reasoning.nudge
  const excuse = observeStaleExcuse(state, action.responseText)
  if (excuse.nudge) nudge = excuse.nudge
  return {
    state: {
      phase,
      lessons,
      reasoning: reasoning.traces,
      reasoningRepeats: reasoning.repeats,
      excuseRepeats: excuse.repeats,
    },
    step: { phase, repeated: repeated || reasoning.repeats >= 2 || excuse.repeats >= 2, lesson, nudge },
  }
}

const STALE_EXCUSE = /cached|old output|different approach|display issue/i

function observeStaleExcuse(state: LearningState, text?: string): { repeats: number; nudge: string | null } {
  const clean = (text || '').trim()
  if (!STALE_EXCUSE.test(clean)) return { repeats: state.excuseRepeats, nudge: null }
  const repeats = state.excuseRepeats + 1
  const nudge = repeats >= 2
    ? 'Stop. Bash results are not cached. Use the latest tool result: executedAt, exitCode, stdout, and stderr. Do not say the output is old, and do not announce another approach.'
    : 'The latest bash result is a new execution (cached: false, with executedAt). Do not call it cached or old. Quote that stdout, stderr, and exit code.'
  return { repeats, nudge }
}

function observeReasoning(state: LearningState, text?: string): { traces: string[]; repeats: number; nudge: string | null } {
  const clean = (text || '').replace(/\s+/g, ' ').trim()
  if (clean.length < 80) return { traces: state.reasoning, repeats: 0, nudge: null }
  let best = 0
  for (const past of state.reasoning) best = Math.max(best, textSimilarity(clean, past))
  const traces = [...state.reasoning, clean.slice(0, 1500)].slice(-6)
  if (best < 0.72) return { traces, repeats: 0, nudge: null }
  const repeats = state.reasoningRepeats + 1
  const nudge = repeats >= 2
    ? 'Your reasoning restated an earlier plan. Stop thinking that plan. Answer with evidence, or make one new tool call that is not a retry.'
    : `Your reasoning overlapped an earlier plan (${Math.round(best * 100)}%). Do not restate it. Take a different action.`
  return { traces, repeats, nudge }
}

export function formatLessons(state: LearningState): string {
  if (state.lessons.length === 0) return ''
  return ['Lessons this turn:', ...state.lessons.map((line) => `- ${line}`)].join('\n')
}
