"use client"
import Link from "next/link"
import { useState, useEffect, useMemo } from "react"
import { createPortal } from "react-dom"
import { useRouter } from "next/navigation"
import { Trash2, ChevronRight } from "lucide-react"
import { isLoggedIn, getAuthHeaders, logout } from "@/lib/auth"
import { SERVER_STAR_COLORS, hashStr } from "@/lib/serverStars"

const cn = (...classes: (string | undefined | null | false)[]) => classes.filter(Boolean).join(" ")

interface SavedServer {
  id: string
  baseUrl: string
  toolCount: number
  createdAt: string
  starX?: number
  starY?: number
}

export default function Home() {
  const router = useRouter()
  const [pageReady, setPageReady] = useState(false)
  const [servers, setServers] = useState<SavedServer[]>([])
  const [loading, setLoading] = useState(true)

  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [reanimatingIds, setReanimatingIds] = useState<Set<string>>(new Set())
  const [reanimationKey, setReanimationKey] = useState(0)
  const [prefetching, setPrefetching] = useState<string | null>(null)
  const [newStarId, setNewStarId] = useState<string | null>(null)
  const [animateMode, setAnimateMode] = useState<"initial" | "steady">("initial")

  useEffect(() => {
    document.fonts.ready.then(() => requestAnimationFrame(() => setPageReady(true)))
  }, [])

  useEffect(() => {
    const id = sessionStorage.getItem("helios_new_server")
    if (id) { setNewStarId(id); sessionStorage.removeItem("helios_new_server") }
  }, [])

  useEffect(() => {
    if (!confirmDelete) return
    document.documentElement.classList.add("popup-open")
    return () => document.documentElement.classList.remove("popup-open")
  }, [confirmDelete])

  const handleServerClick = async (serverId: string) => {
    if (prefetching) return
    setPrefetching(serverId)
    try {
      const res = await fetch("http://localhost:8000/api/try/start", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ specId: serverId })
      })
      const data = await res.json()
      if (!data.error) {
        // Matches the shape the /try page reads from sessionStorage.
        // authContext key must be present (even if null) so /try accepts the cache.
        sessionStorage.setItem(`helios_try_session_${serverId}`, JSON.stringify({
          sessionId: data.sessionId,
          tools: data.tools,
          authContext: data.authContext ?? null
        }))
      }
    } catch {}
    setPrefetching(null)
    router.push(`/try?specId=${serverId}`)
  }

  const handleCardClick = (serverId: string) => {
    if (prefetching) return
    // Sandbox page handles its own data fetch via /api/sandbox/start on mount.
    router.push(`/sandbox?specId=${encodeURIComponent(serverId)}`)
  }

  const handleDeleteClick = (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    setConfirmDelete(id)
  }

  const handleDeleteConfirm = async () => {
    if (!confirmDelete) return
    const idToDelete = confirmDelete
    setConfirmDelete(null)

    // Capture neighbors before the server is removed from state
    const affectedIds = new Set(
      constellationEdges
        .filter(({ source, target }) => source.id === idToDelete || target.id === idToDelete)
        .map(({ source, target }) => source.id === idToDelete ? target.id : source.id)
    )

    const res = await fetch(`http://localhost:8000/api/servers/${idToDelete}`, {
      method: "DELETE",
      headers: getAuthHeaders(),
    })
    if (res.ok) {
      setDeletingId(idToDelete)
      setTimeout(() => {
        setServers(prev => {
          const next = prev.filter(s => s.id !== idToDelete)
          try { sessionStorage.setItem("helios_servers_cache", JSON.stringify(next)) } catch { }
          return next
        })
        setDeletingId(null)
        if (affectedIds.size > 0) {
          setReanimatingIds(affectedIds)
          setReanimationKey(k => k + 1)
        }
      }, 850)
      if (affectedIds.size > 0) {
        setTimeout(() => setReanimatingIds(new Set()), 850 + 3000)
      }
    }
  }

  useEffect(() => {
    if (!isLoggedIn()) { router.replace("/auth"); return }
    sessionStorage.removeItem("helios_create_tools")
    fetch("http://localhost:8000/api/servers", { headers: getAuthHeaders() })
      .then(res => {
        if (res.status === 401) { router.replace("/auth"); return null }
        return res.json()
      })
      .then(data => {
        if (!data) return
        const list = data.servers ?? []
        setServers(list)
        try { sessionStorage.setItem("helios_servers_cache", JSON.stringify(list)) } catch { }
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [router])

  // Compute constellation edges: each star gets 1–3 connections (hash-seeded, stable)
  const constellationEdges = useMemo(() => {
    const valid = servers.filter(s => s.starX != null && s.starY != null)
    if (valid.length < 2) return []

    // Hash-seeded max degree per star: 1, 2, or 3
    const maxDeg = (s: SavedServer) => (hashStr(s.id + "deg") % 3) + 1

    const degree = new Map<string, number>()
    valid.forEach(s => degree.set(s.id, 0))

    // All pairs sorted by distance (shortest first)
    const pairs: Array<{ a: SavedServer; b: SavedServer }> = []
    for (let i = 0; i < valid.length; i++) {
      for (let j = i + 1; j < valid.length; j++) {
        const a = valid[i], b = valid[j]
        const dx = a.starX! - b.starX!
        const dy = a.starY! - b.starY!
        pairs.push({ a, b, dist: Math.sqrt(dx * dx + dy * dy) } as typeof pairs[0] & { dist: number })
      }
    }
    ;(pairs as Array<{ a: SavedServer; b: SavedServer; dist: number }>).sort((x, y) => x.dist - y.dist)

    const seen = new Set<string>()
    const edges: Array<[SavedServer, SavedServer]> = []

    const tryAdd = (a: SavedServer, b: SavedServer) => {
      const key = [a.id, b.id].sort().join('|')
      if (seen.has(key)) return false
      if (degree.get(a.id)! >= maxDeg(a)) return false
      if (degree.get(b.id)! >= maxDeg(b)) return false
      seen.add(key)
      edges.push([a, b])
      degree.set(a.id, degree.get(a.id)! + 1)
      degree.set(b.id, degree.get(b.id)! + 1)
      return true
    }

    // Greedy pass: add edges shortest-first within each star's desired degree
    for (const { a, b } of pairs) tryAdd(a, b)

    // Guarantee: any star with 0 connections force-connects to its nearest partner < max 3
    for (const s of valid) {
      if (degree.get(s.id)! > 0) continue
      for (const { a, b } of pairs) {
        const other = a.id === s.id ? b : b.id === s.id ? a : null
        if (!other) continue
        if (degree.get(other.id)! >= 3) continue
        const key = [s.id, other.id].sort().join('|')
        if (seen.has(key)) continue
        seen.add(key)
        edges.push([s, other])
        degree.set(s.id, degree.get(s.id)! + 1)
        degree.set(other.id, degree.get(other.id)! + 1)
        break
      }
    }

    // ── Chain-reaction delays via BFS from the rightmost star ──────────
    // Each star "activates" when the line arriving at it finishes drawing.
    // Activation time = BFS depth × line draw duration.
    // An edge fires at the activation time of whichever endpoint was reached first.
    const DRAW_DUR = 1.4  // seconds — matches the CSS animation duration

    const adj = new Map<string, string[]>()
    valid.forEach(s => adj.set(s.id, []))
    edges.forEach(([a, b]) => {
      adj.get(a.id)!.push(b.id)
      adj.get(b.id)!.push(a.id)
    })

    const start = valid.reduce((best, s) => (s.starX! > best.starX! ? s : best), valid[0])
    const activationTime = new Map<string, number>()
    activationTime.set(start.id, 0)
    const queue = [start.id]
    while (queue.length > 0) {
      const curr = queue.shift()!
      const t = activationTime.get(curr)!
      for (const nbr of adj.get(curr) ?? []) {
        if (!activationTime.has(nbr)) {
          activationTime.set(nbr, t + DRAW_DUR)
          queue.push(nbr)
        }
      }
    }

    return edges.map(([a, b]) => {
      const tA = activationTime.get(a.id) ?? 0
      const tB = activationTime.get(b.id) ?? 0
      // source = the star that was activated first; line draws FROM source TO target
      const [source, target] = tA <= tB ? [a, b] : [b, a]
      return { source, target, delay: Math.min(tA, tB) }
    })
  }, [servers])

  // Once the opening BFS draw finishes, flip to steady mode.
  // In steady mode, only edges explicitly flagged (touchesReanimating / touchesNewStar)
  // animate — everything else renders static. Without this, a deletion triggers the
  // constellationEdges useMemo to recompute BFS delays, and the un-keyed style-prop change
  // restarts CSS animations with new delays, making distant lines blink off then back on.
  useEffect(() => {
    if (animateMode !== "initial" || constellationEdges.length === 0) return
    const maxDelay = constellationEdges.reduce((m, e) => Math.max(m, e.delay), 0)
    const t = setTimeout(() => setAnimateMode("steady"), (maxDelay + 1.4) * 1000 + 150)
    return () => clearTimeout(t)
  }, [constellationEdges, animateMode])

  return (
    <div className={cn("min-h-screen transition-opacity duration-500", pageReady ? "opacity-100" : "opacity-0")}>

      {/* ── Star constellation layer ──────────────────────────────────────── */}
      {!loading && servers.length > 0 && (
        <>
        {/* ── Constellation lines — above background, below everything else ── */}
        <svg
          className="fixed inset-0 pointer-events-none"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          style={{ zIndex: 2, width: "100vw", height: "100vh" }}
        >
          <defs>
            <linearGradient id="line-fade" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%"   stopColor="rgba(255,255,255,0.0)" />
              <stop offset="12%"  stopColor="rgba(255,255,255,0.55)" />
              <stop offset="88%"  stopColor="rgba(255,255,255,0.55)" />
              <stop offset="100%" stopColor="rgba(255,255,255,0.0)" />
            </linearGradient>
          </defs>
          {constellationEdges.map(({ source, target, delay }) => {
            const touchesDeleting    = source.id === deletingId || target.id === deletingId
            const touchesReanimating = reanimatingIds.has(source.id) || reanimatingIds.has(target.id)
            const touchesNewStar     = source.id === newStarId || target.id === newStarId

            // Stable key; include reanimationKey for affected edges so React remounts them
            const edgeKey = touchesReanimating
              ? `${source.id}-${target.id}-r${reanimationKey}`
              : `${source.id}-${target.id}`

            if (touchesDeleting) {
              // Put the deleted star at x2 so dashoffset 0→1 erases from that end first
              const deletedIsSource = source.id === deletingId
              return (
                <line
                  key={edgeKey}
                  x1={deletedIsSource ? target.starX : source.starX}
                  y1={deletedIsSource ? target.starY : source.starY}
                  x2={deletedIsSource ? source.starX : target.starX}
                  y2={deletedIsSource ? source.starY : target.starY}
                  stroke="url(#line-fade)"
                  strokeWidth="0.18"
                  strokeLinecap="round"
                  pathLength={1}
                  style={{ animation: `constellation-erase 0.7s ease-in forwards` }}
                />
              )
            }

            if (deletingId) {
              // Unaffected edge — keep static at fully-drawn state during erase
              return (
                <line
                  key={edgeKey}
                  x1={source.starX} y1={source.starY}
                  x2={target.starX} y2={target.starY}
                  stroke="url(#line-fade)"
                  strokeWidth="0.18"
                  strokeLinecap="round"
                  pathLength={1}
                  style={{ strokeDasharray: 1, strokeDashoffset: 0, opacity: 1 }}
                />
              )
            }

            // Steady state: only animate edges explicitly flagged. Everything else
            // stays painted, no restart → no 2-3s flicker after a deletion resettles.
            if (animateMode === "steady" && !touchesReanimating && !touchesNewStar) {
              return (
                <line
                  key={edgeKey}
                  x1={source.starX} y1={source.starY}
                  x2={target.starX} y2={target.starY}
                  stroke="url(#line-fade)"
                  strokeWidth="0.18"
                  strokeLinecap="round"
                  pathLength={1}
                  style={{ strokeDasharray: 1, strokeDashoffset: 0, opacity: 1 }}
                />
              )
            }

            const baseDelay = touchesNewStar ? 4.2 : touchesReanimating ? 0 : delay
            return (
              <line
                key={edgeKey}
                x1={source.starX} y1={source.starY}
                x2={target.starX} y2={target.starY}
                stroke="url(#line-fade)"
                strokeWidth="0.18"
                strokeLinecap="round"
                pathLength={1}
                style={{ animation: `constellation-draw 1.4s ease-out ${baseDelay}s both` }}
              />
            )
          })}
        </svg>

        <div className="fixed inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 10 }}>
          {servers.map(server => {
            const x = server.starX
            const y = server.starY
            if (x == null || y == null) return null

            const h = hashStr(server.id)
            const size        = 18 + (h % 3) * 4
            const twinkleDur  = 2.5 + (h % 30) / 10
            const twinkleDelay = (h % 20) / 10
            const rotateDur   = 20 + (h % 25)
            const starColor   = SERVER_STAR_COLORS[h % SERVER_STAR_COLORS.length]
            const isNew = server.id === newStarId

            return (
              <div
                key={server.id}
                className={cn("star-wrapper", deletingId === server.id ? "is-deleting" : isNew ? "is-new" : "is-existing")}
                style={{
                  left: `${x}%`,
                  top:  `${y}vh`,
                  transform: "translate(-50%, -50%)",
                }}
                onClick={() => handleServerClick(server.id)}
              >
                <div
                  className={cn("star-dot", isNew ? "is-new" : "is-existing")}
                  style={{
                    width:  size,
                    height: size,
                    ["--twinkle-dur"   as string]: `${twinkleDur}s`,
                    ["--twinkle-delay" as string]: `${twinkleDelay}s`,
                    ["--rotate-dur"    as string]: `${rotateDur}s`,
                    ["--star-color"    as string]: starColor,
                  }}
                />
                <span className="star-label">{server.id}</span>
              </div>
            )
          })}
        </div>
        </>
      )}

      {/* Page content — the delete modal renders its own scrim-blur overlay,
          no need to mutate this wrapper. */}
      <div className="relative z-[6]">

      {/* ── Sticky nav ───────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-30 flex items-center px-8 h-[80px]">

        <div className="flex-1 flex items-center">
          <span
            className="font-[family-name:--font-cinzel] font-semibold text-[32px] tracking-[0.35em] pr-[0.35em] select-none"
            style={{ color: "#ffffff", textShadow: "0 0 40px rgba(255,255,255,0.15)" }}
          >
            HELIOS
          </span>
        </div>

        <div className="flex items-center justify-end gap-1">
          <Link href="/info" className="group relative font-[family-name:--font-cinzel] text-[15px] tracking-[0.15em] px-5 py-2.5 text-white/60 hover:text-white transition-all duration-200 cursor-pointer hover:-translate-y-[1px]">
            Info
            <span className="absolute bottom-1 left-5 right-5 h-[1px] bg-white/70 scale-x-0 group-hover:scale-x-100 transition-transform duration-200 origin-left" />
          </Link>
          <Link href="/keys" className="group relative font-[family-name:--font-cinzel] text-[15px] tracking-[0.15em] px-5 py-2.5 text-white/60 hover:text-white transition-all duration-200 cursor-pointer hover:-translate-y-[1px]">
            Keys
            <span className="absolute bottom-1 left-5 right-5 h-[1px] bg-white/70 scale-x-0 group-hover:scale-x-100 transition-transform duration-200 origin-left" />
          </Link>
          {pageReady && (isLoggedIn() ? (
            <button
              onClick={() => { logout(); router.refresh(); router.push("/auth") }}
              className="group relative font-[family-name:--font-cinzel] text-[15px] tracking-[0.15em] px-5 py-2.5 text-white/60 hover:text-white transition-all duration-200 cursor-pointer hover:-translate-y-[1px]"
            >
              Sign Out
              <span className="absolute bottom-1 left-5 right-5 h-[1px] bg-white/70 scale-x-0 group-hover:scale-x-100 transition-transform duration-200 origin-left" />
            </button>
          ) : (
            <Link href="/auth" className="group relative font-[family-name:--font-cinzel] text-[15px] tracking-[0.15em] px-5 py-2.5 text-white/60 hover:text-white transition-all duration-200 cursor-pointer hover:-translate-y-[1px]">
              Sign In
              <span className="absolute bottom-1 left-5 right-5 h-[1px] bg-white/70 scale-x-0 group-hover:scale-x-100 transition-transform duration-200 origin-left" />
            </Link>
          ))}
        </div>

      </div>

      {/* ── Scrollable content — CTA + servers flow together ─────────────── */}
      <div>

        {/* ── Main CTA ─────────────────────────────────────────────────── */}
        <div className="flex items-center justify-center min-h-[68vh] pb-4">
          <div className="flex flex-col items-center gap-6 animate-fade-up">
            <p className="font-[family-name:--font-cinzel] text-[20px] tracking-[0.45em] uppercase text-white">
              MCP Server Generator
            </p>
            <Link href="/create">
              <button className="btn-gold font-[family-name:--font-cinzel] cursor-pointer px-20 py-7 text-[28px] tracking-[0.18em] rounded-2xl animate-gold-pulse">
                Build Your Server
              </button>
            </Link>
            <p className="font-[family-name:--font-cormorant] text-[17px] italic text-white" style={{ letterSpacing: "0.04em" }}>
              Transform any API into an agent-ready MCP server
            </p>
          </div>
        </div>

        {/* ── Your Servers ─────────────────────────────────────────────── */}
        <section className="px-16 pb-16">
          <div className="max-w-5xl mx-auto">
            <div className="flex items-center gap-4 mb-6 w-full">
              <div className="flex-1 h-[2px] bg-white/[0.30]" />
              <h2 className="font-[family-name:--font-cinzel] text-[18px] tracking-[0.3em] text-white/65 uppercase">
                Your Servers
              </h2>
              <div className="flex-1 h-[2px] bg-white/[0.30]" />
            </div>

            <div className="flex flex-wrap gap-5 justify-center">
              {loading ? (
                <span className="font-[family-name:--font-cinzel] text-white/55 text-[13px] tracking-widest">
                  Loading...
                </span>
              ) : servers.length === 0 ? (
                <span className="font-[family-name:--font-cinzel] text-white/50 text-[13px] tracking-widest">
                  No servers yet — build one above.
                </span>
              ) : (
                servers.map(server => (
                  // Outer wrapper: owns dimensions + blur layer. Never receives a CSS
                  // transform, so background-attachment:fixed on the blur div is always
                  // relative to the viewport — no matter what the inner card does.
                  <div
                    key={server.id}
                    onClick={() => handleCardClick(server.id)}
                    className={cn(
                      "w-[260px] aspect-[4/3] relative z-[0] rounded-2xl cursor-pointer",
                      prefetching === server.id && "opacity-60 pointer-events-none"
                    )}
                  >
                    {/* Blur layer — parent chain is transform-free */}
                    <div
                      aria-hidden="true"
                      className="absolute inset-0 pointer-events-none rounded-2xl"
                      style={{
                        backgroundImage: "var(--page-bg, url('/Background-Midnight(1).jpg'))",
                        backgroundSize: 'cover',
                        backgroundPosition: 'center',
                        backgroundAttachment: 'fixed',
                        filter: 'blur(8px) saturate(1.2) brightness(0.72)',
                      }}
                    />

                    {/* Inner card: glass + all hover animations including scale */}
                    <div
                      className={cn(
                        "glass rounded-2xl w-full h-full",
                        "flex flex-col justify-between px-6 py-6",
                        "hover:-translate-y-2 hover:scale-[1.03] hover:bg-white/[0.13] hover:border-white/[0.2]",
                        "hover:shadow-[0_20px_50px_rgba(0,0,0,0.55),0_0_0_1px_rgba(255,255,255,0.18)]",
                        "transition-all duration-250 ease-out group",
                      )}
                    >
                      {prefetching === server.id ? (
                        <div className="absolute top-3 right-3 z-10 p-1.5">
                          <div className="w-3.5 h-3.5 rounded-full border border-white/30 border-t-white/70 animate-spin" />
                        </div>
                      ) : (
                        <button
                          onClick={e => handleDeleteClick(e, server.id)}
                          className="absolute top-3 right-3 z-10 p-1.5 text-[#C9A84C]/60 hover:text-[#C9A84C]
                            transition-colors duration-200 cursor-pointer"
                          aria-label="Delete server"
                        >
                          <Trash2 size={20} strokeWidth={1.5} />
                        </button>
                      )}

                      <div className="flex flex-col gap-1">
                        <span className="font-[family-name:--font-cinzel] text-[20px] tracking-wider leading-snug text-white/90 group-hover:text-white transition-colors duration-250 break-words">
                          {server.id}
                        </span>
                        <span className="font-[family-name:--font-geist-mono] text-[10px] text-white/55 truncate">
                          {server.baseUrl || "—"}
                        </span>
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="font-[family-name:--font-cinzel] text-[11px] tracking-widest text-white/65">
                          {server.toolCount} tools
                        </span>
                        <div className="flex items-center gap-1.5 text-[#C9A84C]/50 group-hover:text-[#C9A84C] group-hover:translate-x-0.5 transition-all duration-250">
                          <span className="font-[family-name:--font-geist-mono] text-[10px]">
                            {server.createdAt ? new Date(server.createdAt).toLocaleDateString() : "—"}
                          </span>
                          <ChevronRight size={12} strokeWidth={1.5} />
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>

      </div>

      </div>{/* end full-page blur wrapper */}

      {/* ── Delete confirmation modal — portaled to <body> so .page-wrapper
          filter blur doesn't blur the modal itself ──────────────────── */}
      {confirmDelete && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/20" onClick={() => setConfirmDelete(null)} />
          <div className="relative overflow-hidden z-[0] glass-mid rounded-3xl px-12 py-10 flex flex-col items-center gap-6
            shadow-[0_32px_80px_rgba(0,0,0,0.5)] animate-fade-up">
            <div aria-hidden="true" className="absolute pointer-events-none" style={{ inset: '-50px', backgroundImage: "var(--page-bg, url('/Background-Midnight(1).jpg'))", backgroundSize: 'cover', backgroundPosition: 'center', backgroundAttachment: 'fixed', filter: 'blur(8px) saturate(1.2) brightness(0.72)', zIndex: -1 }} />
            <span className="font-[family-name:--font-cinzel] text-[20px] tracking-widest text-white/90">
              Delete Server?
            </span>
            <span className="font-[family-name:--font-cormorant] text-[16px] text-white/50 text-center">
              <span className="text-white/80 font-semibold">{confirmDelete}</span> will be permanently removed.
            </span>
            <div className="flex gap-4">
              <button
                onClick={() => setConfirmDelete(null)}
                className="font-[family-name:--font-cinzel] cursor-pointer px-8 py-3 text-[13px] tracking-widest
                  glass rounded-xl text-white/55 hover:text-white hover:bg-white/[0.11] transition-all duration-200"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteConfirm}
                className="font-[family-name:--font-cinzel] cursor-pointer px-8 py-3 text-[13px] tracking-widest
                  bg-red-500/80 hover:bg-red-500 text-white rounded-xl border border-red-400/40
                  transition-all duration-200"
              >
                Delete
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
