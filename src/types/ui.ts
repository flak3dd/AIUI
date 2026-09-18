import type { BashExecResult } from '../lib/bashShell'
import type { ToolCall } from '../lib/api'

export type UiFollowUp = { id: string; label: string; prompt: string }

export type UiMessage = {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  /** Native model reasoning / thinking trace for ThoughtTrail */
  reasoning?: string
  execResult?: BashExecResult
  ragCitations?: string[]
  /** tool_call_id for role:'tool' messages — required by strict OpenAI-compatible APIs */
  tool_call_id?: string
  /** tool function name; also `status_chip` for quiet system notices */
  name?: string
  /** tool_calls emitted by an assistant turn — needed to reconstruct valid multi-turn history */
  tool_calls?: ToolCall[]
  /** End-of-response / status-chip suggestion buttons */
  followUps?: UiFollowUp[]
  /** Compact actions line when files/scaffolds were written */
  actionsOverview?: string
}
