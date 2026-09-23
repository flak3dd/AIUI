import React, { useEffect, useRef } from 'react'
import {
  modelLabel,
  preferFor,
  isGatedModelId,
  applyAssistMode,
  getAssistMode,
  type AssistMode,
  type StoredSettings,
  type ProviderId,
  type SparkRoute,
} from '../../lib/providers'
import { ABLITERATION_LEVELS, ABLITERATION_LEVEL_ORDER } from '../../lib/abliterationLevel'
import type { ExecutionTarget } from '../../lib/bashShell'
import type { AntiLoopSuggestion } from '../../lib/agentAnalyzer'
const ASSIST_CHOICES: { id: AssistMode; label: string; title: string }[] = [
  { id: 'chat', label: 'Talk', title: 'Talk — think it through, nothing runs' },
  { id: 'agent', label: 'Do it', title: 'Do it — look, change, and check' },
  { id: 'deep', label: 'Build it', title: 'Build it — plan, implement, and verify' },
]

const ASSIST_LABEL: Record<AssistMode, string> = {
  chat: 'Talk',
  agent: 'Do it',
  deep: 'Build it',
}

function agentStatusCopy(
  status: { round: number; maxRounds: number; stage: string },
  mode: AssistMode,
): { verb: string; phrase: string; mono: boolean } {
  const verb = mode === 'deep' ? 'Building' : mode === 'agent' ? 'Doing it' : 'Working'
  if (status.stage === 'fixing') return { verb, phrase: 'fixing the last command', mono: false }
  if (status.stage === 'anti_loop') return { verb, phrase: 'trying another way', mono: false }
  if (status.stage === 'running_cmd') return { verb, phrase: 'running a command', mono: false }
  return { verb, phrase: `round ${status.round} of ${status.maxRounds}`, mono: true }
}

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
  showAssistMode?: boolean
  onSendPrompt?: (prompt: string) => void
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
    showAssistMode = true,
    onSendPrompt,
  } = props

  const fieldRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = fieldRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [input])

  return (
    <div className="composer">
      {error && <div className="error">{error}</div>}
      {modelsError && <div className="hint">{modelsError}</div>}

      {agentStatus && (() => {
        const copy = agentStatusCopy(agentStatus, getAssistMode(settings))
        return (
          <div className="agent-status-banner" role="status">
            <p className="agent-status-line">
              <span className="agent-status-verb">{copy.verb}</span>
              <span className="agent-status-dot" aria-hidden="true">·</span>
              <span className={copy.mono ? 'agent-status-round' : 'agent-status-detail'}>{copy.phrase}</span>
            </p>
            <button type="button" className="agent-stop-btn" onClick={stop}>
              Stop
            </button>
          </div>
        )
      })()}

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
              {showAssistMode && (
              <div className="assist-mode-seg" role="group" aria-label="Assist mode">
                {ASSIST_CHOICES.map((m) => {
                  const active = getAssistMode(settings) === m.id
                  return (
                    <button
                      key={m.id}
                      type="button"
                      className={`assist-mode-btn ${active ? 'active' : ''} ${m.id === 'deep' && active ? 'deep' : ''}`}
                      disabled={busy}
                      title={m.title}
                      aria-pressed={active}
                      onClick={() => {
                        persist(applyAssistMode(settings, m.id))
                        handleAutoAblitToggle(m.id !== 'chat')
                        showToast(`Mode: ${ASSIST_LABEL[m.id]}`, { type: 'info' })
                      }}
                    >
                      {m.label}
                    </button>
                  )
                })}
              </div>
              )}

              <textarea
                ref={fieldRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="What should happen?"
                disabled={busy && !settings.agentMode}
                className="composer-textarea"
                rows={1}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    void send()
                  }
                }}
              />

              <div className="composer-bottom-bar">
                <div className="composer-bottom-controls">
                  <button
                    type="button"
                    className="composer-setup-toggle"
                    aria-expanded={composerAdvanced}
                    aria-controls="composer-setup-panel"
                    onClick={() => setComposerAdvanced((open) => !open)}
                  >
                    How this runs
                  </button>
                  <div className="composer-send-row">
                    <div className="composer-actions">
                      {busy && (
                        <button type="button" className="btn-stop" onClick={stop} title="Halt current execution">
                          Stop
                        </button>
                      )}
                      <button
                        type="button"
                        className="primary composer-send-btn"
                        onClick={() => void send()}
                        disabled={busy || !input.trim()}
                        title="Send (Enter)"
                      >
                        Send
                      </button>
                    </div>
                  </div>
                </div>

                {composerAdvanced && (
                  <div className="composer-setup-body" id="composer-setup-panel">
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
                                {gated ? `${label} (gated)` : label}
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
                          <option value="local_mac">This Mac</option>
                          <option value="dgx_spark">Spark</option>
                          <option value="container">Linux pod</option>
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

                        {settings.provider === 'spark' && (
                          <select
                            className="composer-select-compact"
                            value={settings.sparkRoute || 'both'}
                            disabled={busy}
                            title="Spark vLLM route. Both opens LAN and Tailscale and streams the first one that answers."
                            onChange={(e) => {
                              const sparkRoute = e.target.value as SparkRoute
                              persist({ ...settings, sparkRoute })
                              const label = sparkRoute === 'both' ? 'LAN + Tailscale' : sparkRoute === 'lan' ? 'LAN' : 'Tailscale'
                              showToast(`vLLM → ${label}`, { type: 'info' })
                            }}
                          >
                            <option value="both">LAN + Tailscale</option>
                            <option value="lan">LAN</option>
                            <option value="tailscale">Tailscale</option>
                          </select>
                        )}

                        <button
                          type="button"
                          className={`composer-tool-btn ${showModelSearch ? 'active' : ''}`}
                          onClick={() => setShowModelSearch(!showModelSearch)}
                          title="Search / filter models"
                        >
                          Search
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
                          className="composer-toggle-pill composer-optimise-pill"
                          title="Run complete system, memory, policy & GPU optimization in chat (shortcut: 'optimise')"
                          disabled={busy}
                          onClick={() => {
                            if (onSendPrompt) {
                              onSendPrompt('optimise')
                            } else {
                              setInput('optimise')
                              setTimeout(() => void send(), 20)
                            }
                          }}
                        >
                          <span>Optimise</span>
                        </button>

                        <button
                          type="button"
                          className={`composer-toggle-pill optimize ${settings.optimizeChatResponses !== false ? 'active' : ''}`}
                          title="Continuously optimize chat responses (monitor + MemPalace)"
                          disabled={busy}
                          onClick={() => {
                            const next = !(settings.optimizeChatResponses !== false)
                            persist({ ...settings, optimizeChatResponses: next })
                            showToast(next ? 'Response optimizer ON' : 'Response optimizer OFF', { type: 'info' })
                          }}
                        >
                          Auto-optimize
                        </button>

                        <label className="setup-check" title="Auto-run shell steps the agent writes">
                          <input
                            type="checkbox"
                            checked={autoAblit}
                            disabled={busy}
                            onChange={(e) => {
                              handleAutoAblitToggle(e.target.checked)
                              showToast(e.target.checked ? 'Abliteration on' : 'Abliteration off', { type: 'info' })
                            }}
                          />
                          Abliteration
                        </label>

                        <label className="setup-check" title="Enable Memory Palace episodic auto-recall">
                          <input
                            type="checkbox"
                            checked={autoRecall}
                            onChange={(e) => handleAutoRecallToggle(e.target.checked)}
                          />
                          Recall
                        </label>

                        <label className="setup-check" title="Enable Memory Palace auto-checkpointing">
                          <input
                            type="checkbox"
                            checked={autoCheckpoint}
                            onChange={(e) => handleAutoCheckpointToggle(e.target.checked)}
                          />
                          Checkpoint
                        </label>

                        <button
                          type="button"
                          className={`composer-params-toggle-btn ${paramsAccordionOpen ? 'active' : ''}`}
                          onClick={() => setParamsAccordionOpen(!paramsAccordionOpen)}
                          title="Temperature & token params"
                        >
                          <span>⚙</span>
                          <span style={{ fontSize: 9.5, opacity: 0.85 }}>T:{settings.temperature ?? 0.7}</span>
                          <span className={`fui-chevron ${paramsAccordionOpen ? 'open' : ''}`}>▾</span>
                        </button>
                      </div>
                    </div>

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
                              persist({ ...settings, temperature: 0.6, maxTokens: 16384, agentMaxRounds: 48 })
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

                        <div className="param-slider-group">
                          <div className="param-slider-label-row">
                            <span className="param-slider-name">Max Output Tokens</span>
                            <span className="param-slider-val">{settings.maxTokens ?? 4096}</span>
                          </div>
                          <input
                            type="range"
                            min="1024"
                            max="16384"
                            step="512"
                            className="param-slider-input"
                            value={settings.maxTokens ?? 4096}
                            onChange={(e) => persist({ ...settings, maxTokens: parseInt(e.target.value, 10) })}
                          />
                        </div>

                        <div className="param-slider-group">
                          <div className="param-slider-label-row">
                            <span className="param-slider-name">Autonomous Loop Limit</span>
                            <span className="param-slider-val">{settings.agentMaxRounds ?? 8} rounds</span>
                          </div>
                          <input
                            type="range"
                            min="1"
                            max="64"
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
                  </div>
                )}
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>

  )
}
