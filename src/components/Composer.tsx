import React from 'react'
import type { StoredSettings, ProviderId } from '../lib/providers'
import { modelLabel, preferFor, isGatedModelId } from '../lib/providers'
import { ABLITERATION_LEVELS, ABLITERATION_LEVEL_ORDER } from '../lib/abliterationLevel'
import type { ExecutionTarget } from '../lib/bashShell'
import type { AntiLoopSuggestion } from '../lib/agentAnalyzer'

export interface ComposerProps {
  error: string | null
  modelsError: string | null
  agentStatus: {
    round: number
    maxRounds: number
    stage: string
    detail?: string
  } | null
  antiLoopSuggestions?: AntiLoopSuggestion[] | null
  onAntiLoopSuggestion?: (prompt: string) => void
  stop: () => void
  settings: StoredSettings
  persist: (next: StoredSettings) => void
  showToast: (msg: string, opts?: { type?: 'info' | 'success' | 'warning' | 'error'; icon?: string; duration?: number }) => void
  onOpenTerminal: () => void
  composerAdvanced: boolean
  setComposerAdvanced: React.Dispatch<React.SetStateAction<boolean>>
  modelQuery: string
  setModelQuery: (v: string) => void
  filteredModels: string[]
  models: string[]
  gatedIds: Set<string>
  bashTarget: ExecutionTarget
  handleTargetChange: (t: ExecutionTarget) => void
  busy: boolean
  showModelSearch: boolean
  setShowModelSearch: React.Dispatch<React.SetStateAction<boolean>>
  hideGated: boolean
  setHideGated: React.Dispatch<React.SetStateAction<boolean>>
  autoAblit: boolean
  handleAutoAblitToggle: (v: boolean) => void
  paramsAccordionOpen: boolean
  setParamsAccordionOpen: React.Dispatch<React.SetStateAction<boolean>>
  autoRecall: boolean
  handleAutoRecallToggle: (v: boolean) => void
  autoCheckpoint: boolean
  handleAutoCheckpointToggle: (v: boolean) => void
  input: string
  setInput: (v: string) => void
  send: () => void
  handleInspectDuckDb: () => void
  handleBranchSession: () => void
}

export function Composer(props: ComposerProps) {
  const {
    error,
    modelsError,
    agentStatus,
    antiLoopSuggestions,
    onAntiLoopSuggestion,
    stop,
    settings,
    persist,
    showToast,
    onOpenTerminal,
    composerAdvanced,
    setComposerAdvanced,
    modelQuery,
    setModelQuery,
    filteredModels,
    models,
    gatedIds,
    bashTarget,
    handleTargetChange,
    busy,
    showModelSearch,
    setShowModelSearch,
    hideGated,
    setHideGated,
    autoAblit,
    handleAutoAblitToggle,
    paramsAccordionOpen,
    setParamsAccordionOpen,
    autoRecall,
    handleAutoRecallToggle,
    autoCheckpoint,
    handleAutoCheckpointToggle,
    input,
    setInput,
    send,
    handleInspectDuckDb,
    handleBranchSession,
  } = props

  return (
    <div className="composer">
      {error && <div className="error">{error}</div>}
      {modelsError && <div className="hint">{modelsError}</div>}

      {agentStatus && (
        <div className="agent-status-banner">
          <div className="agent-status-left">
            <span
              className={`agent-pulse-dot ${
                agentStatus.stage === 'anti_loop'
                  ? 'anti_loop'
                  : agentStatus.stage === 'fixing'
                  ? 'fixing'
                  : ''
              }`}
            />
            <span className="agent-round-badge">Round {agentStatus.round}/{agentStatus.maxRounds}</span>
            <span className="agent-status-text">
              {agentStatus.stage === 'anti_loop'
                ? `Adjusting approach: ${agentStatus.detail || 'trying a different path…'}`
                : agentStatus.stage === 'fixing'
                ? `${settings.deepBuild ? 'Deep fix' : 'Fixing'}${agentStatus.detail ? `: ${agentStatus.detail}` : '…'}`
                : agentStatus.stage === 'running_cmd'
                ? `Running: ${agentStatus.detail || 'command'}`
                : settings.deepBuild
                ? 'Thinking through the plan…'
                : 'Thinking…'}
            </span>
          </div>
          <button type="button" className="btn-sm ghost" onClick={stop} title="Stop">
            Stop
          </button>
        </div>
      )}

      {antiLoopSuggestions && antiLoopSuggestions.length > 0 && (
        <div className="anti-loop-suggestions" role="group" aria-label="Anti-loop prompt suggestions">
          <div className="anti-loop-suggestions-label">
            {agentStatus?.stage === 'anti_loop' ? 'Anti-Loop Active' : 'Anti-Loop'} · prompt suggestions
          </div>
          <div className="anti-loop-suggestions-row">
            {antiLoopSuggestions.map((s) => (
              <button
                key={s.id}
                type="button"
                className="anti-loop-chip"
                title={s.prompt}
                onClick={() => onAntiLoopSuggestion?.(s.prompt)}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="composer-flip-stage">
        <div className="composer-flipper">
          {/* Composer */}
          <div className="composer-face composer-front">
            <div className={`composer-capsule ${composerAdvanced ? "is-advanced" : ""}`}>
              <div className="composer-top-bar">
                <div className="composer-selectors">
                  <select
                    className="composer-select-compact"
                    value={settings.model}
                    onChange={(e) => {
                      persist({ ...settings, model: e.target.value })
                      showToast(`Model → ${modelLabel(e.target.value)}`, { type: 'info' })
                    }}
                    disabled={busy}
                    title="Model"
                  >
                    {(filteredModels.length ? filteredModels : models).map((id) => {
                      const gated = gatedIds.has(id) || isGatedModelId(id)
                      const label = modelLabel(id)
                      return (
                        <option key={id} value={id}>
                          {gated ? `🔒 ${label}` : `⚡ ${label}`}
                        </option>
                      )
                    })}
                  </select>

                  <select
                    className="composer-select-compact"
                    value={bashTarget}
                    onChange={(e) => {
                      const t = e.target.value as ExecutionTarget
                      handleTargetChange(t)
                      showToast(`Run on ${t}`, { type: 'info' })
                    }}
                    title="Where to run commands"
                  >
                    <option value="local_mac">💻 local_mac</option>
                    <option value="dgx_spark">🚀 dgx_spark</option>
                    <option value="container">📦 linux_pod</option>
                  </select>

                  <select
                    className="composer-select-compact"
                    value={settings.provider}
                    onChange={(e) => {
                      const nextProvider = e.target.value as ProviderId
                      persist({ ...settings, provider: nextProvider, model: preferFor(nextProvider)[0] })
                      showToast(`Provider → ${nextProvider}`, { type: 'info' })
                    }}
                    disabled={busy}
                    title="Provider"
                  >
                    <option value="spark">GX10 Spark</option>
                    <option value="featherless">Featherless</option>
                    <option value="abliteration">Abliteration</option>
                  </select>

                  <button
                    type="button"
                    className={`composer-tool-btn ${showModelSearch ? 'active' : ''}`}
                    onClick={() => setShowModelSearch(!showModelSearch)}
                    title="Search / filter models"
                    style={{ padding: '3px 7px' }}
                  >
                    🔍
                  </button>

                  {showModelSearch && (
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <input
                        className="composer-select-compact"
                        style={{ width: 110, fontSize: 11 }}
                        placeholder="Search…"
                        value={modelQuery}
                        onChange={(e) => setModelQuery(e.target.value)}
                        autoFocus
                      />
                      {settings.provider === 'featherless' && (
                        <label className="chip clickable" style={{ padding: '2px 5px', fontSize: 10 }}>
                          <input
                            type="checkbox"
                            checked={hideGated}
                            onChange={(e) => setHideGated(e.target.checked)}
                            style={{ marginRight: 2 }}
                          />
                          Ungated
                        </label>
                      )}
                    </div>
                  )}
                </div>

                <div className="composer-toggles-strip">
                  <button
                    type="button"
                    className={`composer-toggle-pill ${settings.agentMode ? 'active' : ''}`}
                    onClick={() => {
                      const next = !settings.agentMode
                      persist({ ...settings, agentMode: next })
                      showToast(`Agent loop ${next ? 'enabled' : 'disabled'}`, { type: 'info' })
                    }}
                    disabled={busy}
                    title="Agent: autonomous bash shell execution and self-healing fix loop"
                  >
                    ⚡ Agent
                  </button>

                  <button
                    type="button"
                    className={`composer-toggle-pill ${settings.deepBuild ? 'active deep' : ''}`}
                    onClick={() => {
                      const next = !settings.deepBuild
                      persist({ ...settings, deepBuild: next })
                      showToast(`Deep build ${next ? 'enabled' : 'disabled'}`, { type: 'info' })
                    }}
                    disabled={busy}
                    title="Deep Thinking & Comprehensive Architecture Plan"
                  >
                    🧠 Deep
                  </button>

                  <button
                    type="button"
                    className={`composer-toggle-pill ${settings.clusterRag !== false ? 'active' : ''}`}
                    onClick={() => {
                      const next = settings.clusterRag === false
                      persist({ ...settings, clusterRag: next })
                      showToast(`RAG ${next ? 'enabled' : 'disabled'}`, { type: 'info' })
                    }}
                    disabled={busy}
                    title="On-Device Cluster Ground Truth RAG"
                  >
                    📚 RAG
                  </button>

                  <button
                    type="button"
                    className={`composer-toggle-pill ${autoAblit ? 'active' : ''}`}
                    onClick={() => handleAutoAblitToggle(!autoAblit)}
                    title="Automatically run bash commands emitted by the assistant"
                  >
                    ⚡ Auto
                  </button>

                  <button
                    type="button"
                    className={`composer-params-toggle-btn ${paramsAccordionOpen ? 'active' : ''}`}
                    onClick={() => setParamsAccordionOpen(!paramsAccordionOpen)}
                    title="Expand Hyperparameters & Telemetry Accordion"
                  >
                    <span>⚙ PARAMS</span>
                    <span style={{ fontSize: 9.5, opacity: 0.85 }}>T:{settings.temperature ?? 0.7}</span>
                    <span className={`fui-chevron ${paramsAccordionOpen ? 'open' : ''}`}>▾</span>
                  </button>
                </div>
              </div>

              {/* Expandable Hyperparameters & Telemetry Accordion Drawer */}
              <div className={`composer-params-accordion ${paramsAccordionOpen ? 'open' : ''}`}>
                <div className="params-header-row">
                  <span className="params-title">// HYPERPARAMETERS & REASONING DOCK</span>
                  <div className="params-presets-row">
                    <span style={{ fontSize: 10, color: 'var(--text-dim)', marginRight: 4 }}>PRESETS:</span>
                    <button
                      type="button"
                      className="params-preset-pill"
                      onClick={() => {
                        persist({ ...settings, temperature: 0.1, maxTokens: 4096 })
                        showToast('Preset: Fast & Deterministic (T: 0.1)', { type: 'info' })
                      }}
                    >
                      ⚡ Fast (0.1)
                    </button>
                    <button
                      type="button"
                      className="params-preset-pill"
                      onClick={() => {
                        persist({ ...settings, temperature: 0.7, maxTokens: 4096 })
                        showToast('Preset: Balanced (T: 0.7)', { type: 'info' })
                      }}
                    >
                      ⚖️ Balanced (0.7)
                    </button>
                    <button
                      type="button"
                      className="params-preset-pill"
                      onClick={() => {
                        persist({ ...settings, temperature: 0.6, maxTokens: 8192 })
                        showToast('Preset: Deep Reasoning (T: 0.6, 8k)', { type: 'info' })
                      }}
                    >
                      🧠 Reasoning (0.6, 8k)
                    </button>
                    <button
                      type="button"
                      className="params-preset-pill"
                      onClick={() => {
                        persist({ ...settings, temperature: 1.0, maxTokens: 4096 })
                        showToast('Preset: Creative & Exploratory (T: 1.0)', { type: 'info' })
                      }}
                    >
                      🎨 Creative (1.0)
                    </button>
                  </div>
                </div>

                <div className="params-grid">
                  {/* Temperature Slider */}
                  <div className="param-slider-group">
                    <div className="param-slider-label-row">
                      <span className="param-slider-name">Temperature</span>
                      <span className="param-slider-val">{settings.temperature ?? 0.7}</span>
                    </div>
                    <input
                      type="range"
                      min="0.0"
                      max="1.5"
                      step="0.05"
                      className="param-slider-input"
                      value={settings.temperature ?? 0.7}
                      onChange={(e) => persist({ ...settings, temperature: parseFloat(e.target.value) })}
                    />
                  </div>

                  {/* Max Tokens Slider */}
                  <div className="param-slider-group">
                    <div className="param-slider-label-row">
                      <span className="param-slider-name">Max Output Tokens</span>
                      <span className="param-slider-val">{settings.maxTokens ?? 4096}</span>
                    </div>
                    <input
                      type="range"
                      min="1024"
                      max="8192"
                      step="512"
                      className="param-slider-input"
                      value={settings.maxTokens ?? 4096}
                      onChange={(e) => persist({ ...settings, maxTokens: parseInt(e.target.value, 10) })}
                    />
                  </div>

                  {/* Agent Max Rounds */}
                  <div className="param-slider-group">
                    <div className="param-slider-label-row">
                      <span className="param-slider-name">Autonomous Loop Limit</span>
                      <span className="param-slider-val">{settings.agentMaxRounds ?? 8} rounds</span>
                    </div>
                    <input
                      type="range"
                      min="1"
                      max="20"
                      step="1"
                      className="param-slider-input"
                      value={settings.agentMaxRounds ?? 8}
                      onChange={(e) => persist({ ...settings, agentMaxRounds: parseInt(e.target.value, 10) })}
                    />
                  </div>
                </div>

                <div className="params-toggles-row">
                  <label className="param-checkbox-label" title="Enable Memory Palace episodic auto-recall">
                    <input
                      type="checkbox"
                      checked={autoRecall}
                      onChange={(e) => handleAutoRecallToggle(e.target.checked)}
                    />
                    <span>MemPalace Auto-Recall</span>
                  </label>

                  <label className="param-checkbox-label" title="Enable Memory Palace auto-checkpointing">
                    <input
                      type="checkbox"
                      checked={autoCheckpoint}
                      onChange={(e) => handleAutoCheckpointToggle(e.target.checked)}
                    />
                    <span>Auto-Checkpointing</span>
                  </label>
                </div>

                {/* Abliterated Filter & Laser Field HUD Row */}
                <div className="params-laser-row">
                  <div className="params-laser-header">
                    <span className="params-laser-title">// LASER PERSPECTIVE GRID:</span>
                    <div className="params-laser-modes">
                      <button
                        type="button"
                        className={`laser-mode-pill ${(settings.laserMode || 'auto') === 'auto' ? 'active' : ''}`}
                        onClick={() => {
                          persist({ ...settings, laserMode: 'auto' })
                          showToast('Laser grid: Auto (model-reactive)', { type: 'info' })
                        }}
                      >
                        ⚡ Auto
                      </button>
                      <button
                        type="button"
                        className={`laser-mode-pill ${(settings.laserMode || 'auto') === 'manual' ? 'active' : ''}`}
                        onClick={() => {
                          persist({ ...settings, laserMode: 'manual' })
                          showToast('Laser grid: Manual override', { type: 'info' })
                        }}
                      >
                        🎯 Manual
                      </button>
                      <button
                        type="button"
                        className={`laser-mode-pill ${settings.laserMode === 'off' ? 'active' : ''}`}
                        onClick={() => {
                          persist({ ...settings, laserMode: 'off' })
                          showToast('Laser grid: Off', { type: 'info' })
                        }}
                      >
                        🚫 Off
                      </button>
                    </div>
                  </div>

                  {settings.laserMode === 'manual' && (
                    <div className="params-laser-levels">
                      {ABLITERATION_LEVEL_ORDER.map((lvl) => {
                        const meta = ABLITERATION_LEVELS[lvl]
                        const isSel = (settings.laserLevelManual ?? 3) === lvl
                        return (
                          <button
                            key={lvl}
                            type="button"
                            className={`laser-level-pill ${isSel ? 'selected' : ''}`}
                            style={{ '--lvl-color': meta.color } as React.CSSProperties}
                            onClick={() => {
                              persist({ ...settings, laserMode: 'manual', laserLevelManual: lvl })
                              showToast(`Laser level: ${meta.label} (${meta.tag})`, { type: 'info' })
                            }}
                            title={`${meta.label} (${meta.tag}): ${meta.desc}`}
                          >
                            <span className="lvl-dot" />
                            <span className="lvl-num">{lvl}</span>
                            <span className="lvl-name">{meta.label}</span>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>

              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Message… (Enter to send, Shift+Enter for newline)"
                disabled={busy && !settings.agentMode}
                className="composer-textarea"
                rows={2}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    void send()
                  }
                }}
              />

              <div className="composer-bottom-bar">
                <div className="composer-left-dock">
                  {/* Tools */}
                  <div className="composer-tools-group">
                    <button
                      type="button"
                      className={`composer-tool-btn ${composerAdvanced ? 'active' : ''}`}
                      onClick={() => setComposerAdvanced((v) => !v)}
                      title="Show model, provider, and mode options"
                    >
                      {composerAdvanced ? 'Less' : 'Options'}
                    </button>
                    <button
                      type="button"
                      className={`composer-tool-btn composer-agent-quick ${settings.agentMode ? 'active' : ''}`}
                      onClick={() => {
                        const next = !settings.agentMode
                        persist({ ...settings, agentMode: next })
                        showToast(`Agent ${next ? 'on' : 'off'}`, { type: 'info' })
                      }}
                      disabled={busy}
                      title="Agent mode"
                    >
                      Agent
                    </button>
                    <button
                      type="button"
                      className="composer-tool-btn composer-power-only"
                      onClick={() => handleInspectDuckDb()}
                      title="DuckDB identity index"
                    >
                      <img src="/icons/icon-duck.png" alt="DuckDB" className="chip-icon-img" />
                      <span>DuckDB</span>
                    </button>
                    <button
                      type="button"
                      className="composer-tool-btn composer-power-only"
                      onClick={() => handleBranchSession()}
                      title="Branch this chat"
                    >
                      Branch
                    </button>
                  </div>

                  {/* Terminal */}
                  <button
                    type="button"
                    className="btn-flip-mode"
                    onClick={onOpenTerminal}
                    title="Terminal (Ctrl+`)"
                  >
                    <span className="flip-icon-spin">🔄</span>
                    <span>CONSOLE</span>
                  </button>

                  <div className="composer-divider" />

                  {/* Organized Shortcut Stack */}
                  <div className="composer-shortcut-stack">
                    <div className="shortcut-item">
                      <kbd>↵</kbd>
                      <span>send</span>
                    </div>
                    <div className="shortcut-item">
                      <kbd>⇧↵</kbd>
                      <span>newline</span>
                    </div>
                    <div className="shortcut-item">
                      <kbd>Ctrl+`</kbd>
                      <span>flip</span>
                    </div>
                    <div className="shortcut-item">
                      <kbd>⌘K</kbd>
                      <span>palette</span>
                    </div>
                  </div>
                </div>

                <div className="composer-actions">
                  {busy && (
                    <button type="button" className="btn-stop" onClick={stop} title="Halt current execution">
                      ⏹ ABORT
                    </button>
                  )}
                  <button
                    type="button"
                    className="primary"
                    onClick={() => void send()}
                    disabled={busy || !input.trim()}
                    style={{ padding: '7px 18px', fontWeight: 800 }}
                    title="Send (Enter)"
                  >
                    <img src="/icons/icon-lightning.png" alt="Send" className="btn-icon-img" />
                    <span>SEND</span>
                  </button>
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>

  )
}
