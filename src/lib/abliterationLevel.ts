/**
 * Reactive Abliteration Level & Laser Perspective Grid System.
 *
 * Maps active model, provider, and runtime state to an uncensored filter level
 * (0–4: Locked -> Soft -> Open -> Raw -> Void) which drives the 3-point
 * perspective laser-trace field.
 */

import type { ProviderId } from './providers'

export type AbliterationLevel = 0 | 1 | 2 | 3 | 4

export type LaserMode = 'auto' | 'manual' | 'off'

export interface AbliterationLevelMeta {
  level: AbliterationLevel
  label: string
  tag: string
  desc: string
  color: string
  bgAlpha: string
  borderAlpha: string
}

export const ABLITERATION_LEVELS: Record<AbliterationLevel, AbliterationLevelMeta> = {
  0: {
    level: 0,
    label: 'Locked',
    tag: 'CENSORED',
    desc: 'Alignment & guardrails intact (0 lasers)',
    color: '#71717a',
    bgAlpha: 'rgba(113, 113, 122, 0.12)',
    borderAlpha: 'rgba(113, 113, 122, 0.35)',
  },
  1: {
    level: 1,
    label: 'Soft',
    tag: 'GUARDED',
    desc: 'Mild refusal suppression (sparse lasers)',
    color: '#38bdf8',
    bgAlpha: 'rgba(56, 189, 248, 0.12)',
    borderAlpha: 'rgba(56, 189, 248, 0.35)',
  },
  2: {
    level: 2,
    label: 'Open',
    tag: 'UNCONSTRAINED',
    desc: 'Ungated cloud / refusal vector offset (ambient lasers)',
    color: '#22d3ee',
    bgAlpha: 'rgba(34, 211, 238, 0.14)',
    borderAlpha: 'rgba(34, 211, 238, 0.4)',
  },
  3: {
    level: 3,
    label: 'Raw',
    tag: 'ABLITERATED',
    desc: 'Representation abliterated / raw neural weights (dense lasers)',
    color: '#00f2fe',
    bgAlpha: 'rgba(0, 242, 254, 0.14)',
    borderAlpha: 'rgba(0, 242, 254, 0.4)',
  },
  4: {
    level: 4,
    label: 'Void',
    tag: 'OVERDRIVE',
    desc: 'Zero guardrails / full vector ablation (aggressive lasers)',
    color: '#f43f5e',
    bgAlpha: 'rgba(244, 63, 94, 0.18)',
    borderAlpha: 'rgba(244, 63, 94, 0.55)',
  },
}

export const ABLITERATION_LEVEL_ORDER: AbliterationLevel[] = [0, 1, 2, 3, 4]

/**
 * Heuristic mapper: determines the effective abliteration level in 'auto' mode.
 *
 * Rules:
 * - Gated / standard proprietary models (e.g. meta-llama without abliterated) -> 0 (or 1 if busy)
 * - Ungated / generic models -> 2
 * - Cloud abliterated models (mlabonne, huihui-ai, etc.) -> 3 (or 4 if busy)
 * - Local Spark DGX qwen-abliterated -> 3 (or 4 if busy)
 * - While actively streaming/running agent (busy = true), bump +1 (capped at 4)
 */
export function inferAbliterationLevel(
  modelId: string,
  provider: ProviderId,
  busy: boolean,
  isGated = false,
): AbliterationLevel {
  const m = (modelId || '').toLowerCase()

  let baseLevel: AbliterationLevel = 2

  if (isGated) {
    baseLevel = 0
  } else if (provider === 'spark' || m.includes('qwen-abliterated') || m.includes('qwen-flash')) {
    // Dedicated GB10 local abliterated instance
    baseLevel = 3
  } else if (m.includes('abliterat') || m.includes('uncensor') || m.includes('hermes')) {
    baseLevel = 3
  } else if (m.includes('llama') && !m.includes('abliterat')) {
    // Standard Llama without abliteration
    baseLevel = 1
  } else if (provider === 'featherless' && isGated) {
    baseLevel = 0
  } else {
    // Default open / ungated cloud models
    baseLevel = 2
  }

  // Dynamic token streaming / agent loop excitation: bump +1 when busy
  if (busy) {
    return Math.min(4, baseLevel + 1) as AbliterationLevel
  }

  return baseLevel
}
