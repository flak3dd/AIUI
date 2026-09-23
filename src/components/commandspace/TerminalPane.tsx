import React, { useRef, useEffect, useState } from 'react'
import type { TerminalPaneData } from '../../lib/commandSpaceEngine'
import { TerminalHeatmap } from './TerminalHeatmap'

export interface TerminalPaneProps {
  pane: TerminalPaneData
  onClose?: (id: string) => void
  onToggleMaximize?: (id: string) => void
  onAutoHeal?: (command: string, errorText: string) => void
}

export const TerminalPane: React.FC<TerminalPaneProps> = ({
  pane,
  onClose,
  onToggleMaximize,
  onAutoHeal,
}) => {
  const terminalBodyRef = useRef<HTMLDivElement | null>(null)
  const [paused, setPaused] = useState<boolean>(false)
  const [highlightedLineIdx, setHighlightedLineIdx] = useState<number | null>(null)
  const [copied, setCopied] = useState<boolean>(false)

  const isError = pane.state === 'error' || (pane.exitCode !== null && pane.exitCode !== 0)
  const isStreaming = pane.state === 'streaming'
  const isCompleted = pane.state === 'completed'

  // Auto-scroll to bottom unless user paused or jumped to a line
  useEffect(() => {
    if (!paused && terminalBodyRef.current) {
      terminalBodyRef.current.scrollTop = terminalBodyRef.current.scrollHeight
    }
  }, [pane.lines, pane.stdout, paused])

  const handleJumpToLine = (lineIdx: number) => {
    setPaused(true)
    setHighlightedLineIdx(lineIdx)

    if (terminalBodyRef.current) {
      const lineElements = terminalBodyRef.current.querySelectorAll('.terminal-line')
      const targetEl = lineElements[lineIdx] as HTMLElement | undefined
      if (targetEl) {
        targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
      } else {
        // Fallback ratio scroll
        const total = pane.lines.length || 1
        terminalBodyRef.current.scrollTop = (lineIdx / total) * terminalBodyRef.current.scrollHeight
      }
    }

    setTimeout(() => {
      setHighlightedLineIdx(null)
    }, 2500)
  }

  const handleCopy = () => {
    const text = pane.stdout || pane.stderr || pane.lines.map((l) => l.text).join('\n')
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div
      className={`commandspace-terminal-pane state-${pane.state} ${pane.maximized ? 'pane-maximized' : ''} ${isError ? 'pane-error-highlight' : ''}`}
    >
      {/* Pane Header */}
      <div className="terminal-pane-header">
        <div className="terminal-pane-header-left">
          <span className="terminal-prompt-symbol">$</span>
          <span className="terminal-pane-cmd" title={pane.command}>
            {pane.command || 'bash'}
          </span>

          {/* Status Badge */}
          {isStreaming && (
            <span className="pane-badge badge-streaming">
              <span className="badge-pulse-dot" /> STREAMING
            </span>
          )}
          {isCompleted && (
            <span className="pane-badge badge-completed">✓ EXIT 0</span>
          )}
          {isError && (
            <span className="pane-badge badge-error">
              ✖ EXIT {pane.exitCode ?? 1} (CRITICAL)
            </span>
          )}

          {pane.durationMs !== undefined && (
            <span className="pane-duration">{pane.durationMs}ms</span>
          )}

          {pane.target && (
            <span className="pane-target-tag">@{pane.target}</span>
          )}
        </div>

        <div className="terminal-pane-header-right">
          {/* Auto-Heal shortcut on failure */}
          {isError && onAutoHeal && (
            <button
              type="button"
              className="btn-pane-action btn-heal"
              onClick={() => onAutoHeal(pane.command, pane.stderr || pane.stdout)}
              title="Instruct agent to auto-heal this traceback error"
            >
              ⚡ Auto-Heal
            </button>
          )}

          {/* Pause / Resume Scroll */}
          <button
            type="button"
            className={`btn-pane-action ${paused ? 'active-paused' : ''}`}
            onClick={() => setPaused(!paused)}
            title={paused ? 'Resume auto-scroll' : 'Pause auto-scroll'}
          >
            {paused ? '▶ Resume' : '⏸ Pause'}
          </button>

          {/* Copy Button */}
          <button
            type="button"
            className="btn-pane-action"
            onClick={handleCopy}
            title="Copy output to clipboard"
          >
            {copied ? '✔ Copied' : '📋 Copy'}
          </button>

          {/* Maximize / Restore */}
          {onToggleMaximize && (
            <button
              type="button"
              className="btn-pane-action"
              onClick={() => onToggleMaximize(pane.id)}
              title={pane.maximized ? 'Restore tile layout' : 'Maximize pane'}
            >
              {pane.maximized ? '⧉ Restore' : '⛶ Max'}
            </button>
          )}

          {/* Close Pane */}
          {onClose && (
            <button
              type="button"
              className="btn-pane-close"
              onClick={() => onClose(pane.id)}
              title="Close pane"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Pane Workspace: Body + Heatmap Gutter */}
      <div className="terminal-pane-workspace">
        <div ref={terminalBodyRef} className="terminal-pane-output-scroll">
          {pane.lines.length === 0 ? (
            <div className="terminal-empty-placeholder">
              {isStreaming ? 'Awaiting initial stdout stream...' : 'Process exited with empty output.'}
            </div>
          ) : (
            pane.lines.map((line, idx) => {
              const isTargeted = highlightedLineIdx === idx
              return (
                <div
                  key={line.id || idx}
                  className={`terminal-line line-${line.type} ${isTargeted ? 'line-jump-highlight' : ''}`}
                >
                  <span className="line-num">{line.lineNumber}</span>
                  <span className="line-content">{line.text || '\u00A0'}</span>
                </div>
              )
            })
          )}
        </div>

        {/* Integrated Terminal Minimap Heatmap */}
        <TerminalHeatmap
          segments={pane.heatmap}
          totalLines={pane.lines.length}
          onJumpToLine={handleJumpToLine}
        />
      </div>

      {/* Paused Notification Pill */}
      {paused && (
        <div className="terminal-paused-toast" onClick={() => setPaused(false)}>
          <span>Auto-scroll paused · Click to resume</span>
        </div>
      )}
    </div>
  )
}
