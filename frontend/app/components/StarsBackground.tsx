"use client"

import * as React from "react"
import { motion, useMotionValue, useSpring, useTransform, type MotionValue, type SpringOptions } from "framer-motion"

// Shared orbital pivot — stars rotate around (50vw, -PIVOT_TOP_VH vh)
// Matches BackgroundManager's prior geometry so the arc mask still lines up.
const PIVOT_TOP_VH  = 150
const ORBIT_BASE_S  = 2400

// Stellar spectral classes — colors picked to roughly match real stars across
// temperature (O/B = hot blue → M = cool red). Weighted so white/neutral still
// dominate but warm and cool tints are clearly visible in the field.
const COLORS = [
  // White (A class, hottest visible)
  "#ffffff", "#ffffff", "#ffffff",
  // Blue-white (B/A) — pale ice
  "#eef2ff", "#dfe7ff",
  // Hot blue (O/B) — sapphire
  "#b8c8ff", "#9bb0ff",
  // Cool blue edge
  "#c6d4ff",
  // Cyan-white
  "#d6ecff",
  // Yellow-white (F class)
  "#fff7d6", "#fff0b8",
  // Yellow (G class — sun-like)
  "#ffd98a", "#ffcf6f",
  // Peach / pale orange
  "#ffe4c8", "#ffc79a",
  // Orange (K class)
  "#ffa96e", "#ff9458",
  // Red (M class, coolest)
  "#ff7a5a", "#e66a48",
]

function xorshift(seed: number) {
  let s = (seed >>> 0) || 1
  return () => { s ^= s << 13; s ^= s >> 17; s ^= s << 5; return (s >>> 0) / 0x100000000 }
}

type LayerConfig = {
  count:    number
  minDist:  number   // vh from pivot
  maxDist:  number
  minSize:  number   // px
  maxSize:  number
  minOp:    number
  maxOp:    number
  durScale: number   // ORBIT_BASE_S multiplier — different speeds = parallax
  parallax: number   // mouse-parallax multiplier (bigger = "closer" = moves more)
  seed:     number
}

// Four layers — "inner" closest to pivot (tight arc near zenith),
// "outer" farthest (broad arc low in sky). Outer layers rotate slower =
// parallax depth. Each layer is one DOM node with box-shadow stars.
const LAYERS: LayerConfig[] = [
  { count: 1500, minDist: 140, maxDist: 165, minSize: 0.7, maxSize: 1.8, minOp: 0.42, maxOp: 0.78, durScale: 0.70, parallax: 0.20, seed: 31337 },
  { count: 1100, minDist: 164, maxDist: 188, minSize: 1.1, maxSize: 2.8, minOp: 0.52, maxOp: 0.88, durScale: 1.50, parallax: 0.50, seed: 17163 },
  { count:  700, minDist: 186, maxDist: 206, minSize: 1.6, maxSize: 4.0, minOp: 0.62, maxOp: 0.96, durScale: 3.20, parallax: 1.05, seed: 90210 },
  { count:  350, minDist: 204, maxDist: 222, minSize: 2.2, maxSize: 5.8, minOp: 0.72, maxOp: 1.00, durScale: 5.50, parallax: 1.80, seed: 48271 },
]

function opacityToHex(op: number) {
  const clamped = Math.max(0, Math.min(1, op))
  return Math.floor(clamped * 255).toString(16).padStart(2, "0")
}

// Each star = two box-shadows painted on the same 1px parent:
//   1. Core — crisp, near-opaque pin-point (makes it read as a point of light)
//   2. Halo — soft blurred glow behind it (makes it read as luminous)
// Core shadow is listed FIRST so it renders ON TOP of the halo.
// Config `op` controls the HALO brightness; the core stays bright so
// every star has a visible center regardless of halo tuning.
function generateRingShadow(cfg: LayerConfig, vhPx: number) {
  const rng = xorshift(cfg.seed)
  const parts: string[] = []
  for (let i = 0; i < cfg.count; i++) {
    const angle  = rng() * Math.PI * 2
    const dist   = cfg.minDist + rng() * (cfg.maxDist - cfg.minDist)
    const x      = Math.cos(angle) * dist * vhPx
    const y      = Math.sin(angle) * dist * vhPx
    const size   = cfg.minSize + rng() * (cfg.maxSize - cfg.minSize)
    const haloOp = cfg.minOp   + rng() * (cfg.maxOp  - cfg.minOp)
    const baseCol = COLORS[Math.floor(rng() * COLORS.length)]

    // Core: random 30–65% of full size, no blur, 95% opacity → sharp bright pin.
    // The varied ratio makes some stars read as tight points, others as diffuse/
    // soft — avoids the "all stars look identical" feel.
    const coreRatio  = 0.30 + rng() * 0.35
    const coreSize   = Math.max(0.8, size * coreRatio)
    const coreSpread = (coreSize - 1) / 2
    const coreCol    = baseCol + opacityToHex(0.95)

    // Halo: full size, heavy blur, configured opacity → soft glow
    const haloSpread = (size - 1) / 2
    const haloBlur   = size * 2.4
    const haloCol    = baseCol + opacityToHex(haloOp)

    const xs = x.toFixed(0), ys = y.toFixed(0)
    parts.push(
      `${xs}px ${ys}px 0 ${coreSpread.toFixed(2)}px ${coreCol}`,
      `${xs}px ${ys}px ${haloBlur.toFixed(2)}px ${haloSpread.toFixed(2)}px ${haloCol}`,
    )
  }
  return parts.join(", ")
}

function StarLayer({
  cfg,
  parallaxX,
  parallaxY,
}: {
  cfg:       LayerConfig
  parallaxX: MotionValue<number>
  parallaxY: MotionValue<number>
}) {
  const [shadow, setShadow] = React.useState<string>("")
  const x = useTransform(parallaxX, v => v * cfg.parallax)
  const y = useTransform(parallaxY, v => v * cfg.parallax)

  React.useEffect(() => {
    function regen() {
      const vhPx = window.innerHeight / 100
      setShadow(generateRingShadow(cfg, vhPx))
    }
    regen()
    window.addEventListener("resize", regen)
    return () => window.removeEventListener("resize", regen)
  }, [cfg])

  // Outer = per-layer mouse parallax; inner = rotation.
  // Separating them keeps the rotation transform-origin correct (the pivot)
  // regardless of mouse offset.
  return (
    <motion.div style={{ position: "absolute", inset: 0, x, y, pointerEvents: "none" }}>
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ repeat: Infinity, duration: cfg.durScale * ORBIT_BASE_S, ease: "linear" }}
        style={{
          position:   "absolute",
          left:       "50vw",
          top:        `-${PIVOT_TOP_VH}vh`,
          width:      0,
          height:     0,
          willChange: "transform",
        }}
      >
        <div style={{
          width:        "1px",
          height:       "1px",
          borderRadius: "50%",
          boxShadow:    shadow,
        }} />
      </motion.div>
    </motion.div>
  )
}

export type StarMode = "full" | "sparse" | "none"

type Props = {
  mode:    StarMode
  factor?: number
  spring?: SpringOptions
}

export function StarsBackground({
  mode,
  factor = 0.020,
  // Softer spring = slower, floatier mouse follow-through.
  spring = { stiffness: 18, damping: 22 },
}: Props) {
  const offsetX = useMotionValue(0)
  const offsetY = useMotionValue(0)
  const springX = useSpring(offsetX, spring)
  const springY = useSpring(offsetY, spring)

  // Mouse parallax via window listener — the star wrapper is pointer-events-none,
  // so we can't use onMouseMove on the element itself.
  React.useEffect(() => {
    if (mode === "none") return
    function onMove(e: MouseEvent) {
      const cx = window.innerWidth  / 2
      const cy = window.innerHeight / 2
      offsetX.set(-(e.clientX - cx) * factor)
      offsetY.set(-(e.clientY - cy) * factor)
    }
    window.addEventListener("mousemove", onMove)
    return () => window.removeEventListener("mousemove", onMove)
  }, [mode, factor, offsetX, offsetY])

  if (mode === "none") return null

  // sparse = innermost layer only (tight arc near zenith, matches prior behaviour)
  const layers = mode === "sparse" ? LAYERS.slice(0, 1) : LAYERS

  return (
    <div style={{
      position:      "absolute",
      inset:         0,
      opacity:       mode === "sparse" ? 0.55 : 1,
      pointerEvents: "none",
    }}>
      {layers.map((cfg, i) => (
        <StarLayer key={i} cfg={cfg} parallaxX={springX} parallaxY={springY} />
      ))}
    </div>
  )
}
