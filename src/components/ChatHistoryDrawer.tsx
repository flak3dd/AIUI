import React, { useState, useMemo } from 'react'
import {
  type ChatSession,
  exportSessionAsMarkdown,
  downloadTextFile,
} from '../lib/chatHistory'

export interface ChatHistoryDrawerProps {
  isOpen: boolean
  onClose: () => void
  sessions: ChatSession[]
  activeSessionId: string | null
  onSelectSession: (id: string) => void
  onNewChat: () => void
  onDeleteSession: (id: string) => void
  onRenameSession: (id: string, newTitle: string) => void
  onTogglePin: (id: string) => void
  onClearAll: () => void
}

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days}d ago`
  return new Date(ts).toLocaleDateString()
}

export const ChatHistoryDrawer: React.FC<ChatHistoryDrawerProps> = ({
  isOpen,
  onClose,
  sessions,
  activeSessionId,
  onSelectSession,
  onNewChat,
  onDeleteSession,
  onRenameSession,
  onTogglePin,
  onClearAll,
}) => {
  const [search, setSearch] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({
    older: false,
    lastWeek: false,
  })

  const toggleGroup = (key: string) => {
    setCollapsedGroups((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const collapseAll = () => {
    setCollapsedGroups({
      pinned: true,
      today: true,
      yesterday: true,
      lastWeek: true,
      older: true,
    })
  }

  const expandAll = () => {
    setCollapsedGroups({
      pinned: false,
      today: false,
      yesterday: false,
      lastWeek: false,
      older: false,
    })
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return sessions
    return sessions.filter((s) => {
      if (s.title.toLowerCase().includes(q)) return true
      if (s.model.toLowerCase().includes(q)) return true
      return s.messages.some((m) => m.content.toLowerCase().includes(q))
    })
  }, [sessions, search])

  // Categorize
  const groups = useMemo(() => {
    const now = Date.now()
    const oneDay = 86400000
    const sevenDays = oneDay * 7

    const pinned: ChatSession[] = []
    const today: ChatSession[] = []
    const yesterday: ChatSession[] = []
    const lastWeek: ChatSession[] = []
    const older: ChatSession[] = []

    for (const s of filtered) {
      if (s.pinned) {
        pinned.push(s)
        continue
      }
      const age = now - s.updatedAt
      if (age < oneDay) {
        today.push(s)
      } else if (age < oneDay * 2) {
        yesterday.push(s)
      } else if (age < sevenDays) {
        lastWeek.push(s)
      } else {
        older.push(s)
      }
    }
    return { pinned, today, yesterday, lastWeek, older }
  }, [filtered])

  if (!isOpen) return null

  const handleStartEdit = (s: ChatSession, e: React.MouseEvent) => {
    e.stopPropagation()
    setEditingId(s.id)
    setEditTitle(s.title)
  }

  const handleSaveEdit = (id: string) => {
    if (editTitle.trim()) {
      onRenameSession(id, editTitle.trim())
    }
    setEditingId(null)
  }

  const handleExportMd = (s: ChatSession, e: React.MouseEvent) => {
    e.stopPropagation()
    const md = exportSessionAsMarkdown(s)
    const filename = `${s.title.replace(/[^a-zA-Z0-9_\-]/g, '_')}_${s.id}.md`
    downloadTextFile(filename, md, 'text/markdown')
  }

  const handleExportAll = () => {
    const json = JSON.stringify(sessions, null, 2)
    downloadTextFile(`ablit_all_chat_sessions_${Date.now()}.json`, json, 'application/json')
  }

  const renderSessionCard = (s: ChatSession) => {
    const isActive = s.id === activeSessionId
    const isEditing = s.id === editingId

    return (
      <div
        key={s.id}
        className={`history-item ${isActive ? 'active' : ''} ${s.pinned ? 'pinned' : ''}`}
        onClick={() => {
          onSelectSession(s.id)
          onClose()
        }}
      >
        <div className="history-item-main">
          <div className="history-item-header">
            {isEditing ? (
              <input
                type="text"
                className="history-edit-input"
                value={editTitle}
                autoFocus
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setEditTitle(e.target.value)}
                onBlur={() => handleSaveEdit(s.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveEdit(s.id)
                  if (e.key === 'Escape') setEditingId(null)
                }}
              />
            ) : (
              <span className="history-title" title={s.title}>
                {s.pinned && <span className="pin-indicator">📌 </span>}
                {s.title}
              </span>
            )}
            <span className="history-time">{formatRelativeTime(s.updatedAt)}</span>
          </div>

          <div className="history-meta">
            <span className="history-tag model-tag">{s.model}</span>
            <span className="history-tag count-tag">{s.messages.length} msgs</span>
          </div>
        </div>

        <div className="history-item-actions" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className={`ghost-icon-btn ${s.pinned ? 'active-pin' : ''}`}
            title={s.pinned ? 'Unpin' : 'Pin to top'}
            onClick={() => onTogglePin(s.id)}
          >
            📌
          </button>
          <button
            type="button"
            className="ghost-icon-btn"
            title="Rename"
            onClick={(e) => handleStartEdit(s, e)}
          >
            ✏️
          </button>
          <button
            type="button"
            className="ghost-icon-btn"
            title="Export as Markdown"
            onClick={(e) => handleExportMd(s, e)}
          >
            📥
          </button>
          <button
            type="button"
            className="ghost-icon-btn delete-btn"
            title="Delete session"
            onClick={() => {
              if (window.confirm(`Delete "${s.title}"?`)) {
                onDeleteSession(s.id)
              }
            }}
          >
            🗑️
          </button>
        </div>
      </div>
    )
  }

  const renderGroup = (key: string, title: string, items: ChatSession[]) => {
    if (items.length === 0) return null
    const isCollapsed = collapsedGroups[key] ?? false

    return (
      <div className="history-group" key={key}>
        <button
          type="button"
          className="history-group-header-btn"
          onClick={() => toggleGroup(key)}
          title={isCollapsed ? `Expand ${title}` : `Collapse ${title}`}
        >
          <div className="history-group-title-wrap">
            <span className={`history-group-chevron ${!isCollapsed ? 'open' : ''}`}>▶</span>
            <span>{title}</span>
          </div>
          <span className="history-group-count-badge">{items.length}</span>
        </button>
        {!isCollapsed && (
          <div className="history-group-content">
            {items.map(renderSessionCard)}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="history-drawer-overlay" onClick={onClose}>
      <aside className="history-drawer-panel" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="history-drawer-header">
          <div className="history-header-brand">
            <h2>Chats</h2>
            <span className="history-count-badge">{sessions.length}</span>
          </div>
          <button type="button" className="ghost-close-btn" onClick={onClose} title="Close (⌘B)">
            ✕
          </button>
        </div>

        {/* Action Bar */}
        <div className="history-action-bar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <button
            type="button"
            className="btn-new-chat"
            onClick={() => {
              onNewChat()
              onClose()
            }}
          >
            ➕ New Chat
          </button>
          <div className="history-expand-all-tools">
            <button
              type="button"
              className="ghost btn-sm"
              style={{ fontSize: 10, padding: '3px 7px' }}
              onClick={expandAll}
              title="Expand all groups"
            >
              Expand All
            </button>
            <button
              type="button"
              className="ghost btn-sm"
              style={{ fontSize: 10, padding: '3px 7px' }}
              onClick={collapseAll}
              title="Collapse all groups"
            >
              Collapse All
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="history-search-container">
          <input
            type="text"
            className="history-search-input"
            placeholder="Search conversations, keywords, models..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              type="button"
              className="history-search-clear"
              onClick={() => setSearch('')}
            >
              ✕
            </button>
          )}
        </div>

        {/* Session List */}
        <div className="history-list-scroll">
          {filtered.length === 0 ? (
            <div className="history-empty-state">
              <span className="empty-icon">📂</span>
              <p>{search ? 'No matching conversations' : 'No chat history yet'}</p>
              <button
                type="button"
                className="btn-sm btn-ablit"
                onClick={() => {
                  onNewChat()
                  onClose()
                }}
              >
                Start First Conversation
              </button>
            </div>
          ) : (
            <>
              {renderGroup('pinned', '📌 PINNED', groups.pinned)}
              {renderGroup('today', 'TODAY', groups.today)}
              {renderGroup('yesterday', 'YESTERDAY', groups.yesterday)}
              {renderGroup('lastWeek', 'PREVIOUS 7 DAYS', groups.lastWeek)}
              {renderGroup('older', 'OLDER CONVERSATIONS', groups.older)}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="history-drawer-footer">
          <button
            type="button"
            className="btn-sm ghost"
            onClick={handleExportAll}
            title="Download full JSON backup of all sessions"
          >
            💾 Backup All
          </button>
          <button
            type="button"
            className="btn-sm ghost text-danger"
            onClick={() => {
              if (window.confirm('Delete all conversations permanently?')) {
                onClearAll()
              }
            }}
            title="Clear all saved history"
          >
            🗑️ Clear All
          </button>
        </div>
      </aside>
    </div>
  )
}
