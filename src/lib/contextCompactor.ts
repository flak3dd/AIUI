/**
 * Context window management, token estimation, and conversation compaction.
 * Prevents HTTP 400 (context length overflow) across vLLM, Featherless, and cloud providers.
 */

export interface ContextMessage {
  role: string
  content?: string | null
  [key: string]: unknown
}

/**
 * Fast, conservative token count approximation for code, tools, and dialogue.
 * In practice for mixed code/json/bash, 1 token ≈ 3.4 characters.
 */
export function estimateTokens(text: string | null | undefined): number {
  if (!text) return 0
  return Math.ceil(text.length / 3.4)
}

/**
 * Estimates total input tokens for a chat message list including metadata overhead.
 */
export function estimateMessagesTokens(messages: ContextMessage[] | any[]): number {
  if (!Array.isArray(messages) || messages.length === 0) return 0
  let total = 0
  for (const m of messages) {
    total += 12 // Message role & framing overhead
    if (typeof m.content === 'string') {
      total += estimateTokens(m.content)
    }
  }
  return total + 3 // Priming tokens
}

/**
 * Returns the default maximum context window for a provider / model.
 */
export function getProviderContextLimit(providerId?: string, _modelId?: string): number {
  switch (providerId) {
    case 'spark':
      // Local vLLM default context on Spark
      return 32768
    case 'featherless':
      return 32768
    case 'openrouter':
      return 32768
    case 'abliteration':
      return 32768
    default:
      return 16384
  }
}

/**
 * Compacts conversation history when input prompt approaches or exceeds context limits.
 *
 * Strategies:
 * 1. Preserves the system prompt (index 0) with all tool schemas and directives.
 * 2. Preserves the initial user prompt (index 1) to retain the original goal.
 * 3. Preserves the most recent 3 turns (the active conversation / immediate tool outputs).
 * 4. Truncates oversized intermediate messages (> 600 chars) such as long bash logs.
 * 5. If still over budget, prunes older intermediate messages sequentially.
 */
export function compactMessagesForContext<T extends ContextMessage>(
  messages: T[],
  maxContext: number,
  targetOutputTokens = 2048,
): T[] {
  if (!Array.isArray(messages) || messages.length <= 4) {
    return messages
  }

  const targetInputBudget = Math.max(1024, maxContext - targetOutputTokens - 64)
  let currentTokens = estimateMessagesTokens(messages)

  if (currentTokens <= targetInputBudget) {
    return messages
  }

  // Phase 1: Truncate large tool outputs and verbose logs in all non-boundary messages
  const truncatedMessages = messages.map((msg, idx) => {
    if (idx === 0 || idx === messages.length - 1) return msg
    if (typeof msg.content === 'string' && msg.content.length > 600) {
      const half = 280
      const truncated =
        msg.content.slice(0, half) +
        '\n\n[...output truncated to preserve context window...]\n\n' +
        msg.content.slice(-half)
      return { ...msg, content: truncated }
    }
    return msg
  })

  currentTokens = estimateMessagesTokens(truncatedMessages)
  if (currentTokens <= targetInputBudget) {
    return truncatedMessages as T[]
  }

  // Phase 2: If still above budget, drop older intermediate messages preserving system, goal, and tail
  const systemMessage = truncatedMessages[0]
  const hasSystem = systemMessage?.role === 'system'
  const firstUserIndex = hasSystem ? 1 : 0
  const initialUserMessage = truncatedMessages[firstUserIndex]
  const tailMessages = truncatedMessages.slice(-2)
  const intermediate = truncatedMessages.slice(firstUserIndex + 1, -2)

  let candidate = [
    ...(hasSystem ? [systemMessage] : []),
    ...(initialUserMessage ? [initialUserMessage] : []),
    ...intermediate,
    ...tailMessages,
  ]

  while (intermediate.length > 0 && currentTokens > targetInputBudget) {
    intermediate.shift()
    candidate = [
      ...(hasSystem ? [systemMessage] : []),
      ...(initialUserMessage ? [initialUserMessage] : []),
      ...intermediate,
      ...tailMessages,
    ]
    currentTokens = estimateMessagesTokens(candidate)
  }

  return candidate as T[]
}

/**
 * Calculate safe max_tokens parameter so input_tokens + max_tokens <= max_context.
 */
export function calculateSafeMaxTokens(
  estimatedInputTokens: number,
  requestedMaxTokens = 4096,
  maxContext = 16384,
  safetyBuffer = 48,
): number {
  const availableHeadroom = maxContext - estimatedInputTokens - safetyBuffer
  if (availableHeadroom <= 0) {
    return 256
  }
  return Math.max(128, Math.min(requestedMaxTokens, availableHeadroom))
}
