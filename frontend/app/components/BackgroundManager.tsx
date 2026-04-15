"use client"
import { usePathname } from "next/navigation"
import { useState, useEffect } from "react"

const PAGE_CONFIG: Record<string, { bg: string; overlay: string }> = {
  "/":         { bg: "/Background-Midnight(1).svg", overlay: "rgba(0,0,0,0.35)" },
  "/auth":     { bg: "/Background-Midnight(1).svg", overlay: "rgba(0,0,0,0.40)" },
  "/create":   { bg: "/Background-Dusk(2).svg",     overlay: "rgba(0,0,0,0.35)" },
  "/sandbox":  { bg: "/Background-Sunrise(3).svg",  overlay: "rgba(0,0,0,0.42)" },
  "/verify":   { bg: "/Background-Midday-nosun.svg", overlay: "rgba(0,0,0,0.45)" },
  "/download": { bg: "/Background-Sunset(5).svg",   overlay: "rgba(0,0,0,0.25)" },
}

const DEFAULT = PAGE_CONFIG["/"]

function getConfig(pathname: string) {
  // Strip query params and trailing slash for matching
  const base = pathname.split("?")[0].replace(/\/$/, "") || "/"
  return PAGE_CONFIG[base] ?? DEFAULT
}

export default function BackgroundManager() {
  const pathname = usePathname()
  const [active, setActive]     = useState(() => getConfig(pathname))
  const [incoming, setIncoming] = useState<typeof active | null>(null)

  useEffect(() => {
    const next = getConfig(pathname)
    if (next.bg === active.bg) {
      // Same background, just update overlay smoothly
      setActive(next)
      return
    }
    setIncoming(next)
    const timer = setTimeout(() => {
      setActive(next)
      setIncoming(null)
    }, 650)
    return () => clearTimeout(timer)
  }, [pathname])

  return (
    <>
      {/* Active background — always fully visible, never fades out */}
      <div
        className="fixed inset-0 -z-10"
        style={{
          backgroundImage: `url('${active.bg}')`,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      />

      {/* Incoming background — fades in on top, then swap happens silently */}
      {incoming && (
        <div
          className="fixed inset-0 -z-10 animate-bg-in"
          style={{
            backgroundImage: `url('${incoming.bg}')`,
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        />
      )}

      {/* Overlay */}
      <div
        className="fixed inset-0 -z-[9] transition-all duration-600"
        style={{ background: (incoming ?? active).overlay }}
      />
    </>
  )
}
