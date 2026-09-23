/**
 * CommandSpace: The Intelligent Multiplexer Engine
 * Manages dynamic terminal panes, heatmap error density indexing,
 * file mutation parsing for the Ghost-Type Editor, and monologue telemetry.
 */

export type PaneState = 'streaming' | 'completed' | 'error' | 'idle'

export interface TerminalLine {
  id: string
  lineNumber: number
  text: string
  type: 'stdout' | 'stderr' | 'command' | 'traceback' | 'error' | 'warning'
}

export interface HeatmapSegment {
  lineIndex: number
  type: 'error' | 'traceback' | 'warning' | 'command'
  label: string
}

export interface TerminalPaneData {
  id: string
  title: string
  command: string
  state: PaneState
  stdout: string
  stderr: string
  lines: TerminalLine[]
  heatmap: HeatmapSegment[]
  exitCode: number | null
  durationMs?: number
  target?: string
  timestamp: string
  paused?: boolean
  focusedLine?: number | null
  maximized?: boolean
}

export interface CodeCanvasFile {
  path: string
  content: string
  language: string
  isGhostTyping: boolean
  lastModifiedTimestamp: number
  mutationType: 'write_file' | 'cat_eof' | 'sed' | 'append' | 'direct'
}

export interface MonologueEntry {
  id: string
  timestamp: string
  stateTag: string
  detail: string
  level: 'info' | 'active' | 'warning' | 'error'
}

// Error & Traceback detection patterns
const TRACEBACK_REGEX = /(?:Traceback \(most recent call last\)|at [a-zA-Z0-9_$.]+\s*\([^)]+:\d+:\d+\)|File "[^"]+", line \d+)/i
const ERROR_LINE_REGEX = /(?:Error:|TypeError:|ValueError:|SyntaxError:|IndexError:|KeyError:|NameError:|AttributeError:|RuntimeError:|FATAL:|PANIC:|FAILED:|exit code [1-9]|command not found|Permission denied|no such file)/i
const WARNING_LINE_REGEX = /(?:Warning:|DeprecationWarning:|WARN|notice:)/i

/**
 * Parses raw terminal output into indexed lines with error classification.
 */
export function parseTerminalLines(output: string, commandText = ''): { lines: TerminalLine[]; heatmap: HeatmapSegment[] } {
  if (!output && !commandText) {
    return { lines: [], heatmap: [] }
  }

  const rawLines = output ? output.split(/\r?\n/) : []
  const lines: TerminalLine[] = []
  const heatmap: HeatmapSegment[] = []

  let lineNum = 1

  if (commandText) {
    lines.push({
      id: `cmd_header`,
      lineNumber: lineNum++,
      text: `$ ${commandText}`,
      type: 'command',
    })
    heatmap.push({
      lineIndex: 0,
      type: 'command',
      label: `$ ${commandText.slice(0, 40)}`,
    })
  }

  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i]
    let type: TerminalLine['type'] = 'stdout'

    if (TRACEBACK_REGEX.test(raw)) {
      type = 'traceback'
      heatmap.push({
        lineIndex: lines.length,
        type: 'traceback',
        label: `Traceback at line ${lineNum}`,
      })
    } else if (ERROR_LINE_REGEX.test(raw)) {
      type = 'error'
      heatmap.push({
        lineIndex: lines.length,
        type: 'error',
        label: raw.slice(0, 50),
      })
    } else if (WARNING_LINE_REGEX.test(raw)) {
      type = 'warning'
      heatmap.push({
        lineIndex: lines.length,
        type: 'warning',
        label: raw.slice(0, 50),
      })
    }

    lines.push({
      id: `line_${i}`,
      lineNumber: lineNum++,
      text: raw,
      type,
    })
  }

  return { lines, heatmap }
}

/**
 * Detects file modifications from agent command strings and tool outputs.
 */
export function extractFileMutation(
  command: string,
  contentOrPayload?: string
): { path: string; content?: string; mutationType: CodeCanvasFile['mutationType'] } | null {
  if (!command) return null

  // 1. write_file tool pattern
  if (command === 'write_file' || command.startsWith('write_file:')) {
    try {
      if (contentOrPayload) {
        const parsed = JSON.parse(contentOrPayload)
        if (parsed.path) {
          return {
            path: parsed.path,
            content: parsed.content || '',
            mutationType: 'write_file',
          }
        }
      }
    } catch {}
  }

  // 2. cat << 'EOF' > path/to/file pattern
  const catEofMatch = command.match(/cat\s+(?:<<\s*['"]?([A-Za-z0-9_]+)['"]?)\s*>\s*([^\s\n]+)/)
  if (catEofMatch) {
    const delimiter = catEofMatch[1]
    const targetPath = catEofMatch[2]
    let fileBody = ''
    if (delimiter && command.includes(delimiter)) {
      const parts = command.split(new RegExp(`<<\\s*['"]?${delimiter}['"]?\\s*>[^\\n]+\\n`))
      if (parts[1]) {
        fileBody = parts[1].split(new RegExp(`\\n${delimiter}`))?.[0] || ''
      }
    }
    return {
      path: targetPath,
      content: fileBody || contentOrPayload,
      mutationType: 'cat_eof',
    }
  }

  // 3. Direct redirection: echo "..." > file.txt or printf "..." > file.txt
  const redirectMatch = command.match(/(?:echo|printf)\s+.*?>\s*([a-zA-Z0-9_.\-\/]+\.[a-zA-Z0-9]+)/)
  if (redirectMatch && redirectMatch[1]) {
    return {
      path: redirectMatch[1],
      content: contentOrPayload,
      mutationType: 'direct',
    }
  }

  // 4. sed -i pattern
  const sedMatch = command.match(/sed\s+-i.*?([a-zA-Z0-9_.\-\/]+\.[a-zA-Z0-9]+)/)
  if (sedMatch && sedMatch[1]) {
    return {
      path: sedMatch[1],
      mutationType: 'sed',
    }
  }

  return null
}

/**
 * Infer syntax language from file extension.
 */
export function inferLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || ''
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    mjs: 'javascript',
    py: 'python',
    sh: 'bash',
    bash: 'bash',
    zsh: 'bash',
    json: 'json',
    md: 'markdown',
    yml: 'yaml',
    yaml: 'yaml',
    css: 'css',
    html: 'html',
    sql: 'sql',
    c: 'c',
    cpp: 'cpp',
    rs: 'rust',
    go: 'go',
  }
  return map[ext] || 'plaintext'
}

/**
 * Synthesize clean monospace internal monologue line from agent activity.
 */
export function formatMonologueState(
  stage: string,
  detail?: string,
  _round = 1,
  elapsedSec?: number
): MonologueEntry {
  const timeStr = new Date().toLocaleTimeString('en-US', { hour12: false })
  let stateTag = 'AGENT_IDLE'
  let text = detail || 'Listening for instructions...'
  let level: MonologueEntry['level'] = 'info'

  switch (stage) {
    case 'thinking':
      stateTag = 'AGENT_REASONING'
      text = detail ? `Synthesizing plan: ${detail}` : 'Formulating tactical execution step...'
      level = 'active'
      break
    case 'running_cmd':
      stateTag = 'SHELL_EXEC'
      text = detail ? `Executing: ${detail}` : 'Running sandbox shell process...'
      level = 'active'
      break
    case 'fixing':
      stateTag = 'SELF_HEALING'
      text = detail ? `Correcting defect: ${detail}` : 'Diagnosing traceback and applying code fix...'
      level = 'warning'
      break
    case 'writing':
    case 'modifying':
      stateTag = 'CODE_SYNTHESIS'
      text = detail ? `Writing ${detail}` : 'Streaming file mutation to Code Canvas...'
      level = 'active'
      break
    case 'error':
      stateTag = 'CRITICAL_FAULT'
      text = detail ? `Error detected: ${detail}` : 'Process exited with non-zero status.'
      level = 'error'
      break
    case 'done':
      stateTag = 'TASK_COMPLETED'
      text = detail || 'Goal verified and achieved.'
      level = 'info'
      break
    default:
      if (detail) text = detail
  }

  if (elapsedSec !== undefined && elapsedSec > 0) {
    text += ` (${elapsedSec}s)`
  }

  return {
    id: `mono_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    timestamp: timeStr,
    stateTag,
    detail: text,
    level,
  }
}
