import React, { useState, useEffect, useRef } from 'react'
import type { CodeCanvasFile } from '../../lib/commandSpaceEngine'

export interface GhostTypeEditorProps {
  file: CodeCanvasFile | null
  onClose?: () => void
  onSendToComposer?: (code: string) => void
}

export const GhostTypeEditor: React.FC<GhostTypeEditorProps> = ({
  file,
  onClose,
  onSendToComposer,
}) => {
  const [displayedText, setDisplayedText] = useState<string>('')
  const [isTyping, setIsTyping] = useState<boolean>(false)
  const [copied, setCopied] = useState<boolean>(false)
  const editorBodyRef = useRef<HTMLDivElement | null>(null)

  const fullContent = file?.content || ''

  // Ghost Typing Live Stream Simulation
  useEffect(() => {
    if (!fullContent) {
      setDisplayedText('')
      setIsTyping(false)
      return
    }

    // If file is already typed or content is tiny, render immediately
    if (fullContent.length < 40 || !file?.isGhostTyping) {
      setDisplayedText(fullContent)
      setIsTyping(false)
      return
    }

    // Initiate High-Speed Ghost-Type Live Stream
    setIsTyping(true)
    let currentLen = Math.max(1, Math.floor(fullContent.length * 0.15))
    setDisplayedText(fullContent.slice(0, currentLen))

    const chunkSize = Math.max(12, Math.floor(fullContent.length / 35))
    const timer = setInterval(() => {
      currentLen += chunkSize
      if (currentLen >= fullContent.length) {
        setDisplayedText(fullContent)
        setIsTyping(false)
        clearInterval(timer)
      } else {
        setDisplayedText(fullContent.slice(0, currentLen))
      }

      if (editorBodyRef.current) {
        editorBodyRef.current.scrollTop = editorBodyRef.current.scrollHeight
      }
    }, 28)

    return () => clearInterval(timer)
  }, [fullContent, file?.isGhostTyping, file?.lastModifiedTimestamp])

  const handleCopy = () => {
    if (!fullContent) return
    navigator.clipboard.writeText(fullContent)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const lines = (displayedText || '').split(/\r?\n/)

  return (
    <div className="ghost-type-editor-pane">
      {/* Editor Header */}
      <div className="ghost-editor-header">
        <div className="ghost-editor-header-left">
          <span className="ghost-editor-icon">⚡</span>
          <span className="ghost-editor-title">CODE CANVAS</span>
          <span className="ghost-editor-file-path" title={file?.path || 'No active file'}>
            {file?.path || 'workspace/untitled'}
          </span>
          {file?.language && (
            <span className="ghost-editor-lang-tag">{file.language.toUpperCase()}</span>
          )}
          <span className={`ghost-editor-status-pill ${isTyping ? 'typing-active' : 'typing-idle'}`}>
            {isTyping ? '● AI GHOST TYPING LIVE' : '✓ SYNTHESIZED'}
          </span>
        </div>

        <div className="ghost-editor-header-right">
          {onSendToComposer && fullContent && (
            <button
              type="button"
              className="btn-ghost-action"
              onClick={() => onSendToComposer(fullContent)}
              title="Insert full code into current prompt composer"
            >
              📌 To Composer
            </button>
          )}

          <button
            type="button"
            className="btn-ghost-action"
            onClick={handleCopy}
            title="Copy file contents"
          >
            {copied ? '✔ Copied' : '📋 Copy File'}
          </button>

          {onClose && (
            <button
              type="button"
              className="btn-pane-close"
              onClick={onClose}
              title="Close code canvas"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Editor Body */}
      <div ref={editorBodyRef} className="ghost-editor-body">
        {lines.length === 0 || !file ? (
          <div className="ghost-editor-empty">
            <div className="ghost-empty-icon">📂</div>
            <div className="ghost-empty-title">Persistent Code Canvas Active</div>
            <div className="ghost-empty-sub">
              Any file modified by the AI via <code>write_file</code>, <code>cat &gt; file</code>, or <code>sed</code> will stream here in real-time.
            </div>
          </div>
        ) : (
          <div className="ghost-editor-code-stream">
            {lines.map((line, idx) => {
              const isLastLine = idx === lines.length - 1
              return (
                <div key={idx} className="ghost-code-line">
                  <span className="ghost-line-number">{idx + 1}</span>
                  <span className="ghost-line-text">
                    {line || '\u00A0'}
                    {/* Distinct Neon Purple Agent Ghost Cursor */}
                    {isLastLine && isTyping && (
                      <span
                        className="neon-purple-ghost-cursor"
                        title="AI Agent Ghost Cursor (writing live)"
                      >
                        ▌
                      </span>
                    )}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Footer Breadcrumb */}
      {file && (
        <div className="ghost-editor-footer">
          <span>Target: {file.mutationType}</span>
          <span>{lines.length} lines</span>
          <span>{new Blob([displayedText]).size} bytes</span>
        </div>
      )}
    </div>
  )
}
