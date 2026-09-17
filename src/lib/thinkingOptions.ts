/**
 * Pure helpers for Deep Reasoning / enable_thinking request kwargs
 * and classifying stream deltas into answer vs reasoning.
 */

export function resolveThinkingKwargs(
  providerId: string,
  enableThinking: boolean,
): { enable_thinking: boolean } | undefined {
  if (providerId === 'abliteration') return undefined
  return { enable_thinking: enableThinking }
}

export function classifyStreamDelta(delta: {
  content?: unknown
  reasoning_content?: unknown
}): { kind: 'content' | 'reasoning' | 'none'; text: string } {
  if (typeof delta.content === 'string' && delta.content) {
    return { kind: 'content', text: delta.content }
  }
  if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) {
    return { kind: 'reasoning', text: delta.reasoning_content }
  }
  return { kind: 'none', text: '' }
}
