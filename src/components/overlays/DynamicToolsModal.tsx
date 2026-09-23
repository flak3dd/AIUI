import { useState, useEffect } from 'react'
import {
  loadDynamicToolRegistry,
  executeDynamicTool,
  researchAndAcquireTool,
  type DynamicToolMeta,
} from '../../lib/dynamicToolManager'
import { executeBashCommand } from '../../lib/bashShell'

interface DynamicToolsModalProps {
  open: boolean
  onClose: () => void
  onToolChanged?: () => void
}

export function DynamicToolsModal({ open, onClose, onToolChanged }: DynamicToolsModalProps) {
  const [activeTab, setActiveTab] = useState<'installed' | 'lab' | 'blueprints'>('installed')
  const [tools, setTools] = useState<Record<string, DynamicToolMeta>>({})
  const [loading, setLoading] = useState(false)
  const [statusMsg, setStatusMsg] = useState<string | null>(null)

  // Testing Workbench state
  const [selectedTool, setSelectedTool] = useState<DynamicToolMeta | null>(null)
  const [testInputs, setTestInputs] = useState<Record<string, string>>({})
  const [testRunning, setTestRunning] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)

  // Acquisition Lab state
  const [newToolName, setNewToolName] = useState('')
  const [newCapability, setNewCapability] = useState('')
  const [newImplementation, setNewImplementation] = useState('')
  const [acquiring, setAcquiring] = useState(false)
  const [acquireOutput, setAcquireOutput] = useState<string | null>(null)

  const reloadRegistry = async () => {
    setLoading(true)
    try {
      const reg = await loadDynamicToolRegistry(true)
      setTools(reg)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) {
      reloadRegistry()
      setStatusMsg(null)
      setTestResult(null)
      setAcquireOutput(null)
    }
  }, [open])

  if (!open) return null

  const handleSelectToolForTest = (meta: DynamicToolMeta) => {
    setSelectedTool(meta)
    const initialInputs: Record<string, string> = {}
    const props = (meta.parameters as any)?.properties || {}
    for (const k of Object.keys(props)) {
      initialInputs[k] = ''
    }
    setTestInputs(initialInputs)
    setTestResult(null)
  }

  const handleRunTest = async () => {
    if (!selectedTool) return
    setTestRunning(true)
    setTestResult(null)
    try {
      const res = await executeDynamicTool(selectedTool.name, JSON.stringify(testInputs))
      setTestResult(res)
      reloadRegistry()
      if (onToolChanged) onToolChanged()
    } catch (err: any) {
      setTestResult(JSON.stringify({ ok: false, error: err.message }, null, 2))
    } finally {
      setTestRunning(false)
    }
  }

  const handleAcquire = async (toolName: string, capability: string, implementation?: string) => {
    setAcquiring(true)
    setAcquireOutput(null)
    try {
      const payload: Record<string, any> = {
        tool_name: toolName.trim(),
        capability_needed: capability.trim(),
      }
      if (implementation && implementation.trim()) {
        payload.suggested_implementation = implementation.trim()
      }
      const res = await researchAndAcquireTool(JSON.stringify(payload))
      setAcquireOutput(res)
      await reloadRegistry()
      if (onToolChanged) onToolChanged()
      setStatusMsg(`✔ Tool "${toolName}" acquired and verified!`)
    } catch (err: any) {
      setAcquireOutput(JSON.stringify({ ok: false, error: err.message }, null, 2))
    } finally {
      setAcquiring(false)
    }
  }

  const handleDeleteTool = async (toolName: string) => {
    if (!confirm(`Are you sure you want to unload and delete tool "${toolName}"?`)) return
    try {
      const cmd = `node -e 'import("./scripts/dynamic-tool-manager.mjs").then(async m => { m.dynamicToolManager.removeTool(${JSON.stringify(toolName)}); process.exit(0); })'`
      await executeBashCommand(cmd)
      if (selectedTool?.name === toolName) setSelectedTool(null)
      await reloadRegistry()
      if (onToolChanged) onToolChanged()
      setStatusMsg(`✔ Removed tool "${toolName}".`)
    } catch (err: any) {
      setStatusMsg(`✘ Failed to remove: ${err.message}`)
    }
  }

  const toolList = Object.values(tools)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm animate-fadeIn">
      <div className="relative flex max-h-[90vh] w-full max-w-4xl flex-col rounded-2xl border border-white/10 bg-[#0d1117] text-gray-100 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-500/20 text-xl text-cyan-400 ring-1 ring-cyan-500/30">
              🧩
            </span>
            <div>
              <h2 className="text-lg font-semibold tracking-wide text-white">
                Dynamic Tool Architecture & JIT Extension
              </h2>
              <p className="text-xs text-gray-400">
                Self-researched, hot-loaded autonomous agent tools • {toolList.length} active
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-gray-400 transition hover:bg-white/10 hover:text-white"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-white/10 px-6 pt-2">
          <button
            onClick={() => setActiveTab('installed')}
            className={`border-b-2 px-4 py-2.5 text-xs font-medium transition ${
              activeTab === 'installed'
                ? 'border-cyan-400 text-cyan-300'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            Active Catalog ({toolList.length})
          </button>
          <button
            onClick={() => setActiveTab('blueprints')}
            className={`border-b-2 px-4 py-2.5 text-xs font-medium transition ${
              activeTab === 'blueprints'
                ? 'border-cyan-400 text-cyan-300'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            Curated Blueprints
          </button>
          <button
            onClick={() => setActiveTab('lab')}
            className={`border-b-2 px-4 py-2.5 text-xs font-medium transition ${
              activeTab === 'lab'
                ? 'border-cyan-400 text-cyan-300'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            Acquisition Lab
          </button>
        </div>

        {statusMsg && (
          <div className="mx-6 mt-3 rounded-lg bg-cyan-950/40 border border-cyan-800/40 px-3 py-2 text-xs text-cyan-300 flex items-center justify-between">
            <span>{statusMsg}</span>
            <button onClick={() => setStatusMsg(null)} className="text-cyan-400 hover:text-white">✕</button>
          </div>
        )}

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* TAB 1: Installed Tools */}
          {activeTab === 'installed' && (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
              {/* Left Column: Tool List */}
              <div className="lg:col-span-5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                    Installed Dynamic Tools
                  </span>
                  <button
                    onClick={reloadRegistry}
                    disabled={loading}
                    className="text-xs text-cyan-400 hover:underline disabled:opacity-50"
                  >
                    {loading ? 'Refreshing...' : 'Refresh'}
                  </button>
                </div>

                {toolList.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-white/10 p-8 text-center text-gray-500">
                    <p className="text-sm">No dynamic tools installed yet.</p>
                    <p className="mt-1 text-xs text-gray-600">
                      The agent will acquire tools autonomously mid-turn, or you can install a blueprint.
                    </p>
                    <button
                      onClick={() => setActiveTab('blueprints')}
                      className="mt-4 rounded-lg bg-cyan-500/20 px-3 py-1.5 text-xs font-medium text-cyan-300 hover:bg-cyan-500/30"
                    >
                      Browse Blueprints
                    </button>
                  </div>
                ) : (
                  toolList.map((meta) => (
                    <div
                      key={meta.name}
                      onClick={() => handleSelectToolForTest(meta)}
                      className={`cursor-pointer rounded-xl border p-3.5 transition ${
                        selectedTool?.name === meta.name
                          ? 'border-cyan-500 bg-cyan-950/20 shadow-lg ring-1 ring-cyan-500/30'
                          : 'border-white/5 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.04]'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-xs font-semibold text-cyan-300">
                          {meta.name}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <span className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-gray-300">
                            {meta.runtime || 'python3'}
                          </span>
                          <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300">
                            verified
                          </span>
                        </div>
                      </div>
                      <p className="mt-1.5 text-xs text-gray-400 line-clamp-2">
                        {meta.description}
                      </p>
                      <div className="mt-2.5 flex items-center justify-between text-[11px] text-gray-500">
                        <span>Used {meta.usageCount || 0} time(s)</span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleDeleteTool(meta.name)
                          }}
                          className="text-red-400/70 hover:text-red-300 hover:underline"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Right Column: Interactive Test Workbench */}
              <div className="lg:col-span-7 flex flex-col rounded-xl border border-white/10 bg-black/40 p-4">
                {selectedTool ? (
                  <div className="flex flex-col h-full space-y-4">
                    <div className="flex items-center justify-between border-b border-white/10 pb-3">
                      <div>
                        <h3 className="font-mono text-sm font-semibold text-cyan-300">
                          {selectedTool.name}
                        </h3>
                        <p className="text-xs text-gray-400">{selectedTool.description}</p>
                      </div>
                      <span className="text-[11px] text-gray-500 font-mono">
                        {selectedTool.entrypoint}
                      </span>
                    </div>

                    {/* Parameters Input Form */}
                    <div className="space-y-3">
                      <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                        Parameters Input
                      </span>
                      {Object.keys((selectedTool.parameters as any)?.properties || {}).map((key) => {
                        const prop = (selectedTool.parameters as any)?.properties?.[key] || {}
                        const isRequired = ((selectedTool.parameters as any)?.required || []).includes(key)
                        return (
                          <div key={key} className="space-y-1">
                            <label className="flex items-center justify-between text-xs text-gray-300 font-mono">
                              <span>
                                {key} {isRequired && <span className="text-red-400">*</span>}
                              </span>
                              <span className="text-[10px] text-gray-500">{prop.type}</span>
                            </label>
                            {prop.description && (
                              <p className="text-[11px] text-gray-500">{prop.description}</p>
                            )}
                            <input
                              type="text"
                              value={testInputs[key] || ''}
                              onChange={(e) =>
                                setTestInputs((prev) => ({ ...prev, [key]: e.target.value }))
                              }
                              placeholder={prop.default ? String(prop.default) : `Enter ${key}...`}
                              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white placeholder-gray-600 focus:border-cyan-500 focus:outline-none"
                            />
                          </div>
                        )
                      })}

                      <button
                        onClick={handleRunTest}
                        disabled={testRunning}
                        className="flex items-center justify-center gap-2 rounded-lg bg-cyan-600 px-4 py-2 text-xs font-semibold text-white shadow-lg transition hover:bg-cyan-500 disabled:opacity-50"
                      >
                        {testRunning ? 'Executing Tool...' : '▶ Run Tool Test'}
                      </button>
                    </div>

                    {/* Test Output Console */}
                    {testResult && (
                      <div className="flex-1 space-y-1 pt-2">
                        <div className="flex items-center justify-between text-xs text-gray-400">
                          <span>Execution Output</span>
                          <button
                            onClick={() => navigator.clipboard.writeText(testResult)}
                            className="text-cyan-400 hover:underline"
                          >
                            Copy Output
                          </button>
                        </div>
                        <pre className="max-h-60 overflow-y-auto rounded-lg border border-white/10 bg-[#090d13] p-3 font-mono text-[11px] text-emerald-400">
                          {testResult}
                        </pre>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-64 text-gray-500 text-center">
                    <span className="text-2xl mb-2">👈</span>
                    <p className="text-xs">Select any installed tool on the left to run an interactive test.</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: Curated Blueprints */}
          {activeTab === 'blueprints' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-sm font-semibold text-cyan-300">sqlite_query</span>
                    <span className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-gray-300">python3</span>
                  </div>
                  <p className="mt-2 text-xs text-gray-300">
                    Direct SQL query engine against local SQLite databases (.db, .sqlite). Returns structured JSON rows with table schemas.
                  </p>
                </div>
                <button
                  onClick={() => handleAcquire('sqlite_query', 'Query SQLite database tables and return JSON rows')}
                  disabled={acquiring}
                  className="mt-4 rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-cyan-500 disabled:opacity-50"
                >
                  {tools['sqlite_query'] ? 'Re-install / Verify' : 'Install Blueprint'}
                </button>
              </div>

              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-sm font-semibold text-cyan-300">web_search_duckduckgo</span>
                    <span className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-gray-300">python3</span>
                  </div>
                  <p className="mt-2 text-xs text-gray-300">
                    Real-time public web search using DuckDuckGo parser. Zero API key needed; extracts top titles, snippets, and verified URLs.
                  </p>
                </div>
                <button
                  onClick={() => handleAcquire('web_search_duckduckgo', 'Search the web via DuckDuckGo and return search results')}
                  disabled={acquiring}
                  className="mt-4 rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-cyan-500 disabled:opacity-50"
                >
                  {tools['web_search_duckduckgo'] ? 'Re-install / Verify' : 'Install Blueprint'}
                </button>
              </div>

              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-sm font-semibold text-cyan-300">git_blame_inspector</span>
                    <span className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-gray-300">node</span>
                  </div>
                  <p className="mt-2 text-xs text-gray-300">
                    Line-by-line git blame analyzer. Inspects author, commit hashes, modification dates, and blame lines for code audit.
                  </p>
                </div>
                <button
                  onClick={() => handleAcquire('git_blame_inspector', 'Inspect git blame line by line with commit metadata')}
                  disabled={acquiring}
                  className="mt-4 rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-cyan-500 disabled:opacity-50"
                >
                  {tools['git_blame_inspector'] ? 'Re-install / Verify' : 'Install Blueprint'}
                </button>
              </div>

              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-sm font-semibold text-cyan-300">csv_stats_analyzer</span>
                    <span className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-gray-300">python3</span>
                  </div>
                  <p className="mt-2 text-xs text-gray-300">
                    High-speed CSV parser computing row counts, column types, null percentages, min/max/mean metrics for tabular datasets.
                  </p>
                </div>
                <button
                  onClick={() => handleAcquire('csv_stats_analyzer', 'Analyze CSV table statistics and null percentages')}
                  disabled={acquiring}
                  className="mt-4 rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-cyan-500 disabled:opacity-50"
                >
                  {tools['csv_stats_analyzer'] ? 'Re-install / Verify' : 'Install Blueprint'}
                </button>
              </div>
            </div>
          )}

          {/* TAB 3: Acquisition Lab */}
          {activeTab === 'lab' && (
            <div className="max-w-2xl mx-auto space-y-4">
              <div className="rounded-xl bg-cyan-950/20 border border-cyan-800/30 p-4 text-xs text-cyan-300 leading-relaxed">
                💡 <strong>Autonomous Acquisition Lab:</strong> Type any capability requirement below. The engine will synthesize a standalone tool script, generate OpenAPI JSON schemas, smoke test the tool in a sandbox, and hot-load it into the active architecture.
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-300">
                  Tool Name (identifier) <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={newToolName}
                  onChange={(e) => setNewToolName(e.target.value)}
                  placeholder="e.g. whois_lookup, pdf_metadata_extractor, json_schema_checker"
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white placeholder-gray-600 focus:border-cyan-500 focus:outline-none font-mono"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-300">
                  Capability Description <span className="text-red-400">*</span>
                </label>
                <textarea
                  rows={3}
                  value={newCapability}
                  onChange={(e) => setNewCapability(e.target.value)}
                  placeholder="Describe what the tool should do, required inputs, and output format..."
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white placeholder-gray-600 focus:border-cyan-500 focus:outline-none"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-300">
                  Custom Implementation Script <span className="text-gray-500">(optional)</span>
                </label>
                <textarea
                  rows={5}
                  value={newImplementation}
                  onChange={(e) => setNewImplementation(e.target.value)}
                  placeholder="#!/usr/bin/env python3&#10;# Optional custom Python or Node.js code... If left empty, the engine synthesizes it automatically."
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white placeholder-gray-600 focus:border-cyan-500 focus:outline-none font-mono text-[11px]"
                />
              </div>

              <button
                onClick={() => handleAcquire(newToolName, newCapability, newImplementation)}
                disabled={acquiring || !newToolName.trim() || !newCapability.trim()}
                className="w-full rounded-lg bg-cyan-600 px-4 py-2.5 text-xs font-semibold text-white shadow-lg transition hover:bg-cyan-500 disabled:opacity-50"
              >
                {acquiring ? 'Synthesizing & Smoke-Testing Tool...' : '⚡ Research, Build & Hot-Load Tool'}
              </button>

              {acquireOutput && (
                <div className="mt-4 space-y-1">
                  <span className="text-xs text-gray-400">Acquisition Report</span>
                  <pre className="max-h-52 overflow-y-auto rounded-lg border border-white/10 bg-black/60 p-3 font-mono text-[11px] text-emerald-400">
                    {acquireOutput}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-white/10 px-6 py-3 text-xs text-gray-500">
          <span>Registry: tools/registry.json • Fast-Path: :17330/api/tools/exec</span>
          <button
            onClick={onClose}
            className="rounded-lg bg-white/5 px-3 py-1.5 text-xs font-medium text-gray-300 hover:bg-white/10"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
