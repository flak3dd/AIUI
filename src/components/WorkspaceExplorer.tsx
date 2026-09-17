import React, { useEffect, useState } from 'react'
import {
  executeBashCommand,
  getStoredWorkspaceDir,
  setStoredWorkspaceDir,
  type ExecutionTarget,
} from '../lib/bashShell'

export interface WorkspaceExplorerProps {
  isOpen: boolean
  onClose: () => void
  currentTarget: ExecutionTarget
  onSwitchTarget: (t: ExecutionTarget) => void
  activeWorkspaceDir?: string
  onChangeWorkspaceDir?: (dir: string) => void
}

/** Default writable roots per execution target */
const WORKSPACE_ROOTS: Record<Exclude<ExecutionTarget, 'container'>, string> = {
  local_mac: '/Users/adminuser/AIUI',
  dgx_spark: '/mnt/nvme/ocr_pipeline/workspaces',
}

export const WORKSPACE_PRESETS: Array<{ label: string; path: string; target: ExecutionTarget }> = [
  { label: '~/AIUI (AI Web App)', path: '/Users/adminuser/AIUI', target: 'local_mac' },
  { label: '~/r (Rego & PPSR Ops)', path: '/Users/adminuser/r', target: 'local_mac' },
  { label: '~/log-sorter', path: '/Users/adminuser/log-sorter', target: 'local_mac' },
  { label: '~/abliterated_ui (Studio)', path: '/Users/adminuser/abliterated_ui', target: 'local_mac' },
  { label: 'Mac Sandbox (/tmp)', path: '/tmp/spark-sandboxes', target: 'local_mac' },
  { label: 'GX10 NVMe Workspaces', path: '/mnt/nvme/ocr_pipeline/workspaces', target: 'dgx_spark' },
]

function defaultPathFor(target: ExecutionTarget, activeWorkspace?: string): string {
  if (activeWorkspace && activeWorkspace.trim()) {
    return activeWorkspace.trim()
  }
  const stored = getStoredWorkspaceDir(target)
  if (stored && stored.trim()) return stored.trim()
  return target === 'dgx_spark' ? WORKSPACE_ROOTS.dgx_spark : WORKSPACE_ROOTS.local_mac
}

interface FileEntry {
  name: string
  isDir: boolean
  size: string
  perms: string
}

export const WorkspaceExplorer: React.FC<WorkspaceExplorerProps> = ({
  isOpen,
  onClose,
  currentTarget,
  onSwitchTarget,
  activeWorkspaceDir,
  onChangeWorkspaceDir,
}) => {
  const [targetPath, setTargetPath] = useState(() => defaultPathFor(currentTarget, activeWorkspaceDir))
  const [files, setFiles] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [fileContent, setFileContent] = useState<string | null>(null)
  const [contentLoading, setContentLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [creating, setCreating] = useState(false)

  const currentActiveWorkspace = activeWorkspaceDir || getStoredWorkspaceDir(currentTarget)

  useEffect(() => {
    setTargetPath(defaultPathFor(currentTarget, activeWorkspaceDir))
  }, [currentTarget, activeWorkspaceDir])

  const loadDirectory = async (dir: string, target: ExecutionTarget) => {
    setLoading(true)
    setError(null)
    setNotice(null)
    setSelectedFile(null)
    setFileContent(null)
    try {
      const res = await executeBashCommand(`ls -la "${dir}" 2>&1`, target, 'web_session', undefined, dir)
      if (!res.ok) {
        setError(`Failed to read directory (${res.exitCode}): ${res.stderr || res.stdout}`)
        setFiles([])
        return
      }

      const lines = res.stdout.split('\n').filter((l) => l.trim().length > 0)
      const parsed: FileEntry[] = []

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (line.startsWith('total')) continue
        const parts = line.split(/\s+/)
        if (parts.length < 9) continue
        const perms = parts[0]
        const size = parts[4]
        const name = parts.slice(8).join(' ')
        if (name === '.' || name === '..') continue

        parsed.push({
          name,
          isDir: perms.startsWith('d'),
          size,
          perms,
        })
      }

      // Sort: directories first, then filenames alphabetically
      parsed.sort((a, b) => {
        if (a.isDir && !b.isDir) return -1
        if (!a.isDir && b.isDir) return 1
        return a.name.localeCompare(b.name)
      })

      setFiles(parsed)
    } catch (err: any) {
      setError(err?.message || 'Error listing files')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isOpen) {
      void loadDirectory(targetPath, currentTarget)
    }
  }, [isOpen, targetPath, currentTarget])

  const previewFile = async (name: string) => {
    setSelectedFile(name)
    setContentLoading(true)
    const filePath = `${targetPath.replace(/\/$/, '')}/${name}`
    try {
      const res = await executeBashCommand(`head -n 250 "${filePath}" 2>&1`, currentTarget, 'web_session', undefined, targetPath)
      setFileContent(res.stdout || res.stderr || '(empty file)')
    } catch (err: any) {
      setFileContent(`Error reading file: ${err?.message || String(err)}`)
    } finally {
      setContentLoading(false)
    }
  }

  const navigateDir = (dirName: string) => {
    const next = `${targetPath.replace(/\/$/, '')}/${dirName}`
    setTargetPath(next)
  }

  const navigateUp = () => {
    const parts = targetPath.split('/').filter(Boolean)
    if (parts.length <= 1) return
    parts.pop()
    const next = '/' + parts.join('/')
    setTargetPath(next)
  }

  const handleSetActiveWorkspace = (path: string) => {
    const cleanPath = path.replace(/\/+$/, '') || '/'
    setStoredWorkspaceDir(cleanPath)
    if (onChangeWorkspaceDir) {
      onChangeWorkspaceDir(cleanPath)
    }
    setNotice(`Active workspace set to: ${cleanPath}`)
    setTimeout(() => setNotice(null), 3000)
  }

  const handleSelectPreset = (preset: (typeof WORKSPACE_PRESETS)[number]) => {
    if (preset.target !== currentTarget) {
      onSwitchTarget(preset.target)
    }
    setTargetPath(preset.path)
    handleSetActiveWorkspace(preset.path)
  }

  const sanitizeFolderName = (raw: string) => {
    return raw.trim().replace(/[/\\:*?"<>|]/g, '')
  }

  const shellSingleQuote = (s: string) => `'${s.replace(/'/g, "'\\''")}'`

  const createFolder = async () => {
    const name = sanitizeFolderName(newFolderName)
    if (!name) {
      setError('Invalid folder name. Use letters, numbers, spaces, . _ - (no slashes).')
      return
    }
    setCreating(true)
    setError(null)

    const parent = targetPath.replace(/\/$/, '') || '/'
    const full = `${parent}/${name}`
    const quotedParent = shellSingleQuote(parent)
    const quoted = shellSingleQuote(full)
    try {
      const res = await executeBashCommand(
        `mkdir -p -- ${quotedParent} ${quoted} && ls -ld -- ${quoted}`,
        currentTarget,
        'web_session',
        undefined,
        parent,
      )
      if (!res.ok) {
        const detail = res.stderr || res.stdout || `exit ${res.exitCode}`
        setError(`Failed to create folder: ${detail}`)
        return
      }
      setNewFolderName('')
      setCreatingFolder(false)
      await loadDirectory(parent, currentTarget)
    } catch (err: any) {
      setError(err?.message || 'Error creating folder')
    } finally {
      setCreating(false)
    }
  }

  if (!isOpen) return null

  const isCurrentTargetActive = targetPath.replace(/\/+$/, '') === currentActiveWorkspace.replace(/\/+$/, '')

  return (
    <div className="explorer-backdrop" onClick={onClose}>
      <div className="explorer-modal" onClick={(e) => e.stopPropagation()}>
        <div className="explorer-header">
          <div className="explorer-title">
            <span className="explorer-icon">🗂️</span>
            <span>Workspace & File Explorer</span>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <select
              value={currentTarget}
              onChange={(e) => {
                const next = e.target.value as ExecutionTarget
                onSwitchTarget(next)
                setTargetPath(defaultPathFor(next, activeWorkspaceDir))
              }}
              style={{ fontSize: 11, padding: '4px 8px' }}
            >
              <option value="local_mac">Target: Local Mac</option>
              <option value="dgx_spark">Target: Remote GX10 Spark</option>
            </select>
            <button type="button" className="btn-sm ghost" onClick={onClose}>
              ✕
            </button>
          </div>
        </div>

        {/* Workspace Quick Switcher Bar */}
        <div className="explorer-workspace-bar">
          <div className="explorer-workspace-left">
            <span className="explorer-ws-label">ACTIVE WORKSPACE:</span>
            <span className="explorer-ws-badge" title={currentActiveWorkspace}>
              {currentActiveWorkspace}
            </span>
          </div>
          <div className="explorer-workspace-actions">
            {!isCurrentTargetActive ? (
              <button
                type="button"
                className="btn-sm btn-ablit"
                onClick={() => handleSetActiveWorkspace(targetPath)}
                title="Make current directory the active workspace for terminal & agent"
              >
                ★ Set as Active Workspace
              </button>
            ) : (
              <span className="explorer-ws-active-chip">✓ Active Workspace</span>
            )}
          </div>
        </div>

        {/* Workspace Quick Presets */}
        <div className="explorer-presets-strip">
          <span className="explorer-presets-label">Presets:</span>
          {WORKSPACE_PRESETS.map((p) => (
            <button
              key={p.path}
              type="button"
              className={`explorer-preset-chip ${targetPath.startsWith(p.path) ? 'active' : ''}`}
              onClick={() => handleSelectPreset(p)}
              title={`Switch to ${p.path} (${p.target})`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Notice & Error Banners */}
        {notice && <div className="explorer-notice-banner">{notice}</div>}
        {error && <div className="explorer-error-banner">{error}</div>}

        {/* Navigation Toolbar */}
        <div className="explorer-nav-bar">
          <button
            type="button"
            className="btn-sm ghost"
            onClick={navigateUp}
            title="Navigate up one directory"
          >
            ⬆ Up
          </button>
          <button
            type="button"
            className="btn-sm ghost"
            onClick={() => setTargetPath(currentActiveWorkspace)}
            title={`Jump to active workspace (${currentActiveWorkspace})`}
          >
            🏠 Active
          </button>
          <input
            className="explorer-path-input"
            value={targetPath}
            onChange={(e) => setTargetPath(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                void loadDirectory(targetPath, currentTarget)
              }
            }}
            placeholder="/path/to/workspace"
            title="Type or edit directory path, then press Enter to navigate"
          />
          <button
            type="button"
            className="btn-sm btn-ablit"
            onClick={() => void loadDirectory(targetPath, currentTarget)}
            disabled={loading}
          >
            🔄 Go / Refresh
          </button>
          <button
            type="button"
            className="btn-sm ghost"
            onClick={() => {
              setCreatingFolder((v) => !v)
              setError(null)
            }}
            title="Create a new folder in the current directory"
            disabled={loading || creating}
          >
            📁+ New Folder
          </button>
        </div>

        {creatingFolder && (
          <div className="explorer-new-folder-bar">
            <span style={{ fontSize: 11, color: 'var(--dracula-comment)' }}>Folder name:</span>
            <input
              autoFocus
              className="explorer-folder-name-input"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="e.g. project_alpha"
              onKeyDown={(e) => {
                if (e.key === 'Enter') void createFolder()
                if (e.key === 'Escape') {
                  setCreatingFolder(false)
                  setNewFolderName('')
                }
              }}
              disabled={creating}
            />
            <button
              type="button"
              className="btn-sm primary"
              onClick={createFolder}
              disabled={creating || !newFolderName.trim()}
            >
              {creating ? 'Creating…' : 'Create'}
            </button>
            <button
              type="button"
              className="btn-sm ghost"
              onClick={() => {
                setCreatingFolder(false)
                setNewFolderName('')
              }}
              disabled={creating}
            >
              Cancel
            </button>
          </div>
        )}

        {/* Content Pane: File Browser & File Preview */}
        <div className="explorer-content">
          <div className="explorer-file-list">
            {loading ? (
              <div className="explorer-loading">Loading directory contents…</div>
            ) : files.length === 0 ? (
              <div className="explorer-empty">Empty directory</div>
            ) : (
              files.map((file) => (
                <div
                  key={file.name}
                  className={`explorer-file-item ${file.name === selectedFile ? 'selected' : ''}`}
                  onClick={() => {
                    if (file.isDir) {
                      navigateDir(file.name)
                    } else {
                      void previewFile(file.name)
                    }
                  }}
                  title={file.isDir ? `Open folder: ${file.name}` : `Preview file: ${file.name}`}
                >
                  <span className="file-icon">{file.isDir ? '📁' : '📄'}</span>
                  <span className="file-name">{file.name}</span>
                  <span className="file-size">{file.isDir ? 'dir' : file.size}</span>
                </div>
              ))
            )}
          </div>

          <div className="explorer-preview-pane">
            <div className="explorer-preview-header">
              <span>{selectedFile ? selectedFile : 'File Preview'}</span>
              {selectedFile && (
                <span style={{ fontSize: 10, color: 'var(--dracula-comment)' }}>
                  (First 250 lines)
                </span>
              )}
            </div>
            <div className="explorer-preview-body">
              {contentLoading ? (
                <div className="explorer-loading">Reading file…</div>
              ) : fileContent ? (
                <pre>{fileContent}</pre>
              ) : (
                <div className="explorer-empty">Select a file to inspect its content</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
