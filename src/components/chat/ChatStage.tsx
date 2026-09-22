import { useRef, useEffect, useMemo } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { QuickStartHero } from './QuickStartHero'
import { MessageContent } from './MessageContent'
import { AgentBashWorkingsSection } from './AgentBashWorkingsSection'
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
  onFollowUp?: (prompt: string) => void
  scrollToken?: number
  streamingMessageId?: string
}

const VIRTUALIZE_AFTER = 40

type ChatItem =
  | { type: 'message'; message: UiMessage }
  | { type: 'tool_group'; id: string; messages: UiMessage[] }
  | { type: 'status_chip'; message: UiMessage }

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
  onFollowUp,
  scrollToken = 0,
  streamingMessageId,
}: ChatStageProps) {
  const parentRef = useRef<HTMLDivElement | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)

  // Group consecutive tool messages into a single consolidated bash workings section
  const chatItems = useMemo<ChatItem[]>(() => {
    const items: ChatItem[] = []
    let currentToolGroup: UiMessage[] = []

    const flushToolGroup = () => {
      if (currentToolGroup.length > 0) {
        items.push({
          type: 'tool_group',
          id: `tg_${currentToolGroup[0].id}`,
          messages: [...currentToolGroup],
        })
        currentToolGroup = []
      }
    }

    for (const m of messages) {
      if (m.role === 'tool') {
        currentToolGroup.push(m)
      } else if (m.name === 'status_chip') {
        flushToolGroup()
        items.push({ type: 'status_chip', message: m })
      } else {
        flushToolGroup()
        items.push({ type: 'message', message: m })
      }
    }
    flushToolGroup()
    return items
  }, [messages])

  const useVirtual = chatItems.length >= VIRTUALIZE_AFTER

  const virtualizer = useVirtualizer({
    count: useVirtual ? chatItems.length : 0,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 140,
    overscan: 10,
  })

  useEffect(() => {
    if (!useVirtual) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
      return
    }
    if (chatItems.length > 0) {
      virtualizer.scrollToIndex(chatItems.length - 1, { align: 'end' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollToken, chatItems.length, useVirtual])

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
          reasoning={m.role === 'assistant' ? m.reasoning : undefined}
          reasoningStreaming={Boolean(isStreaming && m.reasoning)}
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
              {chatItems.map((item) => (
                <div key={item.type === 'message' ? item.message.id : item.type === 'tool_group' ? item.id : item.message.id}>
                  {item.type === 'tool_group' ? (
                    <AgentBashWorkingsSection
                      messages={item.messages}
                      copiedCellKey={copiedCellKey}
                      onCopyCode={onCopyCode}
                    />
                  ) : item.type === 'status_chip' ? (
                    <div className="status-chip-block">
                      <div className="status-chip-row" role="status">
                        <span className="status-chip">{item.message.content.replace(/^⚡\s*/, '')}</span>
                      </div>
                      {item.message.followUps && item.message.followUps.length > 0 && (
                        <div className="response-followups-row">
                          {item.message.followUps.map((s) => (
                            <button
                              key={s.id}
                              type="button"
                              className="response-followup-chip"
                              onClick={() => onFollowUp?.(s.prompt)}
                            >
                              {s.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    renderBubble(item.message)
                  )}
                </div>
              ))}
              <div ref={bottomRef} />
            </>
          )}

          {useVirtual && (
            <div
              className="virtual-message-list"
              style={{ height: virtualizer.getTotalSize(), width: '100%', position: 'relative' }}
            >
              {virtualizer.getVirtualItems().map((row) => {
                const item = chatItems[row.index]
                if (!item) return null
                return (
                  <div
                    key={item.type === 'tool_group' ? item.id : item.message.id}
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
                    {item.type === 'tool_group' ? (
                      <AgentBashWorkingsSection
                        messages={item.messages}
                        copiedCellKey={copiedCellKey}
                        onCopyCode={onCopyCode}
                      />
                    ) : item.type === 'status_chip' ? (
                      <div className="status-chip-block">
                        <div className="status-chip-row" role="status">
                          <span className="status-chip">{item.message.content.replace(/^⚡\s*/, '')}</span>
                        </div>
                        {item.message.followUps && item.message.followUps.length > 0 && (
                          <div className="response-followups-row">
                            {item.message.followUps.map((s) => (
                              <button
                                key={s.id}
                                type="button"
                                className="response-followup-chip"
                                onClick={() => onFollowUp?.(s.prompt)}
                              >
                                {s.label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : (
                      renderBubble(item.message)
                    )}
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
