/**
 * Reactive rain mood system — derives a "mood" from conversation context
 * so the matrix rain background shifts color with the feel of the thread.
 *
 * v1: local heuristic (no extra LLM call). Keyword/regex buckets + boosts.
 */

import type { UiMessage } from '../types/ui'

export type Mood = 'calm' | 'focus' | 'creative' | 'warm' | 'alert' | 'deep'

export type RgbTriplet = [number, number, number]

export interface MoodPalette {
  /** Bright leading head character */
  head: RgbTriplet
  /** Accent spark (primary) */
  spark: RgbTriplet
  /** Comet trail (secondary) */
  trail: RgbTriplet
}

/**
 * Mood → spectrum map (familiar Expo matrix colors).
 * `focus` is intentionally absent here — it falls back to theme tokens
 * (Abliterated Night violet/cyan) resolved at runtime by the canvas.
 */
export const MOOD_PALETTES: Record<Exclude<Mood, 'focus'>, MoodPalette> = {
  // Calm / idle — soft blue
  calm: {
    head: [186, 230, 253],
    spark: [59, 130, 246],
    trail: [96, 165, 250],
  },
  // Creative / playful — violet → cyan rainbow-ish
  creative: {
    head: [244, 244, 245],
    spark: [192, 132, 252],
    trail: [34, 211, 238],
  },
  // Warm / success — amber
  warm: {
    head: [254, 243, 199],
    spark: [251, 191, 36],
    trail: [245, 158, 11],
  },
  // Alert / fail — rose
  alert: {
    head: [254, 226, 226],
    spark: [244, 63, 94],
    trail: [251, 113, 133],
  },
  // Deep / systems — green
  deep: {
    head: [209, 250, 229],
    spark: [52, 211, 153],
    trail: [16, 185, 129],
  },
}

export const MOOD_LABELS: Record<Mood, string> = {
  calm: 'Calm',
  focus: 'Focus',
  creative: 'Creative',
  warm: 'Warm',
  alert: 'Alert',
  deep: 'Deep',
}

export const MOOD_ORDER: Mood[] = ['calm', 'focus', 'creative', 'warm', 'alert', 'deep']

export interface MoodContext {
  messages: UiMessage[]
  busy: boolean
  hasFailure: boolean
  toolsStripped: boolean
  agentMode: boolean
  deepBuild: boolean
}

const RE = {
  error: /\b(error|fail(?:ed|ure)?|exception|traceback|stderr|crash(?:ed)?|killed|denied|refused|timeout|cannot|unable|fatal|panic|segfault)\b/gi,
  exitFail: /exit (?:code )?[1-9]/gi,
  httpErr: /\b(4\d{2}|5\d{2})\b/g,
  build: /\b(build|compile|deploy|implement|refactor|fix|test|pytest|function|class|import|api|endpoint|component|render|hook|state|prop|callback|type|interface|route)\b/gi,
  creative: /\b(art|brainstorm|idea|story|poem|creative|playful|joke|fun|imagine|design|color|aesthetic|music|lyric|draw|paint|style)\b/gi,
  ops: /\b(ssh|docker|container|gpu|spark|vllm|infra|logs?|systemd|service|daemon|port|network|firewall|disk|memory|cpu|kernel|nginx|redis|postgres|mysql|kubernetes|kubectl)\b/gi,
  warm: /\b(done|shipped|works|working|passed|success(?:ful)?|complete(?:d)?|finished|verified|perfect|great|awesome|nice|✓|✅|solved|resolved)\b/gi,
  chill: /\b(hi|hey|hello|thanks|thank|ok|okay|cool|sure|yes|no|yep|nope|sup|morning|afternoon|evening|howdy)\b/gi,
}

function count(text: string, re: RegExp): number {
  return (text.match(re) || []).length
}

/**
 * Score the conversation and return the dominant mood.
 * Scans last ~12 messages + applies boosts for busy / failure / toolsStripped.
 */
export function scoreConversation(ctx: MoodContext): Mood {
  const { messages, busy, hasFailure, toolsStripped, agentMode, deepBuild } = ctx

  const recent = messages.slice(-12)
  const text = recent.map((m) => m.content || '').join('\n').toLowerCase()

  const scores: Record<Mood, number> = {
    calm: 1,
    focus: 1,
    creative: 1,
    warm: 1,
    alert: 1,
    deep: 1,
  }

  // Keyword buckets
  scores.alert += (count(text, RE.error) + count(text, RE.exitFail) + count(text, RE.httpErr)) * 3

  const buildHits = count(text, RE.build)
  const codeFences = count(text, /```/g)
  scores.focus += buildHits * 2 + codeFences * 1.5

  scores.creative += count(text, RE.creative) * 2.5
  scores.deep += count(text, RE.ops) * 2.5
  scores.warm += count(text, RE.warm) * 3

  const chillHits = count(text, RE.chill)
  const isShortChat = text.length < 200 && recent.length <= 3
  scores.calm += chillHits * 2 + (isShortChat ? 2 : 0)

  // Boosts
  if (busy && agentMode) scores.focus += 4
  if (deepBuild) scores.focus += 2
  if (hasFailure) scores.alert += 5
  if (toolsStripped) scores.alert += 2
  if (codeFences >= 3) scores.deep += 2

  // Pick winner (priority tiebreak: alert > focus > deep > warm > creative > calm)
  const priority: Mood[] = ['alert', 'focus', 'deep', 'warm', 'creative', 'calm']
  let best: Mood = 'focus'
  let bestScore = -Infinity
  for (const m of priority) {
    if (scores[m] > bestScore) {
      bestScore = scores[m]
      best = m
    }
  }
  return best
}

/** Parse a "r, g, b" CSS custom property into an RgbTriplet. */
export function parseRgbTriplet(raw: string, fallback: RgbTriplet): RgbTriplet {
  const parts = raw.split(',').map((s) => parseInt(s.trim(), 10))
  if (parts.length === 3 && parts.every((n) => !Number.isNaN(n))) {
    return [parts[0], parts[1], parts[2]]
  }
  return fallback
}

/** Resolve the active palette. `focus` → theme tokens (passed in); others → static. */
export function resolvePalette(
  mood: Mood,
  themeRgb: { text: string; accent: string; accent2: string },
): MoodPalette {
  if (mood === 'focus') {
    return {
      head: parseRgbTriplet(themeRgb.text, [244, 244, 245]),
      spark: parseRgbTriplet(themeRgb.accent, [139, 92, 246]),
      trail: parseRgbTriplet(themeRgb.accent2, [34, 211, 238]),
    }
  }
  return MOOD_PALETTES[mood]
}
