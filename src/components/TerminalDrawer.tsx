import React from 'react'
import type { BashExecResult, ExecutionTarget, SandboxStatus } from '../lib/bashShell'

export interface TerminalDrawerProps {
  open: boolean
  onClose: () => void
  bashTarget: ExecutionTarget
  handleTargetChange: (t: ExecutionTarget) => void
  termInput: string
  setTermInput: (v: string) => void
  executingCmd: boolean
  runBashCommand: (cmd: string, target?: ExecutionTarget) => Promise<BashExecResult>
  terminalLogs: BashExecResult[]
  setTerminalLogs: React.Dispatch<React.SetStateAction<BashExecResult[]>>
  collapsedOutputs: Record<number, boolean>
  copiedLogIdx: number | null
  termHeightMode: 'compact' | 'standard' | 'maximized' | 'docked'
  setTermHeightMode: React.Dispatch<React.SetStateAction<'compact' | 'standard' | 'maximized' | 'docked'>>
  handleInspectDuckDb: () => void
  handleAutoHeal: (cmd: string, stderr: string) => void
  sandboxStatus: SandboxStatus | null
  termBodyRef: React.RefObject<HTMLDivElement | null>
  handleTermKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
  handleCopyOutput: (text: string, idx: number) => void
  toggleCollapseOutput: (idx: number) => void
}

export function TerminalDrawer(props: TerminalDrawerProps) {
  const {
    open,
    onClose,
    bashTarget,
    handleTargetChange,
    termInput,
    setTermInput,
    executingCmd,
    runBashCommand,
    terminalLogs,
    setTerminalLogs,
    collapsedOutputs,
    copiedLogIdx,
    termHeightMode,
    setTermHeightMode,
    handleInspectDuckDb,
    handleAutoHeal,
    sandboxStatus,
    termBodyRef,
    handleTermKeyDown,
    handleCopyOutput,
    toggleCollapseOutput,
  } = props

  if (!open) return null

  return (
    <div className="terminal-drawer" role="dialog" aria-label="Terminal console">
      <div
        className={`terminal-flip-capsule ${
          termHeightMode === 'docked'
            ? 'height-docked'
            : termHeightMode === 'compact'
            ? 'height-compact'
            : termHeightMode === 'maximized'
            ? 'height-maximized'
            : 'height-standard'
        }`}
      >
        <div className="terminal-mobile-drag-bar" aria-hidden="true">
          <span className="terminal-drag-handle" />
        </div>
        <div className="terminal-header">
          <div className="terminal-title-group">
            <span className="term-beacon-dot" />
            <span>{termHeightMode === 'docked' ? 'TERMINAL DOCK' : 'TERMINAL CONSOLE'}</span>
            <span
              className={`term-target-badge ${
                bashTarget === 'dgx_spark' ? 'spark' : bashTarget === 'container' ? 'pod' : ''
              }`}
            >
              {bashTarget === 'dgx_spark'
                ? '⚡ SPARK'
                : bashTarget === 'container'
                ? '📦 POD'
                : '💻 MAC'}
            </span>
            <span style={{ fontSize: 10, color: 'var(--text-dim)', fontWeight: 400 }}>
              {termHeightMode === 'docked' && terminalLogs.length > 0
                ? `Last: ${terminalLogs[terminalLogs.length - 1].command.slice(0, 32)} (EXIT ${terminalLogs[terminalLogs.length - 1].exitCode ?? 0})`
                : sandboxStatus?.online
                ? `(:17330 · ${sandboxStatus.latencyMs}ms)`
                : '(:17330 offline)'}
            </span>
          </div>

          <div className="terminal-controls-row">
            <div className="term-quick-chips">
              <button
                type="button"
                className="term-chip"
                onClick={() =>
                  void runBashCommand('uname -a && uptime && python3 --version', bashTarget)
                }
                disabled={executingCmd}
                title="Run diagnostics on selected target"
              >
                🩺 Doctor
              </button>
              <button
                type="button"
                className="term-chip"
                onClick={() => {
                  if (bashTarget !== 'container') handleTargetChange('container')
                  void runBashCommand(
                    'python3 -c "import duckdb, pandas, numpy, sys; print(f\'✅ Linux Pod Active: Python {sys.version.split()[0]} | DuckDB {duckdb.__version__} | Pandas {pandas.__version__}\')"',
                    'container',
                  )
                }}
                disabled={executingCmd}
                title="Execute inside isolated Linux Pod container"
              >
                📦 Pod Test
              </button>
              <button
                type="button"
                className="term-chip"
                onClick={() => void runBashCommand('ls -lah', bashTarget)}
                disabled={executingCmd}
                title="List directory contents"
              >
                📁 ls -la
              </button>
              <button
                type="button"
                className="term-chip"
                onClick={handleInspectDuckDb}
                disabled={executingCmd}
                title="Inspect DuckDB OCR Identity Index"
              >
                🦆 DuckDB
              </button>
              <button
                type="button"
                className="term-chip"
                onClick={() => setTerminalLogs([])}
                title="Clear console output"
              >
                🧹 Clear
              </button>
            </div>

            <select
              className="term-select-compact"
              value={bashTarget}
              onChange={(e) => handleTargetChange(e.target.value as ExecutionTarget)}
            >
              <option value="local_mac">Target: Local Mac (/tmp/spark-sandboxes)</option>
              <option value="dgx_spark">Target: GX10 DGX (flak3dd)</option>
              <option value="container">Target: 📦 Isolated Linux Pod</option>
            </select>

            {/* Height mode toggle */}
            <button
              type="button"
              className="term-btn-window"
              onClick={() =>
                setTermHeightMode((prev) =>
                  prev === 'compact'
                    ? 'standard'
                    : prev === 'standard'
                    ? 'maximized'
                    : prev === 'maximized'
                    ? 'docked'
                    : 'compact',
                )
              }
              title={`Current: ${termHeightMode}. Click to cycle height mode`}
            >
              {termHeightMode === 'compact'
                ? '⤢ Standard'
                : termHeightMode === 'standard'
                ? '◫ Maximize'
                : termHeightMode === 'maximized'
                ? '⎯ Dock Mini'
                : '▲ Compact'}
            </button>

            {/* Close back to chat */}
            <button
              type="button"
              className="btn-flip-mode to-chat"
              onClick={onClose}
              title="Close terminal (Ctrl+`)"
            >
              <span className="flip-icon-spin">✕</span>
              <span>CLOSE</span>
            </button>
          </div>
        </div>

        {termHeightMode !== 'docked' && (
          <>
            <div className="terminal-body" ref={termBodyRef}>
              {terminalLogs.length === 0 ? (
                <div className="term-empty-state">
                  <div className="term-empty-title">
                    <span>🛰️ READY · TARGET: {bashTarget.toUpperCase()}</span>
                  </div>
                  <div className="term-empty-suggestions">
                    <button
                      type="button"
                      className="term-empty-pill"
                      onClick={() => void runBashCommand('uname -a', bashTarget)}
                    >
                      uname -a
                    </button>
                    <button
                      type="button"
                      className="term-empty-pill"
                      onClick={() =>
                        void runBashCommand('nvidia-smi 2>&1 || echo "No local GPU"', bashTarget)
                      }
                    >
                      nvidia-smi
                    </button>
                    <button
                      type="button"
                      className="term-empty-pill"
                      onClick={() => void runBashCommand('ls -lah', bashTarget)}
                    >
                      ls -lah
                    </button>
                    <button
                      type="button"
                      className="term-empty-pill"
                      onClick={() => void runBashCommand('python3 --version', bashTarget)}
                    >
                      python3 --version
                    </button>
                  </div>
                </div>
              ) : (
                terminalLogs.map((log, idx) => {
                  const isCollapsed = collapsedOutputs[idx] ?? false
                  const outputText = (log.stdout || '').trim()
                  const lineCount = outputText ? outputText.split('\n').length : 0
                  const canCollapse = lineCount > 8

                  return (
                    <div key={idx} className={`term-entry ${log.ok ? 'ok' : 'error'}`}>
                      <div className="term-entry-header">
                        <div className="term-entry-cmd-block">
                          <span className="term-cmd-sigil">❯</span>
                          <span className="term-cmd-text">{log.command}</span>
                        </div>
                        <div className="term-entry-meta">
                          <span className={`term-pill-status ${log.ok ? '' : 'err'}`}>
                            {log.ok ? `EXIT ${log.exitCode ?? 0}` : `ERR ${log.exitCode ?? 1}`}
                          </span>
                          <span className="term-pill-meta">⏱ {log.durationMs ?? 0}ms</span>
                          <span className="term-pill-meta">keg:{log.target}</span>

                          {outputText && (
                            <button
                              type="button"
                              className="term-btn-action"
                              onClick={() => handleCopyOutput(outputText, idx)}
                              title="Copy stdout to clipboard"
                            >
                              {copiedLogIdx === idx ? '✓ Copied' : '📋 Copy'}
                            </button>
                          )}

                          {canCollapse && (
                            <button
                              type="button"
                              className="term-btn-action"
                              onClick={() => toggleCollapseOutput(idx)}
                              title={isCollapsed ? 'Expand output' : 'Collapse output'}
                            >
                              {isCollapsed ? `▼ Show all (${lineCount} lines)` : '▲ Collapse'}
                            </button>
                          )}

                          {!log.ok && (
                            <button
                              type="button"
                              className="btn-auto-heal"
                              onClick={() => handleAutoHeal(log.command, log.stderr || log.stdout)}
                              title="Ask assistant to diagnose and auto-fix this error"
                            >
                              ⚡ Auto-Fix
                            </button>
                          )}
                        </div>
                      </div>

                      {log.stdout && (
                        <pre className={`term-output ${isCollapsed ? 'collapsed' : ''}`}>
                          {log.stdout}
                        </pre>
                      )}
                      {log.stderr && <pre className="term-stderr">{log.stderr}</pre>}
                    </div>
                  )
                })
              )}

              {executingCmd && (
                <div
                  style={{
                    color: 'var(--sat-cyan)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '4px 0',
                    fontSize: 11,
                  }}
                >
                  <span className="term-beacon-dot" />
                  <span>Executing process on target &lt;{bashTarget}&gt;…</span>
                </div>
              )}
            </div>

            {/* Quick suggestions strip */}
            <div className="term-suggestions-bar">
              <span className="term-sugg-label">Presets:</span>
              <button
                type="button"
                className="term-sugg-pill"
                onClick={() => void runBashCommand('ls -lah', bashTarget)}
              >
                📁 ls -lah
              </button>
              <button
                type="button"
                className="term-sugg-pill"
                onClick={() => void runBashCommand('git status --short', bashTarget)}
              >
                🌿 git status
              </button>
              <button
                type="button"
                className="term-sugg-pill"
                onClick={() => void runBashCommand('ps aux | head -n 10', bashTarget)}
              >
                ⚡ ps top 10
              </button>
              <button
                type="button"
                className="term-sugg-pill"
                onClick={() => void runBashCommand('df -h /', bashTarget)}
              >
                💾 disk space
              </button>
              <button
                type="button"
                className="term-sugg-pill"
                onClick={() =>
                  void runBashCommand(
                    'python3 -c "import torch; print(\'PyTorch:\', torch.__version__, \'CUDA Available:\', torch.cuda.is_available())" 2>&1 || echo "PyTorch not found"',
                    bashTarget,
                  )
                }
              >
                🔥 torch probe
              </button>
            </div>

            {/* Mobile Terminal Virtual Quick Keys */}
            <div className="term-mobile-keys">
              <button type="button" className="term-mobile-key" onClick={() => setTermInput('')}>ESC</button>
              <button type="button" className="term-mobile-key" onClick={() => setTermInput(termInput + '\t')}>TAB</button>
              <button type="button" className="term-mobile-key" onClick={() => void runBashCommand('^C', bashTarget)}>CTRL-C</button>
              <button type="button" className="term-mobile-key" onClick={() => setTerminalLogs([])}>CLEAR</button>
              <button type="button" className="term-mobile-key" onClick={() => void runBashCommand('ls -la', bashTarget)}>ls -la</button>
            </div>

            {/* Terminal Input Bar */}
            <form
              className="term-input-bar"
              onSubmit={(e) => {
                e.preventDefault()
                const cmd = termInput.trim()
                if (!cmd || executingCmd) return
                setTermInput('')
                void runBashCommand(cmd, bashTarget)
              }}
            >
              <span className="term-prompt">
                {bashTarget === 'dgx_spark' ? '⚡ spark' : bashTarget === 'container' ? '📦 pod' : '💻 mac'}{' '}
                ❯
              </span>
              <div className="term-input-field-wrap">
                <input
                  value={termInput}
                  onChange={(e) => setTermInput(e.target.value)}
                  onKeyDown={handleTermKeyDown}
                  placeholder="Enter bash command (↑/↓ for history, e.g. ls -la, python3 script.py, df -h)..."
                  disabled={executingCmd}
                />
                {termInput && (
                  <button
                    type="button"
                    className="term-btn-clear-input"
                    onClick={() => setTermInput('')}
                    title="Clear input"
                  >
                    ✕
                  </button>
                )}
              </div>
              <button
                type="submit"
                className="term-btn-submit"
                disabled={executingCmd || !termInput.trim()}
              >
                ⚡ EXEC
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
