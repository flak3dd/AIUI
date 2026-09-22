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

export interface GpuTelemetryPillProps {
  sparkHost?: string
  className?: string
}

export const GpuTelemetryPill: React.FC<GpuTelemetryPillProps> = ({ sparkHost, className }) => {
  const [data, setData] = useState<SparkTelemetryData | null>(null)
  const [openPopover, setOpenPopover] = useState(false)
  const [latencyMs, setLatencyMs] = useState<number | null>(null)
  const [isOnline, setIsOnline] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let active = true

    const probe = async () => {
      const t0 = performance.now()
      try {
        // Try local Spark controller bridge first (:17325)
        const res = await fetch('http://127.0.0.1:17325/api/status', {
          signal: AbortSignal.timeout(2500),
        })
        if (res.ok) {
          const json = (await res.json()) as SparkTelemetryData
          if (active) {
            setData(json)
            setIsOnline(true)
            setLatencyMs(Math.round(performance.now() - t0))
          }
          return
        }
      } catch {
        /* fallback to remote Spark controller */
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
            setIsOnline(true)
            setLatencyMs(Math.round(performance.now() - t0))
          }
          return
        }
      } catch {
        if (active) {
          setIsOnline(false)
        }
      }
    }

    void probe()
    const tick = () => {
      if (document.visibilityState === 'hidden') return
      void probe()
    }
    const interval = setInterval(tick, 10000)
    const onVis = () => {
      if (document.visibilityState === 'visible') void probe()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      active = false
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])

  // Close popover on outside click
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

  if (!isOnline || !data?.gpu) {
    return (
      <div className={`gpu-telemetry-pill offline ${className || ''}`.trim()} title="Spark GPU Controller offline (:17325)">
        <span className="gpu-dot offline" />
        <span className="gpu-label">GB10 GPU</span>
      </div>
    )
  }

  const gpu = data.gpu
  const usedGb = (gpu.unifiedUsedGb || gpu.vramUsedMb / 1024).toFixed(1)
  const totalGb = (gpu.unifiedTotalGb || gpu.vramTotalMb / 1024).toFixed(1)
  const pct = Math.round(gpu.memUtilPct || (gpu.vramUsedMb / gpu.vramTotalMb) * 100)
  const runningModel = data.docker?.find((d) => d.running)?.name || 'qwen-abliterated'

  const getMeterColor = (val: number) => {
    if (val > 90) return 'var(--dracula-pink)'
    if (val > 70) return 'var(--dracula-orange)'
    return 'var(--dracula-green)'
  }

  return (
    <div className={`gpu-telemetry-container ${className || ''}`.trim()} ref={popoverRef}>
      <div
        className={`gpu-telemetry-pill online ${openPopover ? 'active' : ''}`}
        onClick={() => setOpenPopover(!openPopover)}
        title="NVIDIA GB10 Blackwell GPU Telemetry · Click for detailed specifications"
      >
        <div className="gpu-telemetry-left">
          <span className="gpu-dot online pulse" />
          <span className="gpu-chip-name">GB10</span>
          <span className="gpu-temp-badge">{gpu.tempC}°C</span>
          <span className="gpu-power-badge">{Math.round(gpu.powerDrawW)}W</span>
        </div>

        <div className="gpu-meter-wrapper" title={`VRAM: ${usedGb} / ${totalGb} GiB (${pct}%)`}>
          <div
            className="gpu-meter-fill"
            style={{ width: `${Math.min(100, pct)}%`, background: getMeterColor(pct) }}
          />
        </div>

        <span className="gpu-vram-text">{usedGb}G</span>
      </div>

      {/* Expanded Telemetry Popover */}
      {openPopover && (
        <div className="gpu-telemetry-popover">
          <div className="gpu-popover-header">
            <div className="row" style={{ gap: 8, alignItems: 'center' }}>
              <span className="gpu-dot online" />
              <strong>{gpu.name} (Blackwell GB10)</strong>
            </div>
            {latencyMs != null && <span className="gpu-ping-tag">{latencyMs}ms</span>}
          </div>

          <div className="gpu-popover-grid">
            <div className="gpu-stat-cell">
              <span className="gpu-stat-label">UNIFIED VRAM</span>
              <span className="gpu-stat-value">
                {usedGb} / {totalGb} GiB
              </span>
              <div className="gpu-stat-sub">{pct}% Allocated (LPDDR5x)</div>
            </div>

            <div className="gpu-stat-cell">
              <span className="gpu-stat-label">GPU UTILIZATION</span>
              <span className="gpu-stat-value">{gpu.gpuUtilPct}%</span>
              <div className="gpu-stat-sub">Clock: {gpu.clockMhz} MHz</div>
            </div>

            <div className="gpu-stat-cell">
              <span className="gpu-stat-label">THERMALS</span>
              <span className="gpu-stat-value">{gpu.tempC}°C</span>
              <div className="gpu-stat-sub">Target: &lt;85°C</div>
            </div>

            <div className="gpu-stat-cell">
              <span className="gpu-stat-label">POWER DRAW</span>
              <span className="gpu-stat-value">{gpu.powerDrawW.toFixed(1)}W</span>
              <div className="gpu-stat-sub">Limit: {gpu.powerLimitW}W Envelope</div>
            </div>
          </div>

          <div className="gpu-popover-footer">
            <div className="gpu-docker-status">
              <span className="active-dot" />
              <span>Served Model: <strong>{runningModel}</strong></span>
            </div>
            <div className="gpu-driver-tag">Driver {gpu.driver}</div>
          </div>
        </div>
      )}
    </div>
  )
}
