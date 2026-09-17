import type { BashExecResult } from '../lib/bashShell'
import type { ToolCall } from '../lib/api'

export type UiMessage = {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  execResult?: BashExecResult
  ragCitations?: string[]
  /** tool_call_id for role:'tool' messages — required by strict OpenAI-compatible APIs */
  tool_call_id?: string
  /** tool function name for role:'tool' messages */
  name?: string
  /** tool_calls emitted by an assistant turn — needed to reconstruct valid multi-turn history */
  tool_calls?: ToolCall[]
}
