import React, { useEffect, useState, useRef } from 'react'

export interface GpuStats {
  name: string
  driver: string
  tempC: number
  gpuUtilPct: number
  memUtilPct: number
  vramUsedMb: number
  vramTotalMb: number
  powerDrawW: number
  powerLimitW: number
  clockMhz: number
  memoryKind?: string
  unifiedSpecGb?: number
  unifiedTotalGb?: number
  unifiedUsedGb?: number
  unifiedFreeGb?: number
}

export interface SparkTelemetryData {
  ok: boolean
  gpu?: GpuStats
  docker?: Array<{ name: string; status: string; running: boolean }>
  live?: { port: number; health: boolean; models?: Array<{ id: string }> }
  sshOk?: boolean
}

export interface MeshPulseProps {
  sparkHost?: string
  sandboxOnline?: boolean
  sandboxLatency?: number
  mempalaceOnline?: boolean
  mempalaceLatency?: number
  className?: string
}

export const MeshPulse: React.FC<MeshPulseProps> = ({
  sparkHost = '192.168.4.103',
  sandboxOnline = false,
  sandboxLatency,
  mempalaceOnline = false,
  mempalaceLatency,
  className = '',
}) => {
  const [data, setData] = useState<SparkTelemetryData | null>(null)
  const [openPopover, setOpenPopover] = useState(false)
  const [sparkLatency, setSparkLatency] = useState<number | null>(null)
  const [sparkOnline, setSparkOnline] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let active = true

    const probe = async () => {
      const t0 = performance.now()
      try {
        const res = await fetch('http://127.0.0.1:17325/api/status', {
          signal: AbortSignal.timeout(2500),
        })
        if (res.ok) {
          const json = (await res.json()) as SparkTelemetryData
          if (active) {
            setData(json)
            setSparkOnline(true)
            setSparkLatency(Math.round(performance.now() - t0))
          }
          return
        }
      } catch {
        /* fallback to remote controller */
      }

      try {
        const host = sparkHost || '192.168.4.103'
        const resSpark = await fetch(`http://${host}:17325/api/status`, {
          signal: AbortSignal.timeout(2500),
        })
        if (resSpark.ok) {
          const json = (await resSpark.json()) as SparkTelemetryData
          if (active) {
            setData(json)
            setSparkOnline(true)
            setSparkLatency(Math.round(performance.now() - t0))
          }
          return
        }
      } catch {
        if (active) {
          setSparkOnline(false)
        }
      }
    }

    void probe()
    const tick = () => {
      if (document.visibilityState === 'hidden') return
      void probe()
    }
    const timer = setInterval(tick, 12000)
    const onVis = () => {
      if (document.visibilityState === 'visible') void probe()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      active = false
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [sparkHost])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpenPopover(false)
      }
    }
    if (openPopover) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [openPopover])

  // Determine overall mesh health
  const isHealthy = sparkOnline && sandboxOnline
  const isDegraded = !isHealthy && (sparkOnline || sandboxOnline || mempalaceOnline)
  const statusClass = isHealthy ? 'ok' : isDegraded ? 'warn' : 'danger'

  const gpu = data?.gpu
  const usedGb = gpu ? (gpu.unifiedUsedGb || gpu.vramUsedMb / 1024).toFixed(1) : null
  const totalGb = gpu ? (gpu.unifiedTotalGb || gpu.vramTotalMb / 1024).toFixed(1) : null
  const pct = gpu ? Math.round(gpu.memUtilPct || (gpu.vramUsedMb / gpu.vramTotalMb) * 100) : null

  return (
    <div className={`mesh-pulse-container ${className}`.trim()} ref={popoverRef}>
      <button
        type="button"
        className={`mesh-pulse-pill ${statusClass} ${openPopover ? 'active' : ''}`}
        onClick={() => setOpenPopover(!openPopover)}
        title="Mesh Status · Click to view node telemetry"
      >
        <span className={`mesh-dot ${statusClass}`} />
        <span className="mesh-label">Mesh</span>
        {pct !== null && <span className="mesh-sublabel">{pct}% VRAM</span>}
      </button>

      {openPopover && (
        <div className="mesh-popover-card">
          <div className="mesh-popover-header">
            <div className="mesh-popover-title">
              <img src="/icons/icon-chart.png" alt="Mesh" className="popover-icon-img" />
              <span>Mesh Network & Hardware</span>
            </div>
            <span className="mesh-node-pill">{sparkHost}</span>
          </div>

          <div className="mesh-node-list">
            {/* DGX Spark GPU */}
            <div className="mesh-node-row">
              <div className="node-row-left">
                <span className={`status-indicator ${sparkOnline ? 'ok' : 'danger'}`} />
                <div>
                  <div className="node-name">DGX Spark (Blackwell GB10)</div>
                  <div className="node-sub">
                    {sparkOnline && gpu
                      ? `${gpu.tempC}°C · ${Math.round(gpu.powerDrawW)}W · ${usedGb}/${totalGb} GiB unified`
                      : 'GPU Controller (:17325)'}
                  </div>
                </div>
              </div>
              <div className="node-latency">
                {sparkOnline ? `${sparkLatency ?? '<10'}ms` : 'Offline'}
              </div>
            </div>

            {/* Sandbox Shell Runner */}
            <div className="mesh-node-row">
              <div className="node-row-left">
                <span className={`status-indicator ${sandboxOnline ? 'ok' : 'danger'}`} />
                <div>
                  <div className="node-name">Sandbox Shell Runner</div>
                  <div className="node-sub">127.0.0.1:17330 · bash / python exec</div>
                </div>
              </div>
              <div className="node-latency">
                {sandboxOnline ? `${sandboxLatency ?? '<5'}ms` : 'Offline'}
              </div>
            </div>

            {/* MemPalace */}
            <div className="mesh-node-row">
              <div className="node-row-left">
                <span className={`status-indicator ${mempalaceOnline ? 'ok' : 'warn'}`} />
                <div>
                  <div className="node-name">MemPalace Semantic Recall</div>
                  <div className="node-sub">127.0.0.1:17333 · memory graph</div>
                </div>
              </div>
              <div className="node-latency">
                {mempalaceOnline ? `${mempalaceLatency ?? '<15'}ms` : 'Standby'}
              </div>
            </div>

            {/* Go Edge Gateway */}
            <div className="mesh-node-row">
              <div className="node-row-left">
                <span className="status-indicator ok" />
                <div>
                  <div className="node-name">Edge Gateway Proxy</div>
                  <div className="node-sub">127.0.0.1:8080 · Go reverse proxy</div>
                </div>
              </div>
              <div className="node-latency">Active</div>
            </div>
          </div>

          {gpu && (
            <div className="mesh-gpu-bar">
              <div className="gpu-bar-header">
                <span>Unified Memory Allocation</span>
                <span>{usedGb} / {totalGb} GiB ({pct}%)</span>
              </div>
              <div className="gpu-bar-track">
                <div
                  className="gpu-bar-fill"
                  style={{
                    width: `${Math.min(100, pct || 0)}%`,
                    background: (pct || 0) > 90 ? 'var(--danger)' : (pct || 0) > 70 ? 'var(--warn)' : 'var(--accent-2)',
                  }}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
