import React, { useState, useMemo } from 'react'

export interface ThoughtTrailProps {
  thoughtText: string
  isStreaming?: boolean
}

interface ReasoningPhase {
  id: string
  icon: string
  label: string
  content: string
}

export const ThoughtTrail: React.FC<ThoughtTrailProps> = ({ thoughtText, isStreaming = false }) => {
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)

  const tokenCount = useMemo(() => {
    return Math.max(1, Math.round(thoughtText.length / 3.8))
  }, [thoughtText])

  // Parse reasoning text into phases if possible
  const phases = useMemo<ReasoningPhase[]>(() => {
    if (!thoughtText.trim()) return []

    // Try splitting by numbered steps, markdown headers, or keywords
    const rawParagraphs = thoughtText.split(/\n\n+/)
    if (rawParagraphs.length <= 1) {
      return [
        {
          id: 'phase_1',
          icon: '🧠',
          label: 'Reasoning Flow',
          content: thoughtText.trim(),
        },
      ]
    }

    const result: ReasoningPhase[] = []
    const icons = ['🧠', '🔬', '⚡', '📐', '🎯', '✅']
    const labels = [
      'Problem Formulation & Intent',
      'Architectural Analysis',
      'Execution Strategy',
      'Constraint Validation',
      'Synthesis & Verification',
    ]

    for (let i = 0; i < rawParagraphs.length; i++) {
      const p = rawParagraphs[i].trim()
      if (!p) continue
      const icon = icons[i % icons.length]
      const label = labels[i] || `Thinking Step ${i + 1}`
      result.push({
        id: `phase_${i}`,
        icon,
        label,
        content: p,
      })
    }
    return result
  }, [thoughtText])

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation()
    navigator.clipboard.writeText(thoughtText)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  if (!thoughtText.trim()) return null

  return (
    <div className={`thought-trail-card ${expanded ? 'expanded' : 'collapsed'}`}>
      <div className="thought-trail-header" onClick={() => setExpanded(!expanded)}>
        <div className="thought-trail-left">
          <img
            src={isStreaming ? '/icons/icon-lightning.png' : '/icons/icon-brain.png'}
            alt="Thought"
            className="thought-trail-icon-img"
          />
          <span className="thought-trail-title">
            {isStreaming ? 'Thinking in progress…' : 'Deep Thinking Trail'}
          </span>
          <span className="thought-trail-badge">
            {tokenCount} tokens
          </span>
          {phases.length > 1 && (
            <span className="thought-trail-phases-count">
              {phases.length} phases
            </span>
          )}
        </div>

        <div className="thought-trail-right" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className="thought-copy-btn"
            onClick={handleCopy}
            title="Copy full reasoning text"
          >
            {copied ? '✔ Copied' : 'Copy Trace'}
          </button>
          <button
            type="button"
            className="thought-toggle-btn"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? '▲ Collapse' : '▼ Expand'}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="thought-trail-body">
          {phases.map((phase, idx) => (
            <div key={phase.id} className="thought-phase-item">
              <div className="thought-phase-header">
                <span className="phase-icon">{phase.icon}</span>
                <span className="phase-step-num">Step {idx + 1}</span>
                <span className="phase-label">{phase.label}</span>
              </div>
              <div className="thought-phase-content">{phase.content}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
