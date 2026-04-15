"use client"
import Image from "next/image"
import Link from "next/link"
import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Trash2, Settings, LogOut, Info, Key, ChevronRight } from "lucide-react"
import { isLoggedIn, getAuthHeaders, logout } from "@/lib/auth"

const cn = (...classes: (string | undefined | null | false)[]) => classes.filter(Boolean).join(" ")

// ── Star constellation helpers ─────────────────────────────
function hashStr(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

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
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [prefetching, setPrefetching] = useState<string | null>(null)
  const [newStarId, setNewStarId] = useState<string | null>(null)

  useEffect(() => {
    document.fonts.ready.then(() => requestAnimationFrame(() => setPageReady(true)))
  }, [])

  useEffect(() => {
    const id = sessionStorage.getItem("helios_new_server")
    if (id) { setNewStarId(id); sessionStorage.removeItem("helios_new_server") }
  }, [])

  const handleServerClick = async (serverId: string) => {
    if (prefetching) return
    setPrefetching(serverId)
    try {
      const res = await fetch("http://localhost:8000/api/sandbox/start", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ specId: serverId })
      })
      const data = await res.json()
      if (!data.error) {
        sessionStorage.setItem(`helios_prefetch_${serverId}`, JSON.stringify({
          sessionId: data.sessionId,
          tools: data.tools,
          baseUrl: data.baseUrl ?? "",
          authContext: data.authContext ?? null
        }))
      }
    } catch {}
    setPrefetching(null)
    router.push(`/sandbox?specId=${serverId}`)
  }

  const handleDeleteClick = (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    setConfirmDelete(id)
  }

  const handleDeleteConfirm = async () => {
    if (!confirmDelete) return
    const res = await fetch(`http://localhost:8000/api/servers/${confirmDelete}`, {
      method: "DELETE",
      headers: getAuthHeaders(),
    })
    if (res.ok) setServers(prev => prev.filter(s => s.id !== confirmDelete))
    setConfirmDelete(null)
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
        setServers(data.servers ?? [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [router])

  return (
    <div className={cn("min-h-screen relative", pageReady ? "animate-page-enter" : "opacity-0")}>

      {/* ── Star constellation layer ──────────────────────────────────────── */}
      {/* z-index 5: above page content so pointer-events reach the stars    */}
      {/* Container is pointer-events-none; individual wrappers opt back in   */}
      {!loading && servers.length > 0 && (
        <div className="fixed inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 5 }}>

{servers.map(server => {
            // Position comes from DB — stable across sessions
            const x = server.starX
            const y = server.starY
            if (x == null || y == null) return null

            // Animation params are hash-derived (deterministic, don't affect position)
            const h = hashStr(server.id)
            const size        = 12 + (h % 3) * 4          // 12, 16, or 20px
            const twinkleDur  = 2.5 + (h % 30) / 10
            const twinkleDelay = (h % 20) / 10
            const rotateDur   = 20 + (h % 25)
            const isNew = server.id === newStarId

            return (
              <div
                key={server.id}
                className={cn("star-wrapper", isNew ? "is-new" : "is-existing")}
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
                  }}
                />
                <span className="star-label">{server.id}</span>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Blurable content wrapper ─────────────────────────────────────── */}
      <div className={cn("flex flex-col h-screen transition-[filter] duration-300", !!confirmDelete && "blur-sm brightness-75")}>

      {/* ── Nav ──────────────────────────────────────────────────────────── */}
      <nav className="sticky top-0 z-30 glass-nav flex items-center justify-between px-8 h-[62px]">
        <Image src="/logoName.svg" alt="Helios" width={120} height={40} className="brightness-0 invert opacity-90" />

        <div className="flex items-center gap-1">
          <button className="font-[family-name:--font-cinzel] text-[12px] tracking-[0.15em] px-4 py-2 text-white/55 hover:text-white/90 transition-colors duration-200 cursor-pointer">
            Info
          </button>
          <button className="font-[family-name:--font-cinzel] text-[12px] tracking-[0.15em] px-4 py-2 text-white/55 hover:text-white/90 transition-colors duration-200 cursor-pointer">
            Keys
          </button>
          <div className="relative">
            {menuOpen && <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />}
            <button
              onClick={() => setMenuOpen(v => !v)}
              className={cn(
                "font-[family-name:--font-cinzel] text-[12px] tracking-[0.15em] px-5 py-2 rounded-full border transition-all duration-200 cursor-pointer z-20 relative",
                menuOpen
                  ? "bg-white/15 border-white/25 text-white"
                  : "bg-white/[0.07] border-white/[0.14] text-white/70 hover:bg-white/12 hover:border-white/22 hover:text-white"
              )}
            >
              Account
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full mt-2 w-[200px] glass rounded-xl overflow-hidden z-20 animate-fade-up">
                <div className="py-1">
                  {[
                    { icon: Settings, label: "Settings" },
                    { icon: Info,     label: "Info" },
                    { icon: Key,      label: "API Keys" },
                  ].map(({ icon: Icon, label }) => (
                    <button key={label} className="w-full flex items-center gap-3 px-5 py-3
                      font-[family-name:--font-cinzel] text-[12px] tracking-[0.12em] text-white/60
                      hover:text-white hover:bg-white/[0.07] transition-colors duration-150 cursor-pointer"
                    >
                      <Icon size={14} strokeWidth={1.5} />
                      {label}
                    </button>
                  ))}
                  <div className="h-px bg-white/[0.09] mx-4 my-1" />
                  <button
                    onClick={() => logout()}
                    className="w-full flex items-center gap-3 px-5 py-3
                      font-[family-name:--font-cinzel] text-[12px] tracking-[0.12em] text-white/45
                      hover:text-white/80 hover:bg-white/[0.05] transition-colors duration-150 cursor-pointer"
                  >
                    <LogOut size={14} strokeWidth={1.5} />
                    Sign Out
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </nav>

      {/* ── Content area (fills viewport below nav) ──────────────────────── */}
      <div className="relative flex-1">

        {/* ── Main CTA — centered in the full content area ─────────────── */}
        <div className="absolute inset-0 flex items-center justify-center pb-[25vh]">
          <div className="flex flex-col items-center gap-6 animate-fade-up">
            <p className="font-[family-name:--font-cinzel] text-[11px] tracking-[0.35em] text-white/35 uppercase">
              MCP Server Generator
            </p>
            <Link href="/create">
              <button className="btn-gold font-[family-name:--font-cinzel] cursor-pointer px-20 py-7 text-[28px] tracking-[0.18em] rounded-2xl animate-gold-pulse">
                Build Your Server
              </button>
            </Link>
            <p className="font-[family-name:--font-cormorant] text-[15px] italic text-white/35">
              Transform any API into an agent-ready MCP server
            </p>
          </div>
        </div>

        {/* ── Your Servers — pinned to bottom 25% ──────────────────────── */}
        <section className="absolute bottom-0 left-0 right-0 h-[25vh] px-16 overflow-y-auto">
          <div className="max-w-5xl mx-auto pb-6">
            <div className="flex items-center gap-4 mb-4">
              <h2 className="font-[family-name:--font-cinzel] text-[13px] tracking-[0.3em] text-white/35 uppercase">
                Your Servers
              </h2>
              <div className="flex-1 h-px bg-white/[0.09]" />
            </div>

            <div className="flex flex-wrap gap-5">
            {loading ? (
              <span className="font-[family-name:--font-cinzel] text-white/30 text-[13px] tracking-widest">
                Loading...
              </span>
            ) : servers.length === 0 ? (
              <span className="font-[family-name:--font-cinzel] text-white/25 text-[13px] tracking-widest">
                No servers yet — build one above.
              </span>
            ) : (
              servers.map(server => (
                <div
                  key={server.id}
                  onClick={() => handleServerClick(server.id)}
                  className={cn(
                    "w-[260px] aspect-[4/3] glass rounded-2xl cursor-pointer",
                    "flex flex-col justify-between px-6 py-6 relative",
                    "hover:bg-white/[0.11] hover:shadow-[0_12px_40px_rgba(0,0,0,0.4)]",
                    "transition-all duration-300 group",
                    prefetching === server.id && "opacity-60 pointer-events-none"
                  )}
                >
                  {prefetching === server.id ? (
                    <div className="absolute top-3 right-3 z-10 p-1.5">
                      <div className="w-3.5 h-3.5 rounded-full border border-white/30 border-t-white/70 animate-spin" />
                    </div>
                  ) : (
                    <button
                      onClick={e => handleDeleteClick(e, server.id)}
                      className="absolute top-3 right-3 z-10 p-1.5 text-white/20 hover:text-white/70
                        transition-colors duration-200 cursor-pointer"
                      aria-label="Delete server"
                    >
                      <Trash2 size={16} strokeWidth={1.5} />
                    </button>
                  )}

                  <div className="flex flex-col gap-1">
                    <span className="font-[family-name:--font-cinzel] text-[16px] tracking-wider leading-snug text-white/90 break-words">
                      {server.id}
                    </span>
                    <span className="font-[family-name:--font-geist-mono] text-[10px] text-white/35 truncate">
                      {server.baseUrl || "—"}
                    </span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="font-[family-name:--font-cinzel] text-[11px] tracking-widest text-white/45">
                      {server.toolCount} tools
                    </span>
                    <div className="flex items-center gap-1.5 text-[#C9A84C]/50 group-hover:text-[#C9A84C]/80 transition-colors">
                      <span className="font-[family-name:--font-geist-mono] text-[10px]">
                        {server.createdAt ? new Date(server.createdAt).toLocaleDateString() : "—"}
                      </span>
                      <ChevronRight size={12} strokeWidth={1.5} />
                    </div>
                  </div>
                </div>
              ))
            )}
            </div>
          </div>
        </section>

      </div>{/* end content area */}
      </div>{/* end blurable wrapper */}

      {/* ── Delete confirmation modal ─────────────────────────────────── */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center animate-fade-in">
          <div className="absolute inset-0" onClick={() => setConfirmDelete(null)} />
          <div className="relative glass-mid rounded-3xl px-12 py-10 flex flex-col items-center gap-6
            shadow-[0_32px_80px_rgba(0,0,0,0.5)] animate-fade-up">
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
        </div>
      )}
    </div>
  )
}
