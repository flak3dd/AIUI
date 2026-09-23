import React, { useEffect, useRef, useState, useMemo } from 'react'

export interface CyberMatrixModalProps {
  open: boolean
  onClose: () => void
  onSelectProvider?: (providerId: 'spark' | 'featherless' | 'abliteration') => void
  activeProviderId?: string
}

type MatrixPalette = 'neon' | 'emerald' | 'gold' | 'crimson'

interface PaletteConfig {
  name: string
  lead: string
  trail: string
  glow: string
  accent: string
}

const PALETTES: Record<MatrixPalette, PaletteConfig> = {
  neon: {
    name: 'Featherless Violet / Cyan',
    lead: '#ffffff',
    trail: '#00f2fe',
    glow: '#8b5cf6',
    accent: '#a855f7',
  },
  emerald: {
    name: 'Cyberpunk Classic',
    lead: '#e6fffa',
    trail: '#10b981',
    glow: '#059669',
    accent: '#34d399',
  },
  gold: {
    name: 'Obsidian Core',
    lead: '#fffbeb',
    trail: '#f59e0b',
    glow: '#d97706',
    accent: '#fbbf24',
  },
  crimson: {
    name: 'Breach Protocol',
    lead: '#fff1f2',
    trail: '#f43f5e',
    glow: '#e11d48',
    accent: '#fb7185',
  },
}

const GLYPHS =
  'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン0123456789ABCDEFλΩ⚡∑∆∇{}[]<>/*+-=~'

interface MatrixColumn {
  x: number
  y: number
  speed: number
  chars: string[]
  length: number
}

export const CyberMatrixModal: React.FC<CyberMatrixModalProps> = ({
  open,
  onClose,
  onSelectProvider,
  activeProviderId = 'spark',
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [palette, setPalette] = useState<MatrixPalette>('neon')
  const [speedMultiplier, setSpeedMultiplier] = useState<number>(1.2)
  const [density, setDensity] = useState<number>(36)
  const [isGlitching, setIsGlitching] = useState<boolean>(false)
  const [pingStatus, setPingStatus] = useState<string | null>(null)
  const [isPinging, setIsPinging] = useState<boolean>(false)

  const activePal = useMemo(() => PALETTES[palette], [palette])

  // Canvas Matrix Digital Rain Animation
  useEffect(() => {
    if (!open) return

    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let animId: number
    let width = (canvas.width = window.innerWidth)
    let height = (canvas.height = window.innerHeight)

    const handleResize = () => {
      if (!canvas) return
      width = canvas.width = window.innerWidth
      height = canvas.height = window.innerHeight
      initColumns()
    }
    window.addEventListener('resize', handleResize)

    const fontSize = 16
    let columns: MatrixColumn[] = []

    const initColumns = () => {
      const colCount = Math.floor(width / (fontSize * (45 / density)))
      columns = []
      for (let i = 0; i < colCount; i++) {
        const length = Math.floor(Math.random() * 22) + 12
        const chars: string[] = []
        for (let j = 0; j < length; j++) {
          chars.push(GLYPHS[Math.floor(Math.random() * GLYPHS.length)])
        }
        columns.push({
          x: i * (width / colCount),
          y: Math.random() * -height,
          speed: (Math.random() * 2.5 + 1.8) * speedMultiplier,
          chars,
          length,
        })
      }
    }

    initColumns()

    let frame = 0

    const render = () => {
      frame++
      // Translucent wash for phosphorescent decay trail
      ctx.fillStyle = 'rgba(5, 5, 12, 0.16)'
      ctx.fillRect(0, 0, width, height)

      ctx.font = `bold ${fontSize}px "JetBrains Mono", "Fira Code", monospace`

      for (let i = 0; i < columns.length; i++) {
        const col = columns[i]

        // Randomly mutate internal glyphs
        if (frame % 4 === 0 && Math.random() > 0.4) {
          const charIdx = Math.floor(Math.random() * col.chars.length)
          col.chars[charIdx] = GLYPHS[Math.floor(Math.random() * GLYPHS.length)]
        }

        for (let j = 0; j < col.chars.length; j++) {
          const charY = col.y - j * fontSize
          if (charY < -fontSize || charY > height + fontSize) continue

          const isHead = j === 0
          const isSpark = j === 1 || j === 2

          if (isHead) {
            ctx.fillStyle = activePal.lead
            ctx.shadowBlur = 14
            ctx.shadowColor = activePal.trail
          } else if (isSpark) {
            ctx.fillStyle = activePal.trail
            ctx.shadowBlur = 8
            ctx.shadowColor = activePal.glow
          } else {
            const alpha = 1 - j / col.length
            ctx.fillStyle = isGlitching
              ? `rgba(255, 60, 120, ${alpha * 0.9})`
              : activePal.glow === '#8b5cf6'
                ? `rgba(139, 92, 246, ${alpha * 0.85})`
                : `rgba(16, 185, 129, ${alpha * 0.85})`
            ctx.shadowBlur = 0
          }

          ctx.fillText(col.chars[j], col.x, charY)
        }

        col.y += col.speed
        if (col.y - col.length * fontSize > height) {
          col.y = Math.random() * -120
          col.speed = (Math.random() * 2.5 + 1.8) * speedMultiplier
        }
      }

      animId = requestAnimationFrame(render)
    }

    render()

    return () => {
      window.removeEventListener('resize', handleResize)
      cancelAnimationFrame(animId)
    }
  }, [open, activePal, speedMultiplier, density, isGlitching])

  // Glitch flash trigger
  const triggerGlitch = () => {
    setIsGlitching(true)
    setTimeout(() => setIsGlitching(false), 380)
  }

  // Gateway Ping Probe
  const handleTestPing = async () => {
    setIsPinging(true)
    setPingStatus('Pinging Gateway :17332...')
    const t0 = performance.now()
    try {
      const res = await fetch('http://127.0.0.1:17332/health', { signal: AbortSignal.timeout(3000) })
      const latency = Math.round(performance.now() - t0)
      if (res.ok) {
        setPingStatus(`✔ Gateway Online · ${latency}ms latency`)
      } else {
        setPingStatus(`⚠ Gateway HTTP ${res.status}`)
      }
    } catch {
      // Fallback probe Vite UI
      try {
        await fetch('/', { signal: AbortSignal.timeout(2000) })
        const latency = Math.round(performance.now() - t0)
        setPingStatus(`✔ Vite Host Online · ${latency}ms latency`)
      } catch {
        setPingStatus('❌ Connection Refused (Gateway Offline)')
      }
    } finally {
      setIsPinging(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center overflow-hidden bg-black/90 backdrop-blur-xl animate-fade-in">
      {/* Dynamic Matrix Rain Canvas */}
      <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none opacity-80" />

      {/* Cybernetic Grid & Vignette Overlay */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse at center, rgba(10, 5, 25, 0.45) 0%, rgba(2, 2, 8, 0.95) 85%)',
          boxShadow: 'inset 0 0 160px rgba(0, 0, 0, 0.9)',
        }}
      />

      {/* Glassmorphic Cyber Matrix Cockpit */}
      <div className="relative z-10 w-[96vw] max-w-6xl max-h-[92vh] flex flex-col rounded-2xl border border-purple-500/30 bg-[#0a0614]/85 p-6 shadow-2xl shadow-purple-950/60 backdrop-blur-2xl overflow-y-auto text-slate-100 transition-all">
        {/* Top Bar / Header */}
        <div className="flex items-center justify-between border-b border-purple-500/20 pb-4 mb-6">
          <div className="flex items-center gap-3">
            <div className="relative flex items-center justify-center w-11 h-11 rounded-xl bg-gradient-to-br from-purple-600 via-indigo-600 to-cyan-400 p-[1.5px] shadow-lg shadow-purple-500/30">
              <div className="w-full h-full bg-[#0d071d] rounded-[10px] flex items-center justify-center">
                <span className="text-xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-cyan-300">
                  F
                </span>
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-extrabold tracking-wide text-transparent bg-clip-text bg-gradient-to-r from-purple-300 via-indigo-200 to-cyan-300 uppercase">
                  Cybernetic Capabilities Matrix
                </h2>
                <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-purple-500/20 border border-purple-500/40 text-purple-300">
                  v3.6 HIGH-ASSURANCE
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Multi-Node Architecture · Hardware Inference & Cloud Routing Matrix
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={triggerGlitch}
              className="px-3 py-1.5 rounded-lg border border-purple-500/30 bg-purple-900/20 text-xs font-semibold text-purple-300 hover:bg-purple-800/40 hover:border-purple-400 transition-all flex items-center gap-1.5"
            >
              <span>⚡</span> Glitch Distortion
            </button>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg border border-slate-700 bg-slate-900/60 text-slate-400 hover:text-white hover:border-slate-500 flex items-center justify-center transition-all"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Matrix Controls & Spectrum Selector */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 rounded-xl border border-purple-500/20 bg-purple-950/15 mb-6">
          <div>
            <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block mb-1.5">
              Matrix Spectrum Mood
            </label>
            <div className="grid grid-cols-2 gap-1.5">
              {(Object.keys(PALETTES) as MatrixPalette[]).map((palKey) => (
                <button
                  key={palKey}
                  onClick={() => setPalette(palKey)}
                  className={`px-2.5 py-1.5 text-xs font-medium rounded-lg border text-left transition-all ${
                    palette === palKey
                      ? 'border-purple-400 bg-purple-600/30 text-white font-bold shadow-sm shadow-purple-500/40'
                      : 'border-slate-800 bg-slate-900/40 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                  }`}
                >
                  <span
                    className="inline-block w-2 h-2 rounded-full mr-1.5"
                    style={{ backgroundColor: PALETTES[palKey].trail }}
                  />
                  {palKey === 'neon'
                    ? 'Violet/Cyan'
                    : palKey === 'emerald'
                      ? 'Emerald'
                      : palKey === 'gold'
                        ? 'Obsidian'
                        : 'Crimson'}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="flex justify-between items-center mb-1.5">
              <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                Digital Rain Dynamics
              </label>
              <span className="text-[10px] text-purple-300 font-mono">{speedMultiplier.toFixed(1)}x speed</span>
            </div>
            <input
              type="range"
              min="0.4"
              max="3.0"
              step="0.2"
              value={speedMultiplier}
              onChange={(e) => setSpeedMultiplier(parseFloat(e.target.value))}
              className="w-full accent-purple-500 bg-slate-800 h-1.5 rounded-lg appearance-none cursor-pointer mb-3"
            />

            <div className="flex justify-between items-center mb-1">
              <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                Cascade Density
              </label>
              <span className="text-[10px] text-cyan-300 font-mono">{density} columns</span>
            </div>
            <input
              type="range"
              min="16"
              max="64"
              step="4"
              value={density}
              onChange={(e) => setDensity(parseInt(e.target.value, 10))}
              className="w-full accent-cyan-400 bg-slate-800 h-1.5 rounded-lg appearance-none cursor-pointer"
            />
          </div>

          <div className="flex flex-col justify-between">
            <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block mb-1.5">
              Cluster Gateway Diagnostics
            </label>
            <div className="flex items-center gap-2 mb-2">
              <button
                onClick={handleTestPing}
                disabled={isPinging}
                className="flex-1 py-2 px-3 rounded-lg border border-cyan-500/40 bg-cyan-950/30 text-cyan-300 text-xs font-semibold hover:bg-cyan-900/40 hover:border-cyan-400 transition-all flex items-center justify-center gap-1.5"
              >
                <span>{isPinging ? '⏳' : '📡'}</span> Ping Gateway (:17332)
              </button>
            </div>
            <div className="text-[11px] font-mono px-3 py-2 rounded-lg bg-black/50 border border-slate-800 text-slate-300 min-h-[34px] flex items-center">
              {pingStatus || 'Gateway Standby · Click to probe latency'}
            </div>
          </div>
        </div>

        {/* Core Architecture Matrix Cards */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-6">
          {/* 1. Spark GB10 Hardware Card */}
          <div
            className={`relative rounded-xl border p-5 transition-all flex flex-col justify-between ${
              activeProviderId === 'spark'
                ? 'border-purple-400 bg-gradient-to-b from-purple-950/40 to-[#0d071d] shadow-lg shadow-purple-900/30'
                : 'border-slate-800 bg-[#0d0a17]/70 hover:border-slate-700'
            }`}
          >
            {activeProviderId === 'spark' && (
              <span className="absolute -top-2.5 right-4 px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-500 text-white uppercase tracking-wider shadow">
                Active Provider
              </span>
            )}
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-2xl">⚡</span>
                <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-purple-900/40 border border-purple-500/30 text-purple-300">
                  GB10 TENSOR CORE
                </span>
              </div>
              <h3 className="text-base font-bold text-white mb-1">DGX Spark (Local Cluster)</h3>
              <p className="text-xs text-purple-200/70 font-mono mb-4">
                Qwen3.6-35B-A3B-abliterated-NVFP4-MTP
              </p>

              <div className="space-y-2.5 text-xs">
                <div className="flex justify-between border-b border-purple-500/10 pb-1.5">
                  <span className="text-slate-400">Serving Engine</span>
                  <span className="font-semibold text-slate-200">vLLM Nightly (:8000)</span>
                </div>
                <div className="flex justify-between border-b border-purple-500/10 pb-1.5">
                  <span className="text-slate-400">Quantization</span>
                  <span className="font-semibold text-cyan-400">NVFP4 Blackwell Native</span>
                </div>
                <div className="flex justify-between border-b border-purple-500/10 pb-1.5">
                  <span className="text-slate-400">Speculative Head</span>
                  <span className="font-semibold text-purple-300">MTP Multi-Token Speedup</span>
                </div>
                <div className="flex justify-between border-b border-purple-500/10 pb-1.5">
                  <span className="text-slate-400">Context Limit</span>
                  <span className="font-semibold text-amber-300">32,768 Tokens (1.27M KV)</span>
                </div>
                <div className="flex justify-between border-b border-purple-500/10 pb-1.5">
                  <span className="text-slate-400">Refusal Vector</span>
                  <span className="font-semibold text-emerald-400">Ablated (Uncensored)</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Token Cost</span>
                  <span className="font-semibold text-emerald-400">$0.00 / Zero API Meter</span>
                </div>
              </div>
            </div>

            <button
              onClick={() => onSelectProvider && onSelectProvider('spark')}
              disabled={activeProviderId === 'spark'}
              className={`mt-5 w-full py-2 rounded-lg text-xs font-bold transition-all ${
                activeProviderId === 'spark'
                  ? 'bg-purple-600/30 text-purple-300 border border-purple-500/30 cursor-default'
                  : 'bg-purple-600 hover:bg-purple-500 text-white shadow-md shadow-purple-700/30'
              }`}
            >
              {activeProviderId === 'spark' ? '✔ Currently Selected' : 'Engage Spark Cluster'}
            </button>
          </div>

          {/* 2. Featherless Cloud Card */}
          <div
            className={`relative rounded-xl border p-5 transition-all flex flex-col justify-between ${
              activeProviderId === 'featherless'
                ? 'border-cyan-400 bg-gradient-to-b from-cyan-950/40 to-[#0d071d] shadow-lg shadow-cyan-900/30'
                : 'border-slate-800 bg-[#0d0a17]/70 hover:border-slate-700'
            }`}
          >
            {activeProviderId === 'featherless' && (
              <span className="absolute -top-2.5 right-4 px-2 py-0.5 rounded-full text-[10px] font-bold bg-cyan-500 text-black uppercase tracking-wider shadow">
                Active Provider
              </span>
            )}
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-2xl">🪶</span>
                <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-cyan-900/40 border border-cyan-500/30 text-cyan-300">
                  SERVERLESS WARM-POOL
                </span>
              </div>
              <h3 className="text-base font-bold text-white mb-1">Featherless Cloud</h3>
              <p className="text-xs text-cyan-200/70 font-mono mb-4">
                Llama-3.3-70B · DeepSeek-V3.2 · Qwen-72B
              </p>

              <div className="space-y-2.5 text-xs">
                <div className="flex justify-between border-b border-cyan-500/10 pb-1.5">
                  <span className="text-slate-400">Endpoint Routing</span>
                  <span className="font-semibold text-slate-200">Key-Proxy (:17332)</span>
                </div>
                <div className="flex justify-between border-b border-cyan-500/10 pb-1.5">
                  <span className="text-slate-400">Model Diversity</span>
                  <span className="font-semibold text-cyan-300">20+ Curated Open Weights</span>
                </div>
                <div className="flex justify-between border-b border-cyan-500/10 pb-1.5">
                  <span className="text-slate-400">Gated Model Access</span>
                  <span className="font-semibold text-amber-300">Auto Ungated Fallback</span>
                </div>
                <div className="flex justify-between border-b border-cyan-500/10 pb-1.5">
                  <span className="text-slate-400">Context Window</span>
                  <span className="font-semibold text-slate-200">Up to 128k Tokens</span>
                </div>
                <div className="flex justify-between border-b border-cyan-500/10 pb-1.5">
                  <span className="text-slate-400">Browser Security</span>
                  <span className="font-semibold text-emerald-400">Zero Client Key Leak</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Availability</span>
                  <span className="font-semibold text-emerald-400">High Cloud Redundancy</span>
                </div>
              </div>
            </div>

            <button
              onClick={() => onSelectProvider && onSelectProvider('featherless')}
              disabled={activeProviderId === 'featherless'}
              className={`mt-5 w-full py-2 rounded-lg text-xs font-bold transition-all ${
                activeProviderId === 'featherless'
                  ? 'bg-cyan-600/30 text-cyan-300 border border-cyan-500/30 cursor-default'
                  : 'bg-cyan-600 hover:bg-cyan-500 text-black shadow-md shadow-cyan-700/30'
              }`}
            >
              {activeProviderId === 'featherless' ? '✔ Currently Selected' : 'Engage Featherless Cloud'}
            </button>
          </div>

          {/* 3. Abliteration AI Card */}
          <div
            className={`relative rounded-xl border p-5 transition-all flex flex-col justify-between ${
              activeProviderId === 'abliteration'
                ? 'border-indigo-400 bg-gradient-to-b from-indigo-950/40 to-[#0d071d] shadow-lg shadow-indigo-900/30'
                : 'border-slate-800 bg-[#0d0a17]/70 hover:border-slate-700'
            }`}
          >
            {activeProviderId === 'abliteration' && (
              <span className="absolute -top-2.5 right-4 px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-500 text-white uppercase tracking-wider shadow">
                Active Provider
              </span>
            )}
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-2xl">🛡️</span>
                <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-indigo-900/40 border border-indigo-500/30 text-indigo-300">
                  RED-TEAM FORGING
                </span>
              </div>
              <h3 className="text-base font-bold text-white mb-1">Abliteration AI</h3>
              <p className="text-xs text-indigo-200/70 font-mono mb-4">
                abliterated-model-large-v2
              </p>

              <div className="space-y-2.5 text-xs">
                <div className="flex justify-between border-b border-indigo-500/10 pb-1.5">
                  <span className="text-slate-400">Alignment Mode</span>
                  <span className="font-semibold text-indigo-300">Exposition Neutral</span>
                </div>
                <div className="flex justify-between border-b border-indigo-500/10 pb-1.5">
                  <span className="text-slate-400">Security Research</span>
                  <span className="font-semibold text-emerald-400">Zero Refusal Shield</span>
                </div>
                <div className="flex justify-between border-b border-indigo-500/10 pb-1.5">
                  <span className="text-slate-400">System Tool Calling</span>
                  <span className="font-semibold text-slate-200">Subshell & Scripting</span>
                </div>
                <div className="flex justify-between border-b border-indigo-500/10 pb-1.5">
                  <span className="text-slate-400">Context Window</span>
                  <span className="font-semibold text-slate-200">32,768 Tokens</span>
                </div>
                <div className="flex justify-between border-b border-indigo-500/10 pb-1.5">
                  <span className="text-slate-400">Enterprise Guard</span>
                  <span className="font-semibold text-indigo-300">High Assurance Pipeline</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Target Role</span>
                  <span className="font-semibold text-amber-300">Cyber Forensics & Recon</span>
                </div>
              </div>
            </div>

            <button
              onClick={() => onSelectProvider && onSelectProvider('abliteration')}
              disabled={activeProviderId === 'abliteration'}
              className={`mt-5 w-full py-2 rounded-lg text-xs font-bold transition-all ${
                activeProviderId === 'abliteration'
                  ? 'bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 cursor-default'
                  : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-700/30'
              }`}
            >
              {activeProviderId === 'abliteration' ? '✔ Currently Selected' : 'Engage Abliteration AI'}
            </button>
          </div>
        </div>

        {/* Footer Audit Bar */}
        <div className="flex items-center justify-between pt-4 border-t border-purple-500/20 text-xs text-slate-400 font-mono">
          <div className="flex items-center gap-4">
            <span>● MEMORY PALACE: ONLINE (:17333)</span>
            <span>● SANDBOX RUNNER: PORT :17330</span>
            <span>● DIRECTIVE 4: ZERO BASE64 PIPELINE</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg border border-purple-500/30 bg-purple-900/30 text-purple-200 hover:bg-purple-800/40 hover:text-white transition-all font-sans font-semibold"
          >
            Return to Studio
          </button>
        </div>
      </div>
    </div>
  )
}
