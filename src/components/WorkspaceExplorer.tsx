import React, { useEffect, useState } from 'react'
import { executeBashCommand, type ExecutionTarget } from '../lib/bashShell'

export interface WorkspaceExplorerProps {
  isOpen: boolean
  onClose: () => void
  currentTarget: ExecutionTarget
  onSwitchTarget: (t: ExecutionTarget) => void
}

/** Writable roots per execution target (GX10 /mnt/nvme itself is root-owned). */
const WORKSPACE_ROOTS: Record<Exclude<ExecutionTarget, 'container'>, string> = {
  local_mac: '/tmp/spark-sandboxes',
  dgx_spark: '/mnt/nvme/ocr_pipeline/workspaces',
}

function defaultPathFor(target: ExecutionTarget): string {
  if (target === 'dgx_spark') return WORKSPACE_ROOTS.dgx_spark
  if (target === 'local_mac') return WORKSPACE_ROOTS.local_mac
  return WORKSPACE_ROOTS.local_mac
}

function isUnderRoot(path: string, root: string): boolean {
  const p = path.replace(/\/+$/, '') || '/'
  const r = root.replace(/\/+$/, '') || '/'
  return p === r || p.startsWith(r + '/')
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
}) => {
  const [targetPath, setTargetPath] = useState(() => defaultPathFor(currentTarget))
  const [files, setFiles] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [fileContent, setFileContent] = useState<string | null>(null)
  const [contentLoading, setContentLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    setTargetPath(defaultPathFor(currentTarget))
  }, [currentTarget])

  const loadDirectory = async (dir: string, target: ExecutionTarget) => {
    setLoading(true)
    setError(null)
    setSelectedFile(null)
    setFileContent(null)
    try {
      const res = await executeBashCommand(
        `ls -la "${dir}" 2>&1`,
        target,
        dir
      )
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

      // Sort: dirs first, then files
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
      const res = await executeBashCommand(
        `head -n 250 "${filePath}" 2>&1`,
        currentTarget,
        targetPath
      )
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

  const workspaceRoot =
    currentTarget === 'dgx_spark' ? WORKSPACE_ROOTS.dgx_spark : WORKSPACE_ROOTS.local_mac

  const navigateUp = () => {
    const parts = targetPath.split('/').filter(Boolean)
    if (parts.length <= 1) return
    parts.pop()
    const next = '/' + parts.join('/')
    // Keep GX10 creates inside the writable workspaces tree; browsing above /mnt/nvme is useless
    if (currentTarget === 'dgx_spark' && !isUnderRoot(next, '/mnt/nvme/ocr_pipeline')) {
      setTargetPath(WORKSPACE_ROOTS.dgx_spark)
      return
    }
    if (currentTarget === 'local_mac' && !isUnderRoot(next, WORKSPACE_ROOTS.local_mac)) {
      setTargetPath(WORKSPACE_ROOTS.local_mac)
      return
    }
    setTargetPath(next)
  }

  const sanitizeFolderName = (raw: string): string | null => {
    const name = raw.trim()
    if (!name) return null
    if (name === '.' || name === '..') return null
    if (/[\\/]/.test(name)) return null
    if (!/^[A-Za-z0-9][A-Za-z0-9._ -]{0,127}$/.test(name)) return null
    return name
  }

  const shellSingleQuote = (value: string) => "'" + value.replace(/'/g, `'"'"'`) + "'"

  const createFolder = async () => {
    const name = sanitizeFolderName(newFolderName)
    if (!name) {
      setError('Invalid folder name. Use letters, numbers, spaces, . _ - (no slashes).')
      return
    }
    setCreating(true)
    setError(null)

    // /mnt/nvme is root-owned — always create under the writable workspace root
    let parent = targetPath.replace(/\/$/, '') || '/'
    let redirected = false
    if (currentTarget === 'dgx_spark' && !isUnderRoot(parent, WORKSPACE_ROOTS.dgx_spark)) {
      parent = WORKSPACE_ROOTS.dgx_spark
      redirected = true
    }
    if (currentTarget === 'local_mac' && !isUnderRoot(parent, WORKSPACE_ROOTS.local_mac)) {
      parent = WORKSPACE_ROOTS.local_mac
      redirected = true
    }

    const full = `${parent}/${name}`
    const quotedParent = shellSingleQuote(parent)
    const quoted = shellSingleQuote(full)
    try {
      const res = await executeBashCommand(
        `mkdir -p -- ${quotedParent} ${quoted} && ls -ld -- ${quoted}`,
        currentTarget,
        parent,
      )
      if (!res.ok) {
        const detail = res.stderr || res.stdout || `exit ${res.exitCode}`
        setError(
          detail.includes('Permission denied')
            ? `Permission denied creating ${full}. On GX10 use ${WORKSPACE_ROOTS.dgx_spark}/ (not /mnt/nvme).`
            : `Failed to create folder: ${detail}`,
        )
        return
      }
      setNewFolderName('')
      setCreatingFolder(false)
      if (redirected || parent !== targetPath.replace(/\/$/, '')) {
        setTargetPath(parent)
      }
      await loadDirectory(parent, currentTarget)
    } catch (err: any) {
      setError(err?.message || 'Error creating folder')
    } finally {
      setCreating(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="explorer-backdrop" onClick={onClose}>
      <div className="explorer-modal" onClick={(e) => e.stopPropagation()}>
        <div className="explorer-header">
          <div className="explorer-title">
            <span className="explorer-icon">🗂️</span>
            <span>Remote NVMe & Workspace Explorer</span>
          </div>
          <div className="row">
            <select
              value={currentTarget}
              onChange={(e) => {
                const next = e.target.value as ExecutionTarget
                onSwitchTarget(next)
                setTargetPath(defaultPathFor(next))
              }}
              style={{ fontSize: 11, padding: '4px 8px' }}
            >
              <option value="local_mac">Target: Local Mac (/tmp/spark-sandboxes)</option>
              <option value="dgx_spark">Target: GX10 (/mnt/nvme/ocr_pipeline/workspaces)</option>
            </select>
            <button type="button" className="btn-sm ghost" onClick={onClose}>
              ✕
            </button>
          </div>
        </div>

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
            onClick={() => setTargetPath(workspaceRoot)}
            title={`Jump to workspace root (${workspaceRoot})`}
          >
            🏠 Root
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
          />
          <button
            type="button"
            className="btn-sm btn-ablit"
            onClick={() => void loadDirectory(targetPath, currentTarget)}
            disabled={loading}
          >
            🔄 Refresh
          </button>
          <button
            type="button"
            className="btn-sm ghost"
            onClick={() => {
              setCreatingFolder((v) => !v)
              setError(null)
            }}
            title="Create a new folder in the current workspace path"
            disabled={loading || creating}
          >
            📁+ New Folder
          </button>
        </div>

        {creatingFolder && (
          <div className="explorer-create-row">
            <input
              className="explorer-path-input"
              autoFocus
              placeholder="New folder name"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
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
              className="btn-sm btn-ablit"
              onClick={() => void createFolder()}
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

        {error && <div className="error" style={{ padding: '8px 16px' }}>{error}</div>}

        <div className="explorer-body">
          <div className="explorer-file-pane">
            {loading ? (
              <div className="explorer-loading">==&gt; Reading directory contents…</div>
            ) : files.length === 0 ? (
              <div className="explorer-empty">Empty directory or unreadable.</div>
            ) : (
              files.map((file) => {
                const isSelected = selectedFile === file.name
                const icon = file.isDir
                  ? '📁'
                  : file.name.endsWith('.py')
                  ? '🐍'
                  : file.name.endsWith('.duckdb')
                  ? '🦆'
                  : file.name.endsWith('.log')
                  ? '📜'
                  : file.name.endsWith('.csv')
                  ? '📊'
                  : file.name.endsWith('.json') || file.name.endsWith('.jsonl')
                  ? '📦'
                  : '📄'

                return (
                  <div
                    key={file.name}
                    className={`explorer-row ${isSelected ? 'selected' : ''}`}
                    onClick={() => {
                      if (file.isDir) {
                        navigateDir(file.name)
                      } else {
                        void previewFile(file.name)
                      }
                    }}
                  >
                    <span className="file-icon">{icon}</span>
                    <span className="file-name">{file.name}</span>
                    <span className="file-size">{file.size}</span>
                  </div>
                )
              })
            )}
          </div>

          <div className="explorer-preview-pane">
            {selectedFile ? (
              <>
                <div className="preview-header">
                  <span>📄 {selectedFile}</span>
                  <button
                    type="button"
                    className="btn-sm ghost"
                    onClick={() => void previewFile(selectedFile)}
                  >
                    Refresh
                  </button>
                </div>
                {contentLoading ? (
                  <div className="explorer-loading">Loading preview…</div>
                ) : (
                  <pre className="preview-content">{fileContent}</pre>
                )}
              </>
            ) : (
              <div className="preview-placeholder">
                Select a file to inspect up to 250 lines.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
