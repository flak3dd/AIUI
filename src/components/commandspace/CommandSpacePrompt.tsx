import React, { useState, useRef, useEffect } from 'react'
import type { UiMessage } from '../../types/ui'

export interface CommandSpacePromptProps {
  busy: boolean
  onSend: (text: string) => Promise<void>
  onStop: () => void
  onClearCompleted?: () => void
  onToggleCodeCanvas?: () => void
  codeCanvasOpen?: boolean
  recentMessages?: UiMessage[]
  lastErrorCommand?: string
  lastErrorText?: string
  onAutoHeal?: (command: string, errorText: string) => void
}

export const CommandSpacePrompt: React.FC<CommandSpacePromptProps> = ({
  busy,
  onSend,
  onStop,
  onClearCompleted,
  onToggleCodeCanvas,
  codeCanvasOpen = true,
  recentMessages = [],
  lastErrorCommand,
  lastErrorText,
  onAutoHeal,
}) => {
  const [text, setText] = useState<string>('')
  const [history, setHistory] = useState<string[]>([])
  const [historyIdx, setHistoryIdx] = useState<number>(-1)
  const [hudOpen, setHudOpen] = useState<boolean>(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const hudEndRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (hudOpen && hudEndRef.current) {
      hudEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [recentMessages, hudOpen])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    } else if (e.key === 'ArrowUp') {
      if (history.length > 0 && historyIdx < history.length - 1) {
        const next = historyIdx + 1
        setHistoryIdx(next)
        setText(history[next])
      }
    } else if (e.key === 'ArrowDown') {
      if (historyIdx > 0) {
        const next = historyIdx - 1
        setHistoryIdx(next)
        setText(history[next])
      } else if (historyIdx === 0) {
        setHistoryIdx(-1)
        setText('')
      }
    } else if (e.key === 'Escape') {
      setHudOpen(false)
    }
  }

  const handleSubmit = async () => {
    const trimmed = text.trim()
    if (!trimmed || busy) return

    setHistory((prev) => [trimmed, ...prev.filter((h) => h !== trimmed)].slice(0, 40))
    setHistoryIdx(-1)
    setText('')
    await onSend(trimmed)
  }

  const isShellCommand = text.trim().startsWith('$') || text.trim().startsWith('>')
  const lastAssistantMsg = recentMessages.slice().reverse().find((m) => m.role === 'assistant' && m.name !== 'status_chip')

  return (
    <div className="commandspace-prompt-container">
      {/* Collapsible Dialogue HUD / Transcript Drawer */}
      {hudOpen && (
        <div className="commandspace-dialogue-hud">
          <div className="dialogue-hud-header">
            <span className="hud-header-title">💬 AGENT DIALOGUE & TRANSCRIPT STREAM</span>
            <div className="hud-header-actions">
              <span className="hud-msg-count">{recentMessages.length} messages</span>
              <button
                type="button"
                className="btn-hud-close"
                onClick={() => setHudOpen(false)}
                title="Collapse dialogue HUD (Esc)"
              >
                ✕
              </button>
            </div>
          </div>

          <div className="dialogue-hud-body">
            {recentMessages.length === 0 ? (
              <div className="hud-empty-state">No conversation history in this session yet.</div>
            ) : (
              recentMessages.map((msg) => (
                <div key={msg.id} className={`hud-message role-${msg.role}`}>
                  <div className="hud-msg-header">
                    <span className="hud-msg-role">
                      {msg.role === 'user' ? '👤 USER' : msg.role === 'tool' ? '⚡ TOOL EXEC' : '🤖 ABLITERATED AGENT'}
                    </span>
                    {msg.execResult?.target && (
                      <span className="hud-msg-target">@{msg.execResult.target}</span>
                    )}
                  </div>
                  <div className="hud-msg-content">{msg.content}</div>
                </div>
              ))
            )}
            <div ref={hudEndRef} />
          </div>
        </div>
      )}

      {/* Quick Action Chips & Controls */}
      <div className="commandspace-prompt-toolbar">
        <div className="prompt-toolbar-left">
          <button
            type="button"
            className={`btn-toolbar-chip ${hudOpen ? 'chip-active' : ''}`}
            onClick={() => setHudOpen(!hudOpen)}
            title="Toggle dialogue transcript HUD"
          >
            💬 Dialogue HUD {lastAssistantMsg ? '• Latest Reply' : ''}
          </button>

          {onToggleCodeCanvas && (
            <button
              type="button"
              className={`btn-toolbar-chip ${codeCanvasOpen ? 'chip-active' : ''}`}
              onClick={onToggleCodeCanvas}
              title="Toggle Ghost-Type Code Canvas"
            >
              ⚡ Code Canvas {codeCanvasOpen ? 'ON' : 'OFF'}
            </button>
          )}

          {onClearCompleted && (
            <button
              type="button"
              className="btn-toolbar-chip"
              onClick={onClearCompleted}
              title="Clear completed panes from auto-grid"
            >
              🧹 Clear Done
            </button>
          )}

          {lastErrorCommand && onAutoHeal && (
            <button
              type="button"
              className="btn-toolbar-chip chip-heal"
              onClick={() => onAutoHeal(lastErrorCommand, lastErrorText || '')}
              title="Trigger immediate agent self-healing on last failing command"
            >
              🩹 Auto-Heal Traceback
            </button>
          )}
        </div>

        <div className="prompt-toolbar-right">
          {busy && (
            <button
              type="button"
              className="btn-toolbar-chip chip-stop"
              onClick={onStop}
              title="Abort agent execution"
            >
              ⏹ Stop Agent
            </button>
          )}
        </div>
      </div>

      {/* Interactive Command & Conversation Input Bar */}
      <div className="commandspace-prompt-bar">
        <span className="prompt-prefix">
          {isShellCommand ? '$' : '❯'}
        </span>
        <input
          ref={inputRef}
          type="text"
          className="commandspace-prompt-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            busy
              ? 'Agent executing... type to queue or send instructions'
              : 'Ask the agent anything, or type "$ command" to run directly in the multiplexer…'
          }
          disabled={false}
          autoFocus
        />

        <button
          type="button"
          className="btn-commandspace-send"
          onClick={handleSubmit}
          disabled={!text.trim()}
          title="Send to agent (Enter)"
        >
          {busy ? 'Send' : '⚡ Execute'}
        </button>
      </div>
    </div>
  )
}
