/** Lumen glow icons from Figma (node 2:2). Root width/height come from each SVG asset. */
export const LUMEN_ICON_DIMS = {
  home: { width: 47.8, height: 47.8 },
  search: { width: 47.4, height: 47.4 },
  bolt: { width: 43.4, height: 48.8001 },
  heart: { width: 45.8, height: 46.8 },
  bell: { width: 43.8, height: 46.5 },
  user: { width: 44.8001, height: 47.8001 },
  spark: { width: 47.3, height: 48.8 },
  shield: { width: 43.8, height: 48.3 },
} as const

export type LumenIconName = keyof typeof LUMEN_ICON_DIMS

export interface LumenIconProps {
  name: LumenIconName
  /** Accessible label; omit when parent button already has aria-label/title */
  alt?: string
  className?: string
}

/**
 * Renders a downloaded Figma SVG via img. Native root width/height are preserved on the
 * image element; wrappers may scale visually without overriding those attributes.
 */
export function LumenIcon({ name, alt = '', className }: LumenIconProps) {
  const { width, height } = LUMEN_ICON_DIMS[name]
  return (
    <span className={`lumen-icon${className ? ` ${className}` : ''}`} aria-hidden={alt ? undefined : true}>
      <img
        src={`/icons/lumen/${name}.svg`}
        alt={alt}
        width={width}
        height={height}
        draggable={false}
      />
    </span>
  )
}
