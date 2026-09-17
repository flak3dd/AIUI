import { useRef, useEffect } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { QuickStartHero } from './QuickStartHero'
import { MessageContent } from './MessageContent'
import type { UiMessage } from '../types/ui'
import type { BashExecResult } from '../lib/bashShell'

export interface ChatStageProps {
  messages: UiMessage[]
  sparkHost: string
  sandboxOnline?: boolean
  mempalaceOnline?: boolean
  onSelectPrompt: (prompt: string) => void
  gatedNotice: { model: string; alt: string } | null
  onSwitchUngated: (model: string) => void
  inlineExecResults: Record<string, BashExecResult>
  executingInlineKey: string | null
  copiedCellKey: string | null
  executingCmd: boolean
  onCopyCode: (cellKey: string, code: string) => void
  onRunCode: (cellKey: string, code: string) => void
  onAutoHeal: (code: string, errorText: string) => void
  onCopyMessage: (id: string, content: string) => void
  scrollToken?: number
  streamingMessageId?: string
}

const VIRTUALIZE_AFTER = 40

export function ChatStage({
  messages,
  sparkHost,
  sandboxOnline,
  mempalaceOnline,
  onSelectPrompt,
  gatedNotice,
  onSwitchUngated,
  inlineExecResults,
  executingInlineKey,
  copiedCellKey,
  executingCmd,
  onCopyCode,
  onRunCode,
  onAutoHeal,
  onCopyMessage,
  scrollToken = 0,
  streamingMessageId,
}: ChatStageProps) {
  const parentRef = useRef<HTMLDivElement | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const useVirtual = messages.length >= VIRTUALIZE_AFTER

  const virtualizer = useVirtualizer({
    count: useVirtual ? messages.length : 0,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 140,
    overscan: 10,
  })

  useEffect(() => {
    if (!useVirtual) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
      return
    }
    if (messages.length > 0) {
      virtualizer.scrollToIndex(messages.length - 1, { align: 'end' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollToken, messages.length, useVirtual])

  const showHero = messages.length === 1 && messages[0]?.id === 'welcome'

  const renderBubble = (m: UiMessage) => {
    if (m.id === 'welcome' && messages.length === 1) return null
    const isStreaming = m.role === 'assistant' && m.id === streamingMessageId
    return (
      <div
        key={m.id}
        className={`bubble ${m.role} ${isStreaming ? 'is-streaming' : ''}`}
        data-index={m.id}
      >
        <div className="bubble-actions">
          <button
            type="button"
            className={`bubble-copy-btn ${copiedCellKey === `msg_${m.id}` ? 'btn-copied-success' : ''}`}
            onClick={() => onCopyMessage(m.id, m.content)}
            title="Copy message"
          >
            {copiedCellKey === `msg_${m.id}` ? '✓' : '⧉'}
          </button>
        </div>
        {m.ragCitations && m.ragCitations.length > 0 && (
          <div className="rag-citations">
            {m.ragCitations.map((c) => (
              <span key={c} className="rag-chip">
                {c}
              </span>
            ))}
          </div>
        )}
        <MessageContent
          content={
            m.name === 'memory_search'
              ? 'Searching Memory...'
              : m.name === 'memory_checkpoint'
                ? 'Saving Memory...'
                : m.content
          }
          msgId={m.id}
          inlineExecResults={inlineExecResults}
          executingInlineKey={executingInlineKey}
          copiedCellKey={copiedCellKey}
          executingCmd={executingCmd}
          onCopyCode={onCopyCode}
          onRunCode={onRunCode}
          onAutoHeal={onAutoHeal}
        />
        {m.execResult && (
          <div className="tool-exec-strip">
            <span className={m.execResult.ok ? 'ok' : 'fail'}>
              exit {m.execResult.exitCode} · {m.execResult.durationMs}ms
            </span>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="chat-stage">
      <div className="messages" ref={parentRef}>
        <div className="messages-column">
          {showHero && (
            <QuickStartHero
              onSelectPrompt={onSelectPrompt}
              sparkHost={sparkHost}
              sandboxOnline={sandboxOnline}
              mempalaceOnline={mempalaceOnline}
            />
          )}

          {gatedNotice && (
            <div className="gated-notice">
              <span className="ablit-marker">==&gt;</span> {gatedNotice.model} is gated
              <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                <button type="button" className="primary" onClick={() => onSwitchUngated(gatedNotice.alt)}>
                  Switch to {gatedNotice.alt} & Run
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => onSwitchUngated('Qwen/Qwen2.5-7B-Instruct')}
                >
                  Switch to Qwen 2.5 7B
                </button>
                <a
                  href={`https://featherless.ai/models/${gatedNotice.model}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: 'var(--accent)', fontSize: 12 }}
                >
                  Verify on Featherless
                </a>
              </div>
            </div>
          )}

          {!useVirtual && (
            <>
              {messages.map((m) => renderBubble(m))}
              <div ref={bottomRef} />
            </>
          )}

          {useVirtual && (
            <div
              className="virtual-message-list"
              style={{ height: virtualizer.getTotalSize(), width: '100%', position: 'relative' }}
            >
              {virtualizer.getVirtualItems().map((row) => {
                const m = messages[row.index]
                return (
                  <div
                    key={m.id}
                    data-index={row.index}
                    ref={virtualizer.measureElement}
                    className="virtual-message-row"
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      transform: `translateY(${row.start}px)`,
                    }}
                  >
                    {renderBubble(m)}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
