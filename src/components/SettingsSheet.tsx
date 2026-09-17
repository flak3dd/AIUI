import { useState } from 'react'
import type { StoredSettings, RainMode, LaserMode } from '../lib/providers'
import { ABLITERATION_LEVELS, ABLITERATION_LEVEL_ORDER } from '../lib/abliterationLevel'
import type { MemPalaceStatus } from '../lib/mempalace'
import type { SandboxStatus } from '../lib/bashShell'
import { DRACULA_THEMES, type DraculaTheme, applyTheme, loadTheme } from '../lib/theme'
import { MOOD_LABELS, MOOD_ORDER, type Mood } from '../lib/rainMood'

type TabId = 'model' | 'mesh' | 'agent' | 'memory' | 'appearance'

const TABS: { id: TabId; label: string }[] = [
  { id: 'model', label: 'Model' },
  { id: 'mesh', label: 'Mesh' },
  { id: 'agent', label: 'Agent' },
  { id: 'memory', label: 'Memory' },
  { id: 'appearance', label: 'Appearance' },
]

export interface SettingsSheetProps {
  open: boolean
  onClose: () => void
  settings: StoredSettings
  persist: (next: StoredSettings) => void
  sandboxStatus: SandboxStatus | null
  mempalaceStatus: MemPalaceStatus | null
  autoRecall: boolean
  autoCheckpoint: boolean
  onAutoRecallToggle: (v: boolean) => void
  onAutoCheckpointToggle: (v: boolean) => void
  getSandboxBaseUrl: () => string
  setSandboxBaseUrl: (url: string) => void
  getMempalaceBaseUrl: () => string
  setMempalaceBaseUrl: (url: string) => void
  refreshSandboxHealth: () => void | Promise<void>
  refreshMempalaceHealth: () => void | Promise<void>
}

export function SettingsSheet({
  open,
  onClose,
  settings,
  persist,
  sandboxStatus,
  mempalaceStatus,
  autoRecall,
  autoCheckpoint,
  onAutoRecallToggle,
  onAutoCheckpointToggle,
  getSandboxBaseUrl,
  setSandboxBaseUrl,
  getMempalaceBaseUrl,
  setMempalaceBaseUrl,
  refreshSandboxHealth,
  refreshMempalaceHealth,
}: SettingsSheetProps) {
  const [tab, setTab] = useState<TabId>('model')
  const [themeId, setThemeId] = useState<DraculaTheme>(() => loadTheme())
  const [showSecrets, setShowSecrets] = useState(false)

  if (!open) return null

  const keyType = showSecrets ? 'text' : 'password'

  return (
    <div className="drawer" onClick={onClose}>
      <div className="settings-panel settings-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="settings-sheet-header">
          <h2>Settings</h2>
          <button type="button" className="ghost btn-sm" onClick={onClose}>
            ✕
          </button>
        </div>
        <p className="hint">Saved in this browser only.</p>
        <button
          type="button"
          className="ghost btn-sm"
          style={{ alignSelf: 'flex-start', marginBottom: 4 }}
          onClick={() => setShowSecrets((s) => !s)}
          title={showSecrets ? 'Hide secrets' : 'Reveal secrets'}
        >
          {showSecrets ? '🙈 Hide keys' : '👁 Reveal keys'}
        </button>

        <div className="settings-tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={`settings-tab ${tab === t.id ? 'active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="settings-tab-panel">
          {tab === 'model' && (
            <>
              <div className="field">
                <label>Featherless base URL <span style={{ opacity: 0.6, fontWeight: 400 }}>(proxy :17332 recommended)</span></label>
                <input
                  value={settings.featherlessBaseUrl}
                  onChange={(e) => persist({ ...settings, featherlessBaseUrl: e.target.value })}
                />
              </div>
              <div className="field">
                <label>Featherless API key</label>
                <input
                  type={keyType}
                  value={settings.featherlessApiKey}
                  onChange={(e) => persist({ ...settings, featherlessApiKey: e.target.value })}
                  placeholder="fl_…"
                />
              </div>
              <div className="field">
                <label>Abliteration base URL</label>
                <input
                  value={settings.abliterationBaseUrl}
                  onChange={(e) => persist({ ...settings, abliterationBaseUrl: e.target.value })}
                />
              </div>
              <div className="field">
                <label>Abliteration API key</label>
                <input
                  type={keyType}
                  value={settings.abliterationApiKey}
                  onChange={(e) => persist({ ...settings, abliterationApiKey: e.target.value })}
                />
              </div>
            </>
          )}

          {tab === 'mesh' && (
            <>
              <div className="field">
                <label>Sandbox runner URL</label>
                <input
                  defaultValue={getSandboxBaseUrl()}
                  onBlur={(e) => {
                    setSandboxBaseUrl(e.target.value.trim())
                    void refreshSandboxHealth()
                  }}
                  placeholder="http://127.0.0.1:17330"
                />
                <span className="hint">
                  {sandboxStatus?.online ? (
                    <span style={{ color: 'var(--ok)' }}>Online ({sandboxStatus.latencyMs}ms)</span>
                  ) : (
                    <span style={{ color: 'var(--danger)' }}>
                      Offline ({sandboxStatus?.error || 'unreachable'})
                    </span>
                  )}
                </span>
              </div>
              <div className="field">
                <label>GX10 host</label>
                <input
                  value={settings.sparkHost}
                  onChange={(e) => persist({ ...settings, sparkHost: e.target.value.trim() })}
                  placeholder="192.168.4.103"
                />
              </div>
              <div className="field">
                <label>GX10 port</label>
                <input
                  type="number"
                  value={settings.sparkPort}
                  onChange={(e) =>
                    persist({ ...settings, sparkPort: Number(e.target.value) || 8000 })
                  }
                />
              </div>
              <div className="field">
                <label className="chip clickable" style={{ display: 'inline-flex', gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={settings.sparkUseProxy}
                    onChange={(e) => persist({ ...settings, sparkUseProxy: e.target.checked })}
                  />
                  Use proxy (avoids CORS)
                </label>
              </div>
              <div className="field">
                <label>GX10 API key (optional)</label>
                <input
                  type={keyType}
                  value={settings.sparkApiKey}
                  onChange={(e) => persist({ ...settings, sparkApiKey: e.target.value })}
                />
              </div>
            </>
          )}

          {tab === 'agent' && (
            <>
              <div className="field">
                <label className="chip clickable" style={{ display: 'inline-flex', gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={Boolean(settings.deepBuild)}
                    onChange={(e) => persist({ ...settings, deepBuild: e.target.checked })}
                  />
                  Deep Build mode
                </label>
                <span className="hint">Exhaustive plans, full implementations, and tests.</span>
              </div>
              <div className="field">
                <label className="chip clickable" style={{ display: 'inline-flex', gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={settings.clusterRag !== false}
                    onChange={(e) => persist({ ...settings, clusterRag: e.target.checked })}
                  />
                  On-device RAG
                </label>
              </div>
              <div className="field">
                <label>Active Workspace Directory</label>
                <input
                  value={settings.workspaceDir || '/Users/adminuser/AIUI'}
                  onChange={(e) => persist({ ...settings, workspaceDir: e.target.value.trim() })}
                  placeholder="/Users/adminuser/AIUI"
                />
                <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn-sm ghost"
                    onClick={() => persist({ ...settings, workspaceDir: '/Users/adminuser/AIUI' })}
                  >
                    ~/AIUI
                  </button>
                  <button
                    type="button"
                    className="btn-sm ghost"
                    onClick={() => persist({ ...settings, workspaceDir: '/Users/adminuser/r' })}
                  >
                    ~/r
                  </button>
                  <button
                    type="button"
                    className="btn-sm ghost"
                    onClick={() => persist({ ...settings, workspaceDir: '/Users/adminuser/log-sorter' })}
                  >
                    ~/log-sorter
                  </button>
                  <button
                    type="button"
                    className="btn-sm ghost"
                    onClick={() => persist({ ...settings, workspaceDir: '/tmp/spark-sandboxes' })}
                  >
                    /tmp Sandbox
                  </button>
                </div>
                <span className="hint">Base directory for sandbox files, bash commands, and terminal execution.</span>
              </div>
            </>
          )}

          {tab === 'memory' && (
            <>
              <div className="field">
                <label>MemPalace bridge URL</label>
                <input
                  defaultValue={getMempalaceBaseUrl()}
                  onBlur={(e) => {
                    setMempalaceBaseUrl(e.target.value.trim())
                    void refreshMempalaceHealth()
                  }}
                  placeholder="http://127.0.0.1:17333"
                />
                <span className="hint">
                  {mempalaceStatus?.online ? (
                    <span style={{ color: 'var(--ok)' }}>Online ({mempalaceStatus.latencyMs}ms)</span>
                  ) : (
                    <span style={{ color: 'var(--danger)' }}>
                      Offline ({mempalaceStatus?.error || 'unreachable'})
                    </span>
                  )}
                </span>
              </div>
              <div className="field">
                <label className="chip clickable" style={{ display: 'inline-flex', gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={autoRecall}
                    onChange={(e) => onAutoRecallToggle(e.target.checked)}
                  />
                  Auto-recall before answers
                </label>
              </div>
              <div className="field">
                <label className="chip clickable" style={{ display: 'inline-flex', gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={autoCheckpoint}
                    onChange={(e) => onAutoCheckpointToggle(e.target.checked)}
                  />
                  Auto-checkpoint after replies
                </label>
              </div>
            </>
          )}

          {tab === 'appearance' && (
            <>
              <div className="field">
                <label>Theme</label>
                <div className="theme-picker-grid">
                  {DRACULA_THEMES.map((th) => (
                    <button
                      key={th.id}
                      type="button"
                      className={`theme-swatch ${themeId === th.id ? 'active' : ''}`}
                      style={{ borderColor: th.accent, background: th.bg, color: th.isDark ? '#fff' : '#111' }}
                      onClick={() => {
                        setThemeId(th.id)
                        applyTheme(th.id)
                      }}
                      title={th.description}
                    >
                      {th.name}
                    </button>
                  ))}
                </div>
              </div>
              <div className="field">
                <label>Reactive rain</label>
                <div className="rain-mode-toggle">
                  {(['auto', 'off', 'manual'] as RainMode[]).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      className={`rain-mode-btn ${(settings.rainMode || 'auto') === mode ? 'active' : ''}`}
                      onClick={() => persist({ ...settings, rainMode: mode })}
                    >
                      {mode === 'auto' ? 'Auto' : mode === 'off' ? 'Off' : 'Manual'}
                    </button>
                  ))}
                </div>
                <span className="hint">
                  Auto shifts rain color with the conversation mood. Off uses the theme accent.
                </span>
                {settings.rainMode === 'manual' && (
                  <div className="field" style={{ marginTop: 8 }}>
                    <label>Spectrum</label>
                    <select
                      value={settings.rainMoodManual || 'focus'}
                      onChange={(e) =>
                        persist({ ...settings, rainMoodManual: e.target.value })
                      }
                    >
                      {MOOD_ORDER.map((m: Mood) => (
                        <option key={m} value={m}>
                          {MOOD_LABELS[m]}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
              <div className="field" style={{ marginTop: 16 }}>
                <label>Perspective laser grid</label>
                <div className="rain-mode-toggle">
                  {(['auto', 'off', 'manual'] as LaserMode[]).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      className={`rain-mode-btn ${(settings.laserMode || 'auto') === mode ? 'active' : ''}`}
                      onClick={() => persist({ ...settings, laserMode: mode })}
                    >
                      {mode === 'auto' ? 'Auto' : mode === 'off' ? 'Off' : 'Manual'}
                    </button>
                  ))}
                </div>
                <span className="hint">
                  3-point perspective laser rays. Auto scales density & velocity with model abliteration/uncensored level.
                </span>
                {settings.laserMode === 'manual' && (
                  <div className="field" style={{ marginTop: 10 }}>
                    <label>Abliteration intensity level</label>
                    <div className="laser-level-selector">
                      {ABLITERATION_LEVEL_ORDER.map((lvl) => {
                        const meta = ABLITERATION_LEVELS[lvl]
                        const isSel = (settings.laserLevelManual ?? 3) === lvl
                        return (
                          <button
                            key={lvl}
                            type="button"
                            className={`laser-level-select-btn ${isSel ? 'active' : ''}`}
                            style={{ '--lvl-col': meta.color } as React.CSSProperties}
                            onClick={() => persist({ ...settings, laserLevelManual: lvl })}
                            title={meta.desc}
                          >
                            <span className="lvl-num">{lvl}</span>
                            <span className="lvl-name">{meta.label}</span>
                          </button>
                        )
                      })}
                    </div>
                    <span className="hint" style={{ marginTop: 4, color: ABLITERATION_LEVELS[settings.laserLevelManual ?? 3].color }}>
                      ● {ABLITERATION_LEVELS[settings.laserLevelManual ?? 3].tag}: {ABLITERATION_LEVELS[settings.laserLevelManual ?? 3].desc}
                    </span>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <button type="button" className="primary settings-save-btn" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  )
}
