import React, { useState, useEffect, useRef } from 'react'
import type { BashExecResult, ExecutionTarget } from '../../lib/bashShell'

export interface RemoteClusterRunnerProps {
  open: boolean
  onClose: () => void
  onRunBash: (cmd: string, target?: ExecutionTarget) => Promise<BashExecResult>
  onPinToChat?: (content: string) => void
  onSendToBase64?: (text: string) => void
  initialCommand?: string
}

interface ClusterNode {
  id: string
  name: string
  host: string
  user: string
  target: ExecutionTarget
  badge: string
}

const CLUSTER_NODES: ClusterNode[] = [
  {
    id: 'spark',
    name: 'NVIDIA DGX Spark GB10 (Primary)',
    host: '100.66.147.53',
    user: 'flak3dd',
    target: 'dgx_spark',
    badge: 'GB10 · :8000 · :17330',
  },
  {
    id: 'mac',
    name: 'Mac Host Gateway (Local)',
    host: '192.168.4.50',
    user: 'adminuser',
    target: 'container',
    badge: 'Web UI · :5173 · :17332',
  },
  {
    id: 'tailscale',
    name: 'Tailscale Mesh Node (Spark)',
    host: '100.66.147.53',
    user: 'flak3dd',
    target: 'dgx_spark',
    badge: 'gx10 · WireGuard',
  },
]

const CLUSTER_MACROS = [
  {
    id: 'gpu',
    label: '⚡ nvidia-smi',
    cmd: 'nvidia-smi --query-gpu=name,driver_version,temperature.gpu,utilization.gpu,power.draw,memory.used,memory.total --format=csv',
    desc: 'Live GB10 GPU temperature, power, and VRAM',
  },
  {
    id: 'gpu_apps',
    label: '🎮 GPU App Memory',
    cmd: 'nvidia-smi --query-compute-apps=pid,process_name,used_memory --format=csv && echo "--- DETAILED PS ---" && ps aux | grep -E "vllm|gradio|dgx_worker|ollama" | grep -v grep',
    desc: 'Detailed breakdown of VRAM used per compute process',
  },
  {
    id: 'reclaim_vram',
    label: '🧹 Reclaim VRAM (~5.3GB)',
    cmd: 'pkill -9 -f gradio_demo.py 2>/dev/null || true; pkill -9 -f dgx_worker.py 2>/dev/null || true; sudo systemctl stop ollama 2>/dev/null || pkill -15 ollama 2>/dev/null || true; echo "Terminated OmniParser & OCR worker."; nvidia-smi --query-gpu=memory.used,memory.free --format=csv',
    desc: 'Terminate OmniParser (2.87GB) and OCR worker (2.39GB) to free ~5.26GB VRAM',
  },
  {
    id: 'launch_vllm_full',
    label: '🚀 Launch vLLM Speed (32k)',
    cmd: 'cd ~/spark 2>/dev/null || cd ~/abliterated_ui/spark; docker stop -t 2 qwen-abliterated 2>/dev/null || true; docker rm -f qwen-abliterated 2>/dev/null || true; GPU_MEM=0.68 CTX=32768 SEQS=4 MTP=3 bash serve-qwen-abliterated.sh 2>/dev/null || GPU_MEM=0.68 CTX=32768 SEQS=4 bash serve-qwen36-plague-nvfp4-mtp.sh',
    desc: 'Launch vLLM Speed Profile: 32k context, MTP=3 speculative decoding (~70+ tok/s)',
  },
  {
    id: 'launch_vllm_extended',
    label: '⚡ Launch Extended (65k)',
    cmd: 'pkill -9 -f gradio_demo.py 2>/dev/null || true; pkill -9 -f dgx_worker.py 2>/dev/null || true; cd ~/spark 2>/dev/null || cd ~/abliterated_ui/spark; docker stop -t 2 qwen-abliterated 2>/dev/null || true; docker rm -f qwen-abliterated 2>/dev/null || true; GPU_MEM=0.82 CTX=65536 SEQS=2 MTP=0 bash serve-qwen-abliterated.sh 2>/dev/null || GPU_MEM=0.82 CTX=65536 SEQS=2 MTP=0 bash serve-qwen36-plague-nvfp4-mtp.sh',
    desc: 'Launch Extended Horizon: 65,536 context, reclaimed VRAM, MTP=0, 2 sequence streams',
  },
  {
    id: 'stop_vllm',
    label: '🛑 Stop vLLM / Qwen',
    cmd: 'docker stop -t 5 qwen-abliterated 2>/dev/null || true; docker rm -f qwen-abliterated 2>/dev/null || true; echo "✔ Qwen LLM container stopped and removed."; nvidia-smi --query-gpu=memory.used,memory.free --format=csv',
    desc: 'Shut down Qwen vLLM container and release ~83GB VRAM',
  },
  {
    id: 'vllm',
    label: '🤖 vLLM Health',
    cmd: 'curl -s -m 3 http://127.0.0.1:8000/health && echo "" && curl -s -m 3 http://127.0.0.1:8000/v1/models | python3 -m json.tool | head -30 || echo "vLLM offline or restarting"',
    desc: 'Check served model and inference readiness',
  },
  {
    id: 'load',
    label: '🩺 System Load & RAM',
    cmd: 'cat /proc/loadavg && echo "--- MEMORY ---" && free -h && echo "--- TOP CPU ---" && ps aux --sort=-%cpu | head -6',
    desc: 'Host CPU load averages and memory pressure',
  },
  {
    id: 'containers',
    label: '📦 Containers',
    cmd: 'docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null || podman ps 2>/dev/null || echo "No container engine"',
    desc: 'Active Docker/Podman services',
  },
  {
    id: 'sandboxes',
    label: '📁 Sandboxes',
    cmd: 'ls -lah /tmp/spark-sandboxes/ 2>/dev/null | head -15',
    desc: 'Inspect ephemeral agent workspaces',
  },
  {
    id: 'disk',
    label: '💾 Disks & NVMe',
    cmd: 'df -h / /tmp /mnt/nvme 2>/dev/null || df -h | head -8',
    desc: 'NVMe storage and partition usage',
  },
]

export const RemoteClusterRunner: React.FC<RemoteClusterRunnerProps> = ({
  open,
  onClose,
  onRunBash,
  onPinToChat,
  onSendToBase64,
  initialCommand = 'nvidia-smi',
}) => {
  const [selectedNodeId, setSelectedNodeId] = useState<string>('spark')
  const [command, setCommand] = useState<string>(initialCommand)
  const [running, setRunning] = useState<boolean>(false)
  const [result, setResult] = useState<BashExecResult | null>(null)
  const [history, setHistory] = useState<string[]>([])
  const [historyIdx, setHistoryIdx] = useState<number>(-1)
  const [copied, setCopied] = useState<boolean>(false)

  const activeNode = CLUSTER_NODES.find((n) => n.id === selectedNodeId) || CLUSTER_NODES[0]
  const terminalRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (initialCommand) setCommand(initialCommand)
  }, [initialCommand])

  useEffect(() => {
    if (result && terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight
    }
  }, [result])

  if (!open) return null

  const handleExecute = async (cmdToRun = command) => {
    const trimmed = cmdToRun.trim()
    if (!trimmed || running) return

    setRunning(true)
    setCommand(trimmed)
    setHistory((prev) => [trimmed, ...prev.filter((c) => c !== trimmed)].slice(0, 30))
    setHistoryIdx(-1)

    try {
      const res = await onRunBash(trimmed, activeNode.target)
      setResult(res)
    } catch (err: any) {
      setResult({
        ok: false,
        command: trimmed,
        stdout: '',
        stderr: err.message || 'Execution failed',
        exitCode: 1,
        target: activeNode.target,
        durationMs: 0,
        timestamp: new Date().toISOString(),
      })
    } finally {
      setRunning(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleExecute()
    } else if (e.key === 'ArrowUp') {
      if (history.length > 0 && historyIdx < history.length - 1) {
        const nextIdx = historyIdx + 1
        setHistoryIdx(nextIdx)
        setCommand(history[nextIdx])
      }
    } else if (e.key === 'ArrowDown') {
      if (historyIdx > 0) {
        const nextIdx = historyIdx - 1
        setHistoryIdx(nextIdx)
        setCommand(history[nextIdx])
      } else if (historyIdx === 0) {
        setHistoryIdx(-1)
        setCommand('')
      }
    }
  }

  const handleCopy = () => {
    const text = result?.stdout || result?.stderr || ''
    if (!text) return
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const handlePin = () => {
    if (!result || !onPinToChat) return
    const text = result.stdout || result.stderr
    if (!text) return
    const pinnedSnippet = `\`\`\`bash\n# Output from ${activeNode.name} (${result.command}):\n${text}\n\`\`\``
    onPinToChat(pinnedSnippet)
    onClose()
  }

  return (
    <div className="settings-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div
        className="settings-card"
        style={{
          maxWidth: 920,
          width: '95vw',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          background: 'linear-gradient(180deg, #101422 0%, #0a0c16 100%)',
          border: '1px solid rgba(0, 240, 255, 0.3)',
          boxShadow: '0 25px 70px rgba(0, 0, 0, 0.8), 0 0 35px rgba(0, 240, 255, 0.12)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="settings-header"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 22px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            background: 'rgba(0, 0, 0, 0.25)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 8,
                background: 'rgba(0, 240, 255, 0.12)',
                border: '1px solid rgba(0, 240, 255, 0.35)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 18,
              }}
            >
              ⚡
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, letterSpacing: '0.04em', color: '#fff' }}>
                  REMOTE SSH CLUSTER RUNNER
                </h2>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: 999,
                    background: 'rgba(16, 185, 129, 0.15)',
                    color: '#10b981',
                    border: '1px solid rgba(16, 185, 129, 0.3)',
                  }}
                >
                  LIVE MUX ACTIVE
                </span>
              </div>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>
                Multi-node direct execution cockpit · Zero base64 pipe wrapping · Native ANSI
              </div>
            </div>
          </div>

          <button type="button" className="btn-icon" onClick={onClose} aria-label="Close modal">
            ✕
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '18px 22px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Node Selector Bar */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              background: 'rgba(255, 255, 255, 0.04)',
              padding: '10px 14px',
              borderRadius: 8,
              border: '1px solid rgba(255, 255, 255, 0.08)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#00f0ff', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                ACTIVE NODE:
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                {CLUSTER_NODES.map((node) => (
                  <button
                    key={node.id}
                    type="button"
                    className="btn-sm"
                    style={{
                      background: selectedNodeId === node.id ? 'rgba(0, 240, 255, 0.2)' : 'transparent',
                      color: selectedNodeId === node.id ? '#00f0ff' : '#94a3b8',
                      border: `1px solid ${selectedNodeId === node.id ? 'rgba(0, 240, 255, 0.4)' : 'rgba(255, 255, 255, 0.1)'}`,
                      borderRadius: 6,
                      fontSize: 11,
                      fontWeight: 600,
                      padding: '4px 10px',
                    }}
                    onClick={() => setSelectedNodeId(node.id)}
                  >
                    ● {node.name}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ fontSize: 11, color: '#64748b', fontFamily: 'monospace' }}>
              {activeNode.user}@{activeNode.host} ({activeNode.badge})
            </div>
          </div>

          {/* Quick Macros */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
              ⚡ CLUSTER DIAGNOSTIC MACROS
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {CLUSTER_MACROS.map((macro) => (
                <button
                  key={macro.id}
                  type="button"
                  className="btn-sm"
                  title={macro.desc}
                  style={{
                    fontSize: 11,
                    padding: '6px 12px',
                    borderRadius: 6,
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    color: '#f8fafc',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                  onClick={() => handleExecute(macro.cmd)}
                  disabled={running}
                >
                  {macro.label}
                </button>
              ))}
            </div>
          </div>

          {/* Command Bar */}
          <div className="field">
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                DIRECT CLI EXECUTION COMMAND
              </label>
              <span style={{ fontSize: 11, color: '#64748b' }}>
                Use Up/Down arrows for history
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ position: 'relative', flex: 1 }}>
                <span
                  style={{
                    position: 'absolute',
                    left: 12,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    fontFamily: 'monospace',
                    color: '#00f0ff',
                    fontSize: 13,
                    pointerEvents: 'none',
                  }}
                >
                  $
                </span>
                <input
                  type="text"
                  className="input-text"
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="e.g. nvidia-smi, docker ps, free -h, python3 -c '...'"
                  style={{
                    fontFamily: 'JetBrains Mono, monospace',
                    fontSize: 13,
                    width: '100%',
                    paddingLeft: 28,
                    background: '#090b12',
                    border: '1px solid rgba(0, 240, 255, 0.3)',
                    color: '#fff',
                    borderRadius: 6,
                  }}
                  disabled={running}
                />
              </div>

              <button
                type="button"
                className="btn-primary"
                style={{
                  padding: '0 20px',
                  fontWeight: 700,
                  background: 'linear-gradient(135deg, #00f0ff 0%, #0099ff 100%)',
                  color: '#090d16',
                  border: 'none',
                  borderRadius: 6,
                  minWidth: 100,
                }}
                onClick={() => handleExecute()}
                disabled={running || !command.trim()}
              >
                {running ? 'Executing...' : '⚡ Run'}
              </button>
            </div>
          </div>

          {/* Console / Output Screen */}
          {result && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {/* Telemetry bar */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span
                    style={{
                      fontSize: 11,
                      padding: '2px 9px',
                      borderRadius: 999,
                      fontWeight: 700,
                      background: result.ok ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                      color: result.ok ? '#10b981' : '#ef4444',
                      border: `1px solid ${result.ok ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
                    }}
                  >
                    {result.ok ? '✔ EXIT 0 (OK)' : `✘ EXIT ${result.exitCode ?? 1} (FAILED)`}
                  </span>
                  {result.durationMs !== undefined && (
                    <span style={{ fontSize: 11, color: '#64748b', fontFamily: 'monospace' }}>
                      Latency: {result.durationMs}ms
                    </span>
                  )}
                  <span style={{ fontSize: 11, color: '#475569', fontFamily: 'monospace' }}>
                    Target: {result.target}
                  </span>
                </div>

                <div style={{ display: 'flex', gap: 6 }}>
                  {onPinToChat && (
                    <button
                      type="button"
                      className="btn-sm"
                      onClick={handlePin}
                      style={{ fontSize: 11, padding: '3px 10px', color: '#c084fc' }}
                      title="Insert verified stdout into current chat composer context"
                    >
                      📌 Pin to Chat
                    </button>
                  )}
                  {onSendToBase64 && (
                    <button
                      type="button"
                      className="btn-sm"
                      onClick={() => {
                        const out = result.stdout || result.stderr
                        if (out) {
                          onSendToBase64(out)
                          onClose()
                        }
                      }}
                      style={{ fontSize: 11, padding: '3px 10px', color: '#38bdf8' }}
                      title="Send stdout to Base64 Tactical Studio"
                    >
                      🔤 Base64 Studio
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn-sm"
                    onClick={handleCopy}
                    style={{ fontSize: 11, padding: '3px 10px' }}
                  >
                    {copied ? '✔ Copied!' : '📋 Copy All'}
                  </button>
                </div>
              </div>

              {/* Terminal Viewport */}
              <div
                ref={terminalRef}
                style={{
                  background: '#06080e',
                  borderRadius: 8,
                  padding: 14,
                  fontFamily: 'JetBrains Mono, Fira Code, monospace',
                  fontSize: 12,
                  color: result.ok ? '#94a3b8' : '#fca5a5',
                  maxHeight: 320,
                  overflowY: 'auto',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                  lineHeight: 1.5,
                  boxShadow: 'inset 0 2px 10px rgba(0, 0, 0, 0.6)',
                }}
              >
                {result.stdout || result.stderr || '(Process completed with empty stdout)'}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="settings-footer"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '12px 22px',
            borderTop: '1px solid rgba(255, 255, 255, 0.08)',
            background: 'rgba(0, 0, 0, 0.3)',
          }}
        >
          <div style={{ fontSize: 11, color: '#64748b' }}>
            Direct OpenSSH socket active via ControlPath=/tmp/ssh_mux_spark_%h_%p_%r
          </div>
          <button type="button" className="btn-secondary" onClick={onClose} style={{ borderRadius: 6 }}>
            Close Runner
          </button>
        </div>
      </div>
    </div>
  )
}
