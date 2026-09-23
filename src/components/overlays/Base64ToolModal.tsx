import React, { useState, useMemo } from 'react'

export interface Base64ToolModalProps {
  open: boolean
  onClose: () => void
  onInsertComposer?: (text: string) => void
}

// UTF-8 safe base64 encoding
function utf8ToBase64(str: string, urlSafe = false): string {
  const bytes = new TextEncoder().encode(str)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  let b64 = btoa(binary)
  if (urlSafe) {
    b64 = b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  }
  return b64
}

// UTF-8 safe base64 decoding
function base64ToUtf8(b64: string): string {
  let clean = b64.trim()
  if (clean.includes('-') || clean.includes('_')) {
    clean = clean.replace(/-/g, '+').replace(/_/g, '/')
    while (clean.length % 4 !== 0) clean += '='
  }
  const binary = atob(clean)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return new TextDecoder().decode(bytes)
}

export const Base64ToolModal: React.FC<Base64ToolModalProps> = ({
  open,
  onClose,
  onInsertComposer,
}) => {
  const [mode, setMode] = useState<'encode' | 'decode'>('encode')
  const [input, setInput] = useState('')
  const [urlSafe, setUrlSafe] = useState(false)
  const [copied, setCopied] = useState(false)

  const { output, error } = useMemo(() => {
    if (!input) return { output: '', error: null }
    try {
      if (mode === 'encode') {
        return { output: utf8ToBase64(input, urlSafe), error: null }
      } else {
        return { output: base64ToUtf8(input), error: null }
      }
    } catch (err: any) {
      return { output: '', error: err.message || 'Invalid base64 string' }
    }
  }, [input, mode, urlSafe])

  if (!open) return null

  const handleCopy = (text = output) => {
    if (!text) return
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const handleInsert = () => {
    if (!output || !onInsertComposer) return
    onInsertComposer(output)
    onClose()
  }

  return (
    <div className="settings-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div
        className="settings-card"
        style={{ maxWidth: 740, width: '92vw', maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 20 }}>🔤</span>
            <div>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, letterSpacing: '0.04em' }}>
                BASE64 ENCODER & DECODER TOOL
              </h2>
              <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                UTF-8 resilient string, JSON & binary transform utility
              </div>
            </div>
          </div>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="Close modal">
            ✕
          </button>
        </div>

        <div style={{ padding: '16px 20px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Mode Switcher & Controls */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
            <div style={{ display: 'flex', background: 'var(--bg-subtle, rgba(255,255,255,0.05))', borderRadius: 8, padding: 3, border: '1px solid var(--border)' }}>
              <button
                type="button"
                className="btn-sm"
                style={{
                  background: mode === 'encode' ? 'var(--accent, #7c5cff)' : 'transparent',
                  color: mode === 'encode' ? '#fff' : 'var(--text-dim)',
                  fontWeight: 600,
                  borderRadius: 6,
                  border: 'none',
                }}
                onClick={() => setMode('encode')}
              >
                Encode (Text ➔ Base64)
              </button>
              <button
                type="button"
                className="btn-sm"
                style={{
                  background: mode === 'decode' ? 'var(--accent, #7c5cff)' : 'transparent',
                  color: mode === 'decode' ? '#fff' : 'var(--text-dim)',
                  fontWeight: 600,
                  borderRadius: 6,
                  border: 'none',
                }}
                onClick={() => setMode('decode')}
              >
                Decode (Base64 ➔ Text)
              </button>
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={urlSafe}
                onChange={(e) => setUrlSafe(e.target.checked)}
              />
              <span>URL-Safe (- and _)</span>
            </label>
          </div>

          {/* Input Textarea */}
          <div className="field">
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase' }}>
                {mode === 'encode' ? 'Input Plain Text / JSON / Script' : 'Input Base64 String'}
              </label>
              <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                {input.length} chars ({new TextEncoder().encode(input).length} bytes)
              </span>
            </div>
            <textarea
              className="input-text"
              rows={5}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={mode === 'encode' ? 'Type or paste content to encode...' : 'Paste base64 string to decode...'}
              style={{ fontFamily: 'monospace', fontSize: 12, resize: 'vertical', width: '100%' }}
            />
          </div>

          {/* Output Textarea */}
          <div className="field">
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase' }}>
                {mode === 'encode' ? 'Base64 Result' : 'Decoded Plain Text'}
              </label>
              <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                {output.length} chars ({new TextEncoder().encode(output).length} bytes)
              </span>
            </div>
            {error ? (
              <div style={{ padding: 12, borderRadius: 8, background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.3)', fontSize: 12, fontFamily: 'monospace' }}>
                ⚠ Decode Error: {error}
              </div>
            ) : (
              <textarea
                className="input-text"
                rows={5}
                readOnly
                value={output}
                placeholder="Result will appear here..."
                style={{
                  fontFamily: 'monospace',
                  fontSize: 12,
                  resize: 'vertical',
                  width: '100%',
                  background: 'var(--bg-input, #0c101d)',
                  color: mode === 'encode' ? '#93c5fd' : '#a7f3d0',
                }}
              />
            )}
          </div>

          {/* Quick Actions Row */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn-primary"
              onClick={() => handleCopy()}
              disabled={!output}
              style={{ fontWeight: 600 }}
            >
              {copied ? '✔ Copied!' : '📋 Copy Result'}
            </button>
            {onInsertComposer && (
              <button
                type="button"
                className="btn-secondary"
                onClick={handleInsert}
                disabled={!output}
              >
                💬 Insert into Chat Composer
              </button>
            )}
            <button
              type="button"
              className="btn-sm"
              onClick={() => {
                setInput('')
              }}
              style={{ marginLeft: 'auto' }}
            >
              🧹 Clear
            </button>
          </div>
        </div>

        <div className="settings-footer" style={{ display: 'flex', justifyContent: 'flex-end', padding: '12px 20px', borderTop: '1px solid var(--border)' }}>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
