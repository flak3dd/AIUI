import React, { useState } from 'react'
import type { BashExecResult, ExecutionTarget } from '../../lib/bashShell'

export interface SshToolModalProps {
  open: boolean
  onClose: () => void
  onRunBash: (cmd: string, target?: ExecutionTarget) => Promise<BashExecResult>
  defaultHost?: string
  defaultUser?: string
}

const PRESET_COMMANDS = [
  { id: 'gpu', label: '⚡ nvidia-smi', cmd: 'nvidia-smi --query-gpu=name,driver_version,memory.total,memory.used,utilization.gpu --format=csv' },
  { id: 'vllm', label: '🤖 vLLM Models', cmd: 'curl -s http://127.0.0.1:8000/v1/models | python3 -m json.tool || echo "vLLM offline"' },
  { id: 'disk', label: '💾 Disk Space', cmd: 'df -h / /tmp /mnt/nvme 2>/dev/null || df -h' },
  { id: 'containers', label: '📦 Containers', cmd: 'docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null || podman ps 2>/dev/null || echo "No docker/podman daemon"' },
  { id: 'uptime', label: '🩺 Uptime & Load', cmd: 'uptime && uname -a && lscpu | grep "Model name\\|CPU(s):"' },
  { id: 'sandboxes', label: '📁 Sandboxes', cmd: 'ls -lah /tmp/spark-sandboxes/ 2>/dev/null' },
]

export const SshToolModal: React.FC<SshToolModalProps> = ({
  open,
  onClose,
  onRunBash,
  defaultHost = '100.66.147.53',
  defaultUser = 'flak3dd',
}) => {
  const [host, setHost] = useState(defaultHost)
  const [user, setUser] = useState(defaultUser)
  const [port, setPort] = useState(22)
  const [command, setCommand] = useState('nvidia-smi')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<BashExecResult | null>(null)
  const [copied, setCopied] = useState(false)

  if (!open) return null

  const handleExecute = async (cmdToRun = command) => {
    if (!cmdToRun.trim() || running) return
    setRunning(true)
    setCommand(cmdToRun)
    try {
      // Execute command on dgx_spark target directly via sandbox runner / SSH
      const res = await onRunBash(cmdToRun, 'dgx_spark')
      setResult(res)
    } catch (err: any) {
      setResult({
        ok: false,
        command: cmdToRun,
        stdout: '',
        stderr: err.message || 'Execution error',
        exitCode: 1,
        target: 'dgx_spark',
        durationMs: 0,
        timestamp: new Date().toISOString(),
      })
    } finally {
      setRunning(false)
    }
  }

  const handleCopy = () => {
    const text = result?.stdout || result?.stderr || ''
    if (!text) return
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="settings-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div
        className="settings-card"
        style={{ maxWidth: 740, width: '92vw', maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 20 }}>🔑</span>
            <div>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, letterSpacing: '0.04em' }}>
                REMOTE SSH CLUSTER RUNNER
              </h2>
              <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                Direct execution on DGX Spark (GB10) — Zero base64 pipeline wrapping
              </div>
            </div>
          </div>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="Close modal">
            ✕
          </button>
        </div>

        <div style={{ padding: '16px 20px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Host / User row */}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 100px', gap: 12 }}>
            <div className="field">
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase' }}>
                Remote Host / IP
              </label>
              <input
                type="text"
                className="input-text"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="100.66.147.53"
                style={{ fontFamily: 'monospace', fontSize: 13 }}
              />
            </div>
            <div className="field">
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase' }}>
                User
              </label>
              <input
                type="text"
                className="input-text"
                value={user}
                onChange={(e) => setUser(e.target.value)}
                placeholder="flak3dd"
                style={{ fontFamily: 'monospace', fontSize: 13 }}
              />
            </div>
            <div className="field">
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase' }}>
                Port
              </label>
              <input
                type="number"
                className="input-text"
                value={port}
                onChange={(e) => setPort(Number(e.target.value))}
                placeholder="22"
                style={{ fontFamily: 'monospace', fontSize: 13 }}
              />
            </div>
          </div>

          {/* Preset Buttons */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: 8 }}>
              ⚡ Cluster Diagnostics Quick Actions
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {PRESET_COMMANDS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="btn-sm"
                  style={{ fontSize: 12, padding: '5px 10px', borderRadius: 6, cursor: 'pointer' }}
                  onClick={() => handleExecute(p.cmd)}
                  disabled={running}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Command Input */}
          <div className="field">
            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: 6 }}>
              Command to Execute
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="text"
                className="input-text"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleExecute()}
                placeholder="e.g. nvidia-smi, docker ps, python3 script.py"
                style={{ fontFamily: 'monospace', fontSize: 13, flex: 1 }}
                disabled={running}
              />
              <button
                type="button"
                className="btn-primary"
                style={{ padding: '0 18px', fontWeight: 600, minWidth: 100 }}
                onClick={() => handleExecute()}
                disabled={running || !command.trim()}
              >
                {running ? 'Running...' : '⚡ Run'}
              </button>
            </div>
          </div>

          {/* Console Output */}
          {result && (
            <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span
                    style={{
                      fontSize: 11,
                      padding: '2px 8px',
                      borderRadius: 999,
                      fontWeight: 700,
                      background: result.ok ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                      color: result.ok ? '#10b981' : '#ef4444',
                      border: `1px solid ${result.ok ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
                    }}
                  >
                    {result.ok ? '✔ SUCCESS (EXIT 0)' : `✘ FAILED (EXIT ${result.exitCode ?? 1})`}
                  </span>
                  {result.durationMs !== undefined && (
                    <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                      {result.durationMs}ms
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  className="btn-sm"
                  onClick={handleCopy}
                  style={{ fontSize: 11, padding: '3px 8px' }}
                >
                  {copied ? '✔ Copied!' : '📋 Copy Output'}
                </button>
              </div>

              <div
                style={{
                  background: '#090d16',
                  borderRadius: 8,
                  padding: 12,
                  fontFamily: 'monospace',
                  fontSize: 12,
                  color: result.ok ? '#a7f3d0' : '#fca5a5',
                  maxHeight: 280,
                  overflowY: 'auto',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                }}
              >
                {result.stdout || result.stderr || '(No output produced)'}
              </div>
            </div>
          )}
        </div>

        <div className="settings-footer" style={{ display: 'flex', justifyContent: 'flex-end', padding: '12px 20px', borderTop: '1px solid var(--border)' }}>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
