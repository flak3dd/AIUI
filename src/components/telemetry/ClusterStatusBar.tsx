import React from 'react'

export interface ClusterStatusBarProps {
  sandboxHealthy?: boolean
  mempalaceHealthy?: boolean
  gpuTemp?: number
  gpuUtil?: number
  vramUsedGb?: number
}

/** Health-only footer. SSH, Base64, Sandbox, and ⌘K live in the command palette. */
export const ClusterStatusBar: React.FC<ClusterStatusBarProps> = ({
  sandboxHealthy = true,
  mempalaceHealthy = true,
  gpuTemp = 64,
  gpuUtil = 93,
  vramUsedGb = 49.5,
}) => {
  return (
    <footer className="cluster-status-bar" aria-label="Cluster health">
      <div className="cluster-status-metrics">
        <div className="cluster-status-gpu">
          <span className="cluster-status-label">GB10</span>
          <span className={gpuUtil > 90 ? 'cluster-status-warn' : 'cluster-status-ok'}>
            {gpuUtil}% UTIL
          </span>
          <span className="cluster-status-sep">·</span>
          <span>{gpuTemp}°C</span>
          <span className="cluster-status-sep">·</span>
          <span>
            {vramUsedGb}GB / 121GB
          </span>
        </div>
        <span className="cluster-status-pipe" aria-hidden="true">
          |
        </span>
        <div className="cluster-status-daemons">
          <span className="cluster-status-daemon">
            <i className={`cluster-status-dot ${sandboxHealthy ? 'ok' : 'bad'}`} />
            Runner :17330
          </span>
          <span className="cluster-status-daemon">
            <i className={`cluster-status-dot ${mempalaceHealthy ? 'ok' : 'warn'}`} />
            Palace :17333
          </span>
          <span className="cluster-status-muted">LAN: ~10ms</span>
        </div>
      </div>
    </footer>
  )
}
