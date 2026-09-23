import React from 'react'

export interface AiuiLogoProps {
  className?: string
  width?: number | string
  height?: number | string
  showEcho?: boolean
}

/**
 * Geometric Tri-Tone AIUI Logo based on official brand art:
 * - 'A' and 'I' in Electric Cyan (#00F0FF) with double echo lines
 * - 'U' in Neon Violet (#A855F7) with double echo lines
 * - 'I' in Hot Coral (#FF3366) with double echo lines
 * - Background matte charcoal (#121214)
 */
export const AiuiLogoSvg: React.FC<AiuiLogoProps> = ({
  className = '',
  width = 64,
  height = 32,
  showEcho = true,
}) => {
  return (
    <svg
      viewBox="0 0 190 92"
      width={width}
      height={height}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`aiui-brand-svg ${className}`}
      style={{ verticalAlign: 'middle', flexShrink: 0 }}
      aria-label="AIUI Brand Logo"
    >
      {/* Echo Outlines (Back layer: double concentric offset lines) */}
      {showEcho && (
        <g className="aiui-echo-layer" opacity="0.9">
          {/* Echo 2 (Deepest offset) */}
          <g className="aiui-echo-deep" strokeWidth="1.8" fill="none">
            {/* 'A' Outer/Inner Echo 2 */}
            <path
              d="M 28 84 H 17 V 30 H 22 V 19 H 58 V 84 H 47"
              stroke="#00F0FF"
            />
            <path
              d="M 28 47 H 47 V 30 H 28 Z"
              stroke="#00F0FF"
            />
            {/* 'I1' Echo 2 */}
            <rect x="74" y="27" width="13" height="57" stroke="#00F0FF" />
            {/* 'U' Echo 2 */}
            <path
              d="M 103 27 V 73 H 142 V 27"
              stroke="#A855F7"
            />
            {/* 'I2' Echo 2 */}
            <rect x="162" y="27" width="13" height="57" stroke="#FF3366" />
          </g>

          {/* Echo 1 (Mid offset) */}
          <g className="aiui-echo-mid" strokeWidth="1.8" fill="none">
            {/* 'A' Outer/Inner Echo 1 */}
            <path
              d="M 25 81 H 19 V 28 H 23 V 17 H 56 V 81 H 49"
              stroke="#00F0FF"
            />
            <path
              d="M 28 44 H 47 V 27 H 28 Z"
              stroke="#00F0FF"
            />
            {/* 'I1' Echo 1 */}
            <rect x="72" y="24" width="13" height="57" stroke="#00F0FF" />
            {/* 'U' Echo 1 */}
            <path
              d="M 101 24 V 70 H 140 V 24"
              stroke="#A855F7"
            />
            {/* 'I2' Echo 1 */}
            <rect x="160" y="24" width="13" height="57" stroke="#FF3366" />
          </g>
        </g>
      )}

      {/* Front Solid Geometric Glyphs */}
      <g className="aiui-solid-glyphs">
        {/* Letter 'A' (Cyan) */}
        <path
          d="M 21 14 H 54 V 77 H 42 V 48 H 32 V 77 H 21 V 26 H 15 V 14 Z M 32 24 V 37 H 42 V 24 H 32 Z"
          fill="#00F0FF"
        />

        {/* Letter 'I' (Cyan) */}
        <rect x="69" y="14" width="12" height="63" fill="#00F0FF" />

        {/* Letter 'U' (Neon Violet) */}
        <path
          d="M 98 14 H 110 V 55 H 126 V 14 H 138 V 67 H 104 V 61 H 98 V 14 Z"
          fill="#A855F7"
        />

        {/* Letter 'I' (Hot Coral / Ruby) */}
        <rect x="157" y="14" width="12" height="63" fill="#FF3366" />
      </g>
    </svg>
  )
}

export const AiuiBrandTitle: React.FC<{ compact?: boolean }> = ({ compact }) => {
  return (
    <div className="aiui-brand-header-item">
      <AiuiLogoSvg width={compact ? 44 : 52} height={compact ? 22 : 26} />
      <span className="brand-name">
        <span className="boldface-em">Studio</span>
      </span>
    </div>
  )
}
