import React, { useEffect, useRef } from 'react'
import type { AbliterationLevel } from '../lib/abliterationLevel'
import { MOOD_PALETTES, type Mood, type RgbTriplet } from '../lib/rainMood'

export interface PerspectiveLaserFieldProps {
  /** Abliteration / uncensored filter level (0: Locked -> 4: Void) */
  level: AbliterationLevel
  /** Accelerates laser velocity and pulse density during active streaming/agent execution */
  active?: boolean
  /** Conversation mood for color tinting */
  mood?: Mood
  className?: string
}

interface Point2D {
  x: number
  y: number
}

interface LineSegment {
  p0: Point2D
  p1: Point2D
  type: 'horizon' | 'ground_left' | 'ground_right' | 'ridge' | 'zenith' | 'tick'
}

interface LaserTracer {
  id: number
  alive: boolean
  segmentIndex: number
  progress: number // 0 to 1 along the segment
  speed: number
  lengthRatio: number // fractional length along line
  colorRgb: RgbTriplet
  alpha: number
  thickness: number
  forward: boolean
}

const MAX_TRACERS = 100

export const PerspectiveLaserField: React.FC<PerspectiveLaserFieldProps> = ({
  level,
  active = false,
  mood = 'focus',
  className = '',
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const levelRef = useRef<AbliterationLevel>(level)
  const activeRef = useRef<boolean>(active)
  const moodRef = useRef<Mood>(mood)

  useEffect(() => {
    levelRef.current = level
  }, [level])

  useEffect(() => {
    activeRef.current = active
  }, [active])

  useEffect(() => {
    moodRef.current = mood
  }, [mood])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d', { alpha: true })
    if (!ctx) return

    let animId: number
    let width = 0
    let height = 0
    let dpr = 1
    let isVisible = true

    // Check reduced motion preference
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    let prefersReduced = mediaQuery.matches

    const onMotionChange = (e: MediaQueryListEvent) => {
      prefersReduced = e.matches
    }
    mediaQuery.addEventListener('change', onMotionChange)

    // Pre-allocated object pool for tracers
    const tracers: LaserTracer[] = Array.from({ length: MAX_TRACERS }, (_, i) => ({
      id: i,
      alive: false,
      segmentIndex: 0,
      progress: 0,
      speed: 0.01,
      lengthRatio: 0.25,
      colorRgb: [34, 211, 238],
      alpha: 0.8,
      thickness: 1,
      forward: true,
    }))

    // Draughtsman sketch wireframe segments
    let segments: LineSegment[] = []
    let horizonY = 0

    // Per-level filtered segment-index pools for structured sweeping
    let horizonSegIdx: number[] = []
    let groundSegIdx: number[] = []
    let allSegIdx: number[] = []

    // Per-segment "constructed" progress (0→1) — beams leave persistent lines,
    // building the 3-point perspective landscape pattern progressively.
    let revealed: number[] = []

    // Slow-crawl timing + structured sweep cursor (persists across ticks)
    let lastTickTime = 0
    let spawnAccum = 0
    let sweepCursor = 0

    // Build the architectural draughtsman landscape geometry
    function buildDraftingSegments() {
      segments = []
      horizonY = height * 0.46

      // 1. Horizon Line
      segments.push({
        p0: { x: -40, y: horizonY },
        p1: { x: width + 40, y: horizonY },
        type: 'horizon',
      })

      // Horizon surveyor tick marks (every 60px)
      const tickSpacing = Math.max(50, width / 24)
      for (let x = tickSpacing; x < width; x += tickSpacing) {
        segments.push({
          p0: { x, y: horizonY - 4 },
          p1: { x, y: horizonY + 4 },
          type: 'tick',
        })
      }

      // Vanishing points in 3-point perspective
      const vpLeft: Point2D = { x: -width * 0.3, y: horizonY }
      const vpRight: Point2D = { x: width * 1.3, y: horizonY }
      const vpZenith: Point2D = { x: width * 0.5, y: -height * 0.9 }

      // 2. Ground Plane: Converging perspective lines from Left & Right Vanishing Points
      const numGroundRays = 14
      for (let i = 0; i <= numGroundRays; i++) {
        const bottomX = (width / numGroundRays) * i

        // From Left VP down to bottom edge
        segments.push({
          p0: vpLeft,
          p1: { x: bottomX, y: height + 20 },
          type: 'ground_left',
        })

        // From Right VP down to bottom edge
        segments.push({
          p0: vpRight,
          p1: { x: bottomX, y: height + 20 },
          type: 'ground_right',
        })
      }

      // Ground plane transversal distance rings (foreshortened horizontal lines)
      const numTransversals = 7
      for (let j = 1; j <= numTransversals; j++) {
        const factor = Math.pow(j / numTransversals, 2.2)
        const y = horizonY + (height - horizonY) * factor
        segments.push({
          p0: { x: 0, y },
          p1: { x: width, y },
          type: 'horizon',
        })
      }

      // 3. Draughtsman Topographical Landscape Silhouette (Mountain Ridges along horizon)
      // Generates angular, faceted landscape wireframe contours
      const ridgePointsBack: Point2D[] = [
        { x: -20, y: horizonY },
        { x: width * 0.08, y: horizonY - 24 },
        { x: width * 0.18, y: horizonY - 45 },
        { x: width * 0.28, y: horizonY - 18 },
        { x: width * 0.38, y: horizonY - 60 },
        { x: width * 0.50, y: horizonY - 30 },
        { x: width * 0.62, y: horizonY - 75 },
        { x: width * 0.74, y: horizonY - 35 },
        { x: width * 0.85, y: horizonY - 65 },
        { x: width * 0.94, y: horizonY - 28 },
        { x: width + 20, y: horizonY },
      ]

      for (let k = 0; k < ridgePointsBack.length - 1; k++) {
        segments.push({
          p0: ridgePointsBack[k],
          p1: ridgePointsBack[k + 1],
          type: 'ridge',
        })
        // Vertical surveyor plumb lines dropping from peaks to the horizon
        if (ridgePointsBack[k].y < horizonY - 20) {
          segments.push({
            p0: ridgePointsBack[k],
            p1: { x: ridgePointsBack[k].x, y: horizonY },
            type: 'tick',
          })
        }
      }

      // Foreground sharp faceted mountain ridge
      const ridgePointsFore: Point2D[] = [
        { x: width * 0.02, y: horizonY },
        { x: width * 0.12, y: horizonY - 35 },
        { x: width * 0.22, y: horizonY - 80 },
        { x: width * 0.32, y: horizonY - 40 },
        { x: width * 0.44, y: horizonY - 95 },
        { x: width * 0.58, y: horizonY - 48 },
        { x: width * 0.70, y: horizonY - 105 },
        { x: width * 0.82, y: horizonY - 52 },
        { x: width * 0.92, y: horizonY - 78 },
        { x: width * 0.98, y: horizonY },
      ]

      for (let k = 0; k < ridgePointsFore.length - 1; k++) {
        segments.push({
          p0: ridgePointsFore[k],
          p1: ridgePointsFore[k + 1],
          type: 'ridge',
        })
        // Faceted diagonal slope cross-lines (like CAD wireframe topography)
        segments.push({
          p0: ridgePointsFore[k],
          p1: { x: (ridgePointsFore[k].x + ridgePointsFore[k + 1].x) * 0.5, y: horizonY },
          type: 'ridge',
        })
      }

      // 4. Sky Zenith Rays (perspective lines rising to celestial zenith)
      const numZenithRays = 8
      for (let z = 0; z <= numZenithRays; z++) {
        const topX = (width / numZenithRays) * z
        segments.push({
          p0: vpZenith,
          p1: { x: topX, y: horizonY },
          type: 'zenith',
        })
      }

      // Rebuild filtered index pools for structured sweeping
      horizonSegIdx = []
      groundSegIdx = []
      allSegIdx = []
      revealed = new Array(segments.length).fill(0)
      for (let i = 0; i < segments.length; i++) {
        allSegIdx.push(i)
        if (segments[i].type !== 'zenith') groundSegIdx.push(i)
        if (segments[i].type === 'horizon' || segments[i].type === 'tick') horizonSegIdx.push(i)
      }
    }

    function resize() {
      if (!canvas) return
      width = window.innerWidth
      height = window.innerHeight
      const isMobile = width < 640
      dpr = Math.min(window.devicePixelRatio || 1, isMobile ? 1.5 : 2)
      canvas.width = Math.floor(width * dpr)
      canvas.height = Math.floor(height * dpr)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      ctx?.scale(dpr, dpr)
      buildDraftingSegments()
    }

    resize()
    window.addEventListener('resize', resize)

    const onVisibilityChange = () => {
      isVisible = document.visibilityState === 'visible'
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    function resolveLaserColor(curLevel: AbliterationLevel, curMood: Mood): RgbTriplet {
      if (curLevel === 4) {
        // Void / Overdrive: Electric Crimson & Hot Violet
        return Math.random() > 0.35 ? [244, 63, 94] : [192, 132, 252]
      }
      if (curLevel === 3) {
        // Raw: Vibrant Cyan & Radiant Violet
        return Math.random() > 0.45 ? [34, 211, 238] : [192, 132, 252]
      }
      if (curMood !== 'focus' && MOOD_PALETTES[curMood]) {
        const pal = MOOD_PALETTES[curMood]
        return Math.random() > 0.5 ? pal.spark : pal.trail
      }
      return Math.random() > 0.4 ? [34, 211, 238] : [0, 242, 254]
    }

    // Spawn a laser beam along a specific draughtsman segment (structured sweep)
    function spawnTracer(t: LaserTracer, curLevel: AbliterationLevel, segIdx: number) {
      if (curLevel === 0 || segments.length === 0) return

      t.segmentIndex = segIdx % segments.length
      t.progress = 0
      t.forward = true // always forward — beams crawl outward along the pattern

      // Per-second speeds (slow crawl):
      // LV1 ~12s to cross · LV2 ~7s · LV3 ~4.5s · LV4 ~3s
      const baseSpeed =
        curLevel === 1 ? 0.08 : curLevel === 2 ? 0.14 : curLevel === 3 ? 0.22 : 0.34
      const activeMult = activeRef.current ? 1.25 : 1.0
      t.speed = (baseSpeed + Math.random() * baseSpeed * 0.25) * activeMult

      // Longer beams so the crawl reads as a sustained tracer, not a flicker
      t.lengthRatio = curLevel === 1 ? 0.22 : curLevel === 2 ? 0.24 : curLevel === 3 ? 0.26 : 0.3
      t.colorRgb = resolveLaserColor(curLevel, moodRef.current)
      t.alpha = curLevel === 1 ? 0.5 : curLevel === 2 ? 0.68 : curLevel === 3 ? 0.86 : 0.98
      t.thickness = curLevel >= 4 ? 1.5 : curLevel >= 2 ? 1.1 : 0.9
      t.alive = true
    }

    function tick() {
      if (!isVisible) {
        animId = requestAnimationFrame(tick)
        return
      }

      ctx!.clearRect(0, 0, width, height)

      const curLevel = levelRef.current
      if (curLevel === 0 || prefersReduced) {
        animId = requestAnimationFrame(tick)
        return
      }


      // -------------------------------------------------------------
      // 1. RENDER CONSTRUCTED LANDSCAPE — beams draw the perspective
      //    pattern progressively; revealed portions persist + slow-decay.
      // -------------------------------------------------------------
      // dt for frame-rate-independent construction + crawl
      const now = performance.now()
      const dt = lastTickTime ? Math.min(0.05, (now - lastTickTime) / 1000) : 0.016
      lastTickTime = now

      const [tr, tg, tb] =
        curLevel === 4 ? [244, 63, 94] : curLevel === 3 ? [0, 242, 254] : [34, 211, 238]
      // Constructed-line brightness scales with level (the "drawn" shapes)
      const constructAlpha =
        curLevel === 1 ? 0.16 : curLevel === 2 ? 0.22 : curLevel === 3 ? 0.3 : 0.38
      // Slow decay so the landscape breathes — gets re-constructed over time
      const decayRate = 0.018

      ctx!.lineWidth = 0.9
      ctx!.strokeStyle = `rgba(${tr}, ${tg}, ${tb}, 1)`
      ctx!.lineCap = 'round'
      ctx!.beginPath()
      for (let s = 0; s < segments.length; s++) {
        const seg = segments[s]
        const rv = revealed[s]
        if (rv <= 0.001) continue
        // Decay (applied here so it advances every frame at dt cadence)
        revealed[s] = Math.max(0, rv - decayRate * dt)
        // Draw the constructed portion: p0 → p0 + revealed*(p1-p0)
        const ex = seg.p0.x + (seg.p1.x - seg.p0.x) * revealed[s]
        const ey = seg.p0.y + (seg.p1.y - seg.p0.y) * revealed[s]
        ctx!.moveTo(seg.p0.x, seg.p0.y)
        ctx!.lineTo(ex, ey)
      }
      // Per-segment alpha via globalAlpha (single stroke pass for perf)
      ctx!.globalAlpha = constructAlpha
      ctx!.stroke()
      ctx!.globalAlpha = 1

      // Draughtsman calibration crosshairs (faint guides)
      ctx!.strokeStyle = `rgba(${tr}, ${tg}, ${tb}, 0.09)`
      ctx!.lineWidth = 0.8
      const reticlePositions: Point2D[] = [
        { x: width * 0.06, y: horizonY },
        { x: width * 0.94, y: horizonY },
        { x: width * 0.12, y: height * 0.18 },
        { x: width * 0.88, y: height * 0.18 },
      ]
      for (const p of reticlePositions) {
        ctx!.beginPath()
        ctx!.moveTo(p.x - 7, p.y)
        ctx!.lineTo(p.x + 7, p.y)
        ctx!.moveTo(p.x, p.y - 7)
        ctx!.lineTo(p.x, p.y + 7)
        ctx!.stroke()
      }

      // Technical margin text annotation (draughtsman's title block)
      if (curLevel >= 2) {
        ctx!.font = '9px "JetBrains Mono", monospace'
        ctx!.fillStyle = `rgba(${tr}, ${tg}, ${tb}, 0.12)`
        ctx!.fillText(`// HORIZON ELEV +0.00 · VP-L (-30%) · VP-R (+130%)`, width * 0.03, horizonY - 8)
        ctx!.fillText(`DRAUGHTSMAN SURVEY · TOPOGRAPHY MESH`, width * 0.03, horizonY + 16)
        if (curLevel >= 3) {
          ctx!.fillText(`ABLIT LVL ${curLevel} · UNCONSTRAINED`, width - 210, horizonY - 8)
        }
      }

      // -------------------------------------------------------------
      // 2. SPAWN & UPDATE SLOW-CRAWLING LASER BEAMS (structured sweep)
      // -------------------------------------------------------------
      const isMobile = width < 640
      const mobileCap = isMobile ? (curLevel <= 1 ? 4 : curLevel === 2 ? 8 : 12) : 40
      const baseTarget = curLevel === 1 ? 5 : curLevel === 2 ? 12 : curLevel === 3 ? 24 : 40
      const targetCount = Math.min(mobileCap, baseTarget)
      const activeMult = activeRef.current ? 1.25 : 1.0
      const maxActive = Math.min(MAX_TRACERS, Math.floor(targetCount * activeMult))

      let aliveCount = 0
      for (let i = 0; i < tracers.length; i++) {
        if (tracers[i].alive) aliveCount++
      }

      // Structured sweep: spawn at a steady cadence, cycling through the
      // level-appropriate segment pool in order so beams trace the pattern
      // systematically (left→right, outward) rather than chaotically.
      const spawnInterval =
        curLevel === 1 ? 900 : curLevel === 2 ? 480 : curLevel === 3 ? 280 : 160
      spawnAccum += dt * 1000
      if (spawnAccum > spawnInterval * 2) spawnAccum = spawnInterval
      const pool =
        curLevel === 1 ? horizonSegIdx : curLevel === 2 ? groundSegIdx : allSegIdx
      if (aliveCount < maxActive && spawnAccum >= spawnInterval && pool.length > 0) {
        spawnAccum = 0
        const segIdx = pool[sweepCursor % pool.length]
        sweepCursor++
        for (let i = 0; i < tracers.length; i++) {
          if (!tracers[i].alive) {
            spawnTracer(tracers[i], curLevel, segIdx)
            break
          }
        }
      }

      // Center chat column attenuation zone (width 780px centered)
      const centerMinX = width * 0.5 - 390
      const centerMaxX = width * 0.5 + 390

      // Render laser tracers
      for (let i = 0; i < tracers.length; i++) {
        const t = tracers[i]
        if (!t.alive) continue

        const seg = segments[t.segmentIndex]
        if (!seg) {
          t.alive = false
          continue
        }

        // dt-based crawl (was per-frame — now frame-rate independent + slow)
        t.progress += t.speed * dt
        if (t.progress >= 1.0) {
          // Beam reached the end — fully construct this segment
          revealed[t.segmentIndex] = 1
          t.alive = false
          continue
        }

        const headProg = t.forward ? t.progress : 1.0 - t.progress

        // Beam constructs the line behind its head — advance revealed progress
        if (headProg > revealed[t.segmentIndex]) {
          revealed[t.segmentIndex] = headProg
        }

        const tailProg = t.forward
          ? Math.max(0, t.progress - t.lengthRatio)
          : Math.min(1.0, 1.0 - t.progress + t.lengthRatio)

        const hx = seg.p0.x + (seg.p1.x - seg.p0.x) * headProg
        const hy = seg.p0.y + (seg.p1.y - seg.p0.y) * headProg

        const tx = seg.p0.x + (seg.p1.x - seg.p0.x) * tailProg
        const ty = seg.p0.y + (seg.p1.y - seg.p0.y) * tailProg

        // Readability Guard: Soften inside central chat column
        let readability = 1.0
        if (hx >= centerMinX && hx <= centerMaxX) {
          readability = 0.32
        }

        const [cr, cg, cb] = t.colorRgb
        const finalAlpha = t.alpha * readability

        // Draw laser trail gradient along the draughtsman line
        const grad = ctx!.createLinearGradient(tx, ty, hx, hy)
        grad.addColorStop(0, `rgba(${cr}, ${cg}, ${cb}, 0)`)
        grad.addColorStop(0.75, `rgba(${cr}, ${cg}, ${cb}, ${finalAlpha * 0.65})`)
        grad.addColorStop(1, `rgba(255, 255, 255, ${finalAlpha * 0.95})`)

        ctx!.strokeStyle = grad
        ctx!.lineWidth = t.thickness
        ctx!.lineCap = 'round'

        ctx!.beginPath()
        ctx!.moveTo(tx, ty)
        ctx!.lineTo(hx, hy)
        ctx!.stroke()

        // Draw bright photon head
        if (finalAlpha > 0.15) {
          ctx!.fillStyle = `rgba(255, 255, 255, ${finalAlpha})`
          ctx!.beginPath()
          ctx!.arc(hx, hy, t.thickness * 1.3, 0, Math.PI * 2)
          ctx!.fill()

          // Subtle neon glow halo on high levels
          if (curLevel >= 3) {
            ctx!.fillStyle = `rgba(${cr}, ${cg}, ${cb}, ${finalAlpha * 0.35})`
            ctx!.beginPath()
            ctx!.arc(hx, hy, t.thickness * 3.6, 0, Math.PI * 2)
            ctx!.fill()
          }
        }
      }

      animId = requestAnimationFrame(tick)
    }

    animId = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(animId)
      window.removeEventListener('resize', resize)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      mediaQuery.removeEventListener('change', onMotionChange)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className={`perspective-laser-canvas ${className}`}
      aria-hidden="true"
    />
  )
}
