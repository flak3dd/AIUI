import { useEffect, useRef } from 'react'
import { SATELLITE_ASTRONAUT_ASCII } from '../lib/asciiArtData'
import { resolvePalette, type Mood, type RgbTriplet } from '../lib/rainMood'

export interface AsciiMatrixBackgroundProps {
  opacity?: number
  fontSize?: number
  fps?: number
  className?: string
  showHologram?: boolean
  /** When true (agent busy), rain brightens, accent sparks increase, pulse accelerates. */
  active?: boolean
  /** Conversation mood — shifts head/spark/trail colors. Defaults to 'focus' (theme tokens). */
  mood?: Mood
}

const ASCII_CHARS =
  '01アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン0123456789ABCDEF+-*/=<>[]{}~^:;|._λΩ'

interface HologramPoint {
  char: string
  r: number
  c: number
  weight: 1 | 2 | 3
}

const TOTAL_ROWS = SATELLITE_ASTRONAUT_ASCII.length
const TOTAL_COLS = Math.max(...SATELLITE_ASTRONAUT_ASCII.map((l) => l.length))
const HOLOGRAM_POINTS: HologramPoint[] = []

for (let r = 0; r < SATELLITE_ASTRONAUT_ASCII.length; r++) {
  const line = SATELLITE_ASTRONAUT_ASCII[r]
  for (let c = 0; c < line.length; c++) {
    const ch = line[c]
    if (ch !== ' ') {
      let weight: 1 | 2 | 3 = 1
      if ('@#W89$'.includes(ch)) {
        weight = 3
      } else if ('01234567abcdef?!'.includes(ch)) {
        weight = 2
      }
      HOLOGRAM_POINTS.push({ char: ch, r, c, weight })
    }
  }
}

function readThemeRgb(): {
  canvas: string
  accent: string
  accent2: string
  text: string
} {
  if (typeof window === 'undefined') {
    // Boldface cocoa fallbacks
    return { canvas: '34, 21, 15', accent: '239, 91, 53', accent2: '243, 195, 181', text: '246, 237, 226' }
  }
  const styles = getComputedStyle(document.documentElement)
  const get = (name: string, fallback: string): string => {
    const v = styles.getPropertyValue(name).trim()
    return v || fallback
  }
  return {
    canvas: get('--canvas-rgb', '34, 21, 15'),
    accent: get('--accent-rgb', '239, 91, 53'),
    accent2: get('--accent-2-rgb', '243, 195, 181'),
    text: get('--text-rgb', '246, 237, 226'),
  }
}

function pickChar(): string {
  return ASCII_CHARS[Math.floor(Math.random() * ASCII_CHARS.length)]
}

export const AsciiMatrixBackground: React.FC<AsciiMatrixBackgroundProps> = ({
  opacity = 0.32,
  fontSize = 13,
  fps = 22,
  className = '',
  showHologram = true,
  active = false,
  mood = 'focus',
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const activeRef = useRef(active)
  const moodRef = useRef<Mood>(mood)

  const lerpRef = useRef<{ head: RgbTriplet; spark: RgbTriplet; trail: RgbTriplet }>({
    head: [246, 237, 226],
    spark: [239, 91, 53],
    trail: [243, 195, 181],
  })

  useEffect(() => {
    activeRef.current = active
  }, [active])
  useEffect(() => {
    moodRef.current = mood
  }, [mood])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const reduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduceMotion) {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      return
    }

    let animationFrameId: number
    let lastDraw = 0
    let lastFrameTime = 0
    const frameInterval = 1000 / Math.min(Math.max(fps, 12), 28)
    let pageVisible = document.visibilityState !== 'hidden'
    const onVis = () => {
      pageVisible = document.visibilityState !== 'hidden'
    }
    document.addEventListener('visibilitychange', onVis)

    let themeCache: ReturnType<typeof readThemeRgb> | null = null
    let themeCacheTs = 0

    // Near (foreground) + far (background) layers
    let nearDrops: number[] = []
    let nearSpeeds: number[] = []
    let nearTrail: string[][] = []
    let farDrops: number[] = []
    let farSpeeds: number[] = []

    let offscreenHolo: HTMLCanvasElement | null = null
    let holoStartX = 0
    let holoStartY = 0
    let holoWidth = 0
    let holoHeight = 0

    const buildHologramBuffer = (width: number, height: number, dpr: number) => {
      if (!showHologram) {
        offscreenHolo = null
        return
      }

      const maxHoloHeight = height * 0.72
      const maxHoloWidth = width * 0.86
      const charHByH = maxHoloHeight / TOTAL_ROWS
      const charHByW = maxHoloWidth / TOTAL_COLS / 0.58
      const holoCharHeight = Math.max(5, Math.min(10.5, Math.floor(Math.min(charHByH, charHByW))))
      const holoCharWidth = holoCharHeight * 0.58
      holoWidth = Math.ceil(TOTAL_COLS * holoCharWidth)
      holoHeight = Math.ceil(TOTAL_ROWS * holoCharHeight)
      holoStartX = Math.floor((width - holoWidth) / 2)
      holoStartY = Math.floor((height - holoHeight) / 2)

      const offCanvas = document.createElement('canvas')
      offCanvas.width = Math.ceil(holoWidth * dpr)
      offCanvas.height = Math.ceil(holoHeight * dpr)

      const offCtx = offCanvas.getContext('2d')
      if (!offCtx) return
      offCtx.scale(dpr, dpr)
      offCtx.font = `${Math.floor(holoCharHeight)}px "JetBrains Mono", "Fira Code", monospace`

      const theme = readThemeRgb()

      for (let i = 0; i < HOLOGRAM_POINTS.length; i++) {
        const pt = HOLOGRAM_POINTS[i]
        const px = pt.c * holoCharWidth
        const py = pt.r * holoCharHeight

        if (pt.weight === 3) {
          offCtx.fillStyle = `rgb(${theme.accent})`
        } else if (pt.weight === 2) {
          offCtx.fillStyle = `rgb(${theme.accent2})`
        } else {
          offCtx.fillStyle = `rgba(${theme.text}, 0.85)`
        }

        offCtx.fillText(pt.char, px, py)
      }

      offscreenHolo = offCanvas
    }

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
      const width = window.innerWidth
      const height = window.innerHeight

      canvas.width = Math.floor(width * dpr)
      canvas.height = Math.floor(height * dpr)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`

      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.scale(dpr, dpr)

      const nearColW = fontSize * 1.05
      const nearCols = Math.ceil(width / nearColW)
      nearDrops = new Array(nearCols).fill(0).map(() => Math.floor(Math.random() * -80))
      nearSpeeds = new Array(nearCols).fill(0).map(() => 0.65 + Math.random() * 0.9)
      nearTrail = new Array(nearCols).fill(0).map(() => Array.from({ length: 10 }, () => pickChar()))

      const farColW = fontSize * 1.55
      const farCols = Math.ceil(width / farColW)
      farDrops = new Array(farCols).fill(0).map(() => Math.floor(Math.random() * -100))
      farSpeeds = new Array(farCols).fill(0).map(() => 0.25 + Math.random() * 0.45)

      buildHologramBuffer(width, height, dpr)
    }

    resize()
    window.addEventListener('resize', resize)

    const draw = (currentTime: number) => {
      animationFrameId = requestAnimationFrame(draw)
      if (!pageVisible) return

      if (currentTime - lastDraw < frameInterval) {
        return
      }
      lastDraw = currentTime

      const width = window.innerWidth
      const height = window.innerHeight
      const isActive = activeRef.current

      if (!themeCache || currentTime - themeCacheTs > 1000) {
        themeCache = readThemeRgb()
        themeCacheTs = currentTime
      }
      const theme = themeCache

      const dt = Math.min(0.1, (currentTime - lastFrameTime) / 1000)
      lastFrameTime = currentTime
      const lerpFactor = 1 - Math.exp(-3.0 * dt)
      const target = resolvePalette(moodRef.current, theme)
      const lp = lerpRef.current
      for (let ch = 0; ch < 3; ch++) {
        lp.head[ch] += (target.head[ch] - lp.head[ch]) * lerpFactor
        lp.spark[ch] += (target.spark[ch] - lp.spark[ch]) * lerpFactor
        lp.trail[ch] += (target.trail[ch] - lp.trail[ch]) * lerpFactor
      }
      const headRgb = `${Math.round(lp.head[0])}, ${Math.round(lp.head[1])}, ${Math.round(lp.head[2])}`
      const sparkRgb = `${Math.round(lp.spark[0])}, ${Math.round(lp.spark[1])}, ${Math.round(lp.spark[2])}`
      const trailRgb = `${Math.round(lp.trail[0])}, ${Math.round(lp.trail[1])}, ${Math.round(lp.trail[2])}`

      // Trail wash — longer comets when active
      ctx.fillStyle = `rgba(${theme.canvas}, ${isActive ? 0.08 : 0.12})`
      ctx.fillRect(0, 0, width, height)

      // Soft vignette: keep center chat readable, rain denser at edges
      const vig = ctx.createRadialGradient(
        width * 0.5,
        height * 0.42,
        Math.min(width, height) * 0.12,
        width * 0.5,
        height * 0.45,
        Math.max(width, height) * 0.72,
      )
      vig.addColorStop(0, `rgba(${theme.canvas}, 0.55)`)
      vig.addColorStop(0.45, `rgba(${theme.canvas}, 0.18)`)
      vig.addColorStop(1, 'rgba(0, 0, 0, 0)')
      ctx.fillStyle = vig
      ctx.fillRect(0, 0, width, height)

      if (offscreenHolo && showHologram) {
        const pulse = 0.7 + 0.3 * Math.sin(currentTime * (isActive ? 0.004 : 0.0018))
        ctx.save()
        ctx.globalAlpha = pulse * 0.85
        ctx.drawImage(offscreenHolo, holoStartX, holoStartY, holoWidth, holoHeight)

        const scanline = (currentTime * (isActive ? 0.08 : 0.04)) % height
        if (scanline >= holoStartY && scanline <= holoStartY + holoHeight) {
          const scanGrad = ctx.createLinearGradient(0, scanline - 16, 0, scanline + 16)
          scanGrad.addColorStop(0, `rgba(${trailRgb}, 0)`)
          scanGrad.addColorStop(0.5, `rgba(${trailRgb}, ${isActive ? 0.2 : 0.12})`)
          scanGrad.addColorStop(1, `rgba(${trailRgb}, 0)`)
          ctx.fillStyle = scanGrad
          ctx.fillRect(holoStartX, scanline - 16, holoWidth, 32)
        }
        ctx.restore()
      }

      const farSize = Math.max(9, Math.floor(fontSize * 0.72))
      const nearSize = fontSize
      const farColW = farSize * 1.55
      const nearColW = nearSize * 1.05
      const trailLen = isActive ? 12 : 8

      // —— Far layer (dim, slow) ——
      ctx.font = `${farSize}px "JetBrains Mono", "Fira Code", monospace`
      for (let i = 0; i < farDrops.length; i++) {
        const x = i * farColW
        const y = farDrops[i] * farSize
        const spd = farSpeeds[i]
        ctx.fillStyle = `rgba(${trailRgb}, ${0.12 + spd * 0.2})`
        ctx.fillText(pickChar(), x, y)
        if (y > height && Math.random() > 0.97) {
          farDrops[i] = Math.floor(Math.random() * -40)
        }
        farDrops[i] += spd
      }

      // —— Near layer (comet trails + bright heads) ——
      ctx.font = `${nearSize}px "JetBrains Mono", "Fira Code", monospace`
      const headChance = isActive ? 0.62 : 0.7
      const sparkChance = isActive ? 0.34 : 0.22

      for (let i = 0; i < nearDrops.length; i++) {
        const x = i * nearColW
        const y = nearDrops[i] * nearSize
        const spd = nearSpeeds[i]
        const trail = nearTrail[i]

        // Shift comet buffer
        trail.pop()
        trail.unshift(pickChar())

        // Draw fading comet body behind the head
        const body = Math.min(trailLen, trail.length)
        for (let t = body - 1; t >= 1; t--) {
          const fade = 1 - t / body
          const alpha = (0.08 + fade * 0.35) * (0.55 + spd * 0.35)
          const ty = y - t * nearSize
          if (ty < -nearSize) continue
          ctx.fillStyle =
            t % 3 === 0
              ? `rgba(${sparkRgb}, ${alpha * 0.85})`
              : `rgba(${trailRgb}, ${alpha})`
          ctx.fillText(trail[t], x, ty)
        }

        // Head glyph
        const roll = Math.random()
        if (roll > headChance) {
          ctx.fillStyle = `rgba(${headRgb}, ${isActive ? 1 : 0.95})`
        } else if (roll > headChance - sparkChance) {
          ctx.fillStyle = `rgba(${sparkRgb}, ${0.72 + spd * 0.28})`
        } else {
          ctx.fillStyle = `rgba(${trailRgb}, ${0.4 + spd * 0.3})`
        }
        ctx.fillText(trail[0], x, y)

        // Occasional bright spark column tip
        if (isActive && Math.random() > 0.992) {
          ctx.fillStyle = `rgba(${sparkRgb}, 0.9)`
          ctx.fillText('✦', x, y)
        }

        if (y > height && Math.random() > (isActive ? 0.96 : 0.972)) {
          nearDrops[i] = Math.floor(Math.random() * -24)
          nearTrail[i] = Array.from({ length: 10 }, () => pickChar())
        }

        nearDrops[i] += spd * (isActive ? 1.15 : 1)
      }

      // Edge glow wash (accent bloom at sides)
      const edge = ctx.createLinearGradient(0, 0, width, 0)
      edge.addColorStop(0, `rgba(${sparkRgb}, ${isActive ? 0.07 : 0.04})`)
      edge.addColorStop(0.18, 'rgba(0,0,0,0)')
      edge.addColorStop(0.82, 'rgba(0,0,0,0)')
      edge.addColorStop(1, `rgba(${sparkRgb}, ${isActive ? 0.07 : 0.04})`)
      ctx.fillStyle = edge
      ctx.fillRect(0, 0, width, height)
    }

    animationFrameId = requestAnimationFrame(draw)

    return () => {
      document.removeEventListener('visibilitychange', onVis)
      cancelAnimationFrame(animationFrameId)
      window.removeEventListener('resize', resize)
    }
  }, [fontSize, fps, showHologram])

  return (
    <canvas
      ref={canvasRef}
      className={`ascii-matrix-canvas ${className}`.trim()}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        pointerEvents: 'none',
        zIndex: 0,
        opacity,
      }}
      aria-hidden="true"
    />
  )
}
