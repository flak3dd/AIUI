import React, { useState } from 'react'
import type { UiMessage } from '../types/ui'

export interface AgentBashWorkingsSectionProps {
  messages: UiMessage[]
  copiedCellKey: string | null
  onCopyCode: (cellKey: string, code: string) => void
}

interface ParsedBashCommand {
  id: string
  name: string
  command: string
  exitCode: number
  ok: boolean
  durationMs?: number
  target?: string
  stdout: string
  stderr: string
}

export const AgentBashWorkingsSection: React.FC<AgentBashWorkingsSectionProps> = ({
  messages,
  copiedCellKey,
  onCopyCode,
}) => {
  const [expanded, setExpanded] = useState(true)
  const [copiedAll, setCopiedAll] = useState(false)

  const commands = React.useMemo<ParsedBashCommand[]>(() => {
    return messages.map((m) => {
      if (m.execResult) {
        return {
          id: m.id,
          name: m.name || 'bash',
          command: m.execResult.command || 'bash',
          exitCode: m.execResult.exitCode ?? 0,
          ok: m.execResult.ok,
          durationMs: m.execResult.durationMs,
          target: m.execResult.target,
          stdout: m.execResult.stdout || '',
          stderr: m.execResult.stderr || '',
        }
      }

      // Try parsing JSON or raw content
      let command = m.name || 'tool'
      let stdout = m.content
      let stderr = ''
      let exitCode = 0
      let ok = true
      let durationMs: number | undefined
      let target: string | undefined

      try {
        const cleanContent = m.content.replace(/^==>\s*[a-zA-Z0-9_]+:\s*/i, '').trim()
        const parsed = JSON.parse(cleanContent)
        if (parsed && typeof parsed === 'object') {
          if (parsed.command) command = String(parsed.command)
          if (parsed.exitCode !== undefined) exitCode = Number(parsed.exitCode)
          if (parsed.ok !== undefined) ok = Boolean(parsed.ok)
          if (parsed.durationMs !== undefined) durationMs = Number(parsed.durationMs)
          if (parsed.target) target = String(parsed.target)
          if (parsed.stdout !== undefined) stdout = String(parsed.stdout)
          if (parsed.stderr !== undefined) stderr = String(parsed.stderr)
        }
      } catch {
        // Raw content fallback
      }

      return {
        id: m.id,
        name: m.name || 'bash',
        command,
        exitCode,
        ok: ok && exitCode === 0,
        durationMs,
        target,
        stdout,
        stderr,
      }
    })
  }, [messages])

  const allPassed = commands.every((c) => c.ok)
  const totalDuration = commands.reduce((acc, c) => acc + (c.durationMs || 0), 0)

  const handleCopyAll = (e: React.MouseEvent) => {
    e.stopPropagation()
    const allBashScript = commands
      .map((c) => `# Command (${c.name}) - exit ${c.exitCode}\n${c.command}`)
      .join('\n\n')
    navigator.clipboard.writeText(allBashScript)
    setCopiedAll(true)
    setTimeout(() => setCopiedAll(false), 1500)
  }

  if (commands.length === 0) return null

  return (
    <div className={`agent-bash-section-card ${expanded ? 'expanded' : 'collapsed'}`}>
      <div className="agent-bash-header" onClick={() => setExpanded(!expanded)}>
        <div className="agent-bash-header-left">
          <span className="agent-bash-term-icon">❯_</span>
          <span className="agent-bash-title">Agent Bash Workings</span>
          <span className="agent-bash-badge">
            {commands.length} {commands.length === 1 ? 'command' : 'commands'}
          </span>
          <span className={`agent-bash-status-pill ${allPassed ? 'status-ok' : 'status-fail'}`}>
            {allPassed ? '✓ All Passed' : '⚠ Non-zero Exit'}
          </span>
          {totalDuration > 0 && (
            <span className="agent-bash-duration">{totalDuration}ms total</span>
          )}
        </div>

        <div className="agent-bash-header-right" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className="agent-bash-btn-copy"
            onClick={handleCopyAll}
            title="Copy all commands in this section"
          >
            {copiedAll ? '✔ Copied All' : 'Copy All Commands'}
          </button>
          <button
            type="button"
            className="agent-bash-toggle-btn"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? '▲ Hide Workings' : '▼ View Workings'}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="agent-bash-body">
          {commands.map((cmd, idx) => {
            const cellKey = `bash_cmd_${cmd.id}_${idx}`
            const isCopied = copiedCellKey === cellKey
            const outputText = cmd.stderr ? `${cmd.stdout}\n[STDERR]\n${cmd.stderr}` : cmd.stdout

            return (
              <div key={cmd.id || idx} className="agent-bash-entry">
                <div className="agent-bash-cmd-line">
                  <div className="agent-bash-cmd-meta">
                    <span className="agent-bash-prompt">$</span>
                    <span className="agent-bash-cmd-text">{cmd.command}</span>
                  </div>
                  <div className="agent-bash-cmd-actions">
                    <span
                      className={`agent-bash-exit-badge ${cmd.ok ? 'exit-ok' : 'exit-fail'}`}
                    >
                      exit {cmd.exitCode}
                    </span>
                    {cmd.durationMs !== undefined && (
                      <span className="agent-bash-time">{cmd.durationMs}ms</span>
                    )}
                    {cmd.target && <span className="agent-bash-target">{cmd.target}</span>}
                    <button
                      type="button"
                      className="agent-bash-mini-copy"
                      onClick={() => onCopyCode(cellKey, cmd.command)}
                      title="Copy command"
                    >
                      {isCopied ? '✔' : 'Copy'}
                    </button>
                  </div>
                </div>

                {outputText && outputText.trim() && (
                  <pre className="agent-bash-output">{outputText.trim()}</pre>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
