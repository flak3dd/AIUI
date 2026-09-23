import React from 'react'
import type { MonologueEntry } from '../../lib/commandSpaceEngine'

export interface MonospaceTelemetryBarProps {
  latestMonologue?: MonologueEntry
  onSwitchToStudio?: () => void
  gpuUtil?: number
  gpuTemp?: number
  vramUsedGb?: number
  sandboxHealthy?: boolean
  mempalaceHealthy?: boolean
  activeWorkspaceEnvId?: string
}

export const MonospaceTelemetryBar: React.FC<MonospaceTelemetryBarProps> = ({
  latestMonologue,
  onSwitchToStudio,
  gpuUtil = 14,
  gpuTemp = 52,
  vramUsedGb = 36.3,
  sandboxHealthy = true,
  mempalaceHealthy = true,
  activeWorkspaceEnvId = 'workspace1',
}) => {
  const stateTag = latestMonologue?.stateTag || 'AGENT_IDLE'
  const detail = latestMonologue?.detail || 'Ready for instructions.'
  const level = latestMonologue?.level || 'info'

  return (
    <footer className="monospace-telemetry-bar">
      {/* Left: Raw Agent Monologue Ticker */}
      <div className="telemetry-monologue-section">
        <span className="telemetry-prompt-arrow">&gt;</span>
        <span className={`telemetry-state-tag level-${level}`}>
          [{stateTag}]:
        </span>
        <span className="telemetry-detail-text">
          {detail}
        </span>
        <span className="telemetry-blinking-cursor">_</span>
      </div>

      {/* Right: Hardware & Runtime Cluster Telemetry */}
      <div className="telemetry-hardware-section">
        <div className="telemetry-chip">
          <span className="chip-label">GB10:</span>
          <span className="chip-val">{gpuUtil}%</span>
          <span className="chip-dim">·</span>
          <span className="chip-val">{gpuTemp}°C</span>
          <span className="chip-dim">·</span>
          <span className="chip-val">{vramUsedGb}GB/121GB</span>
        </div>

        <div className="telemetry-chip">
          <span
            className="chip-dot"
            style={{ background: sandboxHealthy ? '#10b981' : '#ef4444' }}
          />
          <span className="chip-val">:17330</span>
        </div>

        <div className="telemetry-chip">
          <span
            className="chip-dot"
            style={{ background: mempalaceHealthy ? '#10b981' : '#f59e0b' }}
          />
          <span className="chip-val">:17333</span>
        </div>

        <div className="telemetry-chip env-chip">
          <span className="chip-label">ENV:</span>
          <span className="chip-val">{activeWorkspaceEnvId}</span>
        </div>

        {onSwitchToStudio && (
          <button
            type="button"
            className="btn-switch-studio"
            onClick={onSwitchToStudio}
            title="Switch back to Studio Chat view (⌘+Shift+M)"
          >
            ⧉ STUDIO
          </button>
        )}
      </div>
    </footer>
  )
}
