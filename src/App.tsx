import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  activeProvider,
  FEATHERLESS_GATED_PREFER,
  isGatedModelId,
  loadSettings,
  mergeCatalog,
  modelLabel,
  preferFor,
  saveSettings,
  UNGATED_ALTERNATIVE,
  type StoredSettings,
  providerSupportsNativeTools,
  SPARK_PREFER,
} from './lib/providers'
import {
  fetchModels,
  streamChat,
  GatedModelError,
  type ChatMessage,
} from './lib/api'
import {
  AGENT_SYSTEM,
  CHAT_SYSTEM,
  AGENT_TOOLS,
  DEEP_BUILD_DIRECTIVE,
  applyToolCalls,
  buildTurnContextBlock,
  buildContinueNudge,
  looksLikeKnowledgeQuery,
} from './lib/agent'
import {
  checkSandboxHealth,
  executeBashCommand,
  extractShellCommands,
  getSandboxBaseUrl,
  getStoredAutoBash,
  getStoredTarget,
  setSandboxBaseUrl,
  setStoredAutoBash,
  setStoredTarget,
  setStoredWorkspaceDir,
  type BashExecResult,
  type ExecutionTarget,
  type SandboxStatus,
} from './lib/bashShell'
import {
  checkMempalaceHealth,
  getMempalaceBaseUrl,
  setMempalaceBaseUrl,
  getAutoRecall,
  setAutoRecall,
  getAutoCheckpoint,
  setAutoCheckpoint,
  searchMemory,
  checkpointMemory,
  type MemPalaceStatus,
} from './lib/mempalace'
import {
  type ChatSession,
  loadAllSessions,
  saveSession,
  deleteSession,
  clearAllSessions,
  createNewSession,
  getActiveSessionId,
  setActiveSessionId,
  updateSessionTitle,
  togglePinSession,
  generateTitle,
} from './lib/chatHistory'
import { CommandPalette } from './components/CommandPalette'
import { WorkspaceExplorer } from './components/WorkspaceExplorer'
import { MeshPulse } from './components/MeshPulse'
import { applyTheme, loadTheme } from './lib/theme'
import { ToastProvider, useToast } from './components/ToastNotification'
import { queryRagKnowledge, formatRagContextBlock } from './lib/rag/ragService'
import { exportProjectZip } from './lib/zipExporter'
import { AgentAnalyzer, type ActionRecord, getAntiLoopPromptSuggestions, type AntiLoopSuggestion } from './lib/agentAnalyzer'
import { shouldCountAsGoalVerified } from './lib/goalVerification'
import { sendAgentDebugEvent } from './lib/agentDebugLogger'
import { ChatStage } from './components/ChatStage'
import { Composer } from './components/Composer'
import { TerminalDrawer } from './components/TerminalDrawer'
import { SettingsSheet } from './components/SettingsSheet'
import { SessionRail } from './components/SessionRail'
import type { UiMessage } from './types/ui'
import { scoreConversation, MOOD_LABELS, type Mood } from './lib/rainMood'
import { PerspectiveLaserField } from './components/PerspectiveLaserField'
import {
  inferAbliterationLevel,
  ABLITERATION_LEVELS,
  type AbliterationLevel,
} from './lib/abliterationLevel'

function uid() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function MainApp() {
  const { showToast } = useToast()
  const [copiedCellKey, setCopiedCellKey] = useState<string | null>(null)
  const [settings, setSettings] = useState<StoredSettings>(() => loadSettings())
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [models, setModels] = useState<string[]>(() => preferFor(loadSettings().provider))
  const [modelQuery, setModelQuery] = useState('')
  const [hideGated, setHideGated] = useState(true)
  const [showModelSearch, setShowModelSearch] = useState(false)
  const [gatedIds, setGatedIds] = useState<Set<string>>(() => new Set(FEATHERLESS_GATED_PREFER))
  const [gatedNotice, setGatedNotice] = useState<{
    model: string
    alt: string
    message: string
  } | null>(null)

  // Bash Shell & Terminal State
  const [autoAblit, setAutoAblit] = useState<boolean>(() => getStoredAutoBash())
  const [bashTarget, setBashTarget] = useState<ExecutionTarget>(() => getStoredTarget())
  const [terminalOpen, setTerminalOpen] = useState<boolean>(false)
  const [terminalLogs, setTerminalLogs] = useState<BashExecResult[]>([])
  const [sandboxStatus, setSandboxStatus] = useState<SandboxStatus | null>(null)
  const [mempalaceStatus, setMempalaceStatus] = useState<MemPalaceStatus | null>(null)
  const [autoRecall, setAutoRecallState] = useState<boolean>(() => getAutoRecall())
  const [autoCheckpoint, setAutoCheckpointState] = useState<boolean>(() => getAutoCheckpoint())
  const [termInput, setTermInput] = useState<string>('')
  const [executingCmd, setExecutingCmd] = useState<boolean>(false)
  const [termHeightMode, setTermHeightMode] = useState<'compact' | 'standard' | 'maximized' | 'docked'>('compact')
  const [termHistory, setTermHistory] = useState<string[]>(['uname -a', 'ls -lah', 'python3 --version'])
  const [historyIndex, setHistoryIndex] = useState<number>(-1)
  const [collapsedOutputs, setCollapsedOutputs] = useState<Record<number, boolean>>({})
  const [copiedLogIdx, setCopiedLogIdx] = useState<number | null>(null)

  // Autonomous Agent Status & Continuous Loop Analyzer
  const [agentStatus, setAgentStatus] = useState<{
    round: number
    maxRounds: number
    stage: 'thinking' | 'running_cmd' | 'fixing' | 'anti_loop'
    detail?: string
  } | null>(null)
  const [antiLoopSuggestions, setAntiLoopSuggestions] = useState<AntiLoopSuggestion[] | null>(null)
  const analyzerRef = useRef(new AgentAnalyzer())

  // Reactive rain mood — derived from conversation context (debounced)
  const [mood, setMood] = useState<Mood>('focus')
  const lastFailureRef = useRef(false)
  const toolsStrippedRef = useRef(false)

  // Command Palette & Workspace Explorer Modals
  const [paletteOpen, setPaletteOpen] = useState<boolean>(false)
  const [explorerOpen, setExplorerOpen] = useState<boolean>(false)
  const [composerAdvanced, setComposerAdvanced] = useState<boolean>(false)
  const [historyOpen, setHistoryOpen] = useState<boolean>(false)

  // Expandable Menu & Subsystem States
  const [subsystemsMenuOpen, setSubsystemsMenuOpen] = useState<boolean>(false)
  const [quickModelMenuOpen, setQuickModelMenuOpen] = useState<boolean>(false)
  const [paramsAccordionOpen, setParamsAccordionOpen] = useState<boolean>(false)
  const subsystemsMenuRef = useRef<HTMLDivElement | null>(null)
  const quickModelMenuRef = useRef<HTMLDivElement | null>(null)

  // Welcome banner text
  const WELCOME_CONTENT =
    '==> Welcome to Abliterated Studio\n==> Skin: Abliterated Night (Zinc #09090B · Violet #8B5CF6 · Cyan #22D3EE)\n==> Providers: Featherless · Abliteration · GX10 Spark\n==> Native Sandbox runner active on :17330\nType any prompt or python/bash command to start.'

  // Chat History & Multi-Session Persistence
  const [sessions, setSessions] = useState<ChatSession[]>(() => {
    const loaded = loadAllSessions()
    if (loaded.length > 0) return loaded
    const initial = createNewSession(
      [{ id: 'welcome', role: 'assistant', content: WELCOME_CONTENT }],
      loadSettings().model,
      loadSettings().provider,
      'Welcome to Ablit AI',
    )
    return [initial]
  })
  const [activeSessionId, setActiveSessionIdState] = useState<string>(() => {
    const stored = getActiveSessionId()
    const loaded = loadAllSessions()
    if (stored && loaded.some((s) => s.id === stored)) return stored
    return loaded[0]?.id || 'initial'
  })

  // Inline Code Cell Executions
  const [inlineExecResults, setInlineExecResults] = useState<Record<string, BashExecResult>>({})
  const [executingInlineKey, setExecutingInlineKey] = useState<string | null>(null)

  const [messages, setMessages] = useState<UiMessage[]>(() => {
    const loaded = loadAllSessions()
    const activeId = getActiveSessionId()
    const active = loaded.find((s) => s.id === activeId) || loaded[0]
    return active?.messages?.length
      ? (active.messages as UiMessage[])
      : [{ id: 'welcome', role: 'assistant', content: WELCOME_CONTENT }]
  })
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const streamFlushRafRef = useRef<number>(0)
  const termBodyRef = useRef<HTMLDivElement | null>(null)
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const lastUserTextRef = useRef<string>('')

  const provider = useMemo(() => activeProvider(settings), [settings])

  // Debounced mood derivation from conversation context (1.8s hysteresis)
  useEffect(() => {
    const timer = setTimeout(() => {
      const computed = scoreConversation({
        messages,
        busy,
        hasFailure: lastFailureRef.current,
        toolsStripped: toolsStrippedRef.current,
        agentMode: settings.agentMode,
        deepBuild: settings.deepBuild,
      })
      setMood((prev) => (prev !== computed ? computed : prev))
    }, 1800)
    return () => clearTimeout(timer)
  }, [messages, busy, settings.agentMode, settings.deepBuild])

  // Sync messages & auto-title to active session in localStorage
  useEffect(() => {
    if (!activeSessionId) return
    setSessions((prevSessions) => {
      const idx = prevSessions.findIndex((s) => s.id === activeSessionId)
      if (idx < 0) return prevSessions
      const cur = prevSessions[idx]
      let title = cur.title
      if (title === 'New Conversation' || title === 'Welcome to Ablit AI' || !title) {
        const firstUser = messages.find((m) => m.role === 'user')
        if (firstUser) {
          title = generateTitle(firstUser.content)
        }
      }
      const updated: ChatSession = {
        ...cur,
        title,
        messages: messages as any,
        updatedAt: Date.now(),
        model: settings.model,
        provider: settings.provider,
      }
      const next = [...prevSessions]
      next[idx] = updated
      saveSession(updated)
      return next
    })
  }, [messages, activeSessionId, settings.model, settings.provider])

  const persist = useCallback((next: StoredSettings) => {
    setSettings(next)
    saveSettings(next)
  }, [])

  // Session Action Handlers
  const handleSelectSession = useCallback(
    (id: string) => {
      const s = sessions.find((x) => x.id === id)
      if (!s) return
      setActiveSessionId(id)
      setActiveSessionIdState(id)
      setMessages(s.messages as UiMessage[])
      if (s.model && s.model !== settings.model) {
        persist({ ...settings, model: s.model })
      }
    },
    [sessions, settings, persist],
  )

  const handleNewChat = useCallback(() => {
    const fresh = createNewSession(
      [{ id: 'welcome', role: 'assistant', content: WELCOME_CONTENT }],
      settings.model,
      settings.provider,
      'New Conversation',
    )
    setSessions((prev) => [fresh, ...prev])
    setActiveSessionId(fresh.id)
    setActiveSessionIdState(fresh.id)
    setMessages(fresh.messages as UiMessage[])
    setInput('')
    setError(null)
    showToast('Started new conversation', { type: 'info', icon: '➕' })
  }, [settings.model, settings.provider, showToast])

  const handleDeleteSession = useCallback(
    (id: string) => {
      const remaining = deleteSession(id)
      setSessions(remaining)
      if (activeSessionId === id) {
        if (remaining.length > 0) {
          handleSelectSession(remaining[0].id)
        } else {
          handleNewChat()
        }
      }
      showToast('Session deleted', { type: 'info', icon: '🗑️' })
    },
    [activeSessionId, handleSelectSession, handleNewChat, showToast],
  )

  const handleRenameSession = useCallback((id: string, newTitle: string) => {
    updateSessionTitle(id, newTitle)
    setSessions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, title: newTitle, updatedAt: Date.now() } : s)),
    )
    showToast('Session renamed', { type: 'success', icon: '✏️' })
  }, [showToast])

  const handleTogglePin = useCallback((id: string) => {
    const updated = togglePinSession(id)
    setSessions(updated)
    showToast('Pin toggled', { type: 'info', icon: '📌' })
  }, [showToast])

  const handleClearAllHistory = useCallback(() => {
    clearAllSessions()
    const fresh = createNewSession(
      [{ id: 'welcome', role: 'assistant', content: WELCOME_CONTENT }],
      settings.model,
      settings.provider,
      'New Conversation',
    )
    setSessions([fresh])
    setActiveSessionId(fresh.id)
    setActiveSessionIdState(fresh.id)
    setMessages(fresh.messages as UiMessage[])
    showToast('All chat history cleared', { type: 'info', icon: '🧹' })
  }, [settings.model, settings.provider, showToast])

  const handleExportZip = useCallback(() => {
    const activeSession = sessions.find((s) => s.id === activeSessionId)
    const title = activeSession?.title || 'abliterated-project'
    exportProjectZip(title, messages)
    showToast('Downloaded project ZIP bundle', { type: 'success', icon: '📦' })
  }, [sessions, activeSessionId, messages, showToast])

  // Poll sandbox runner (:17330) health
  const refreshSandboxHealth = useCallback(async () => {
    const status = await checkSandboxHealth()
    setSandboxStatus(status)
  }, [])

  // Poll MemPalace bridge (:17333) health
  const refreshMempalaceHealth = useCallback(async () => {
    const status = await checkMempalaceHealth()
    setMempalaceStatus(status)
  }, [])

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === 'hidden') return
      void refreshSandboxHealth()
      void refreshMempalaceHealth()
    }
    tick()
    const interval = setInterval(tick, 20000)
    const onVis = () => {
      if (document.visibilityState === 'visible') tick()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [refreshSandboxHealth, refreshMempalaceHealth])

  // Global ⌘K / ⌘B / ⌘N listeners
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((prev) => !prev)
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'h') {
        e.preventDefault()
        setHistoryOpen((prev) => !prev)
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        setHistoryOpen((prev) => !prev)
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === '`' || e.key === '~')) {
        e.preventDefault()
        setTerminalOpen((prev) => !prev)
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n' && !e.shiftKey) {
        const tag = (document.activeElement?.tagName || '').toLowerCase()
        if (tag !== 'input' && tag !== 'textarea') {
          e.preventDefault()
          handleNewChat()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleNewChat])

  const filteredModels = useMemo(() => {
    let list = models
    if (hideGated && settings.provider === 'featherless') {
      list = list.filter((id) => !gatedIds.has(id) && !isGatedModelId(id))
    }
    const q = modelQuery.trim().toLowerCase()
    if (q) list = list.filter((id) => id.toLowerCase().includes(q))
    return list
  }, [models, modelQuery, hideGated, gatedIds, settings.provider])

  const handleAutoAblitToggle = (enabled: boolean) => {
    setAutoAblit(enabled)
    setStoredAutoBash(enabled)
  }

  const handleTargetChange = (target: ExecutionTarget) => {
    setBashTarget(target)
    setStoredTarget(target)
  }

  const handleAutoRecallToggle = (enabled: boolean) => {
    setAutoRecallState(enabled)
    setAutoRecall(enabled)
  }

  const handleAutoCheckpointToggle = (enabled: boolean) => {
    setAutoCheckpointState(enabled)
    setAutoCheckpoint(enabled)
  }

  const refreshModels = useCallback(async () => {
    const s = settingsRef.current
    setModelsError(null)
    const p = activeProvider(s)
    if (p.requiresApiKey && !p.apiKey) {
      setModels(preferFor(s.provider))
      setModelsError('Add an API key in Settings to load models.')
      return
    }
    try {
      const infos = await fetchModels(p)
      const gated = new Set(infos.filter((m) => m.gated).map((m) => m.id))
      setGatedIds(gated)
      const ids = infos.map((m) => m.id)
      const merged = mergeCatalog(s.provider, ids)
      // Prefer ungated when current selection is gated
      let nextModel = s.model
      if (gated.has(nextModel) || isGatedModelId(nextModel)) {
        nextModel =
          merged.find((id) => !gated.has(id) && !isGatedModelId(id)) ||
          preferFor(s.provider)[0] ||
          merged[0]
      }
      setModels(merged)
      if (nextModel && nextModel !== s.model) {
        const next = { ...s, model: nextModel }
        setSettings(next)
        saveSettings(next)
      } else if (!merged.includes(s.model) && merged[0]) {
        const next = { ...s, model: merged[0] }
        setSettings(next)
        saveSettings(next)
      }
    } catch (e: unknown) {
      setModels(preferFor(s.provider))
      setModelsError(e instanceof Error ? e.message : 'Failed to fetch formula catalog')
    }
  }, [])

  useEffect(() => {
    void refreshModels()
  }, [
    settings.provider,
    settings.featherlessApiKey,
    settings.abliterationApiKey,
    settings.featherlessBaseUrl,
    settings.abliterationBaseUrl,
    settings.sparkHost,
    settings.sparkPort,
    settings.sparkUseProxy,
    settings.sparkApiKey,
    refreshModels,
  ])

  useEffect(() => {
    if (terminalOpen) {
      termBodyRef.current?.scrollTo({ top: termBodyRef.current.scrollHeight, behavior: 'smooth' })
    }
  }, [terminalLogs, terminalOpen])

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (
        subsystemsMenuRef.current &&
        !subsystemsMenuRef.current.contains(e.target as Node)
      ) {
        setSubsystemsMenuOpen(false)
      }
      if (
        quickModelMenuRef.current &&
        !quickModelMenuRef.current.contains(e.target as Node)
      ) {
        setQuickModelMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleOutsideClick)
    return () => document.removeEventListener('mousedown', handleOutsideClick)
  }, [])

  const stop = () => {
    abortRef.current?.abort()
    abortRef.current = null
    setBusy(false)
    setAgentStatus(null)
    setAntiLoopSuggestions(null)
  }

  // Execute bash command in sandbox
  const runBashCommand = async (cmd: string, target = bashTarget): Promise<BashExecResult> => {
    setExecutingCmd(true)
    setTermHistory((prev) => (prev.length > 0 && prev[prev.length - 1] === cmd ? prev : [...prev, cmd]))
    setHistoryIndex(-1)
    const result = await executeBashCommand(cmd, target, undefined, undefined, settings.workspaceDir)
    setTerminalLogs((prev) => [...prev, result])
    setExecutingCmd(false)
    return result
  }

  const handleWorkspaceDirChange = useCallback(
    (dir: string) => {
      const trimmed = (dir || '').trim()
      setStoredWorkspaceDir(trimmed)
      persist({ ...settings, workspaceDir: trimmed })
    },
    [settings, persist],
  )

  const handleTermKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (termHistory.length === 0) return
      const nextIdx = historyIndex === -1 ? termHistory.length - 1 : Math.max(0, historyIndex - 1)
      setHistoryIndex(nextIdx)
      setTermInput(termHistory[nextIdx])
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (historyIndex === -1) return
      const nextIdx = historyIndex + 1
      if (nextIdx >= termHistory.length) {
        setHistoryIndex(-1)
        setTermInput('')
      } else {
        setHistoryIndex(nextIdx)
        setTermInput(termHistory[nextIdx])
      }
    }
  }

  const handleCopyOutput = (text: string, idx: number) => {
    void navigator.clipboard.writeText(text)
    setCopiedLogIdx(idx)
    setTimeout(() => setCopiedLogIdx(null), 1800)
  }

  const toggleCollapseOutput = (idx: number) => {
    setCollapsedOutputs((prev) => ({ ...prev, [idx]: !prev[idx] }))
  }

  // Switch from gated model to ungated alternative and retry
  const handleSwitchUngated = async (altModel: string) => {
    const next = { ...settings, model: altModel }
    persist(next)
    setGatedNotice(null)
    setError(null)
    if (lastUserTextRef.current) {
      setTimeout(() => {
        void sendWithText(lastUserTextRef.current, altModel)
      }, 50)
    }
  }

  // Auto-Heal: send failed command error trace to assistant to diagnose & patch
  const handleAutoHeal = async (cmd: string, stderr: string) => {
    const healPrompt = `The command \`${cmd}\` failed with the following error:\n\`\`\`\n${stderr.trim()}\n\`\`\`\nPlease diagnose this error, explain the issue, and provide the exact corrected command or script to fix it.`
    setInput(healPrompt)
    void sendWithText(healPrompt)
  }

  // DuckDB OCR Identity Inspector
  const handleInspectDuckDb = () => {
    const duckCmd = `python3 -c "import duckdb; con = duckdb.connect('/mnt/nvme/ocr_pipeline/db/identity_index.duckdb'); print('=== DUCKDB TABLES ==='); print(con.execute('SHOW TABLES').df()); print('=== IDENTITY COUNT ==='); print(con.execute('SELECT COUNT(*) FROM identities').fetchall())" 2>&1 || echo "DuckDB table not yet initialized on target."`
    setTerminalOpen(true)
    void runBashCommand(duckCmd, 'dgx_spark')
  }

  // Branch Session into a new persistent conversation
  const handleBranchSession = () => {
    const cur = sessions.find((s) => s.id === activeSessionId)
    const branchTitle = cur ? `Branch: ${cur.title}` : `Branch ${Date.now().toString(36)}`
    const branchSession = createNewSession(
      [
        ...messages,
        {
          id: uid(),
          role: 'assistant',
          content: `==> Forked session into branch [${Date.now().toString(36)}]\n==> Preserved ${messages.length} messages for target ${bashTarget}.`,
        },
      ],
      settings.model,
      settings.provider,
      branchTitle,
    )
    setSessions((prev) => [branchSession, ...prev])
    setActiveSessionId(branchSession.id)
    setActiveSessionIdState(branchSession.id)
    setMessages(branchSession.messages as UiMessage[])
  }

  const appendAssistantStream = async (
    working: ChatMessage[],
    controller: AbortController,
    useTools: boolean,
    activeModelOverride?: string,
  ): Promise<{
    working: ChatMessage[]
    toolCalls: number
    content: string
    reasoning: string
    hasFailure: boolean
    failedCmds: string[]
    executions: Array<{ name: string; rawResult: string; bashResult?: BashExecResult }>
    finishReason: string | null
    toolsStripped?: boolean
  }> => {
    const assistantId = uid()
    setMessages((m) => [...m, { id: assistantId, role: 'assistant', content: '', reasoning: '' }])
    let acc = ''
    let reasoningAcc = ''
    const body: Record<string, unknown> = {
      model: activeModelOverride || settingsRef.current.model,
      messages: working,
      temperature: settingsRef.current.temperature ?? 0.7,
      max_tokens: settingsRef.current.maxTokens ?? 4096,
    }
    let toolsStrippedNotice: string | null = null
    const canNativeTools =
      useTools && providerSupportsNativeTools(settingsRef.current.provider)
    if (canNativeTools) {
      body.tools = AGENT_TOOLS
      body.tool_choice = 'auto'
    } else if (useTools) {
      // Unknown / future providers without tool support — Auto-Bash only (no scary banner).
      toolsStrippedNotice = null
    }
    const flushStreamUi = () => {
      if (streamFlushRafRef.current) {
        cancelAnimationFrame(streamFlushRafRef.current)
        streamFlushRafRef.current = 0
      }
      setMessages((msgs) =>
        msgs.map((msg) =>
          msg.id === assistantId
            ? { ...msg, content: acc, reasoning: reasoningAcc || undefined }
            : msg,
        ),
      )
    }

    const runStream = async (enableThinking: boolean) => {
      return streamChat(
        activeProvider(settingsRef.current),
        body,
        {
          onToken: (tok) => {
            acc += tok
            if (!streamFlushRafRef.current) {
              streamFlushRafRef.current = requestAnimationFrame(() => {
                streamFlushRafRef.current = 0
                const contentSnap = acc
                const reasoningSnap = reasoningAcc
                setMessages((msgs) =>
                  msgs.map((msg) =>
                    msg.id === assistantId
                      ? { ...msg, content: contentSnap, reasoning: reasoningSnap }
                      : msg,
                  ),
                )
              })
            }
          },
          onReasoning: (tok) => {
            reasoningAcc += tok
            if (!streamFlushRafRef.current) {
              streamFlushRafRef.current = requestAnimationFrame(() => {
                streamFlushRafRef.current = 0
                const contentSnap = acc
                const reasoningSnap = reasoningAcc
                setMessages((msgs) =>
                  msgs.map((msg) =>
                    msg.id === assistantId
                      ? { ...msg, content: contentSnap, reasoning: reasoningSnap }
                      : msg,
                  ),
                )
              })
            }
          },
          onToolsStripped: (reason) => {
            toolsStrippedNotice = reason
          },
        },
        controller.signal,
        { enableThinking },
      )
    }

    const wantThinking = Boolean(settingsRef.current.deepBuild)
    const t0 = Date.now()
    let result = await runStream(wantThinking)

    // Deep/thinking models often finish with reasoning only — silent answer pass
    if (
      !(result.content || '').trim() &&
      !result.tool_calls.length &&
      wantThinking &&
      !controller.signal.aborted
    ) {
      flushStreamUi()
      const repairMsgs: ChatMessage[] = [
        ...working,
        {
          role: 'assistant',
          content: reasoningAcc
            ? `(reasoning only — ${reasoningAcc.length} chars; answer missing)`
            : null,
        },
        {
          role: 'user',
          content:
            'Your previous turn produced no user-visible answer (empty content). ' +
            'Reply now with the visible answer and/or native tool_calls. ' +
            'Do not only think. An empty reply is not allowed.',
        },
      ]
      body.messages = repairMsgs
      // Keep reasoningAcc; stream answer into same bubble
      result = await runStream(false)
    }

    const durationMs = Date.now() - t0
    flushStreamUi()


    if (toolsStrippedNotice || result.toolsStripped) {
      const prov = settingsRef.current.provider
      const chip =
        prov === 'spark'
          ? 'tools stripped · restart Spark serve (tool-choice flags)'
          : 'tools stripped · Auto-Bash · tap Use Spark for native tools'
      setMessages((msgs) => [
        ...msgs,
        {
          id: uid(),
          role: 'assistant',
          name: 'status_chip',
          content: chip,
          ...(prov !== 'spark'
            ? {
                followUps: [
                  {
                    id: 'switch-spark',
                    label: 'Use Spark',
                    prompt: '__switch_provider_spark__',
                  },
                ],
              }
            : {}),
        },
      ])
    }

    sendAgentDebugEvent({
      type: 'response',
      model: activeModelOverride || settingsRef.current.model,
      provider: settingsRef.current.provider,
      responseText: result.content || '',
      durationMs,
      tokens: result.content ? Math.round(result.content.length / 4) : 0,
      sessionId: activeSessionId || undefined,
    })

    if (result.tool_calls?.length) {
      for (const tc of result.tool_calls) {
        sendAgentDebugEvent({
          type: 'tool_call',
          model: activeModelOverride || settingsRef.current.model,
          toolName: tc.function.name,
          toolArgs: tc.function.arguments,
          sessionId: activeSessionId || undefined,
        })
      }
    }

    flushStreamUi()

    let visibleContent = (result.content || '').trim()
    if (!visibleContent && !result.tool_calls.length) {
      visibleContent = ''
      const hint =
        reasoningAcc.trim()
          ? '_No answer text after thinking. Retrying was attempted; try Chat mode or send again._'
          : '_Empty model reply (no content, no tools). Try again or switch provider._'
      setMessages((msgs) =>
        msgs.map((msg) =>
          msg.id === assistantId
            ? {
                ...msg,
                content: hint,
                reasoning: reasoningAcc || msg.reasoning,
              }
            : msg,
        ),
      )
      acc = hint
    } else if (visibleContent && visibleContent !== acc) {
      acc = result.content || visibleContent
      flushStreamUi()
    }

    working = [
      ...working,
      {
        role: 'assistant',
        content: (result.content || '').trim() || (result.tool_calls.length ? null : acc) || null,
        tool_calls: result.tool_calls.length ? result.tool_calls : undefined,
      },
    ]
    // Attach tool_calls to the assistant UI message so multi-turn rebuild is faithful
    if (result.tool_calls.length) {
      setMessages((msgs) =>
        msgs.map((msg) =>
          msg.id === assistantId ? { ...msg, tool_calls: result.tool_calls } : msg,
        ),
      )
    }
    if (!useTools || !result.tool_calls.length) {
      return {
        working,
        toolCalls: 0,
        content: result.content || '',
        reasoning: reasoningAcc,
        hasFailure: false,
        failedCmds: [],
        executions: [],
        finishReason: result.finishReason,
        toolsStripped: Boolean(result.toolsStripped || toolsStrippedNotice),
      }
    }

    const toolResult = await applyToolCalls(
      result.tool_calls,
      activeProvider(settingsRef.current),
      (bashRes) => {
        setTerminalLogs((prev) => [...prev, bashRes])
      },
    )

    working = [...working, ...toolResult.messages]

    for (const exec of toolResult.executions) {
      sendAgentDebugEvent({
        type: 'tool_result',
        toolName: exec.name,
        exitCode: exec.exitCode ?? (exec.ok ? 0 : 1),
        stdout: exec.bashResult?.stdout || (exec.ok ? exec.rawResult : undefined),
        stderr: exec.bashResult?.stderr || (!exec.ok ? exec.rawResult : undefined),
        error: exec.error,
        sessionId: activeSessionId || undefined,
      })

      const memoryUiLabel =
        exec.name === 'memory_search'
          ? 'Searching Memory...'
          : exec.name === 'memory_checkpoint'
            ? 'Saving Memory...'
            : null
      setMessages((msgs) => [
        ...msgs,
        {
          id: uid(),
          role: 'tool',
          content: memoryUiLabel ?? `==> ${exec.name}:\n${exec.rawResult}`,
          execResult: exec.bashResult,
          tool_call_id: exec.toolCallId,
          name: exec.name,
        },
      ])
    }

    return {
      working,
      toolCalls: result.tool_calls.length,
      content: result.content || '',
        reasoning: reasoningAcc,
      hasFailure: toolResult.hasFailure,
      failedCmds: toolResult.failedCmds,
      executions: toolResult.executions,
      finishReason: result.finishReason,
      toolsStripped: Boolean(result.toolsStripped || toolsStrippedNotice),
    }
  }

  const sendWithText = async (text: string, modelOverride?: string) => {
    if (!text || busy) return
    if (provider.requiresApiKey && !provider.apiKey) {
      setError('Add an API key in Settings to continue.')
      setSettingsOpen(true)
      return
    }
    setError(null)
    setGatedNotice(null)
    lastUserTextRef.current = text
    lastFailureRef.current = false
    toolsStrippedRef.current = false

    // MemPalace: search-before-answer — only when the ask needs prior knowledge
    let memoryPrompt = ''
    const wantKnowledge = looksLikeKnowledgeQuery(text)
    if (autoRecall && mempalaceStatus?.online && wantKnowledge) {
      try {
        const recall = await searchMemory(text, { limit: 5 })
        const MIN_SIM = 0.35
        const filtered = recall.results
          .filter((r) => (r.text || '').trim().length > 40)
          .filter((r) => r.similarity == null || r.similarity >= MIN_SIM)
          .sort((a, b) => {
            const boost = (r: typeof a) => (r.room === 'agent-analysis' ? 0.08 : 0)
            return (b.similarity || 0) + boost(b) - ((a.similarity || 0) + boost(a))
          })
          .slice(0, 3)
        if (filtered.length > 0) {
          const memoryCtx = filtered
            .map((r) => {
              const sim =
                r.similarity != null ? ` sim=${r.similarity.toFixed(2)}` : ''
              return `[${r.wing}/${r.room}${sim}] ${(r.text || '').slice(0, 220)}`
            })
            .join('\n')
          memoryPrompt = `Past memories (from MemPalace — high relevance only):\n${memoryCtx}`
        }
      } catch {
        // Memory failures should never block chat
      }
    }

    // On-Device RAG: gate on knowledge-shaped queries + higher score floor
    let ragPrompt = ''
    let activeRagCitations: string[] = []
    const RAG_MIN_SCORE = 0.22
    if (settings.clusterRag !== false && wantKnowledge) {
      try {
        const ragMatches = queryRagKnowledge(text, 2).filter((m) => m.score >= RAG_MIN_SCORE)
        if (ragMatches.length > 0) {
          ragPrompt = formatRagContextBlock(ragMatches)
          activeRagCitations = ragMatches.map((m) => m.chunk.title)
        }
      } catch {
        // RAG failures should never block chat
      }
    }

    const userMsg: UiMessage = {
      id: uid(),
      role: 'user',
      content: text,
      ragCitations: activeRagCitations.length > 0 ? activeRagCitations : undefined,
    }
    setMessages((m) => [...m, userMsg])
    setBusy(true)

    sendAgentDebugEvent({
      type: 'request',
      model: modelOverride || settings.model,
      provider: settings.provider,
      userPrompt: text,
      sessionId: activeSessionId || undefined,
    })

    let working: ChatMessage[] = []
    let effectiveSystem = settings.agentMode ? AGENT_SYSTEM : CHAT_SYSTEM
    if (settings.deepBuild && settings.agentMode) {
      effectiveSystem = `${effectiveSystem}\n\n${DEEP_BUILD_DIRECTIVE}`
    }
    if (memoryPrompt) {
      effectiveSystem = `${effectiveSystem}\n\n${memoryPrompt}`
    }
    if (ragPrompt) {
      effectiveSystem = `${effectiveSystem}\n\n${ragPrompt}`
    }
    if (settings.agentMode) {
      effectiveSystem = `${effectiveSystem}\n\n${buildTurnContextBlock({
        goal: text,
        stage: 'discovery',
        round: 1,
      })}`
    }
    working.push({ role: 'system', content: effectiveSystem })

    for (const m of [...messages.filter((x) => x.id !== 'welcome'), userMsg]) {
      const msg: ChatMessage = { role: m.role, content: m.content }
      // Preserve tool_call_id / name / tool_calls so strict OpenAI-compatible APIs
      // don't 400 on multi-turn agent sessions (tool messages require tool_call_id)
      if (m.tool_calls) msg.tool_calls = m.tool_calls
      if (m.tool_call_id) {
        msg.tool_call_id = m.tool_call_id
        if (m.name) msg.name = m.name
      }
      working.push(msg)
    }

    const controller = new AbortController()
    abortRef.current = controller

    const isAgent = settings.agentMode
    const cfg = settings.agentMaxRounds ?? 8
    const ROUND_BATCH = isAgent ? (settings.deepBuild ? Math.max(cfg, 14) : cfg) : 1
    const MAX_AUTO_CONTINUES = isAgent ? (settings.deepBuild ? 8 : 5) : 0
    let autoContinueCount = 0
    let maxRounds = ROUND_BATCH
    let finalContent = ''
    let emptyAnswerRetries = 0
    let lastFailedCommand: string | null = null

    setAntiLoopSuggestions(null)
    // Initialize continuous anti-loop and direction analyzer with the user's objective
    analyzerRef.current.initSession(text)

    try {
      let round = 0
      while (round < maxRounds) {
        if (controller.signal.aborted) break

        if (isAgent) {
          setAgentStatus({
            round: round + 1,
            maxRounds,
            stage: round === 0 ? 'thinking' : lastFailedCommand ? 'fixing' : 'running_cmd',
            detail: lastFailedCommand
              ? (settings.deepBuild ? `Deep Fix: ${lastFailedCommand}` : `Fixing: ${lastFailedCommand}`)
              : autoContinueCount > 0
              ? `Auto-continue ${autoContinueCount}/${MAX_AUTO_CONTINUES}`
              : settings.deepBuild
              ? 'Exhaustive architectural planning...'
              : undefined,
          })
        }

        const out = await appendAssistantStream(working, controller, isAgent, modelOverride)
        working = out.working
        finalContent = out.content
        if (out.toolsStripped) toolsStrippedRef.current = true

        if (controller.signal.aborted) break

        // 0a. Empty answer recovery (thinking-only / blank model turns)
        const answerEmpty =
          !(out.content || '').trim() ||
          /^_No answer text|^_Empty model reply|\(empty response\)/i.test((out.content || '').trim())
        if (answerEmpty && out.toolCalls === 0) {
          if (emptyAnswerRetries < 2) {
            emptyAnswerRetries++
            setMessages((prev) => [
              ...prev,
              {
                id: uid(),
                role: 'assistant',
                name: 'status_chip',
                content: `empty reply · recovering ${emptyAnswerRetries}/2`,
              },
            ])
            working.push({
              role: 'user',
              content: buildContinueNudge({
                goal: text,
                reason: 'empty-answer recovery',
                stage: analyzerRef.current.getStage(),
                lastFailed: lastFailedCommand,
                directive:
                  'Previous turn had empty user-visible content. Output a concrete answer or tool_calls now. Do not only reason. Do not reply empty.',
              }),
            })
            round++
            continue
          }
        }

        // 0. Auto-continue if hit token length limit mid-stream
        if (out.finishReason === 'length' && isAgent) {
          setMessages((prev) => [
            ...prev,
            {
              id: uid(),
              role: 'assistant',
              content: '⚡ Output reached token limit mid-generation. Automatically sending "continue" to resume…',
            },
          ])
          working.push({
            role: 'user',
            content: buildContinueNudge({
              goal: text,
              reason: 'token-limit resume',
              stage: analyzerRef.current.getStage(),
              lastFailed: lastFailedCommand,
              directive: 'Resume mid-answer. Finish the interrupted thought, then take the next concrete tool action.',
            }),
          })
          round++
          continue
        }

        // Helper to check and handle auto-continuation if step limit is reached
        const checkAutoContinue = (reasonNotice: string) => {
          round++
          if (round >= maxRounds && isAgent && autoContinueCount < MAX_AUTO_CONTINUES) {
            autoContinueCount++
            maxRounds += ROUND_BATCH
            setMessages((prev) => [
              ...prev,
              {
                id: uid(),
                role: 'assistant',
                content: `⚡ Agent reached step limit (${round} rounds). Automatically sending "continue" (${reasonNotice} — batch ${autoContinueCount}/${MAX_AUTO_CONTINUES})…`,
              },
            ])
            working.push({
              role: 'user',
              content: buildContinueNudge({
                goal: text,
                reason: reasonNotice,
                stage: analyzerRef.current.getStage(),
                lastFailed: lastFailedCommand,
                avoid: lastFailedCommand,
              }),
            })
          }
        }

        // 1. Collect files modified & files read from content or tool calls
        const filesModified: string[] = []
        const filesRead: string[] = []

        if (out.content) {
          const modMatches = out.content.match(
            /(?:>|cat << ['"]?EOF['"]? >|write_file[^"]*"path":\s*")([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)/g
          )
          if (modMatches) {
            for (const fm of modMatches) {
              const clean = fm
                .replace(/.*(?:>|write_file[^"]*"path":\s*")/, '')
                .replace(/['"]/g, '')
                .trim()
              if (clean && !filesModified.includes(clean)) filesModified.push(clean)
            }
          }
        }

        let lastCmdRun: string | undefined
        let lastExitCode: number | undefined
        let lastStdout: string | undefined
        let lastStderr: string | undefined

        // Process native tool executions
        const toolNamesUsed: string[] = []
        if (out.executions && out.executions.length > 0) {
          for (const exec of out.executions) {
            toolNamesUsed.push(exec.name)
            if (exec.name === 'write_file') {
              try {
                const parsed = JSON.parse(exec.rawResult)
                if (parsed?.path && !filesModified.includes(parsed.path)) filesModified.push(parsed.path)
              } catch {}
            } else if (exec.name === 'read_file') {
              try {
                const parsed = JSON.parse(exec.rawResult)
                if (parsed?.path && !filesRead.includes(parsed.path)) filesRead.push(parsed.path)
              } catch {}
            } else if (exec.name === 'bash' || exec.name === 'exec') {
              lastCmdRun = exec.bashResult?.command
              lastExitCode = exec.bashResult?.exitCode
              lastStdout = exec.bashResult?.stdout
              lastStderr = exec.bashResult?.stderr || exec.bashResult?.error || exec.rawResult
            } else if (lastExitCode === undefined && typeof exec.rawResult === 'string') {
              try {
                const parsed = JSON.parse(exec.rawResult)
                if (typeof parsed?.exitCode === 'number') lastExitCode = parsed.exitCode
              } catch {}
            }
          }
        }

        // Only extract shell from fenced/<run> blocks; skip pure Q&A prose.
        // Also skip when native tool_calls already ran this round.
        const hasShellMarkers =
          /<(?:run|bash|cmd)>/i.test(out.content || '') ||
          /```(?:bash|sh|zsh|shell|python|py|node)\b/i.test(out.content || '')
        const shouldRunExtracted =
          (isAgent || autoAblit) && out.toolCalls === 0 && hasShellMarkers
        const extracted = shouldRunExtracted ? extractShellCommands(out.content) : []
        let anyExtractedFailed = false
        let failedCmd = ''

        if (extracted.length > 0) {
          setTerminalOpen(true)
          for (const cmd of extracted) {
            if (controller.signal.aborted) break
            if (isAgent) {
              setAgentStatus({
                round: round + 1,
                maxRounds,
                stage: 'running_cmd',
                detail: cmd,
              })
            }
            const execRes = await runBashCommand(cmd, bashTarget)
            lastCmdRun = cmd
            lastExitCode = execRes.exitCode
            lastStdout = execRes.stdout
            lastStderr = execRes.stderr || execRes.error

            setMessages((prev) => [
              ...prev,
              {
                id: uid(),
                role: 'tool',
                content: `==> ablit exec ($ ${cmd})\n⚡ exit ${execRes.exitCode} (${execRes.durationMs}ms):\n${execRes.stdout || execRes.stderr || '(no output)'}`,
                execResult: execRes,
              },
            ])

            if (!execRes.ok || execRes.exitCode !== 0) {
              anyExtractedFailed = true
              failedCmd = cmd
              const failOut = (
                execRes.stderr || execRes.stdout || execRes.error || '(no output)'
              ).slice(0, 2500)
              working.push({
                role: 'user',
                content:
                  'Command `' +
                  cmd +
                  '` FAILED on ' +
                  bashTarget +
                  ' (exit ' +
                  String(execRes.exitCode) +
                  '):\n```\n' +
                  failOut +
                  '\n```\n' +
                  buildContinueNudge({
                    goal: text,
                    reason: 'auto-fix',
                    stage: 'implementation',
                    lastFailed: cmd,
                    avoid: cmd,
                    directive:
                      'Diagnose from the error above, change approach (edit/install/flags), then re-run a corrected command. Do not repeat this exact failing command unchanged.',
                  }),
              })
            } else {
              const okOut = (execRes.stdout || '(no output)').slice(0, 2500)
              working.push({
                role: 'user',
                content:
                  'Execution of `' +
                  cmd +
                  '` on ' +
                  bashTarget +
                  ' SUCCEEDED (exit 0):\n```\n' +
                  okOut +
                  '\n```\nProceed to the next concrete step, or give a final verified summary if the goal is done.',
              })
            }
          }
        }

        // Continuous Action & Response Analysis
        const currentAction: ActionRecord = {
          round,
          command: lastCmdRun,
          toolName: toolNamesUsed[0] || (extracted.length ? 'auto_bash' : undefined),
          toolArgs: toolNamesUsed.length ? toolNamesUsed.join(',') : undefined,
          exitCode: lastExitCode,
          stdoutExcerpt: lastStdout?.slice(0, 400),
          stderrExcerpt: lastStderr?.slice(0, 400),
          responseText: out.content,
          filesModified,
          filesRead,
          timestamp: Date.now(),
        }

        // CONTINUOUS ANALYSIS: Detect answer looping, stagnant errors, cyclic oscillation, and track progress direction
        const analysis = analyzerRef.current.analyzeStep(currentAction)
        analyzerRef.current.recordAction(currentAction)

        sendAgentDebugEvent({
          type: 'anti_loop',
          round,
          model: modelOverride || settings.model,
          analysis,
          sessionId: activeSessionId || undefined,
        })

        // Circuit breaker: halt runaway loops
        if (isAgent && analysis.isLooping && analysis.suggestedAction === 'abort_runaway') {
          const suggestions = getAntiLoopPromptSuggestions(analysis, text)
          setAntiLoopSuggestions(suggestions)
          setAgentStatus({
            round: round + 1,
            maxRounds,
            stage: 'anti_loop',
            detail: analysis.progressSummary,
          })
          const chips = suggestions.map((s) => `• **${s.label}**`).join('\n')
          setMessages((prev) => [
            ...prev,
            {
              id: uid(),
              role: 'assistant',
              content: `🛑 **Anti-Loop Circuit Breaker Triggered**\n\n> ${analysis.progressSummary}\n\nThe agent has stalled or repeated answers without forward progress toward: "${text}".\n\nExecution has been paused to protect tokens and prevent infinite looping.\n\n**Try a suggestion below (or pick one in the composer):**\n${chips}`,
            },
          ])
          break
        }

        // Active Anti-Loop Steering
        if (isAgent && analysis.isLooping) {
          const suggestions = getAntiLoopPromptSuggestions(analysis, text)
          setAntiLoopSuggestions(suggestions)
          setAgentStatus({
            round: round + 1,
            maxRounds,
            stage: 'anti_loop',
            detail: analysis.progressSummary,
          })

          const chipLine = suggestions.map((s) => s.label).join(' · ')
          setMessages((prev) => [
            ...prev,
            {
              id: uid(),
              role: 'assistant',
              content: `🔄 **Anti-Loop Active (${analysis.loopType?.replace('_', ' ')})**:\n> ${analysis.progressSummary}\n⚡ Steering agent to ensure progress in the right direction…\n\n_Suggestions: ${chipLine}_`,
            },
          ])

          working.push({
            role: 'user',
            content: buildContinueNudge({
              goal: text,
              reason: `anti-loop ${analysis.loopType || 'detected'}`,
              stage: analysis.stage || analyzerRef.current.getStage(),
              lastFailed: lastFailedCommand,
              avoid: analysis.repeatedAction || lastFailedCommand,
              directive:
                analysis.nudgePrompt ||
                'STOP repeating this strategy. Take one distinct concrete tool action toward the goal.',
            }),
          })

          checkAutoContinue('anti-loop steering')
          continue
        }

        // Handle native tool call failure auto-fixing
        if (out.toolCalls > 0 && out.hasFailure) {
          lastFailedCommand = out.failedCmds.join(', ') || 'tool execution'
          lastFailureRef.current = true
          if (isAgent) {
            setAgentStatus({
              round: round + 1,
              maxRounds,
              stage: 'fixing',
              detail: `Diagnosing & fixing: ${lastFailedCommand}`,
            })
          }
          working.push({
            role: 'user',
            content: buildContinueNudge({
              goal: text,
              reason: 'auto-fix',
              stage: 'implementation',
              lastFailed: lastFailedCommand,
              avoid: lastFailedCommand,
              directive:
                'Inspect the error output above, change the approach (edit files / flags / deps), then re-execute to verify. Do not repeat the identical failing command unchanged.',
            }),
          })
          checkAutoContinue('applying fixes')
          continue
        }

        // Handle extracted markdown command failure auto-fixing
        if (anyExtractedFailed) {
          lastFailedCommand = failedCmd
          lastFailureRef.current = true
          if (isAgent) {
            setAgentStatus({
              round: round + 1,
              maxRounds,
              stage: 'fixing',
              detail: `Diagnosing & fixing: ${failedCmd}`,
            })
          }
          // Per-command observations already pushed; reinforce goal-anchored steer once
          working.push({
            role: 'user',
            content: buildContinueNudge({
              goal: text,
              reason: 'auto-fix',
              stage: 'implementation',
              lastFailed: failedCmd,
              avoid: failedCmd,
              directive:
                'Apply a distinct fix and re-verify. Prefer native bash/write_file tools when available.',
            }),
          })
          checkAutoContinue('applying fixes')
          continue
        }

        // If tools or commands ran successfully, decide early-stop vs continue
        if (out.toolCalls > 0 || extracted.length > 0) {
          lastFailedCommand = null
          lastFailureRef.current = false
          const goalVerified =
            isAgent &&
            !out.hasFailure &&
            !anyExtractedFailed &&
            shouldCountAsGoalVerified({
              command: lastCmdRun,
              exitCode: lastExitCode,
              stdout: lastStdout,
            })

          if (goalVerified) {
            setMessages((prev) => [
              ...prev,
              {
                id: uid(),
                role: 'assistant',
                content:
                  `✅ **Goal check passed** — verification succeeded` +
                  (lastCmdRun ? ` (\`${lastCmdRun}\` exit 0)` : '') +
                  `. Stopping early to avoid extra agent rounds.`,
              },
            ])
            break
          }

          checkAutoContinue('executing tasks')
          continue
        }

        // No tool calls and no extracted commands: Task finished!
        break
      }

      // If finished with an unresolved error after max rounds
      if (round >= maxRounds && isAgent) {
        setMessages((prev) => [
          ...prev,
          {
            id: uid(),
            role: 'assistant',
            content: `⚡ Agent reached maximum autonomous rounds (${round} rounds across ${autoContinueCount} auto-continues).${
              lastFailedCommand ? ` Last command checked: \`${lastFailedCommand}\`.` : ''
            }\nYou can type 'continue' to resume execution.`,
          },
        ])
      }

      // MemPalace: auto-checkpoint after response + agent analyzer summary
      if (autoCheckpoint && mempalaceStatus?.online) {
        try {
          const items: Array<{ wing: string; room: string; content: string }> = []
          if (finalContent) {
            items.push({
              wing: 'web-api-app',
              room: 'chat',
              content: `User: ${text}

Assistant: ${finalContent}`,
            })
          }
          if (isAgent) {
            items.push({
              wing: 'web-api-app',
              room: 'agent-analysis',
              content: analyzerRef.current.getSessionSummary(),
            })
          }
          if (items.length) await checkpointMemory(items)
        } catch {
          // Checkpoint failures should never block chat
        }
      }

    } catch (e: unknown) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) {
        sendAgentDebugEvent({
          type: 'error',
          model: modelOverride || settings.model,
          error: e instanceof Error ? e.message : String(e),
          sessionId: activeSessionId || undefined,
        })
        if (
          e instanceof GatedModelError ||
          (e instanceof Error && e.message.includes('model_gated_needs_oauth'))
        ) {
          const m = modelOverride || settings.model
          const alt = UNGATED_ALTERNATIVE[m] || 'mlabonne/Meta-Llama-3.1-8B-Instruct-abliterated'
          setGatedNotice({
            model: m,
            alt,
            message: e instanceof Error ? e.message : String(e),
          })
        } else {
          setError(e instanceof Error ? e.message : String(e))
        }
      }
    } finally {
      abortRef.current = null
      setBusy(false)
      setAgentStatus(null)
    }
  }

  const send = async () => {
    const text = input.trim()
    if (!text) return
    setInput('')
    await sendWithText(text)
  }

  // Helper to render message content with syntax blocks, run buttons & deep thinking traces
  const chatScrollToken = messages.length + (busy ? 1 : 0)

  // Effective rain mood: auto (derived) / off (static focus) / manual (user-picked)
  const effectiveMood: Mood =
    settings.rainMode === 'off'
      ? 'focus'
      : settings.rainMode === 'manual'
        ? ((settings.rainMoodManual as Mood) || 'focus')
        : mood

  // Effective 3-point perspective laser abliteration level: auto / off / manual
  const effectiveLaserLevel: AbliterationLevel =
    settings.laserMode === 'off'
      ? 0
      : settings.laserMode === 'manual'
        ? (settings.laserLevelManual ?? 3)
        : inferAbliterationLevel(
            settings.model,
            settings.provider,
            busy,
            isGatedModelId(settings.model),
          )

  return (
    <div className="app">
      {/* 3-Point Perspective Laser-Trace Field (scaled by uncensored/abliteration level) */}
      <PerspectiveLaserField level={effectiveLaserLevel} active={busy} mood={effectiveMood} />
      {/* Ambient glitch background header — intensifies when agent is busy */}
      <div className="matrix-glitch-title" data-active={busy} aria-hidden="true">
        <div className="glitch-meta-tag">// SYSTEM: ABLITERATED // KERNEL: UNCONSTRAINED</div>
        <span data-text="ABLITERATED">ABLITERATED</span>
      </div>

      {/* Top bar */}
      <header>
        <div className="header-brand">
          <button
            type="button"
            className="ghost btn-sm btn-session-toggle"
            onClick={() => setHistoryOpen(!historyOpen)}
            title="Chats (⌘B)"
          >
            <span className="session-icon">≡</span>
            <span className="btn-label">Chats</span>
            <span className="history-count-badge-inline">{sessions.length}</span>
          </button>
          <div className="brand-title-group">
            <img src="/icons/icon-lightning.png" alt="Studio" className="brand-icon-img" />
            <span className="brand-name">Abliterated <span className="boldface-em">Studio</span></span>
          </div>
          {/* Expandable Model Switcher Dropdown */}
          <div className="fui-dropdown-container" ref={quickModelMenuRef}>
            <button
              type="button"
              className="model-chip-button"
              onClick={() => setQuickModelMenuOpen(!quickModelMenuOpen)}
              title={`Model: ${settings.model}`}
            >
              <span className="model-chip-dot" />
              <span className="model-chip-name">{settings.model.split('/').pop() || settings.model}</span>
              <span className={`fui-chevron ${quickModelMenuOpen ? 'open' : ''}`}>▾</span>
            </button>

            {quickModelMenuOpen && (
              <div className="fui-model-dropdown">
                <div className="fui-menu-header" style={{ padding: '4px 8px' }}>
                  <span className="fui-menu-title">Models</span>
                  <span className="fui-menu-badge">{settings.provider.toUpperCase()}</span>
                </div>
                <div className="fui-model-search-wrap">
                  <span className="fui-model-search-icon">🔍</span>
                  <input
                    type="text"
                    className="fui-model-search-input"
                    placeholder="Search models…"
                    value={modelQuery}
                    onChange={(e) => setModelQuery(e.target.value)}
                    autoFocus
                  />
                </div>
                <div className="fui-model-list">
                  {(filteredModels.length ? filteredModels : models).slice(0, 15).map((id) => {
                    const isSelected = settings.model === id
                    const label = modelLabel(id)
                    return (
                      <button
                        type="button"
                        key={id}
                        className={`fui-model-option ${isSelected ? 'selected' : ''}`}
                        onClick={() => {
                          persist({ ...settings, model: id })
                          setQuickModelMenuOpen(false)
                          showToast(`Model → ${label}`, { type: 'info' })
                        }}
                      >
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {isSelected ? '✓ ' : ''}{label}
                        </span>
                        <span style={{ fontSize: 9.5, opacity: 0.7, marginLeft: 8 }}>
                          {id.includes('27b') ? '27B' : id.includes('70b') || id.includes('72b') ? '70B+' : 'STD'}
                        </span>
                      </button>
                    )
                  })}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 4, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                  <button
                    type="button"
                    className="ghost btn-sm"
                    style={{ fontSize: 10, padding: '3px 6px' }}
                    onClick={() => {
                      setQuickModelMenuOpen(false)
                      setSettingsOpen(true)
                    }}
                  >
                    All models & settings…
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="header-actions">
          <MeshPulse
            sparkHost={settings.sparkHost}
            sandboxOnline={sandboxStatus?.online}
            sandboxLatency={sandboxStatus?.latencyMs}
            mempalaceOnline={mempalaceStatus?.online}
            mempalaceLatency={mempalaceStatus?.latencyMs}
          />
          {settings.rainMode === 'auto' && (
            <div
              className="mood-chip"
              data-mood={effectiveMood}
              title={`Rain mood: ${MOOD_LABELS[effectiveMood]}`}
            >
              <span className="mood-dot" />
              {MOOD_LABELS[effectiveMood]}
            </div>
          )}

          {settings.laserMode !== 'off' && (
            <button
              type="button"
              className="laser-level-chip"
              data-level={effectiveLaserLevel}
              onClick={() => setSettingsOpen(true)}
              title={`Abliteration Laser Grid: Level ${effectiveLaserLevel} (${ABLITERATION_LEVELS[effectiveLaserLevel].label} · ${ABLITERATION_LEVELS[effectiveLaserLevel].tag}) · Mode: ${settings.laserMode ?? 'auto'}. Click to configure.`}
            >
              <span className="laser-dot" />
              <span className="laser-tag">{ABLITERATION_LEVELS[effectiveLaserLevel].label}</span>
            </button>
          )}

          {/* Expandable Subsystems & Operations Mega-Dropdown */}
          <div className="fui-dropdown-container" ref={subsystemsMenuRef}>
            <button
              type="button"
              className={`fui-menu-trigger-btn ${subsystemsMenuOpen ? 'active' : ''}`}
              onClick={() => setSubsystemsMenuOpen(!subsystemsMenuOpen)}
              title="More — terminal, files, export, commands"
              aria-label="More"
            >
              <span className="fui-trigger-dot" />
              <span aria-hidden="true">⋯</span>
            </button>

            {subsystemsMenuOpen && (
              <div className="fui-dropdown-menu align-right">
                <div className="fui-menu-header">
                  <span className="fui-menu-title">Tools</span>
                  <span className="fui-menu-badge">ONLINE</span>
                </div>

                {/* Section 1: Runtimes & Workspaces */}
                <div className="fui-menu-section">
                  <div className="fui-menu-section-label">Runtimes & files</div>
                  <button
                    type="button"
                    className="fui-menu-item"
                    onClick={() => {
                      setTerminalOpen(!terminalOpen)
                      setSubsystemsMenuOpen(false)
                    }}
                  >
                    <span className="fui-item-icon">🐍</span>
                    <div className="fui-item-info">
                      <span className="fui-item-name">Terminal</span>
                      <span className="fui-item-desc">{terminalOpen ? 'Close console drawer' : `Open bash console (${terminalLogs.length} logs)`}</span>
                    </div>
                    <span className="fui-item-tag">{bashTarget.toUpperCase()}</span>
                  </button>

                  <button
                    type="button"
                    className="fui-menu-item"
                    onClick={() => {
                      setExplorerOpen(true)
                      setSubsystemsMenuOpen(false)
                    }}
                  >
                    <span className="fui-item-icon">🗂️</span>
                    <div className="fui-item-info">
                      <span className="fui-item-name">Workspace Explorer</span>
                      <span className="fui-item-desc">{settings.workspaceDir ? settings.workspaceDir.replace('/Users/adminuser', '~') : '~/AIUI'}</span>
                    </div>
                    <kbd className="fui-item-kbd">⌘O</kbd>
                  </button>

                  <button
                    type="button"
                    className="fui-menu-item"
                    onClick={() => {
                      setTerminalOpen(true)
                      void runBashCommand('uname -a && uptime && python3 --version', bashTarget)
                      setSubsystemsMenuOpen(false)
                    }}
                  >
                    <span className="fui-item-icon">🩺</span>
                    <div className="fui-item-info">
                      <span className="fui-item-name">Health check</span>
                      <span className="fui-item-desc">Sweep kernel, uptime, and python health</span>
                    </div>
                    <span className="fui-item-tag">HEALTH</span>
                  </button>

                  <button
                    type="button"
                    className="fui-menu-item"
                    onClick={() => {
                      handleInspectDuckDb()
                      setSubsystemsMenuOpen(false)
                    }}
                  >
                    <span className="fui-item-icon">🦆</span>
                    <div className="fui-item-info">
                      <span className="fui-item-name">DuckDB inspector</span>
                      <span className="fui-item-desc">Inspect columnar NVMe database</span>
                    </div>
                    <span className="fui-item-tag">DUCKDB</span>
                  </button>
                </div>

                {/* Section 2: Missions & Sessions */}
                <div className="fui-menu-section">
                  <div className="fui-menu-section-label">Chats & export</div>
                  <button
                    type="button"
                    className="fui-menu-item"
                    onClick={() => {
                      setHistoryOpen(true)
                      setSubsystemsMenuOpen(false)
                    }}
                  >
                    <span className="fui-item-icon">≡</span>
                    <div className="fui-item-info">
                      <span className="fui-item-name">Chat history</span>
                      <span className="fui-item-desc">{sessions.length} saved conversations</span>
                    </div>
                    <kbd className="fui-item-kbd">⌘B</kbd>
                  </button>

                  <button
                    type="button"
                    className="fui-menu-item"
                    onClick={() => {
                      handleBranchSession()
                      setSubsystemsMenuOpen(false)
                    }}
                  >
                    <span className="fui-item-icon">🌿</span>
                    <div className="fui-item-info">
                      <span className="fui-item-name">Fork this chat</span>
                      <span className="fui-item-desc">Clone conversation into an independent thread</span>
                    </div>
                    <span className="fui-item-tag">FORK</span>
                  </button>

                  <button
                    type="button"
                    className="fui-menu-item"
                    onClick={() => {
                      handleExportZip()
                      setSubsystemsMenuOpen(false)
                    }}
                  >
                    <span className="fui-item-icon">📦</span>
                    <div className="fui-item-info">
                      <span className="fui-item-name">Export project ZIP</span>
                      <span className="fui-item-desc">Download scripts, logs & telemetry</span>
                    </div>
                    <span className="fui-item-tag">ZIP</span>
                  </button>
                </div>

                {/* Section 3: System & Tools */}
                <div className="fui-menu-section">
                  <div className="fui-menu-section-label">System</div>
                  <button
                    type="button"
                    className="fui-menu-item"
                    onClick={() => {
                      setPaletteOpen(true)
                      setSubsystemsMenuOpen(false)
                    }}
                  >
                    <span className="fui-item-icon">⌘</span>
                    <div className="fui-item-info">
                      <span className="fui-item-name">Command palette</span>
                      <span className="fui-item-desc">Fuzzy command execution</span>
                    </div>
                    <kbd className="fui-item-kbd">⌘K</kbd>
                  </button>

                  <button
                    type="button"
                    className="fui-menu-item"
                    onClick={() => {
                      setSettingsOpen(true)
                      setSubsystemsMenuOpen(false)
                    }}
                  >
                    <span className="fui-item-icon">⚙️</span>
                    <div className="fui-item-info">
                      <span className="fui-item-name">Settings</span>
                      <span className="fui-item-desc">Models, endpoints, API keys & RAG</span>
                    </div>
                    <kbd className="fui-item-kbd">⌘,</kbd>
                  </button>
                </div>
              </div>
            )}
          </div>

          <button
            type="button"
            className="ghost btn-sm btn-icon"
            onClick={() => setSettingsOpen(true)}
            title="Settings (⌘,)"
            aria-label="Settings"
          >
            ⚙
          </button>
        </div>
      </header>

      {/* Main Chat Stage */}
      <ChatStage
        messages={messages}
        sparkHost={settings.sparkHost}
        sandboxOnline={sandboxStatus?.online}
        mempalaceOnline={mempalaceStatus?.online}
        onSelectPrompt={(prompt) => {
          setInput(prompt)
          void sendWithText(prompt)
        }}
        gatedNotice={gatedNotice}
        onSwitchUngated={(model) => void handleSwitchUngated(model)}
        inlineExecResults={inlineExecResults}
        executingInlineKey={executingInlineKey}
        copiedCellKey={copiedCellKey}
        executingCmd={executingCmd}
        onCopyCode={(cellKey, code) => {
          navigator.clipboard.writeText(code)
          setCopiedCellKey(cellKey)
          showToast('Copied', { type: 'success' })
          setTimeout(() => setCopiedCellKey((c) => (c === cellKey ? null : c)), 2000)
        }}
        onRunCode={async (cellKey, code) => {
          setExecutingInlineKey(cellKey)
          const cmd = code.trim().replace(/^\$\s+/, '')
          const res = await runBashCommand(cmd, bashTarget)
          setInlineExecResults((prev) => ({ ...prev, [cellKey]: res }))
          setExecutingInlineKey(null)
        }}
        onAutoHeal={(code, err) => handleAutoHeal(code, err)}
        onCopyMessage={(id, content) => {
          navigator.clipboard.writeText(content)
          setCopiedCellKey(`msg_${id}`)
          showToast('Copied', { type: 'success' })
          setTimeout(() => setCopiedCellKey((c) => (c === `msg_${id}` ? null : c)), 2000)
        }}
        scrollToken={chatScrollToken}
        streamingMessageId={
          busy && messages.length && messages[messages.length - 1]?.role === 'assistant'
            ? messages[messages.length - 1].id
            : undefined
        }
        onFollowUp={(prompt) => {
          if (prompt === '__switch_provider_spark__') {
            persist({
              ...settings,
              provider: 'spark',
              model: SPARK_PREFER[0],
            })
            showToast('Switched to Spark · qwen-abliterated', { type: 'success' })
            return
          }
          if (busy) {
            stop()
            setInput(prompt)
            showToast('Stopped — suggestion loaded in composer', { type: 'info' })
            return
          }
          void sendWithText(prompt)
        }}
      />

      <Composer
        error={error}
        modelsError={modelsError}
        agentStatus={agentStatus}
        antiLoopSuggestions={antiLoopSuggestions}
        onAntiLoopSuggestion={(prompt) => {
          setAntiLoopSuggestions(null)
          if (busy) {
            stop()
            setInput(prompt)
            showToast('Stopped — suggestion loaded in composer', { type: 'info' })
            return
          }
          void sendWithText(prompt)
        }}
        stop={stop}
        settings={settings}
        persist={persist}
        showToast={showToast}
        onOpenTerminal={() => setTerminalOpen(true)}
        composerAdvanced={composerAdvanced}
        setComposerAdvanced={setComposerAdvanced}
        modelQuery={modelQuery}
        setModelQuery={setModelQuery}
        filteredModels={filteredModels}
        models={models}
        gatedIds={gatedIds}
        bashTarget={bashTarget}
        handleTargetChange={handleTargetChange}
        busy={busy}
        showModelSearch={showModelSearch}
        setShowModelSearch={setShowModelSearch}
        hideGated={hideGated}
        setHideGated={setHideGated}
        autoAblit={autoAblit}
        handleAutoAblitToggle={handleAutoAblitToggle}
        paramsAccordionOpen={paramsAccordionOpen}
        setParamsAccordionOpen={setParamsAccordionOpen}
        autoRecall={autoRecall}
        handleAutoRecallToggle={handleAutoRecallToggle}
        autoCheckpoint={autoCheckpoint}
        handleAutoCheckpointToggle={handleAutoCheckpointToggle}
        input={input}
        setInput={setInput}
        send={() => void send()}
        handleInspectDuckDb={handleInspectDuckDb}
        handleBranchSession={handleBranchSession}
      />

      <TerminalDrawer
        open={terminalOpen}
        onClose={() => setTerminalOpen(false)}
        bashTarget={bashTarget}
        handleTargetChange={handleTargetChange}
        termInput={termInput}
        setTermInput={setTermInput}
        executingCmd={executingCmd}
        runBashCommand={runBashCommand}
        terminalLogs={terminalLogs}
        setTerminalLogs={setTerminalLogs}
        collapsedOutputs={collapsedOutputs}
        copiedLogIdx={copiedLogIdx}
        termHeightMode={termHeightMode}
        setTermHeightMode={setTermHeightMode}
        handleInspectDuckDb={handleInspectDuckDb}
        handleAutoHeal={handleAutoHeal}
        sandboxStatus={sandboxStatus}
        termBodyRef={termBodyRef}
        handleTermKeyDown={handleTermKeyDown}
        handleCopyOutput={handleCopyOutput}
        toggleCollapseOutput={toggleCollapseOutput}
        activeWorkspaceDir={settings.workspaceDir}
        onOpenExplorer={() => setExplorerOpen(true)}
      />

      <SettingsSheet
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        persist={persist}
        sandboxStatus={sandboxStatus}
        mempalaceStatus={mempalaceStatus}
        autoRecall={autoRecall}
        autoCheckpoint={autoCheckpoint}
        onAutoRecallToggle={handleAutoRecallToggle}
        onAutoCheckpointToggle={handleAutoCheckpointToggle}
        getSandboxBaseUrl={getSandboxBaseUrl}
        setSandboxBaseUrl={setSandboxBaseUrl}
        getMempalaceBaseUrl={getMempalaceBaseUrl}
        setMempalaceBaseUrl={setMempalaceBaseUrl}
        refreshSandboxHealth={refreshSandboxHealth}
        refreshMempalaceHealth={refreshMempalaceHealth}
      />

      {/* ⌘K Command Palette */}
      <CommandPalette
        isOpen={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        models={models}
        currentModel={settings.model}
        onSelectModel={(m) => persist({ ...settings, model: m })}
        currentTarget={bashTarget}
        onSelectTarget={handleTargetChange}
        onRunCommand={(cmd, tgt) => {
          setTerminalOpen(true)
          void runBashCommand(cmd, tgt)
        }}
        onClearTerminal={() => setTerminalLogs([])}
        onToggleTerminal={() => setTerminalOpen(!terminalOpen)}
        onToggleAutoAblit={() => handleAutoAblitToggle(!autoAblit)}
        autoAblit={autoAblit}
        onToggleAgentMode={() => persist({ ...settings, agentMode: !settings.agentMode })}
        agentMode={settings.agentMode}
        onToggleDeepBuild={() => persist({ ...settings, deepBuild: !settings.deepBuild })}
        deepBuild={settings.deepBuild}
        onBranchSession={handleBranchSession}
        onOpenExplorer={() => setExplorerOpen(true)}
        onInspectDuckDb={handleInspectDuckDb}
        onToggleAutoRecall={() => handleAutoRecallToggle(!autoRecall)}
        autoRecall={autoRecall}
        onToggleAutoCheckpoint={() => handleAutoCheckpointToggle(!autoCheckpoint)}
        autoCheckpoint={autoCheckpoint}
        onOpenSettings={() => setSettingsOpen(true)}
        mempalaceOnline={mempalaceStatus?.online}
        onToggleHistory={() => setHistoryOpen((prev) => !prev)}
        onNewChat={handleNewChat}
        onExportZip={handleExportZip}
        onToggleRag={() => persist({ ...settings, clusterRag: settings.clusterRag === false })}
        clusterRag={settings.clusterRag}
        activeWorkspaceDir={settings.workspaceDir}
        onChangeWorkspaceDir={handleWorkspaceDirChange}
      />

      {/* Remote NVMe & Workspace Explorer */}
      <WorkspaceExplorer
        isOpen={explorerOpen}
        onClose={() => setExplorerOpen(false)}
        currentTarget={bashTarget}
        onSwitchTarget={handleTargetChange}
        activeWorkspaceDir={settings.workspaceDir}
        onChangeWorkspaceDir={handleWorkspaceDirChange}
      />

      {/* Chat History & Multi-Session Drawer */}
      <SessionRail
        isOpen={historyOpen}
        onClose={() => setHistoryOpen(false)}
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelectSession={handleSelectSession}
        onNewChat={handleNewChat}
        onDeleteSession={handleDeleteSession}
        onRenameSession={handleRenameSession}
        onTogglePin={handleTogglePin}
        onClearAll={handleClearAllHistory}
      />
    </div>
  )
}

export default function App() {
  // Abliterated Night (or saved) skin
  useEffect(() => {
    applyTheme(loadTheme())
  }, [])

  return (
    <ToastProvider>
      <MainApp />
    </ToastProvider>
  )
}
