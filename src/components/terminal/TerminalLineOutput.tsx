import React from 'react'

export interface TerminalLineOutputProps {
  content: string
  isStderr?: boolean
  className?: string
}

/**
 * Parses and syntax-highlights terminal output lines using active theme variables:
 * - Diffs (+ additions in --primary cyan, - deletions in --accent coral)
 * - Git status (M/A/D in gold/emerald/coral, paths in --primary)
 * - Tests & Pass/Fail status (pass in --success, fail/error in --danger)
 * - Prompts & Commands in --secondary / --primary
 */
export const TerminalLineOutput: React.FC<TerminalLineOutputProps> = ({
  content,
  isStderr = false,
  className = '',
}) => {
  if (!content) return null

  if (isStderr) {
    return (
      <pre className={`term-output stderr-text ${className}`}>
        {content}
      </pre>
    )
  }

  const lines = content.split('\n')

  return (
    <pre className={`term-output stdout-text ${className}`}>
      {lines.map((line, idx) => {
        // Empty lines
        if (!line) {
          return <span key={idx} className="term-line">{'\n'}</span>
        }

        // Git diff additions (+ line)
        if (line.startsWith('+ ') || (line.startsWith('+') && !line.startsWith('+++'))) {
          return (
            <span key={idx} className="term-line term-line-add">
              {line}{'\n'}
            </span>
          )
        }

        // Git diff deletions (- line)
        if (line.startsWith('- ') || (line.startsWith('-') && !line.startsWith('---'))) {
          return (
            <span key={idx} className="term-line term-line-del">
              {line}{'\n'}
            </span>
          )
        }

        // Git diff header chunks (@@ -1,5 +1,5 @@)
        if (line.startsWith('@@') || line.startsWith('diff --git')) {
          return (
            <span key={idx} className="term-line term-line-diff-header">
              {line}{'\n'}
            </span>
          )
        }

        // Errors & Fatals
        if (/^(?:fatal:|error:|failed:|fail:|exception:|\s*Error:)/i.test(line)) {
          return (
            <span key={idx} className="term-line term-line-err">
              {line}{'\n'}
            </span>
          )
        }

        // Warnings
        if (/^(?:warning:|warn:|caution:)/i.test(line)) {
          return (
            <span key={idx} className="term-line term-line-warn">
              {line}{'\n'}
            </span>
          )
        }

        // Passing / Success / Checkmarks
        if (/^(?:✓|passed|pass|success|ok|done|compiled|ready)/i.test(line) || /\b(?:PASS|ALL TESTS PASSED)\b/.test(line)) {
          return (
            <span key={idx} className="term-line term-line-pass">
              {line}{'\n'}
            </span>
          )
        }

        // Git status short lines (e.g., " M src/App.tsx", "?? newfile.ts")
        const gitMatch = line.match(/^([ MADRCU?]{1,2})\s+(.+)$/)
        if (gitMatch) {
          const [, status, filePath] = gitMatch
          const isModified = status.includes('M')
          const isAdded = status.includes('A') || status.includes('?')
          const isDeleted = status.includes('D')
          const statusClass = isModified ? 'stat-mod' : isAdded ? 'stat-add' : isDeleted ? 'stat-del' : 'stat-other'

          return (
            <span key={idx} className="term-line term-line-git">
              <span className={`term-git-status ${statusClass}`}>{status}</span>
              {' '}
              <span className="term-git-path">{filePath}</span>
              {'\n'}
            </span>
          )
        }

        // Shell command echo ($ command or > command)
        if (line.startsWith('$ ') || line.startsWith('> ') || line.startsWith('❯ ')) {
          return (
            <span key={idx} className="term-line term-line-prompt">
              {line}{'\n'}
            </span>
          )
        }

        // Default terminal stdout line
        return (
          <span key={idx} className="term-line">
            {line}{'\n'}
          </span>
        )
      })}
    </pre>
  )
}
