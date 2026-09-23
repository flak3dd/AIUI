import { ThoughtTrail } from './ThoughtTrail'
import type { BashExecResult } from '../../lib/bashShell'
import { extractFileCitations, formatFileCitation, type FileCitation } from '../../lib/devinResponseFormatter'

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
  /** Enable AIUI workspace formatting */
  devinStyle?: boolean
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
  devinStyle = false,
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

  // Extract file citations when workspace formatting is on
  const citations = devinStyle ? extractFileCitations(content) : []

  // Render workspace tool-call blocks
  const renderDevinToolCall = (toolMatch: RegExpMatchArray) => {
    const toolName = toolMatch[1] || 'unknown'
    const args = toolMatch[2] || ''
    
    return (
      <div key={`tool_${toolMatch.index}`} className="devin-tool-call">
        <div className="devin-tool-header">
          <span className="devin-tool-icon">⚡</span>
          <span className="devin-tool-name">{toolName}</span>
          <span className="devin-tool-args">{args}</span>
        </div>
      </div>
    )
  }

  // Render file citations
  const renderDevinCitation = (citation: FileCitation, idx: number) => {
    return (
      <div key={`citation_${idx}`} className="devin-citation">
        <span className="devin-citation-icon">📄</span>
        <span className="devin-citation-text">{formatFileCitation(citation)}</span>
      </div>
    )
  }

  // Parse and render workspace-formatted content
  const renderDevinContent = () => {
    if (!devinStyle) return null

    const toolCallRegex = /\[tool_call:\s*(\w+)\s*([^\]]*)\]/g
    const toolCalls: RegExpMatchArray[] = []
    let match
    while ((match = toolCallRegex.exec(content)) !== null) {
      toolCalls.push(match)
    }

    const contentWithoutTools = content.replace(toolCallRegex, '')
    
    return (
      <div className="devin-formatted-content">
        {toolCalls.length > 0 && (
          <div className="devin-tool-calls-section">
            <div className="devin-section-label">Tool Calls</div>
            {toolCalls.map(renderDevinToolCall)}
          </div>
        )}
        
        {citations.length > 0 && (
          <div className="devin-citations-section">
            <div className="devin-section-label">References</div>
            {citations.map(renderDevinCitation)}
          </div>
        )}
        
        <div className="devin-main-content">
          {contentWithoutTools}
        </div>
      </div>
    )
  }

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

      {devinStyle ? (
        renderDevinContent()
      ) : (
        parts.map((part, idx) => {
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
        })
      )}
    </div>
  )
}
