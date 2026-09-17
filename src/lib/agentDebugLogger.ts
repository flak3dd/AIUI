/**
 * Real-time AI Agent Debug Logger for web-api-app.
 * Transmits non-blocking telemetry and response traces to the local Agent Monitor (:17335).
 */

const MONITOR_ENDPOINT = 'http://127.0.0.1:17335/api/agent/event'

export interface AgentDebugEvent {
  type: 'request' | 'response' | 'tool_call' | 'tool_result' | 'anti_loop' | 'error'
  sessionId?: string
  model?: string
  provider?: string
  round?: number
  userPrompt?: string
  responseText?: string
  thinking?: string
  toolName?: string
  toolArgs?: unknown
  target?: string
  exitCode?: number
  stdout?: string
  stderr?: string
  durationMs?: number
  tokens?: number
  analysis?: unknown
  error?: string
  timestamp?: number
}

/**
 * Fire-and-forget non-blocking dispatch to the local debug monitor daemon.
 * If the monitor is stopped, this safely fails silently without impacting user UX.
 */
export function sendAgentDebugEvent(event: AgentDebugEvent): void {
  const payload = {
    ...event,
    timestamp: event.timestamp || Date.now(),
  }

  // Also log to browser developer console for local tab debugging
  if (typeof window !== 'undefined' && (window as any).__DEBUG_AGENT__) {
    console.log(`[AgentDebug:${event.type}]`, payload)
  }

  try {
    fetch(MONITOR_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      mode: 'cors',
    }).catch(() => {
      // Monitor offline or port closed — intentionally ignored
    })
  } catch {
    // Intentionally ignored
  }
}
