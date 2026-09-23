import React, { useState, useMemo, useEffect } from 'react'

export interface Base64StudioProps {
  open: boolean
  onClose: () => void
  onInsertComposer?: (text: string) => void
  onSendToSshRunner?: (cmd: string) => void
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

// Convert string to hexadecimal representation
function toHexDump(str: string): string {
  const bytes = new TextEncoder().encode(str)
  const hexParts: string[] = []
  for (let i = 0; i < bytes.length; i++) {
    hexParts.push(bytes[i].toString(16).padStart(2, '0').toUpperCase())
  }
  return hexParts.join(' ')
}

export const Base64Studio: React.FC<Base64StudioProps> = ({
  open,
  onClose,
  onInsertComposer,
  onSendToSshRunner,
}) => {
  const [mode, setMode] = useState<'encode' | 'decode'>('encode')
  const [input, setInput] = useState('')
  const [urlSafe, setUrlSafe] = useState(false)
  const [showHex, setShowHex] = useState(false)
  const [activeTab, setActiveTab] = useState<'editor' | 'payloads'>('editor')
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  // Auto-detect base64 string on paste
  useEffect(() => {
    const trimmed = input.trim()
    if (trimmed.length > 8 && /^[A-Za-z0-9+/=_-]+$/.test(trimmed) && trimmed.length % 4 === 0) {
      if (mode === 'encode' && trimmed.endsWith('=')) {
        setMode('decode')
      }
    }
  }, [input, mode])

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

  const handleCopy = (text: string, key = 'output') => {
    if (!text) return
    navigator.clipboard.writeText(text)
    setCopiedKey(key)
    setTimeout(() => setCopiedKey(null), 1500)
  }

  const handleInsert = () => {
    if (!output || !onInsertComposer) return
    onInsertComposer(output)
    onClose()
  }

  const handleSwap = () => {
    if (!output) return
    setInput(output)
    setMode(mode === 'encode' ? 'decode' : 'encode')
  }

  const bashOneLiner = mode === 'encode' 
    ? `echo -n "${input.replace(/"/g, '\\"')}" | base64` 
    : `echo -n "${input.replace(/"/g, '\\"')}" | base64 -d`

  const pythonSnippet = mode === 'encode'
    ? `import base64\npayload = base64.b64encode(b"""${input}""").decode("utf-8")\nprint(payload)`
    : `import base64\nraw = base64.b64decode("${input.trim()}").decode("utf-8", errors="replace")\nprint(raw)`

  const nodeSnippet = mode === 'encode'
    ? `Buffer.from(${JSON.stringify(input)}).toString('base64')`
    : `Buffer.from(${JSON.stringify(input.trim())}, 'base64').toString('utf-8')`

  const dataUri = `data:text/plain;charset=utf-8;base64,${mode === 'encode' ? output : input.trim()}`

  return (
    <div className="settings-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div
        className="settings-card"
        style={{
          maxWidth: 900,
          width: '94vw',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          background: 'linear-gradient(180deg, #111420 0%, #0c0e17 100%)',
          border: '1px solid rgba(0, 240, 255, 0.25)',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.7), 0 0 30px rgba(0, 240, 255, 0.1)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="settings-header"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 22px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            background: 'rgba(0, 0, 0, 0.2)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: 8,
                background: 'rgba(0, 240, 255, 0.12)',
                border: '1px solid rgba(0, 240, 255, 0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 18,
              }}
            >
              🔤
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, letterSpacing: '0.04em', color: '#fff' }}>
                  BASE64 TACTICAL STUDIO
                </h2>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    padding: '2px 7px',
                    borderRadius: 999,
                    background: 'rgba(0, 240, 255, 0.15)',
                    color: '#00f0ff',
                    border: '1px solid rgba(0, 240, 255, 0.3)',
                  }}
                >
                  UTF-8 RESILIENT
                </span>
              </div>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>
                Bi-directional multi-format encoder, decoder, hex inspector & payload generator
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ display: 'flex', background: 'rgba(255, 255, 255, 0.05)', borderRadius: 6, padding: 2, border: '1px solid rgba(255, 255, 255, 0.1)' }}>
              <button
                type="button"
                className="btn-sm"
                style={{
                  background: activeTab === 'editor' ? 'rgba(0, 240, 255, 0.2)' : 'transparent',
                  color: activeTab === 'editor' ? '#00f0ff' : '#94a3b8',
                  border: 'none',
                  borderRadius: 4,
                  fontWeight: 600,
                  fontSize: 11,
                  padding: '4px 10px',
                }}
                onClick={() => setActiveTab('editor')}
              >
                Split Editor
              </button>
              <button
                type="button"
                className="btn-sm"
                style={{
                  background: activeTab === 'payloads' ? 'rgba(0, 240, 255, 0.2)' : 'transparent',
                  color: activeTab === 'payloads' ? '#00f0ff' : '#94a3b8',
                  border: 'none',
                  borderRadius: 4,
                  fontWeight: 600,
                  fontSize: 11,
                  padding: '4px 10px',
                }}
                onClick={() => setActiveTab('payloads')}
              >
                Payload Formats
              </button>
            </div>

            <button type="button" className="btn-icon" onClick={onClose} aria-label="Close modal">
              ✕
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div style={{ padding: '18px 22px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Controls bar */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ display: 'flex', background: 'rgba(255, 255, 255, 0.06)', borderRadius: 8, padding: 3, border: '1px solid rgba(255, 255, 255, 0.1)' }}>
              <button
                type="button"
                className="btn-sm"
                style={{
                  background: mode === 'encode' ? '#00f0ff' : 'transparent',
                  color: mode === 'encode' ? '#090d16' : '#94a3b8',
                  fontWeight: 700,
                  borderRadius: 6,
                  border: 'none',
                  padding: '5px 14px',
                  fontSize: 12,
                  transition: 'all 0.15s ease',
                }}
                onClick={() => setMode('encode')}
              >
                ENCODE (Text ➔ Base64)
              </button>
              <button
                type="button"
                className="btn-sm"
                style={{
                  background: mode === 'decode' ? '#00f0ff' : 'transparent',
                  color: mode === 'decode' ? '#090d16' : '#94a3b8',
                  fontWeight: 700,
                  borderRadius: 6,
                  border: 'none',
                  padding: '5px 14px',
                  fontSize: 12,
                  transition: 'all 0.15s ease',
                }}
                onClick={() => setMode('decode')}
              >
                DECODE (Base64 ➔ Text)
              </button>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#e2e8f0', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={urlSafe}
                  onChange={(e) => setUrlSafe(e.target.checked)}
                  style={{ accentColor: '#00f0ff' }}
                />
                <span>URL-Safe (-_)</span>
              </label>

              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#e2e8f0', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={showHex}
                  onChange={(e) => setShowHex(e.target.checked)}
                  style={{ accentColor: '#00f0ff' }}
                />
                <span>Hex View</span>
              </label>

              <button
                type="button"
                className="btn-sm"
                onClick={handleSwap}
                disabled={!output}
                style={{
                  fontSize: 11,
                  padding: '4px 10px',
                  background: 'rgba(255, 255, 255, 0.08)',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  color: '#e2e8f0',
                  borderRadius: 6,
                }}
              >
                ⇄ Swap
              </button>
            </div>
          </div>

          {activeTab === 'editor' ? (
            /* Split Panes */
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              {/* Left Pane: Input */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {mode === 'encode' ? 'INPUT (PLAIN UTF-8 / JSON)' : 'INPUT (BASE64 STRING)'}
                  </label>
                  <span style={{ fontSize: 11, color: '#64748b', fontFamily: 'monospace' }}>
                    {input.length} chars · {new TextEncoder().encode(input).length} B
                  </span>
                </div>
                <textarea
                  className="input-text"
                  rows={9}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={mode === 'encode' ? 'Type or paste content to encode...' : 'Paste base64 string to decode...'}
                  style={{
                    fontFamily: 'JetBrains Mono, monospace',
                    fontSize: 12,
                    resize: 'vertical',
                    width: '100%',
                    background: '#090b12',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    color: '#f8fafc',
                    borderRadius: 8,
                    padding: 10,
                  }}
                />
                {showHex && input && (
                  <div
                    style={{
                      fontSize: 10,
                      fontFamily: 'monospace',
                      color: '#94a3b8',
                      background: '#05070c',
                      padding: 8,
                      borderRadius: 6,
                      maxHeight: 70,
                      overflowY: 'auto',
                      border: '1px solid rgba(255, 255, 255, 0.06)',
                    }}
                  >
                    HEX: {toHexDump(input)}
                  </div>
                )}
              </div>

              {/* Right Pane: Output */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {mode === 'encode' ? 'OUTPUT (BASE64)' : 'OUTPUT (DECODED UTF-8)'}
                  </label>
                  <span style={{ fontSize: 11, color: '#64748b', fontFamily: 'monospace' }}>
                    {output.length} chars · {new TextEncoder().encode(output).length} B
                  </span>
                </div>
                {error ? (
                  <div
                    style={{
                      height: 195,
                      padding: 14,
                      borderRadius: 8,
                      background: 'rgba(239, 68, 68, 0.1)',
                      color: '#ef4444',
                      border: '1px solid rgba(239, 68, 68, 0.3)',
                      fontSize: 12,
                      fontFamily: 'monospace',
                    }}
                  >
                    ⚠ Decode Error: {error}
                  </div>
                ) : (
                  <textarea
                    className="input-text"
                    rows={9}
                    readOnly
                    value={output}
                    placeholder="Result will appear here reactively..."
                    style={{
                      fontFamily: 'JetBrains Mono, monospace',
                      fontSize: 12,
                      resize: 'vertical',
                      width: '100%',
                      background: '#090b12',
                      border: '1px solid rgba(0, 240, 255, 0.25)',
                      color: mode === 'encode' ? '#38bdf8' : '#34d399',
                      borderRadius: 8,
                      padding: 10,
                    }}
                  />
                )}
                {showHex && output && (
                  <div
                    style={{
                      fontSize: 10,
                      fontFamily: 'monospace',
                      color: '#38bdf8',
                      background: '#05070c',
                      padding: 8,
                      borderRadius: 6,
                      maxHeight: 70,
                      overflowY: 'auto',
                      border: '1px solid rgba(0, 240, 255, 0.1)',
                    }}
                  >
                    HEX: {toHexDump(output)}
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* Payload Formats Tab */
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Bash One-Liner */}
              <div style={{ background: '#090b12', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: 8, padding: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#f59e0b' }}>🐚 BASH ONE-LINER</span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {onSendToSshRunner && (
                      <button
                        type="button"
                        className="btn-sm"
                        style={{ fontSize: 10, padding: '2px 8px' }}
                        onClick={() => {
                          onSendToSshRunner(bashOneLiner)
                          onClose()
                        }}
                      >
                        ⚡ Send to SSH Runner
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn-sm"
                      style={{ fontSize: 10, padding: '2px 8px' }}
                      onClick={() => handleCopy(bashOneLiner, 'bash')}
                    >
                      {copiedKey === 'bash' ? '✔ Copied' : 'Copy'}
                    </button>
                  </div>
                </div>
                <code style={{ fontSize: 11, color: '#e2e8f0', fontFamily: 'monospace', display: 'block', wordBreak: 'break-all' }}>
                  {bashOneLiner}
                </code>
              </div>

              {/* Python 3 Snippet */}
              <div style={{ background: '#090b12', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: 8, padding: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#38bdf8' }}>🐍 PYTHON 3 SNIPPET</span>
                  <button
                    type="button"
                    className="btn-sm"
                    style={{ fontSize: 10, padding: '2px 8px' }}
                    onClick={() => handleCopy(pythonSnippet, 'python')}
                  >
                    {copiedKey === 'python' ? '✔ Copied' : 'Copy'}
                  </button>
                </div>
                <pre style={{ margin: 0, fontSize: 11, color: '#cbd5e1', fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
                  {pythonSnippet}
                </pre>
              </div>

              {/* Node.js Buffer */}
              <div style={{ background: '#090b12', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: 8, padding: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#34d399' }}>🟢 NODE.JS BUFFER</span>
                  <button
                    type="button"
                    className="btn-sm"
                    style={{ fontSize: 10, padding: '2px 8px' }}
                    onClick={() => handleCopy(nodeSnippet, 'node')}
                  >
                    {copiedKey === 'node' ? '✔ Copied' : 'Copy'}
                  </button>
                </div>
                <code style={{ fontSize: 11, color: '#e2e8f0', fontFamily: 'monospace', display: 'block' }}>
                  {nodeSnippet}
                </code>
              </div>

              {/* Data URI */}
              <div style={{ background: '#090b12', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: 8, padding: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#c084fc' }}>🔗 DATA URI SCHEME</span>
                  <button
                    type="button"
                    className="btn-sm"
                    style={{ fontSize: 10, padding: '2px 8px' }}
                    onClick={() => handleCopy(dataUri, 'uri')}
                  >
                    {copiedKey === 'uri' ? '✔ Copied' : 'Copy'}
                  </button>
                </div>
                <code style={{ fontSize: 10, color: '#94a3b8', fontFamily: 'monospace', display: 'block', wordBreak: 'break-all' }}>
                  {dataUri.slice(0, 140)}...
                </code>
              </div>
            </div>
          )}

          {/* Quick Action Toolbar */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              type="button"
              className="btn-primary"
              onClick={() => handleCopy(output, 'output')}
              disabled={!output}
              style={{
                fontWeight: 700,
                background: 'linear-gradient(135deg, #00f0ff 0%, #0099ff 100%)',
                color: '#090d16',
                border: 'none',
                padding: '7px 18px',
                borderRadius: 6,
              }}
            >
              {copiedKey === 'output' ? '✔ Copied Output!' : '📋 Copy Output'}
            </button>

            {onInsertComposer && (
              <button
                type="button"
                className="btn-secondary"
                onClick={handleInsert}
                disabled={!output}
                style={{
                  fontWeight: 600,
                  borderRadius: 6,
                  padding: '7px 16px',
                }}
              >
                💬 Insert into Chat Composer
              </button>
            )}

            {onSendToSshRunner && (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  if (!output) return
                  onSendToSshRunner(mode === 'encode' ? `echo "${output}" | base64 -d` : `echo "${output}"`)
                  onClose()
                }}
                disabled={!output}
                style={{
                  fontWeight: 600,
                  borderRadius: 6,
                  padding: '7px 16px',
                  color: '#38bdf8',
                }}
              >
                🚀 Pipe to SSH Runner
              </button>
            )}

            <button
              type="button"
              className="btn-sm"
              onClick={() => setInput('')}
              style={{
                marginLeft: 'auto',
                color: '#94a3b8',
                background: 'transparent',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: 6,
                padding: '6px 14px',
              }}
            >
              🧹 Clear All
            </button>
          </div>
        </div>

        {/* Footer */}
        <div
          className="settings-footer"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '12px 22px',
            borderTop: '1px solid rgba(255, 255, 255, 0.08)',
            background: 'rgba(0, 0, 0, 0.3)',
          }}
        >
          <span style={{ fontSize: 11, color: '#64748b' }}>
            Tip: Pasting a base64 string automatically switches mode to Decode.
          </span>
          <button type="button" className="btn-secondary" onClick={onClose} style={{ borderRadius: 6 }}>
            Close Studio
          </button>
        </div>
      </div>
    </div>
  )
}
