/**
 * Chat History & Multi-Session Persistence for Ablit Web API App.
 * Manages conversation sessions in browser localStorage with title generation,
 * pinning, searching, forking, and markdown/JSON export.
 */

export interface StoredUiMessage {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  execResult?: any
}

export interface ChatSession {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  model: string
  provider: string
  messages: StoredUiMessage[]
  pinned?: boolean
}

const STORAGE_KEY = 'ablit_chat_sessions_v2'
const ACTIVE_SESSION_KEY = 'ablit_active_session_id_v2'

export function generateTitle(firstUserMsg: string): string {
  const clean = firstUserMsg
    .replace(/^==>\s*/, '')
    .replace(/^❯\s*/, '')
    .trim()
  if (!clean) return 'New Conversation'
  const firstLine = clean.split('\n')[0].trim()
  if (firstLine.length <= 42) return firstLine
  return `${firstLine.slice(0, 39)}…`
}

export function loadAllSessions(): ChatSession[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      return parsed.sort((a, b) => {
        if (a.pinned && !b.pinned) return -1
        if (!a.pinned && b.pinned) return 1
        return b.updatedAt - a.updatedAt
      })
    }
    return []
  } catch (err) {
    console.error('[ChatHistory] Failed to load sessions:', err)
    return []
  }
}

export function saveSession(session: ChatSession): void {
  try {
    const sessions = loadAllSessions()
    const idx = sessions.findIndex((s) => s.id === session.id)
    if (idx >= 0) {
      sessions[idx] = { ...session, updatedAt: Date.now() }
    } else {
      sessions.unshift({ ...session, updatedAt: Date.now() })
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions))
  } catch (err) {
    console.error('[ChatHistory] Failed to save session:', err)
  }
}

export function deleteSession(sessionId: string): ChatSession[] {
  try {
    const sessions = loadAllSessions().filter((s) => s.id !== sessionId)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions))
    if (getActiveSessionId() === sessionId) {
      const nextActive = sessions[0]?.id || null
      if (nextActive) {
        setActiveSessionId(nextActive)
      } else {
        localStorage.removeItem(ACTIVE_SESSION_KEY)
      }
    }
    return sessions
  } catch (err) {
    console.error('[ChatHistory] Failed to delete session:', err)
    return loadAllSessions()
  }
}

export function clearAllSessions(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
    localStorage.removeItem(ACTIVE_SESSION_KEY)
  } catch (err) {
    console.error('[ChatHistory] Failed to clear sessions:', err)
  }
}

export function createNewSession(
  initialMessages: StoredUiMessage[] = [],
  model = 'qwen-abliterated',
  provider = 'local_vllm',
  title = 'New Conversation',
): ChatSession {
  const newSession: ChatSession = {
    id: `sess_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    title,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    model,
    provider,
    messages: initialMessages,
    pinned: false,
  }
  saveSession(newSession)
  setActiveSessionId(newSession.id)
  return newSession
}

export function getActiveSessionId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_SESSION_KEY)
  } catch {
    return null
  }
}

export function setActiveSessionId(id: string): void {
  try {
    localStorage.setItem(ACTIVE_SESSION_KEY, id)
  } catch {
    /* ignore */
  }
}

export function updateSessionTitle(sessionId: string, newTitle: string): void {
  const sessions = loadAllSessions()
  const s = sessions.find((x) => x.id === sessionId)
  if (s) {
    s.title = newTitle.trim() || 'Untitled Conversation'
    s.updatedAt = Date.now()
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions))
  }
}

export function togglePinSession(sessionId: string): ChatSession[] {
  const sessions = loadAllSessions()
  const s = sessions.find((x) => x.id === sessionId)
  if (s) {
    s.pinned = !s.pinned
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions))
  }
  return loadAllSessions()
}

export function exportSessionAsMarkdown(session: ChatSession): string {
  const lines: string[] = []
  lines.push(`# ${session.title}`)
  lines.push(`- **Session ID**: \`${session.id}\``)
  lines.push(`- **Model**: \`${session.model}\` (${session.provider})`)
  lines.push(`- **Date**: ${new Date(session.createdAt).toLocaleString()}`)
  lines.push(`- **Messages**: ${session.messages.length}`)
  lines.push('\n---\n')

  for (const msg of session.messages) {
    if (msg.role === 'user') {
      lines.push(`### ❯ User\n\n${msg.content}\n`)
    } else if (msg.role === 'assistant') {
      lines.push(`### 🤖 Assistant (${session.model})\n\n${msg.content}\n`)
    } else if (msg.role === 'tool') {
      lines.push(`### ⚡ Tool Execution\n\n\`\`\`\n${msg.content}\n\`\`\`\n`)
    }
  }
  return lines.join('\n')
}

export function exportSessionAsJson(session: ChatSession): string {
  return JSON.stringify(session, null, 2)
}

export function downloadTextFile(filename: string, content: string, mimeType = 'text/plain') {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
