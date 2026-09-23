import React, { useState } from 'react'
import type { HeatmapSegment } from '../../lib/commandSpaceEngine'

export interface TerminalHeatmapProps {
  segments: HeatmapSegment[]
  totalLines: number
  onJumpToLine: (lineIndex: number) => void
  currentScrollLine?: number
}

export const TerminalHeatmap: React.FC<TerminalHeatmapProps> = ({
  segments,
  totalLines,
  onJumpToLine,
  currentScrollLine = 0,
}) => {
  const [hoveredSegment, setHoveredSegment] = useState<HeatmapSegment | null>(null)
  const [hoverPos, setHoverPos] = useState<{ y: number; text: string } | null>(null)

  if (totalLines <= 1 || segments.length === 0) {
    return <div className="terminal-heatmap-track empty" title="No diagnostic events" />
  }

  const handleTrackClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const clickY = e.clientY - rect.top
    const ratio = Math.max(0, Math.min(1, clickY / rect.height))
    const targetLine = Math.floor(ratio * totalLines)
    onJumpToLine(targetLine)
  }

  return (
    <div
      className="terminal-heatmap-track"
      onClick={handleTrackClick}
      title="Terminal Heatmap — Click red markers to jump directly to error/traceback"
    >
      {/* Visual Scroll Position Indicator */}
      {totalLines > 0 && (
        <div
          className="terminal-heatmap-thumb"
          style={{
            top: `${Math.min(100, Math.max(0, (currentScrollLine / totalLines) * 100))}%`,
          }}
        />
      )}

      {/* Error & Event Stripes */}
      {segments.map((seg, idx) => {
        const topPct = Math.min(99, Math.max(0, (seg.lineIndex / totalLines) * 100))
        const isError = seg.type === 'error' || seg.type === 'traceback'

        return (
          <div
            key={`${seg.lineIndex}_${idx}`}
            className={`terminal-heatmap-marker marker-${seg.type} ${isError ? 'pulse-glow' : ''}`}
            style={{
              top: `${topPct}%`,
            }}
            onClick={(e) => {
              e.stopPropagation()
              onJumpToLine(seg.lineIndex)
            }}
            onMouseEnter={(e) => {
              const rect = e.currentTarget.getBoundingClientRect()
              setHoveredSegment(seg)
              setHoverPos({ y: rect.top, text: seg.label })
            }}
            onMouseLeave={() => {
              setHoveredSegment(null)
              setHoverPos(null)
            }}
          />
        )
      })}

      {/* Floating Hover Tooltip */}
      {hoverPos && (
        <div
          className="terminal-heatmap-tooltip"
          style={{
            top: hoverPos.y,
            right: 22,
          }}
        >
          <span className="tooltip-tag">
            {hoveredSegment?.type === 'error' ? '✖ ERROR' : hoveredSegment?.type === 'traceback' ? '⚠ TRACEBACK' : '● EVENT'}
          </span>
          <span className="tooltip-text">{hoverPos.text}</span>
        </div>
      )}
    </div>
  )
}
