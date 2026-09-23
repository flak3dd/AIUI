/**
 * MemPalace orchestrator hooks for the response loop.
 * Wake loads L0+L1 only. Search runs after a person or project locus is bound.
 * Consolidation writes a verbatim drawer, an optional triple, and a diary line.
 */

import {
  addDrawer,
  addKnowledgeTriple,
  getMempalaceStatus,
  queryKnowledge,
  recordDiary,
  searchMemory,
  traversePalace,
  type MemPalaceHit,
} from './mempalace.ts'
import {
  PALACE_L0,
  PALACE_L1,
  ROOM_MEMPALACE,
  ROOM_RESPONSE_WORKFLOW,
  WING_AGENT_DESIGN,
} from './palaceWake.ts'

export const L0_CHAR_CAP = 400
export const L1_CHAR_CAP = 3200
export const WAKE_CHAR_CAP = 3600
const WAKE_TTL_MS = 30 * 60 * 1000
const AGENT_NAME = 'aiui'

export type PalaceLocus = {
  palaceFirst: boolean
  needsPathway: boolean
  wings: string[]
  rooms: string[]
  halls: string[]
}

export type ConsolidationPlan = {
  wing: string
  room: string
  hall: string
  drawer: string
  triple: { subject: string; predicate: string; object: string; valid_from: string } | null
  diary: string
}

export type KgFact = {
  subject: string
  predicate: string
  object: string
}

export type PalaceContext = {
  locus: PalaceLocus
  systemBlock: string
  miss: boolean
  hits: MemPalaceHit[]
  facts: KgFact[]
}

export type PalaceReflection =
  | { ok: true }
  | { ok: false; reason: string; nudge: string }

const PALACE_CLAIM =
  /\b(we decided|we chose|our preference|i prefer|the palace (?:says|shows|has)|previously we|last time we|you (?:said|decided)|according to (?:the )?(?:palace|memory))\b/i

const SECRET =
  /\b(api[_ -]?key|password|passwd|secret|credential|access[_ -]?token|bearer\s+[a-z0-9._-]{8,})\b/i
const EPHEMERAL = /\b(searching now|one moment|running (?:the )?tests?|still working)\b/i
const DURABLE =
  /\b(we decided|decided to|decision is|i prefer|we prefer|from now on|always use|locked in|remember that|the spec is)\b/i
const WORLD_ONLY =
  /^(?:what is|who is|who was|define|explain|how does https?|what are)\b/i

let wakeCache: { at: number; block: string } | null = null

export function clip(text: string, max: number): string {
  const clean = (text || '').replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  return `${clean.slice(0, Math.max(0, max - 1)).trim()}…`
}

export function bindLocus(text: string): PalaceLocus {
  const q = (text || '').trim()
  const mentionsPalace = /\bmempalace\b/i.test(q)
  const mentionsWorkflow = /\b(response workflow|agentic|orchestrator|this (?:repo|project|app)|our agent|aiui)\b/i.test(q)
  const personal =
    /\b(my preference|i prefer|we decided|we chose|last time|previously|remember when|you said|our decision)\b/i.test(q)
  const projectOrPersonal = mentionsPalace || mentionsWorkflow || personal
  const palaceFirst = projectOrPersonal && !(WORLD_ONLY.test(q) && !projectOrPersonal)
  const rooms: string[] = []
  if (mentionsPalace) rooms.push(ROOM_MEMPALACE)
  if (mentionsWorkflow || /\bresponse[- ]workflow\b/i.test(q)) rooms.push(ROOM_RESPONSE_WORKFLOW)
  const halls: string[] = []
  if (/\b(prefer|preference|always|from now on)\b/i.test(q)) halls.push('hall_preferences')
  if (/\b(decided|decision|chose|locked)\b/i.test(q)) halls.push('hall_facts')
  if (halls.length === 0 && palaceFirst) halls.push('hall_discoveries')
  const needsPathway =
    palaceFirst &&
    ((rooms.length >= 2) || /\b(connect|relate|pathway|tunnel|how does .+ (?:use|fit))\b/i.test(q))
  return {
    palaceFirst,
    needsPathway,
    wings: palaceFirst ? [WING_AGENT_DESIGN] : [],
    rooms,
    halls,
  }
}

export function consolidationPlan(userText: string, now = new Date()): ConsolidationPlan | null {
  const text = (userText || '').trim()
  if (!text || SECRET.test(text) || EPHEMERAL.test(text) || !DURABLE.test(text)) return null
  const locus = bindLocus(text)
  if (!locus.palaceFirst || locus.rooms.length === 0) return null
  const room = locus.rooms[0]
  const hall = locus.halls[0] || 'hall_facts'
  const chosen = text.match(/\b(?:decided to use|chose|using)\s+([A-Za-z0-9_.:-]{2,40})/i)
  const valid_from = now.toISOString().slice(0, 10)
  return {
    wing: locus.wings[0],
    room,
    hall,
    drawer: clip(text, 1500),
    triple: chosen
      ? { subject: room, predicate: 'uses', object: chosen[1], valid_from }
      : null,
    diary: `${hall} | ${room} | verbatim drawer filed | ${valid_from}`,
  }
}

export function formatWakeBlock(statusLine: string): string {
  const identity = clip(PALACE_L0, L0_CHAR_CAP)
  const story = clip(PALACE_L1, L1_CHAR_CAP)
  const block = [
    '=== PALACE WAKE (L0+L1) ===',
    `L0: ${identity}`,
    `L1: ${story}`,
    statusLine ? `Status: ${statusLine}` : '',
    'Do not search until a wing and room are bound. Do not invent palace facts.',
  ]
    .filter(Boolean)
    .join('\n')
  return clip(block, WAKE_CHAR_CAP)
}

export function formatRecallBlock(locus: PalaceLocus, hits: MemPalaceHit[], pathwayNote: string): string {
  const place = `${locus.wings.join(', ')} / ${locus.rooms.join(', ') || 'unscoped'}`
  if (hits.length === 0) {
    return [
      `Palace search (${place}): not in the palace.`,
      'Do not invent a prior decision, preference, or project fact.',
      pathwayNote,
    ]
      .filter(Boolean)
      .join('\n')
  }
  const lines = hits.slice(0, 3).map((hit) => {
    const id = hit.source_file ? ` drawer=${hit.source_file}` : ''
    return `[${hit.wing}/${hit.room}${id}] ${clip(hit.text || '', 220)}`
  })
  return [`Palace evidence (${place}):`, ...lines, pathwayNote].filter(Boolean).join('\n')
}

export function factsFromKg(result: unknown): KgFact[] {
  const root = (result || {}) as { facts?: unknown; result?: { facts?: unknown } }
  const list = Array.isArray(root.facts)
    ? root.facts
    : Array.isArray(root.result?.facts)
      ? root.result.facts
      : []
  return list
    .map((item) => {
      const fact = item as { subject?: string; predicate?: string; object?: string }
      if (!fact?.subject || !fact?.predicate || !fact?.object) return null
      return { subject: fact.subject, predicate: fact.predicate, object: fact.object }
    })
    .filter((fact): fact is KgFact => Boolean(fact))
}

export function roomsFromTraverse(result: unknown): string[] {
  const found = new Set<string>()
  const visit = (node: unknown) => {
    if (!node || found.size >= 8) return
    if (Array.isArray(node)) {
      node.forEach(visit)
      return
    }
    if (typeof node !== 'object') return
    const record = node as { room?: unknown; start_room?: unknown }
    for (const key of ['room', 'start_room'] as const) {
      if (typeof record[key] === 'string' && record[key]) found.add(record[key] as string)
    }
    for (const value of Object.values(record)) {
      if (value && typeof value === 'object') visit(value)
    }
  }
  visit(result)
  return [...found]
}

export function reflectPalaceDraft(
  draft: string,
  ctx: { locus: PalaceLocus; miss: boolean; facts: KgFact[] },
): PalaceReflection {
  if (!ctx.locus.palaceFirst) return { ok: true }
  const text = draft || ''
  const claims = PALACE_CLAIM.test(text)
  const admitsMiss = /not in the palace/i.test(text)
  if (ctx.miss && ctx.facts.length === 0 && claims && !admitsMiss) {
    return {
      ok: false,
      reason: 'personal or project claim with no drawer and no valid KG triple',
      nudge:
        'Reflection failed (1 cycle). You stated a past decision, preference, or palace fact, but this turn opened no drawer and no valid knowledge-graph triple. Rewrite the answer. Say “not in the palace” for that claim. Do not invent a room, tunnel, or decision. Separate what you can see in the repo from what the palace did not contain.',
    }
  }
  if (!ctx.miss && ctx.facts.length > 0 && admitsMiss) {
    const belief = ctx.facts
      .slice(0, 3)
      .map((fact) => `(${fact.subject}, ${fact.predicate}, ${fact.object})`)
      .join('; ')
    return {
      ok: false,
      reason: 'answer contradicts a still-valid KG triple',
      nudge: `Reflection failed (1 cycle). The knowledge graph still has: ${belief}. Do not say the palace is empty. Revise the answer to match those triples or say they must be invalidated before a new decision is stored.`,
    }
  }
  return { ok: true }
}

export function resetPalaceWakeCache() {
  wakeCache = null
}

export async function preparePalaceContext(text: string): Promise<PalaceContext> {
  const locus = bindLocus(text)
  const now = Date.now()
  let wake = wakeCache && now - wakeCache.at < WAKE_TTL_MS ? wakeCache.block : ''
  if (!wake) {
    let statusLine = 'status unavailable'
    try {
      const status = await getMempalaceStatus()
      const wings = Object.keys(status.wings || {}).length
      statusLine = `${status.totalDrawers} drawers, ${wings} wings`
    } catch {
      statusLine = 'status unavailable'
    }
    wake = formatWakeBlock(statusLine)
    wakeCache = { at: now, block: wake }
  }

  if (!locus.palaceFirst) {
    return { locus, systemBlock: wake, miss: false, hits: [], facts: [] }
  }

  const wing = locus.wings[0]
  const startRoom = locus.rooms[0]
  let searchRooms = locus.rooms.slice(0, 2)
  let pathwayNote = ''

  if (locus.needsPathway && startRoom) {
    const walked = await traversePalace(startRoom, 2)
    if (walked.ok) {
      const hopped = roomsFromTraverse(walked.result)
      if (hopped.length > 0) searchRooms = hopped.slice(0, 4)
      const hopList = hopped.length > 0 ? hopped.join(' → ') : 'no connected rooms returned'
      pathwayNote = `Pathway walk from ${startRoom} (max 2 hops): ${hopList}. Tunnels are related context, not proof.`
    } else {
      pathwayNote = `Pathway walk from ${startRoom} was unavailable. No tunnel was invented.`
    }
  }

  const facts: KgFact[] = []
  for (const entity of searchRooms) {
    const queried = await queryKnowledge(entity)
    if (queried.ok) facts.push(...factsFromKg(queried.result))
  }

  let hits: MemPalaceHit[] = []
  const room = searchRooms[0]
  try {
    const found = await searchMemory(text, { wing, room, limit: 3 })
    hits = (found.results || [])
      .filter((hit) => (hit.text || '').trim().length > 40)
      .filter((hit) => hit.similarity == null || hit.similarity >= 0.35)
      .slice(0, 3)
  } catch {
    hits = []
  }

  const belief =
    facts.length === 0
      ? 'Knowledge graph: no valid triples for the bound rooms.'
      : `Knowledge graph (current beliefs): ${facts
          .slice(0, 4)
          .map((fact) => `(${fact.subject}, ${fact.predicate}, ${fact.object})`)
          .join('; ')}`
  const recall = formatRecallBlock(locus, hits, [pathwayNote, belief].filter(Boolean).join('\n'))
  return {
    locus,
    systemBlock: `${wake}\n\n${recall}`,
    miss: hits.length === 0 && facts.length === 0,
    hits,
    facts,
  }
}

export async function consolidateDurableTurn(userText: string): Promise<{ wrote: boolean; reason: string }> {
  const plan = consolidationPlan(userText)
  if (!plan) return { wrote: false, reason: 'not durable' }
  const drawer = await addDrawer({
    wing: plan.wing,
    room: plan.room,
    content: plan.drawer,
  })
  if (plan.triple) {
    await addKnowledgeTriple(plan.triple)
  }
  await recordDiary(AGENT_NAME, plan.diary, plan.hall, plan.wing)
  if (!drawer.ok) return { wrote: false, reason: drawer.error || 'drawer write failed' }
  return { wrote: true, reason: `${plan.wing}/${plan.room}/${plan.hall}` }
}
