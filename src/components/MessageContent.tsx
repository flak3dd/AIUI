import { ThoughtTrail } from './ThoughtTrail'
import type { BashExecResult } from '../lib/bashShell'

export interface MessageContentProps {
  content: string
  /** Native model reasoning_content for ThoughtTrail */
  reasoning?: string
  reasoningStreaming?: boolean
  msgId?: string
  inlineExecResults: Record<string, BashExecResult>
  executingInlineKey: string | null
  copiedCellKey: string | null
  executingCmd: boolean
  onCopyCode: (cellKey: string, code: string) => void
  onRunCode: (cellKey: string, code: string) => void
  onAutoHeal: (code: string, errorText: string) => void
}

export function MessageContent({
  content,
  reasoning,
  reasoningStreaming = false,
  msgId = 'msg',
  inlineExecResults,
  executingInlineKey,
  copiedCellKey,
  executingCmd,
  onCopyCode,
  onRunCode,
  onAutoHeal,
}: MessageContentProps) {
  if (!content && !(reasoning?.trim())) return null

  const thinkRegex = /<think>([\s\S]*?)(?:<\/think>|$)/gi
  const thinkBlocks: string[] = []
  const contentWithoutThink = content
    .replace(thinkRegex, (_, thinkText) => {
      if (thinkText.trim()) thinkBlocks.push(thinkText.trim())
      return ''
    })
    .trim()

  const codeBlockRegex = /```([a-zA-Z0-9_\-#+]*)\n([\s\S]*?)```/g
  const parts: Array<{ type: 'text' | 'code'; content: string; lang?: string }> = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  const targetContent = contentWithoutThink || (thinkBlocks.length > 0 ? '' : content)

  while ((match = codeBlockRegex.exec(targetContent)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', content: targetContent.slice(lastIndex, match.index) })
    }
    parts.push({ type: 'code', lang: match[1] || 'sh', content: match[2] })
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < targetContent.length) {
    parts.push({ type: 'text', content: targetContent.slice(lastIndex) })
  }

  if (
    !(reasoning?.trim()) &&
    thinkBlocks.length === 0 &&
    parts.length === 1 &&
    parts[0].type === 'text'
  ) {
    return <div style={{ whiteSpace: 'pre-wrap' }}>{content}</div>
  }

  const nativeReasoning = reasoning?.trim() ?? ''
  const tagBlocks = thinkBlocks.filter((b) => b !== nativeReasoning)

  return (
    <div>
      {nativeReasoning ? (
        <ThoughtTrail
          thoughtText={nativeReasoning}
          isStreaming={reasoningStreaming}
        />
      ) : null}
      {tagBlocks.map((thinkContent, tidx) => (
        <ThoughtTrail key={`think_${tidx}`} thoughtText={thinkContent} />
      ))}

      {parts.map((part, idx) => {
        if (part.type === 'text') {
          return (
            <div key={idx} style={{ whiteSpace: 'pre-wrap' }}>
              {part.content}
            </div>
          )
        }

        const isRunnable = ['sh', 'bash', 'zsh', 'shell', 'python', 'py', 'js', 'ts', 'node'].includes(
          (part.lang || '').toLowerCase(),
        )
        const cellKey = `${msgId}_${idx}`
        const inlineResult = inlineExecResults[cellKey]
        const isCellRunning = executingInlineKey === cellKey

        return (
          <div key={idx} className="code-block">
            <div className="code-header">
              <div className="code-header-left">
                <span className="lang-chip">{part.lang || 'code'}</span>
              </div>
              <div className="actions">
                <button
                  type="button"
                  className={`btn-sm ghost ${copiedCellKey === cellKey ? 'btn-copied-success' : ''}`}
                  onClick={() => onCopyCode(cellKey, part.content)}
                  title="Copy code"
                >
                  {copiedCellKey === cellKey ? '✓ Copied' : 'Copy'}
                </button>
                {isRunnable && (
                  <button
                    type="button"
                    className="btn-sm btn-ablit"
                    onClick={() => onRunCode(cellKey, part.content)}
                    disabled={executingCmd || isCellRunning}
                    title="Run command"
                  >
                    {isCellRunning ? (
                      '⏳ Running…'
                    ) : (
                      <>
                        <img src="/icons/icon-lightning.png" alt="Run" className="btn-icon-img" />
                        <span>Run</span>
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>
            <pre className="code-content">
              <code>{part.content}</code>
            </pre>
            {inlineResult && (
              <div className="code-inline-tray">
                <div className="code-inline-header">
                  <span
                    style={{
                      color: inlineResult.ok ? 'var(--dracula-green)' : 'var(--dracula-red)',
                      fontWeight: 'bold',
                    }}
                  >
                    {inlineResult.ok ? 'OK 0' : `FAIL ${inlineResult.exitCode}`} · {inlineResult.durationMs}ms
                  </span>
                  <div className="row" style={{ gap: 6 }}>
                    {!inlineResult.ok && (
                      <button
                        type="button"
                        className="btn-auto-heal"
                        onClick={() =>
                          onAutoHeal(part.content, inlineResult.stderr || inlineResult.stdout)
                        }
                        title="Ask assistant to fix this error"
                      >
                        Auto-Fix & Re-run
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn-sm ghost"
                      onClick={() =>
                        navigator.clipboard.writeText(
                          (inlineResult.stdout || '') + '\n' + (inlineResult.stderr || ''),
                        )
                      }
                      title="Copy output"
                    >
                      Copy Output
                    </button>
                  </div>
                </div>
                {inlineResult.stdout && <pre className="code-inline-stdout">{inlineResult.stdout}</pre>}
                {inlineResult.stderr && <pre className="code-inline-stderr">{inlineResult.stderr}</pre>}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
