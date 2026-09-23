import React from 'react'
import type { TerminalPaneData } from '../../lib/commandSpaceEngine'
import { TerminalPane } from './TerminalPane'

export interface AutoGridMultiplexerProps {
  panes: TerminalPaneData[]
  onClosePane: (id: string) => void
  onToggleMaximizePane: (id: string) => void
  onAutoHeal?: (command: string, errorText: string) => void
}

export const AutoGridMultiplexer: React.FC<AutoGridMultiplexerProps> = ({
  panes,
  onClosePane,
  onToggleMaximizePane,
  onAutoHeal,
}) => {
  if (panes.length === 0) {
    return (
      <div className="autogrid-empty-state">
        <div className="autogrid-empty-icon">⚡</div>
        <div className="autogrid-empty-title">CommandSpace Multiplexer Ready</div>
        <div className="autogrid-empty-desc">
          When the AI launches background processes, web servers, or tests, panes will auto-tile here.
        </div>
        <div className="autogrid-empty-hint">
          Type a prompt in the command bar below to trigger autonomous multi-process execution.
        </div>
      </div>
    )
  }

  // Check if any pane is maximized by user or auto-focused by error
  const maximizedPane = panes.find((p) => p.maximized)
  if (maximizedPane) {
    return (
      <div className="autogrid-container grid-single-maximized">
        <TerminalPane
          key={maximizedPane.id}
          pane={maximizedPane}
          onClose={onClosePane}
          onToggleMaximize={onToggleMaximizePane}
          onAutoHeal={onAutoHeal}
        />
      </div>
    )
  }

  // Determine dynamic layout class based on pane count and states
  const activeStreamingCount = panes.filter((p) => p.state === 'streaming').length
  const errorCount = panes.filter((p) => p.state === 'error').length

  let layoutClass = 'layout-multi'
  if (panes.length === 1) {
    layoutClass = 'layout-single'
  } else if (panes.length === 2) {
    layoutClass = 'layout-dual'
  } else if (panes.length === 3) {
    layoutClass = 'layout-tri'
  } else {
    layoutClass = 'layout-quad'
  }

  return (
    <div
      className={`autogrid-container ${layoutClass} ${errorCount > 0 ? 'has-critical-error' : ''} ${activeStreamingCount > 0 ? 'has-active-stream' : ''}`}
    >
      {panes.map((pane) => (
        <TerminalPane
          key={pane.id}
          pane={pane}
          onClose={onClosePane}
          onToggleMaximize={onToggleMaximizePane}
          onAutoHeal={onAutoHeal}
        />
      ))}
    </div>
  )
}
