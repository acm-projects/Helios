"use client"
import { usePathname } from "next/navigation"
import { useState, useEffect, useRef, useCallback } from "react"

type StarMode = "full" | "sparse" | "none"

const PAGE_CONFIG: Record<string, { bg: string; overlay: string; stars: StarMode }> = {
  "/":         { bg: "/Background-Midnight(1).svg", overlay: "rgba(0,0,0,0.35)", stars: "full"   },
  "/auth":     { bg: "/Background-Midnight(1).svg", overlay: "rgba(0,0,0,0.40)", stars: "full"   },
  "/create":   { bg: "/Background-Dusk(2).svg",     overlay: "rgba(0,0,0,0.35)", stars: "sparse" },
  "/sandbox":  { bg: "/Background-Sunrise(3).svg",  overlay: "rgba(0,0,0,0.42)", stars: "none"   },
  "/verify":   { bg: "/Background-Midday(4).svg",   overlay: "rgba(0,0,0,0.45)", stars: "none"   },
  "/download": { bg: "/Background-Sunset(5).svg",   overlay: "rgba(0,0,0,0.25)", stars: "none"   },
}
const DEFAULT = PAGE_CONFIG["/"]

function getConfig(pathname: string) {
  const base = pathname.split("?")[0].replace(/\/$/, "") || "/"
  return PAGE_CONFIG[base] ?? DEFAULT
}

// ── Arc perimeter ───────────────────────────────────────────────────────────
const ARC_EDGE_Y   = 60
const ARC_CENTER_Y = 80
const _diff        = ARC_CENTER_Y - ARC_EDGE_Y
const ARC_CX       = 50
const ARC_R        = (_diff * _diff + 50 * 50) / (2 * _diff)
const ARC_CY       = ARC_CENTER_Y - ARC_R

const DEBUG_ARC          = false
const DEBUG_TRAJECTORIES = false

function arcYAt(x: number): number {
  const dx = x - ARC_CX
  const d  = ARC_R * ARC_R - dx * dx
  return d < 0 ? Infinity : ARC_CY + Math.sqrt(d)
}

// ── Shared orbital pivot ─────────────────────────────────────────────────────
// All stars orbit (50vw, -150vh) — like stars around a distant celestial pole.
// dist is in vh. Viewport-% position at angle θ (deg), distance D (vh):
//   x_pct = 50 + D·cos(θ) / ASPECT
//   y_pct = D·sin(θ) − PIVOT_TOP_VH
// CW rotation (normal CSS direction) → angle increases → stars drift right→left.
// SVG mask that clips shooting stars at the arc boundary.
// viewBox="0 0 100 100" + preserveAspectRatio="none" maps the 0-100 coordinate
// system onto the element's pixel size, so (ARC_CX, ARC_CY) and ARC_R match
// arcYAt() exactly — the radial gradient becomes an ellipse in screen space
// that follows the arc. Stars fade from fully visible at 93% of the radius
// to transparent at 100% (the arc line itself).
const _arcMaskSvg = [
  `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' preserveAspectRatio='none'>`,
  `<defs><radialGradient id='g' cx='${ARC_CX}' cy='${ARC_CY.toFixed(4)}' r='${ARC_R.toFixed(4)}' gradientUnits='userSpaceOnUse'>`,
  `<stop offset='93%' stop-color='white' stop-opacity='1'/>`,
  `<stop offset='100%' stop-color='white' stop-opacity='0'/>`,
  `</radialGradient></defs>`,
  `<rect width='100' height='100' fill='url(%23g)'/>`,
  `</svg>`,
].join("")
const SKY_MASK = `url("data:image/svg+xml,${_arcMaskSvg}")`

const PIVOT_TOP_VH = 150
const ASPECT       = 16 / 9   // assumed W:H for geometry
const MARGIN_PCT   = 4
const ORBIT_DUR    = 2400      // seconds — same for every star (Earth's rotation)

// ── Star pool ────────────────────────────────────────────────────────────────
function xorshift(seed: number) {
  let s = (seed >>> 0) || 1
  return () => { s ^= s << 13; s ^= s >> 17; s ^= s << 5; return (s >>> 0) / 0x100000000 }
}

const COLORS = [
  "#ffffff", "#ffffff", "#ffffff", "#ffffff", "#ffffff",
  "#eef2ff", "#eef2ff", "#eef2ff",
  "#c6d4ff", "#c6d4ff",
  "#d6ecff",
  "#fff7d6", "#fff7d6",
  "#ffd98a",
  "#ffe4c8",
]

const POOL_CONFIGS = [
  { count: 130, minDist: 153, maxDist: 168, minOp: 0.18, maxOp: 0.45, minSz: 1.0, maxSz: 2.2 },
  { count: 110, minDist: 167, maxDist: 185, minOp: 0.22, maxOp: 0.52, minSz: 1.4, maxSz: 3.2 },
  { count:  80, minDist: 184, maxDist: 200, minOp: 0.28, maxOp: 0.58, minSz: 1.8, maxSz: 4.2 },
  { count:  50, minDist: 198, maxDist: 216, minOp: 0.20, maxOp: 0.50, minSz: 2.4, maxSz: 5.5 },
] as const

interface PoolStar {
  key:        number   // changes on respawn → forces React remount
  id:         string
  dist:       number   // vh
  startDeg:   number   // angle at spawnedAt (deg)
  spawnedAt:  number   // ms timestamp
  opacity:    number
  size:       number
  color:      string
  pulse:      boolean
  pulseDur:   number
  pulseDelay: number
}

// Angle (deg) where a star at `dist` is just off the right screen edge (x ≈ 104%).
// CW motion means entry from right, exit to left.
function computeEntryAngle(dist: number): number {
  // Right edge: x = 104 → cos(θ) = (104-50)*ASPECT / dist
  const c = (54 * ASPECT) / dist
  if (c < 1) {
    const θ = Math.acos(c) * 180 / Math.PI
    const y = dist * Math.sin(θ * Math.PI / 180) - PIVOT_TOP_VH
    if (y > -10) return θ   // on-screen y — right-edge entry
  }
  // Star enters from top (y = -5%) — used for small dist (top-layer arcs)
  const s = (PIVOT_TOP_VH - 5) / dist
  return s <= 1 ? Math.asin(s) * 180 / Math.PI : 65
}

function buildStar(
  rng: () => number, li: number, si: number, keyVal: number,
  startDegOverride?: number,
): PoolStar {
  const cfg    = POOL_CONFIGS[li]
  const dist   = cfg.minDist + rng() * (cfg.maxDist - cfg.minDist)
  const ea     = computeEntryAngle(dist)
  const exitDeg = 180 - ea
  const startDeg = startDegOverride ?? (ea - 5 + (si / cfg.count) * (exitDeg - ea + 10))
  return {
    key:        keyVal,
    id:         `${li}-${si}`,
    dist,
    startDeg,
    spawnedAt:  Date.now(),
    opacity:    cfg.minOp + rng() * (cfg.maxOp - cfg.minOp),
    size:       cfg.minSz + rng() * (cfg.maxSz - cfg.minSz),
    color:      COLORS[Math.floor(rng() * COLORS.length)],
    pulse:      rng() > 0.65,
    pulseDur:   3 + rng() * 6,
    pulseDelay: rng() * 8,
  }
}

function useStarPool() {
  const keyRef      = useRef(10000)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const [stars, setStars] = useState<PoolStar[]>(() => {
    const rng = xorshift(31337)
    return POOL_CONFIGS.flatMap((_, li) =>
      Array.from({ length: POOL_CONFIGS[li].count }, (__, si) =>
        buildStar(rng, li, si, si + li * 1000)
      )
    )
  })

  useEffect(() => {
    const ORBIT_MS = ORBIT_DUR * 1000
    const GRACE_MS = 260_000

    function tick() {
      const now    = Date.now()
      // Use the real viewport aspect ratio — hardcoding 16:9 caused stars to be
      // incorrectly flagged as off-screen on non-standard displays.
      const aspect = window.innerWidth / window.innerHeight

      setStars(prev => prev.map(star => {
        const elapsed = now - star.spawnedAt
        if (elapsed < GRACE_MS) return star

        const deg = star.startDeg + (elapsed / ORBIT_MS) * 360
        const rad = deg * (Math.PI / 180)
        const x   = 50 + star.dist * Math.cos(rad) / aspect
        const y   = star.dist * Math.sin(rad) - PIVOT_TOP_VH

        // Safety: never despawn a star that is currently visible on screen.
        const onScreen = x >= -5 && x <= 105 && y >= -5 && y <= 105
        if (onScreen) return star

        // Only respawn once clearly outside the viewport with generous margins.
        if (x < -25 || x > 125 || y < -25 || y > 125) {
          const li   = parseInt(star.id.split("-")[0])
          const ea   = computeEntryAngle(star.dist)
          const rng2 = xorshift(now ^ (keyRef.current * 997))
          const newDeg = ea - 2 - rng2() * 15
          return {
            ...star,
            key:       ++keyRef.current,
            startDeg:  newDeg,
            spawnedAt: now,
            opacity:   POOL_CONFIGS[li].minOp + rng2() * (POOL_CONFIGS[li].maxOp - POOL_CONFIGS[li].minOp),
          }
        }
        return star
      }))
    }

    function startInterval() {
      intervalRef.current = setInterval(tick, 8000)
    }

    startInterval()

    let hiddenAt = 0
    function onVisibility() {
      if (document.hidden) {
        hiddenAt = Date.now()
        if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null }
      } else {
        // Shift all spawnedAt forward by the hidden duration so elapsed time
        // stays in sync with the CSS animation (which browsers pause on hidden tabs).
        const pausedMs = hiddenAt > 0 ? Date.now() - hiddenAt : 0
        hiddenAt = 0
        if (pausedMs > 0) setStars(prev => prev.map(s => ({ ...s, spawnedAt: s.spawnedAt + pausedMs })))
        startInterval()
      }
    }

    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [])

  return stars
}

// ── Shooting stars ────────────────────────────────────────────────────────────
interface ShootingStar {
  id: number; x: number; y: number; angle: number
  length: number; thick: number; dur: number; bright: boolean
}

function useShootingStars() {
  const [stars, setStars] = useState<ShootingStar[]>([])
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const spawnOne = useCallback(() => {
    const bright = Math.random() > 0.78
    setStars(prev => [...prev, {
      id:     Date.now() + Math.floor(Math.random() * 9999),
      x:      Math.random() * 100,
      y:      3 + Math.random() * 52,
      angle:  Math.random() * 360,
      length: bright ? 180 + Math.random() * 120 : 100 + Math.random() * 100,
      thick:  bright ? 1.2 : 0.7,
      dur:    bright ? 1.5 + Math.random() * 1.0 : 0.9 + Math.random() * 0.8,
      bright,
    }])
  }, [])

  const schedule = useCallback((initialDelay?: number) => {
    if (timerRef.current) clearTimeout(timerRef.current)
    const delay = initialDelay ?? (60000 + Math.random() * 540000)
    timerRef.current = setTimeout(() => {
      if (!document.hidden) spawnOne()
      schedule()
    }, delay)
  }, [spawnOne])

  useEffect(() => {
    schedule(15000 + Math.random() * 45000)

    function onVisibility() {
      if (document.hidden) {
        // Cancel pending spawn and clear any in-flight stars so nothing stacks up.
        if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
        setStars([])
      } else {
        schedule(10000 + Math.random() * 20000)
      }
    }

    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [schedule])

  const remove = useCallback((id: number) => setStars(prev => prev.filter(s => s.id !== id)), [])
  return { stars, remove }
}

// ── Debug arc ─────────────────────────────────────────────────────────────────
const ARC_DEBUG_POINTS = Array.from({ length: 81 }, (_, i) => {
  const x = i * 1.25; const y = arcYAt(x)
  return y <= 100 ? { x, y } : null
}).filter(Boolean) as { x: number; y: number }[]

// ── Component ─────────────────────────────────────────────────────────────────
export default function BackgroundManager() {
  const pathname = usePathname()
  const [active, setActive]     = useState(() => getConfig(pathname))
  const [incoming, setIncoming] = useState<typeof active | null>(null)
  const allStars = useStarPool()
  const { stars: shootingStars, remove: removeShootingStar } = useShootingStars()

  const starMode = active.stars as StarMode
  // sparse = only the topmost orbital layer (li=0, ~130 stars, tightest arc near zenith)
  const stars = starMode === "none"   ? [] :
                starMode === "sparse" ? allStars.filter(s => s.id.startsWith("0-")) :
                allStars

  useEffect(() => {
    const next = getConfig(pathname)
    document.documentElement.style.setProperty('--page-bg', `url('${next.bg}')`)
    if (next.bg === active.bg) { setActive(next); return }
    setIncoming(next)
    const timer = setTimeout(() => { setActive(next); setIncoming(null) }, 650)
    return () => clearTimeout(timer)
  }, [pathname])

  return (
    <>
      {/* Active background */}
      <div className="fixed inset-0 -z-10" style={{
        backgroundImage: `linear-gradient(${active.overlay}, ${active.overlay}), url('${active.bg}')`,
        backgroundSize: "cover", backgroundPosition: "center",
      }} />

      {/* Incoming background */}
      {incoming && (
        <div className="fixed inset-0 -z-10 animate-bg-in" style={{
          backgroundImage: `linear-gradient(${incoming.overlay}, ${incoming.overlay}), url('${incoming.bg}')`,
          backgroundSize: "cover", backgroundPosition: "center",
        }} />
      )}

      {/* Star pool — all orbiting shared pivot at (50vw, -150vh) */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none" style={{ zIndex: -9 }}>
        {stars.map(star => (
          <div
            key={star.key}
            style={{
              position:           "absolute",
              left:               "50vw",
              top:                `-${PIVOT_TOP_VH}vh`,
              opacity:            star.opacity * (starMode === "sparse" ? 0.55 : 1),
              // @ts-expect-error — CSS custom property
              "--r":              `${star.dist}vh`,
              animation:          `star-orbit ${ORBIT_DUR}s linear infinite`,
              animationDirection: "normal",
              animationDelay:     `-${(star.startDeg / 360) * ORBIT_DUR}s`,
            }}
          >
            <div style={{
              width: `${star.size}px`, height: `${star.size}px`,
              borderRadius: "50%", background: star.color,
              boxShadow: `0 0 ${star.size * 2.5}px ${star.size * 0.8}px ${star.color}55`,
              ...(star.pulse ? {
                animation: `star-pulse ${star.pulseDur}s ease-in-out infinite`,
                animationDelay: `${star.pulseDelay}s`,
              } : {}),
            }} />
          </div>
        ))}
      </div>

      {/* DEBUG: orbit trajectory circles */}
      {DEBUG_TRAJECTORIES && (
        <div className="fixed inset-0 overflow-hidden pointer-events-none" style={{ zIndex: 9998 }}>
          {stars.map(star => (
            <div key={`traj-${star.key}`} style={{
              position: "absolute", left: "50vw", top: `-${PIVOT_TOP_VH}vh`,
              width: `${star.dist * 2}vh`, height: `${star.dist * 2}vh`,
              borderRadius: "50%", border: `1px solid ${star.color}55`,
              transform: "translate(-50%, -50%)",
            }} />
          ))}
        </div>
      )}

      {/* Shooting stars — masked so they fade out at the arc/mountain boundary */}
      {starMode !== "none" && <div className="fixed inset-0 overflow-hidden pointer-events-none" style={{
        zIndex: -8,
        maskImage: SKY_MASK,
        WebkitMaskImage: SKY_MASK,
        maskSize: "100% 100%",
        WebkitMaskSize: "100% 100%",
      }}>
        {shootingStars.map(star => (
          <div key={star.id} style={{
            position: "absolute", left: `${star.x}%`, top: `${star.y}%`,
            transform: `rotate(${star.angle}deg)`, transformOrigin: "left center",
          }}>
            <div
              onAnimationEnd={() => removeShootingStar(star.id)}
              style={{
                width: `${star.length}px`, height: `${star.thick}px`,
                borderRadius: "0 50% 50% 0",
                background: star.bright
                  ? "linear-gradient(to right, transparent 0%, rgba(200,225,255,0.4) 35%, rgba(230,242,255,0.88) 72%, rgba(255,255,255,1) 100%)"
                  : "linear-gradient(to right, transparent 0%, rgba(190,215,255,0.35) 40%, rgba(220,235,255,0.80) 78%, rgba(255,255,255,0.95) 100%)",
                boxShadow: star.bright
                  ? "0 0 5px 1.5px rgba(200,230,255,0.55), 0 0 12px 2px rgba(180,210,255,0.25)"
                  : "0 0 3px 1px rgba(200,225,255,0.35)",
                animation: `shooting-star-fly ${star.dur}s ease-in forwards`,
              }}
            />
          </div>
        ))}
      </div>}

      {/* DEBUG arc */}
      {DEBUG_ARC && (
        <div className="fixed inset-0 pointer-events-none" style={{ zIndex: 9999 }}>
          {ARC_DEBUG_POINTS.map((p, i) => (
            <div key={i} style={{
              position: "absolute", left: `${p.x}%`, top: `${p.y}%`,
              width: "4px", height: "4px", borderRadius: "50%",
              background: "rgba(255,60,60,0.9)", transform: "translate(-50%,-50%)",
            }} />
          ))}
          {[0, 25, 50, 75, 100].map(x => {
            const y = arcYAt(x); if (y > 100) return null
            return (
              <div key={x} style={{
                position: "absolute", left: `${x}%`, top: `${y}%`,
                transform: "translate(-50%,8px)", color: "rgba(255,100,100,1)",
                fontSize: "11px", fontFamily: "monospace", whiteSpace: "nowrap",
                fontWeight: "bold", textShadow: "0 0 4px rgba(0,0,0,0.9)",
              }}>x={x}% y={y.toFixed(1)}%</div>
            )
          })}
          <div style={{
            position: "fixed", top: "8px", left: "50%", transform: "translateX(-50%)",
            color: "rgba(255,100,100,1)", fontSize: "12px", fontFamily: "monospace",
            background: "rgba(0,0,0,0.7)", padding: "4px 10px", borderRadius: "4px",
            whiteSpace: "nowrap",
          }}>ARC_EDGE_Y={ARC_EDGE_Y}% · ARC_CENTER_Y={ARC_CENTER_Y}% · margin={MARGIN_PCT}%</div>
        </div>
      )}
    </>
  )
}
