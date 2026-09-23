/** L0 identity. Always loaded. Keep under ~100 tokens. */
export const PALACE_L0 = `AIUI is a local chat and CLI agent. MemPalace is its long-term spatial memory. Project wing: wing_agent_design. Rooms: response-workflow, mempalace-integration.`

/** L1 story. Always loaded. Keep under ~800 tokens. */
export const PALACE_L1 = `The target response loop wakes L0 and L1 only, binds a wing and room, then answers. Personal or project claims require a drawer or knowledge-graph hit, or an explicit miss. Durable decisions write the user's words as a drawer, a timed triple, and a diary line. Hop cap is 2. Secrets and duplicates are not stored.`

export const WING_AGENT_DESIGN = 'wing_agent_design'
export const ROOM_RESPONSE_WORKFLOW = 'response-workflow'
export const ROOM_MEMPALACE = 'mempalace-integration'
