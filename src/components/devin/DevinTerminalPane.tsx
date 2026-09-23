import React, { useState, useRef, useEffect } from 'react';
import type { BashExecResult, ExecutionTarget } from '../../lib/bashShell';
import { TerminalLineOutput } from '../terminal/TerminalLineOutput';

export interface DaemonInfo {
  id: string;
  command: string;
  pid?: number;
  port?: number;
  alive?: boolean;
  uptimeSeconds?: number;
}

export interface DevinTerminalPaneProps {
  logs: BashExecResult[];
  onClearLogs?: () => void;
  onRunCommand?: (cmd: string, target?: ExecutionTarget) => Promise<BashExecResult>;
  executingCmd?: boolean;
  target?: ExecutionTarget;
  daemons?: DaemonInfo[];
  onStopDaemon?: (id: string) => void;
  onInitGitRepo?: () => void;
  isInitializingGit?: boolean;
  /** Hide the PTY stream pane (Work menu / close control). */
  onClose?: () => void;
}

export const DevinTerminalPane: React.FC<DevinTerminalPaneProps> = ({
  logs,
  onClearLogs,
  onRunCommand,
  executingCmd = false,
  target = 'local_mac',
  daemons = [],
  onStopDaemon,
  onInitGitRepo,
  isInitializingGit = false,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<'terminal' | 'daemons'>('terminal');
  const [termInput, setTermInput] = useState('');
  const [streamed, setStreamed] = useState<BashExecResult[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let stop = false
    const pull = async () => {
      try {
        const res = await fetch('/api/agent-events')
        if (!res.ok || stop) return
        const text = await res.text()
        const next: BashExecResult[] = []
        for (const block of text.split('\n\n')) {
          const dataLine = block.split('\n').find((line) => line.startsWith('data: '))
          if (!dataLine) continue
          const event = JSON.parse(dataLine.slice(6)) as {
            type?: string
            detail?: { command?: string; exitCode?: number; stdout?: string; stderr?: string }
          }
          if (event.type !== 'agent:terminal_chunk' || !event.detail?.command) continue
          next.push({
            ok: event.detail.exitCode === 0,
            command: event.detail.command,
            stdout: event.detail.stdout || '',
            stderr: event.detail.stderr || '',
            exitCode: event.detail.exitCode ?? 1,
            durationMs: 0,
            target,
          })
        }
        if (!stop) setStreamed(next.slice(-30))
      } catch {
        /* event channel is optional */
      }
    }
    void pull()
    const timer = window.setInterval(() => void pull(), 2000)
    return () => {
      stop = true
      window.clearInterval(timer)
    }
  }, [target]);

  const visibleLogs = [...logs]
  for (const row of streamed) {
    const seen = visibleLogs.some(
      (log) => log.command === row.command && log.exitCode === row.exitCode && log.stdout === row.stdout,
    )
    if (!seen) visibleLogs.push(row)
  }

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [visibleLogs]);

  const handleCommandSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!termInput.trim() || executingCmd || !onRunCommand) return;
    const cmd = termInput.trim();
    setTermInput('');
    await onRunCommand(cmd, target);
  };

  return (
    <div className="devin-pane devin-pane-terminal">
      {/* Pane Header */}
      <div className="devin-pane-header">
        <div className="devin-pane-title">
          <span className="devin-pane-dot terminal-dot" />
          <span className="devin-pane-heading">2. LIVE TERMINAL (PTY STREAM)</span>
          <span className="devin-terminal-target">[{target}]</span>
        </div>
        <div className="devin-pane-tabs">
          <button
            type="button"
            className={`devin-tab-btn ${activeTab === 'terminal' ? 'active' : ''}`}
            onClick={() => setActiveTab('terminal')}
          >
            Output ({visibleLogs.length})
          </button>
          <button
            type="button"
            className={`devin-tab-btn ${activeTab === 'daemons' ? 'active' : ''}`}
            onClick={() => setActiveTab('daemons')}
          >
            Daemons ({daemons.length})
          </button>
          {onClearLogs && (
            <button type="button" className="devin-tab-btn btn-clear" onClick={onClearLogs}>
              Clear
            </button>
          )}
          {onClose && (
            <button
              type="button"
              className="devin-tab-btn btn-clear"
              onClick={onClose}
              title="Hide live terminal"
            >
              Close
            </button>
          )}
        </div>
      </div>

      {/* Pane Body */}
      <div className="devin-pane-body" ref={scrollRef}>
        {activeTab === 'daemons' ? (
          <div className="devin-daemon-list">
            <div className="devin-section-label">BACKGROUND PROCESS SUPERVISOR</div>
            {daemons.length === 0 ? (
              <div className="devin-empty-state">No background daemons currently running.</div>
            ) : (
              daemons.map((d) => (
                <div key={d.id} className="devin-daemon-card">
                  <div className="daemon-header">
                    <span className={`daemon-status-dot ${d.alive ? 'alive' : 'stopped'}`} />
                    <span className="daemon-id">{d.id}</span>
                    {d.port && <span className="daemon-port">Port :{d.port}</span>}
                    {d.pid && <span className="daemon-pid">PID {d.pid}</span>}
                    {onStopDaemon && (
                      <button
                        type="button"
                        className="devin-btn-stop-daemon"
                        onClick={() => onStopDaemon(d.id)}
                      >
                        Stop
                      </button>
                    )}
                  </div>
                  <div className="daemon-cmd"><code>{d.command}</code></div>
                  {d.uptimeSeconds !== undefined && (
                    <div className="daemon-uptime">Uptime: {d.uptimeSeconds}s</div>
                  )}
                </div>
              ))
            )}
          </div>
        ) : (
          <div className="devin-terminal-stream">
            {visibleLogs.length === 0 ? (
              <div className="devin-terminal-empty">
                <div className="term-empty-icon">💻</div>
                <div className="term-empty-title">PTY STREAM INITIALIZED · TARGET: {target.toUpperCase()}</div>
                <div className="term-empty-subtitle">Waiting for agent or user execution. Click below or type in prompt:</div>
                {onRunCommand && (
                  <div className="devin-term-empty-suggestions">
                    <button type="button" className="term-suggestion-pill" onClick={() => void onRunCommand('git status', target)}>git status</button>
                    <button type="button" className="term-suggestion-pill" onClick={() => void onRunCommand('git init && git status', target)}>git init</button>
                    <button type="button" className="term-suggestion-pill" onClick={() => void onRunCommand('ls -lah', target)}>ls -lah</button>
                    <button type="button" className="term-suggestion-pill" onClick={() => void onRunCommand('uname -a', target)}>uname -a</button>
                  </div>
                )}
              </div>
            ) : (
              visibleLogs.map((log, idx) => {
                const isExitZero = log.exitCode === 0;
                const isGitRepoError =
                  (log.stderr && log.stderr.includes('not a git repository')) ||
                  (log.stdout && log.stdout.includes('not a git repository'));

                return (
                  <div key={idx} className="devin-terminal-entry">
                    <div className="devin-term-cmd-line">
                      <span className="prompt-symbol">$</span>
                      <span className="command-text">{log.command}</span>
                      {log.exitCode !== undefined && log.exitCode !== null && (
                        <span className={`exit-badge ${isExitZero ? 'badge-pass' : 'badge-fail'}`}>
                          exit {log.exitCode}
                        </span>
                      )}
                      {log.durationMs && <span className="time-badge">{log.durationMs}ms</span>}
                    </div>

                    {log.stdout && (
                      <TerminalLineOutput content={log.stdout} />
                    )}

                    {log.stderr && (
                      <TerminalLineOutput content={log.stderr} isStderr />
                    )}

                    {/* Single-click Connect to Repo banner for git errors */}
                    {isGitRepoError && (
                      <div className="devin-git-fix-banner">
                        <div className="devin-git-fix-info">
                          <span className="devin-git-fix-icon">⚠️</span>
                          <div className="devin-git-fix-text">
                            <strong>Git Repository Missing:</strong> Directory lacks a <code>.git</code> folder.
                          </div>
                        </div>
                        <button
                          type="button"
                          className="devin-btn-connect-repo"
                          onClick={() => {
                            if (onInitGitRepo) {
                              onInitGitRepo();
                            } else if (onRunCommand) {
                              void onRunCommand('git init && git status', target);
                            }
                          }}
                          disabled={executingCmd || isInitializingGit}
                          title="Single-click: Run 'git init && git status' and connect repository"
                        >
                          {isInitializingGit ? '⏳ Connecting...' : '⚡ Single Click: Connect to Repo (git init)'}
                        </button>
                      </div>
                    )}

                    {log.error && (
                      <div className="term-error-box">{log.error}</div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* Pane Footer: Manual Terminal Command Input */}
      {onRunCommand && (
        <form className="devin-pane-footer devin-terminal-input-form" onSubmit={handleCommandSubmit}>
          <span className="devin-prompt-char">&gt;</span>
          <input
            type="text"
            className="devin-term-input"
            placeholder="Run shell command in active target workspace..."
            value={termInput}
            onChange={(e) => setTermInput(e.target.value)}
            disabled={executingCmd}
          />
          <button type="submit" className="devin-btn devin-btn-run" disabled={!termInput.trim() || executingCmd}>
            {executingCmd ? '...' : 'Run'}
          </button>
        </form>
      )}
    </div>
  );
};
