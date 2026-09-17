import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { ExecutionTarget } from '../lib/bashShell'
import { isGatedModelId, modelLabel } from '../lib/providers'
import { getAllScaffolds } from '../lib/scaffoldTemplates'

export interface CommandPaletteProps {
  isOpen: boolean
  onClose: () => void
  models: string[]
  currentModel: string
  onSelectModel: (m: string) => void
  currentTarget: ExecutionTarget
  onSelectTarget: (t: ExecutionTarget) => void
  onRunCommand: (cmd: string, target: ExecutionTarget) => void
  onClearTerminal: () => void
  onToggleTerminal: () => void
  onToggleAutoAblit: () => void
  autoAblit: boolean
  onToggleAgentMode?: () => void
  agentMode?: boolean
  onToggleDeepBuild?: () => void
  deepBuild?: boolean
  onBranchSession: () => void
  onOpenExplorer: () => void
  onInspectDuckDb: () => void
  onToggleAutoRecall?: () => void
  autoRecall?: boolean
  onToggleAutoCheckpoint?: () => void
  autoCheckpoint?: boolean
  onOpenSettings?: () => void
  mempalaceOnline?: boolean
  onToggleHistory?: () => void
  onNewChat?: () => void
  onExportZip?: () => void
  onToggleRag?: () => void
  clusterRag?: boolean
}

interface PaletteAction {
  id: string
  title: string
  category: 'Diagnostics' | 'Target' | 'Models' | 'Workspace' | 'Controls' | 'Memory' | 'Scaffolds'
  icon: string
  hint?: string
  badge?: string
  run: () => void
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  models,
  currentModel,
  onSelectModel,
  currentTarget,
  onSelectTarget,
  onRunCommand,
  onClearTerminal,
  onToggleTerminal,
  onToggleAutoAblit,
  autoAblit,
  onToggleAgentMode,
  agentMode,
  onToggleDeepBuild,
  deepBuild,
  onBranchSession,
  onOpenExplorer,
  onInspectDuckDb,
  onToggleAutoRecall,
  autoRecall,
  onToggleAutoCheckpoint,
  autoCheckpoint,
  onOpenSettings,
  mempalaceOnline,
  onToggleHistory,
  onNewChat,
  onExportZip,
  onToggleRag,
  clusterRag,
}) => {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (isOpen) {
      setQuery('')
      setSelectedIndex(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [isOpen])

  const actions: PaletteAction[] = useMemo(() => {
    const list: PaletteAction[] = [
      // Diagnostics
      {
        id: 'diag-doctor',
        title: 'Run Ablit Doctor',
        category: 'Diagnostics',
        icon: '🩺',
        hint: 'Kernel, uptime, and python runtime',
        run: () => onRunCommand('uname -a && uptime && python3 --version', currentTarget),
      },
      {
        id: 'diag-gpu',
        title: 'Query GPU Status (nvidia-smi)',
        category: 'Diagnostics',
        icon: '⚡',
        hint: 'GX10 GB10 GPU telemetry & VRAM',
        run: () => onRunCommand('nvidia-smi', 'dgx_spark'),
      },
      {
        id: 'diag-nvme',
        title: 'Check NVMe Disk Space',
        category: 'Diagnostics',
        icon: '💾',
        hint: 'Inspect /mnt/nvme disk capacity on flak3dd',
        run: () => onRunCommand('df -h /mnt/nvme || df -h', currentTarget),
      },
      {
        id: 'diag-duckdb',
        title: 'Query DuckDB OCR Identity Index',
        category: 'Diagnostics',
        icon: '🦆',
        hint: 'Select record count from identity_index.duckdb',
        run: onInspectDuckDb,
      },
      {
        id: 'diag-ls',
        title: 'List Sandbox Directory (ls -lah)',
        category: 'Diagnostics',
        icon: '📂',
        hint: 'Show all files with permissions & sizes',
        run: () => onRunCommand('ls -lah', currentTarget),
      },

      // Target Switcher
      {
        id: 'target-local',
        title: 'Set Target: Local Mac (/tmp/spark-sandboxes)',
        category: 'Target',
        icon: '💻',
        badge: currentTarget === 'local_mac' ? 'ACTIVE' : undefined,
        run: () => onSelectTarget('local_mac'),
      },
      {
        id: 'target-dgx',
        title: 'Set Target: GX10 (flak3dd GB10)',
        category: 'Target',
        icon: '🚀',
        badge: currentTarget === 'dgx_spark' ? 'ACTIVE' : undefined,
        run: () => onSelectTarget('dgx_spark'),
      },
      {
        id: 'target-container',
        title: 'Set Target: Isolated Linux Pod (Debian / Alpine Container)',
        category: 'Target',
        icon: '📦',
        badge: currentTarget === 'container' ? 'ACTIVE' : undefined,
        hint: 'Execute in isolated Linux container with pre-installed DuckDB/Pandas',
        run: () => onSelectTarget('container'),
      },

      // Workspace & Session
      {
        id: 'ws-explorer',
        title: 'Open Remote NVMe & Workspace Explorer',
        category: 'Workspace',
        icon: '🗂️',
        hint: 'Browse files on /mnt/nvme & sandboxes',
        run: onOpenExplorer,
      },
      {
        id: 'ws-branch',
        title: 'Branch Session from Here',
        category: 'Workspace',
        icon: '🌿',
        hint: 'Fork current conversation into a new sandbox branch',
        run: onBranchSession,
      },
      {
        id: 'ws-export-zip',
        title: 'Export Session Scripts as ZIP',
        category: 'Workspace',
        icon: '📦',
        hint: 'Compile all code blocks from this conversation into a downloadable ZIP',
        run: () => onExportZip && onExportZip(),
      },

      // Controls
      {
        id: 'ctrl-history-toggle',
        title: 'Open Chat History Drawer',
        category: 'Controls',
        icon: '📜',
        hint: 'View past sessions, search, and export (⌘H)',
        run: () => onToggleHistory && onToggleHistory(),
      },
      {
        id: 'ctrl-new-chat',
        title: 'Start New Conversation',
        category: 'Controls',
        icon: '➕',
        hint: 'Fresh session with empty context (⌘N)',
        run: () => onNewChat && onNewChat(),
      },
      {
        id: 'ctrl-agent-mode',
        title: `Toggle Autonomous Agent Mode (${agentMode ? 'Currently ON' : 'Currently OFF'})`,
        category: 'Controls',
        icon: '⚡',
        badge: agentMode ? 'ON' : 'OFF',
        hint: 'Autonomous execution, tool use, and self-healing fix loop',
        run: () => onToggleAgentMode && onToggleAgentMode(),
      },
      {
        id: 'ctrl-deep-build',
        title: `Toggle Deep Thinking / Thorough Build Mode (${deepBuild ? 'Currently ON' : 'Currently OFF'})`,
        category: 'Controls',
        icon: '🧠',
        badge: deepBuild ? 'ON' : 'OFF',
        hint: 'Exhaustive architectural planning, zero stubs, and automated test suites',
        run: () => onToggleDeepBuild && onToggleDeepBuild(),
      },
      {
        id: 'ctrl-rag-toggle',
        title: `Toggle Cluster RAG Knowledge Base (${clusterRag !== false ? 'Currently ON' : 'Currently OFF'})`,
        category: 'Controls',
        icon: '📚',
        badge: clusterRag !== false ? 'ON' : 'OFF',
        hint: 'Retrieve verified cluster telemetry, vLLM config, and GB10 specs',
        run: () => onToggleRag && onToggleRag(),
      },
      {
        id: 'ctrl-term-toggle',
        title: 'Toggle Pythonista Terminal Drawer',
        category: 'Controls',
        icon: '🐍',
        hint: 'Show or hide the bottom interactive terminal',
        run: onToggleTerminal,
      },
      {
        id: 'ctrl-auto-ablit',
        title: `Toggle Auto-Ablit Execution (${autoAblit ? 'Currently ON' : 'Currently OFF'})`,
        category: 'Controls',
        icon: '⚡',
        badge: autoAblit ? 'ON' : 'OFF',
        run: onToggleAutoAblit,
      },
      {
        id: 'ctrl-term-clear',
        title: 'Clear Terminal Output Buffer',
        category: 'Controls',
        icon: '🧹',
        run: onClearTerminal,
      },

      // Memory Palace
      ...(onToggleAutoRecall ? [{
        id: 'mem-auto-recall',
        title: `Toggle MemPalace Auto-Recall (${autoRecall ? 'Currently ON' : 'Currently OFF'})`,
        category: 'Memory' as const,
        icon: '🧠',
        hint: 'Search memory palace before each message and inject context',
        badge: autoRecall ? 'ON' : 'OFF',
        run: onToggleAutoRecall,
      }] : []),
      ...(onToggleAutoCheckpoint ? [{
        id: 'mem-auto-checkpoint',
        title: `Toggle MemPalace Auto-Checkpoint (${autoCheckpoint ? 'Currently ON' : 'Currently OFF'})`,
        category: 'Memory' as const,
        icon: '🏛️',
        hint: 'Automatically save conversation exchanges to memory palace',
        badge: autoCheckpoint ? 'ON' : 'OFF',
        run: onToggleAutoCheckpoint,
      }] : []),
      ...(onOpenSettings ? [{
        id: 'mem-settings',
        title: `MemPalace Bridge Settings (${mempalaceOnline ? 'Online' : 'Offline'})`,
        category: 'Memory' as const,
        icon: '⚙️',
        hint: 'Configure MemPalace URL (:17333) and memory sync',
        badge: mempalaceOnline ? 'ONLINE' : 'OFFLINE',
        run: onOpenSettings,
      }] : []),

      // Scaffolds (Catalog of 52 standardized templates)
      ...getAllScaffolds().map((scaffold) => ({
        id: `scaffold-${scaffold.id}`,
        title: `Scaffold: ${scaffold.name}`,
        category: 'Scaffolds' as const,
        icon: '🏗️',
        badge: `${Object.keys(scaffold.files || {}).length} files`,
        hint: scaffold.description,
        run: () => {
          onRunCommand(
            `echo "=== SCAFFOLD: ${scaffold.name} (${scaffold.id}) ===" && echo "Files (${Object.keys(scaffold.files || {}).length}): ${Object.keys(scaffold.files || {}).join(', ')}"`,
            currentTarget,
          )
        },
      })),
    ]

    // Model Switcher Actions
    const topModels = models.slice(0, 30)
    topModels.forEach((m) => {
      const gated = isGatedModelId(m)
      list.push({
        id: `model-${m}`,
        title: `Switch to Model: ${modelLabel(m)}`,
        category: 'Models',
        icon: gated ? '🔒' : '⚡',
        badge: m === currentModel ? 'SELECTED' : gated ? 'Gated' : 'Ungated',
        run: () => onSelectModel(m),
      })
    })

    return list
  }, [
    models,
    currentModel,
    currentTarget,
    autoAblit,
    autoRecall,
    autoCheckpoint,
    mempalaceOnline,
    onRunCommand,
    onSelectTarget,
    onSelectModel,
    onOpenExplorer,
    onBranchSession,
    onToggleTerminal,
    onToggleAutoAblit,
    onClearTerminal,
    onInspectDuckDb,
    onToggleAutoRecall,
    onToggleAutoCheckpoint,
    onOpenSettings,
  ])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return actions
    return actions.filter(
      (a) =>
        a.title.toLowerCase().includes(q) ||
        a.category.toLowerCase().includes(q) ||
        (a.hint && a.hint.toLowerCase().includes(q))
    )
  }, [actions, query])

  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  const execute = (action?: PaletteAction) => {
    const target = action || filtered[selectedIndex]
    if (target) {
      target.run()
      onClose()
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((prev) => (prev + 1) % Math.max(1, filtered.length))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((prev) => (prev - 1 + filtered.length) % Math.max(1, filtered.length))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      execute()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  if (!isOpen) return null

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="palette-modal" onClick={(e) => e.stopPropagation()}>
        <div className="palette-input-wrap">
          <span className="palette-icon">⌘K</span>
          <input
            ref={inputRef}
            className="palette-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a command, model, or diagnostic (Esc to close)..."
          />
          <span className="palette-count">{filtered.length} actions</span>
        </div>

        <div className="palette-list" ref={listRef}>
          {filtered.length === 0 ? (
            <div className="palette-empty">No matching commands found.</div>
          ) : (
            filtered.map((action, idx) => {
              const active = idx === selectedIndex
              return (
                <div
                  key={action.id}
                  className={`palette-item ${active ? 'active' : ''}`}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  onClick={() => execute(action)}
                >
                  <span className="palette-item-icon">{action.icon}</span>
                  <div className="palette-item-main">
                    <div className="palette-item-title">{action.title}</div>
                    {action.hint && <div className="palette-item-hint">{action.hint}</div>}
                  </div>
                  <span className="palette-item-cat">{action.category}</span>
                  {action.badge && <span className="palette-item-badge">{action.badge}</span>}
                </div>
              )
            })
          )}
        </div>

        <div className="palette-footer">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> navigate
          </span>
          <span>
            <kbd>↵</kbd> select
          </span>
          <span>
            <kbd>esc</kbd> close
          </span>
        </div>
      </div>
    </div>
  )
}
