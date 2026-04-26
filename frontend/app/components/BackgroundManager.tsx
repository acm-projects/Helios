"use client"
import { usePathname } from "next/navigation"
import { useState, useEffect, useRef, useCallback } from "react"
import { StarsBackground, type StarMode } from "./StarsBackground"

const PAGE_CONFIG: Record<string, { bg: string; overlay: string; stars: StarMode }> = {
  "/":         { bg: "/Background-Midnight(1).jpg", overlay: "rgba(0,0,0,0.35)", stars: "full"   },
  "/auth":     { bg: "/Background-Midnight(1).jpg", overlay: "rgba(0,0,0,0.40)", stars: "full"   },
  "/create":   { bg: "/Background-Dusk(2).jpg",     overlay: "rgba(0,0,0,0.35)", stars: "sparse" },
  "/sandbox":  { bg: "/Background-Sunrise(3).jpg",  overlay: "rgba(0,0,0,0.42)", stars: "none"   },
  "/verify":   { bg: "/Background-Midday(4).jpg",   overlay: "rgba(0,0,0,0.45)", stars: "none"   },
  "/download": { bg: "/Background-Sunset(5).jpg",   overlay: "rgba(0,0,0,0.25)", stars: "none"   },
  // /try paints its own GalaxyCanvas + static MotionStarsBackground; suppress
  // the global mouse-parallax star layer here so it doesn't sit on top.
  "/try":      { bg: "/Background-Midnight(1).jpg", overlay: "rgba(0,0,0,0.40)", stars: "none"   },
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

const DEBUG_ARC = false

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

const MARGIN_PCT = 4  // debug overlay readout only

// ── Shooting stars ────────────────────────────────────────────────────────────
interface ShootingStar {
  id: number; x: number; y: number; angle: number
  length: number; thick: number; dur: number; bright: boolean
}

function useShootingStars(enabled: boolean) {
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
    const delay = initialDelay ?? (40000 + Math.random() * 540000)
    timerRef.current = setTimeout(() => {
      if (!document.hidden) spawnOne()
      schedule()
    }, delay)
  }, [spawnOne])

  useEffect(() => {
    // Disabled (non-star page OR stars faded out): cancel timer, clear in-flight,
    // and do NOT attach the visibility listener — prevents pile-up when user
    // navigates to a no-star page and later returns.
    if (!enabled) {
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
      setStars([])
      return
    }

    schedule(15000 + Math.random() * 45000)

    function onVisibility() {
      if (document.hidden) {
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
  }, [schedule, enabled])

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

  const [visibleStarMode, setVisibleStarMode] = useState<StarMode>(() => getConfig(pathname).stars as StarMode)
  const [starOpacity, setStarOpacity] = useState(1)
  const starModeRef = useRef<StarMode>(getConfig(pathname).stars as StarMode)

  const { stars: shootingStars, remove: removeShootingStar } = useShootingStars(visibleStarMode !== "none")

  useEffect(() => {
    const next = getConfig(pathname)
    document.documentElement.style.setProperty('--page-bg', `url('${next.bg}')`)

    let bgTimer: ReturnType<typeof setTimeout> | null = null
    let starTimer: ReturnType<typeof setTimeout> | null = null

    if (next.bg !== active.bg) {
      setIncoming(next)
      bgTimer = setTimeout(() => { setActive(next); setIncoming(null) }, 650)
    } else {
      setActive(next)
    }

    const nextStars = next.stars as StarMode
    if (nextStars !== starModeRef.current) {
      setStarOpacity(0)
      starTimer = setTimeout(() => {
        starModeRef.current = nextStars
        setVisibleStarMode(nextStars)
        if (nextStars !== "none") {
          requestAnimationFrame(() => requestAnimationFrame(() => setStarOpacity(1)))
        }
      }, 400)
    }

    return () => {
      if (bgTimer) clearTimeout(bgTimer)
      if (starTimer) clearTimeout(starTimer)
    }
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

      {/* Star field — parallax layers rotating around (50vw, -150vh) pivot.
          Mask clips below the horizon arc; opacity fades on page-mode change. */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none" style={{
        zIndex: -9, opacity: starOpacity, transition: "opacity 400ms ease",
        maskImage: SKY_MASK, WebkitMaskImage: SKY_MASK,
        maskSize: "100% 100%", WebkitMaskSize: "100% 100%",
      }}>
        <StarsBackground mode={visibleStarMode} />
      </div>

      {/* Shooting stars — masked so they fade out at the arc/mountain boundary */}
      {visibleStarMode !== "none" && <div className="fixed inset-0 overflow-hidden pointer-events-none" style={{
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
