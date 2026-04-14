"use client"
import Image from "next/image"
import Link from "next/link"
import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { User, Trash2 } from "lucide-react"
import { isLoggedIn, getAuthHeaders, logout } from "@/lib/auth"

const cn = (...classes: (string | undefined | null | false)[]) => classes.filter(Boolean).join(" ")

interface SavedServer {
  id: string
  baseUrl: string
  toolCount: number
  createdAt: string
}

export default function Home() {
  const router = useRouter()
  const [servers, setServers] = useState<SavedServer[]>([])
  const [loading, setLoading] = useState(true)
  const [menuState, setMenuState] = useState<"closed" | "expanding" | "open" | "collapsing">("closed")
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const openMenu = () => {
    setMenuState("expanding")
    setTimeout(() => setMenuState("open"), 250)
  }
  const closeMenu = () => {
    setMenuState("collapsing")
    setTimeout(() => setMenuState("closed"), 250)
  }

  const handleDeleteClick = (e: React.MouseEvent, id: string) => {
    e.preventDefault()
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
    if (!isLoggedIn()) {
      router.replace("/auth")
      return
    }
    // Clear the create-flow tool list — user is back at home, flow is over
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
    <div className="min-h-screen bg-[#f2f2f7] text-gray-900">

      {/* ── Nav ──────────────────────────────────────────────────────────────── */}
      <nav className="sticky top-0 z-30 backdrop-blur-2xl bg-white/60 border-b border-black/[0.06]
        flex items-center justify-between px-6 pl-20 pr-10
        shadow-[0_1px_0_rgba(0,0,0,0.04)]">

        <Image
          src="/logoName.svg"
          alt="Helios"
          width={200}
          height={200}
        />

        {/* ── User menu ── liquid glass expand/collapse ── */}
        <div className="relative w-[52px] h-[52px]">
          {(menuState === "open" || menuState === "expanding") && (
            <div className="fixed inset-0 z-10" onClick={closeMenu} />
          )}

          <div
            onClick={() => (menuState === "closed" || menuState === "expanding") ? openMenu() : closeMenu()}
            className={cn(
              "absolute right-0 top-0 z-20 cursor-pointer overflow-hidden",
              "backdrop-blur-2xl bg-white/70 border border-black/[0.08]",
              "shadow-[0_4px_20px_rgba(0,0,0,0.08),inset_0_1px_0_rgba(255,255,255,0.9)]",
              "transition-all duration-[250ms] ease-in-out",
              menuState === "closed"
                ? "w-[52px] h-[52px] rounded-full"
                : menuState === "expanding"
                ? "w-[200px] h-[52px] rounded-[18px]"
                : menuState === "open"
                ? "w-[200px] h-[212px] rounded-[18px]"
                : "w-[200px] h-[52px] rounded-[18px]"
            )}
          >
            {/* Inner highlight ring */}
            <div className={cn(
              "absolute pointer-events-none border border-white/80 transition-all duration-[250ms] ease-in-out",
              menuState === "closed" ? "inset-[4px] rounded-full" : "inset-[5px] rounded-[11px]"
            )} />

            {/* Icon */}
            <div className="absolute top-0 right-0 w-[48px] h-[48px] flex items-center justify-center">
              <User size={22} strokeWidth={1.5} className="text-gray-500" />
            </div>

            {/* Dropdown items */}
            <div className={cn(
              "absolute top-[52px] left-0 right-0 transition-opacity duration-150",
              menuState === "open" ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
            )}>
              <div className="mx-4 h-[1px] bg-black/[0.06]" />
              {["Settings", "Info"].map(item => (
                <button
                  key={item}
                  onClick={e => e.stopPropagation()}
                  className="w-full text-left px-6 py-[14px] font-[family-name:--font-cinzel] text-[13px] tracking-widest
                    text-gray-500 cursor-pointer hover:bg-black/[0.04] hover:text-gray-900 transition-colors duration-200"
                >
                  {item}
                </button>
              ))}
              <button
                onClick={e => { e.stopPropagation(); logout() }}
                className="w-full text-left px-6 py-[14px] font-[family-name:--font-cinzel] text-[13px] tracking-widest
                  text-gray-500 cursor-pointer hover:bg-black/[0.04] hover:text-gray-900 transition-colors duration-200"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* ── Main CTA ─────────────────────────────────────────────────────────── */}
      <main className="flex items-center justify-center h-[75vh]">
        <Link href="/create">
          <button className="font-[family-name:--font-cinzel] cursor-pointer px-16 py-8 text-[36px] tracking-widest text-gray-900
            rounded-3xl backdrop-blur-2xl bg-white/70 border border-black/[0.08]
            shadow-[0_8px_40px_rgba(0,0,0,0.08),inset_0_1px_0_rgba(255,255,255,0.9)]
            hover:bg-white/85 hover:shadow-[0_12px_48px_rgba(0,0,0,0.12),inset_0_1px_0_rgba(255,255,255,0.95)]
            transition-all duration-300">
            Build Your Server
          </button>
        </Link>
      </main>

      {/* ── Your Servers ─────────────────────────────────────────────────────── */}
      <section className="px-[250px] pb-24">
        <h2 className="font-[family-name:--font-cinzel] text-[42px] text-gray-900">Your Servers</h2>
        <div className="h-[1px] bg-black/[0.08] mt-1 mb-8" />

        <div className="flex flex-wrap justify-center gap-6">
          {loading ? (
            <span className="font-[family-name:--font-cinzel] text-gray-400 text-[18px] tracking-widest">
              Loading...
            </span>
          ) : servers.length === 0 ? (
            <span className="font-[family-name:--font-cinzel] text-gray-400 text-[18px] tracking-widest">
              No servers yet — build one above.
            </span>
          ) : (
            servers.map(server => (
              <Link key={server.id} href={`/sandbox?specId=${server.id}`}>
                <div className="w-[280px] aspect-[4/3] font-[family-name:--font-cinzel] cursor-pointer
                  flex flex-col justify-between px-8 py-8 relative
                  rounded-2xl backdrop-blur-2xl bg-white/70 border border-black/[0.07]
                  shadow-[0_2px_16px_rgba(0,0,0,0.05),inset_0_1px_0_rgba(255,255,255,0.9)]
                  hover:bg-white/85 hover:shadow-[0_8px_32px_rgba(0,0,0,0.1),inset_0_1px_0_rgba(255,255,255,0.95)]
                  transition-all duration-300">

                  <button
                    onClick={e => handleDeleteClick(e, server.id)}
                    className="absolute top-3 right-3 z-10 p-1.5 text-gray-300 hover:text-gray-600
                      transition-colors duration-200 cursor-pointer"
                    aria-label="Delete server"
                  >
                    <Trash2 size={19} strokeWidth={1.5} />
                  </button>

                  <span className="text-[22px] tracking-widest leading-tight break-words text-gray-900">{server.id}</span>

                  <div className="flex flex-col gap-1">
                    <span className="text-[11px] tracking-wider text-gray-400 truncate font-[family-name:--font-geist-mono]">
                      {server.baseUrl || "—"}
                    </span>
                    <div className="flex items-center justify-between">
                      <span className="text-[12px] tracking-widest text-gray-500">{server.toolCount} tools</span>
                      <span className="text-[11px] text-gray-400 font-[family-name:--font-geist-mono]">
                        {server.createdAt ? new Date(server.createdAt).toLocaleDateString() : "—"}
                      </span>
                    </div>
                  </div>
                </div>
              </Link>
            ))
          )}
        </div>
      </section>

      {/* ── Delete confirmation modal ─────────────────────────────────────────── */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={() => setConfirmDelete(null)} />
          <div className="relative backdrop-blur-2xl bg-white/80 border border-black/[0.08] rounded-3xl
            px-12 py-10 flex flex-col items-center gap-6
            shadow-[0_24px_64px_rgba(0,0,0,0.12),inset_0_1px_0_rgba(255,255,255,0.95)]">

            <span className="font-[family-name:--font-cinzel] text-[22px] tracking-widest text-gray-900">
              Delete Server?
            </span>
            <span className="font-[family-name:--font-geist-sans] text-[14px] text-gray-500 text-center">
              <span className="font-[family-name:--font-cinzel] text-gray-900">{confirmDelete}</span> will be permanently removed.
            </span>

            <div className="flex gap-4">
              <button
                onClick={() => setConfirmDelete(null)}
                className="font-[family-name:--font-cinzel] cursor-pointer px-8 py-4 text-[15px] tracking-widest text-gray-500
                  rounded-2xl backdrop-blur-xl bg-white/60 border border-black/[0.08]
                  hover:bg-white/90 hover:text-gray-900
                  shadow-[0_2px_12px_rgba(0,0,0,0.05),inset_0_1px_0_rgba(255,255,255,0.9)]
                  transition-all duration-300"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteConfirm}
                className="font-[family-name:--font-cinzel] cursor-pointer px-8 py-4 text-[15px] tracking-widest text-white
                  rounded-2xl bg-gray-900 border border-gray-800
                  hover:bg-gray-700
                  shadow-[0_2px_12px_rgba(0,0,0,0.15)]
                  transition-all duration-300"
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
