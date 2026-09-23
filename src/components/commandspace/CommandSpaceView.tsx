import React, { useState } from 'react'
import type { TerminalPaneData, CodeCanvasFile, MonologueEntry } from '../../lib/commandSpaceEngine'
import type { UiMessage } from '../../types/ui'
import { AutoGridMultiplexer } from './AutoGridMultiplexer'
import { GhostTypeEditor } from './GhostTypeEditor'
import { CommandSpacePrompt } from './CommandSpacePrompt'
import { MonospaceTelemetryBar } from './MonospaceTelemetryBar'

export interface CommandSpaceViewProps {
  panes: TerminalPaneData[]
  activeCodeFile: CodeCanvasFile | null
  latestMonologue?: MonologueEntry
  recentMessages: UiMessage[]
  busy: boolean
  onSend: (text: string) => Promise<void>
  onStop: () => void
  onClosePane: (id: string) => void
  onToggleMaximizePane: (id: string) => void
  onClearCompletedPanes: () => void
  onSwitchToStudio: () => void
  onAutoHeal?: (command: string, errorText: string) => void
  onInsertToComposer?: (text: string) => void
  activeWorkspaceEnvId?: string
  sandboxHealthy?: boolean
  mempalaceHealthy?: boolean
}

export const CommandSpaceView: React.FC<CommandSpaceViewProps> = ({
  panes,
  activeCodeFile,
  latestMonologue,
  recentMessages,
  busy,
  onSend,
  onStop,
  onClosePane,
  onToggleMaximizePane,
  onClearCompletedPanes,
  onSwitchToStudio,
  onAutoHeal,
  onInsertToComposer,
  activeWorkspaceEnvId = 'workspace1',
  sandboxHealthy = true,
  mempalaceHealthy = true,
}) => {
  const [codeCanvasOpen, setCodeCanvasOpen] = useState<boolean>(true)

  // Extract last failed command & error text for immediate self-healing chip
  const lastErrorPane = panes.slice().reverse().find((p) => p.state === 'error' || (p.exitCode !== null && p.exitCode !== 0))
  const lastErrorCommand = lastErrorPane?.command
  const lastErrorText = lastErrorPane?.stderr || lastErrorPane?.stdout

  return (
    <div className="commandspace-view-root">
      {/* Top Multiplexer Control Bar */}
      <div className="commandspace-top-nav">
        <div className="top-nav-left">
          <div className="commandspace-brand-badge">
            <span className="brand-dot" />
            <span className="brand-title">COMMANDSPACE</span>
            <span className="brand-subtitle">// INTELLIGENT MULTIPLEXER</span>
          </div>

          <span className="nav-divider">|</span>

          <div className="pane-summary-tags">
            <span className="tag-item">
              <span className="tag-val">{panes.length}</span> {panes.length === 1 ? 'pane' : 'panes'}
            </span>
            {panes.some((p) => p.state === 'streaming') && (
              <span className="tag-item tag-streaming">● STREAMING</span>
            )}
            {lastErrorPane && (
              <span className="tag-item tag-error">⚠ FAULT DETECTED</span>
            )}
          </div>
        </div>

        <div className="top-nav-right">
          <button
            type="button"
            className={`btn-nav-mode ${codeCanvasOpen ? 'mode-active' : ''}`}
            onClick={() => setCodeCanvasOpen(!codeCanvasOpen)}
            title="Toggle Ghost-Type Code Canvas split"
          >
            ⚡ Canvas [{codeCanvasOpen ? 'ON' : 'OFF'}]
          </button>

          <button
            type="button"
            className="btn-nav-mode btn-mode-studio"
            onClick={onSwitchToStudio}
            title="Switch back to Studio Chat view (⌘+Shift+M)"
          >
            💬 Studio Mode
          </button>
        </div>
      </div>

      {/* Main Multiplexer Split Area: Auto-Grid Panes + Persistent Code Canvas */}
      <div className={`commandspace-main-stage ${codeCanvasOpen && activeCodeFile ? 'has-code-canvas' : 'full-terminal-grid'}`}>
        {/* Dynamic Tiling Auto-Grid */}
        <div className="stage-terminal-grid">
          <AutoGridMultiplexer
            panes={panes}
            onClosePane={onClosePane}
            onToggleMaximizePane={onToggleMaximizePane}
            onAutoHeal={onAutoHeal}
          />
        </div>

        {/* Persistent Ghost-Type Code Canvas */}
        {codeCanvasOpen && (
          <div className="stage-code-canvas">
            <GhostTypeEditor
              file={activeCodeFile}
              onClose={() => setCodeCanvasOpen(false)}
              onSendToComposer={onInsertToComposer}
            />
          </div>
        )}
      </div>

      {/* Integrated User/Agent Conversation Bar & Dialogue HUD */}
      <CommandSpacePrompt
        busy={busy}
        onSend={onSend}
        onStop={onStop}
        onClearCompleted={onClearCompletedPanes}
        onToggleCodeCanvas={() => setCodeCanvasOpen(!codeCanvasOpen)}
        codeCanvasOpen={codeCanvasOpen}
        recentMessages={recentMessages}
        lastErrorCommand={lastErrorCommand}
        lastErrorText={lastErrorText}
        onAutoHeal={onAutoHeal}
      />

      {/* Persistent Monospace Telemetry Status Bar */}
      <MonospaceTelemetryBar
        latestMonologue={latestMonologue}
        onSwitchToStudio={onSwitchToStudio}
        sandboxHealthy={sandboxHealthy}
        mempalaceHealthy={mempalaceHealthy}
        activeWorkspaceEnvId={activeWorkspaceEnvId}
      />
    </div>
  )
}
