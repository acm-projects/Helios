"use client"
import Image from "next/image"
import Link from "next/link"
import { useState, useEffect } from "react"
import { User, Trash2 } from "lucide-react"

interface SavedServer {
  id: string
  baseUrl: string
  toolCount: number
  createdAt: string
}

export default function Home() {
  const [servers, setServers] = useState<SavedServer[]>([])
  const [loading, setLoading] = useState(true)
  const [menuState, setMenuState] = useState<'closed' | 'expanding' | 'open' | 'collapsing'>('closed')
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const openMenu = () => {
    setMenuState('expanding')
    setTimeout(() => setMenuState('open'), 250)
  }
  const closeMenu = () => {
    setMenuState('collapsing')
    setTimeout(() => setMenuState('closed'), 250)
  }

  const handleDeleteClick = (e: React.MouseEvent, id: string) => {
    e.preventDefault()
    e.stopPropagation()
    setConfirmDelete(id)
  }

  const handleDeleteConfirm = async () => {
    if (!confirmDelete) return
    const res = await fetch(`http://localhost:8000/api/servers/${confirmDelete}`, { method: "DELETE" })
    if (res.ok) setServers(prev => prev.filter(s => s.id !== confirmDelete))
    setConfirmDelete(null)
  }

  useEffect(() => {
    fetch("http://localhost:8000/api/servers")
      .then(res => res.json())
      .then(data => {
        setServers(data.servers ?? [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  return (
  <div className="min-h-screen">
    <nav className="flex items-center justify-between px-6 pl-20 pr-10">
        <Image src="/logoName.svg" alt="Helios" width={200} height={200} />
        {/* fixed-size anchor — nav never shifts */}
        <div className="relative w-[52px] h-[52px]">
          {(menuState === 'open' || menuState === 'expanding') && (
            <div className="fixed inset-0 z-10" onClick={closeMenu} />
          )}

          {/* outer ring — step 1: width expands (circle→pill), step 2: height drops */}
          <div
            onClick={() => menuState === 'closed' || menuState === 'expanding' ? openMenu() : closeMenu()}
            className={`absolute right-0 top-0 z-20 bg-white border-[2px] border-black cursor-pointer overflow-hidden transition-all duration-[250ms] ease-in-out
              ${menuState === 'closed'
                ? 'w-[52px] h-[52px] rounded-full'
                : menuState === 'expanding'
                ? 'w-[200px] h-[52px] rounded-[18px]'
                : menuState === 'open'
                ? 'w-[200px] h-[212px] rounded-[18px]'
                : 'w-[200px] h-[52px] rounded-[18px]'  /* collapsing */
              }`}
          >
            {/* inner ring */}
            <div className={`absolute pointer-events-none border-[1px] border-black transition-all duration-[250ms] ease-in-out
              ${menuState === 'closed' ? 'inset-[4px] rounded-full' : 'inset-[5px] rounded-[11px]'}`} />

            {/* icon — pinned top-right, never moves */}
            <div className="absolute top-0 right-0 w-[48px] h-[48px] flex items-center justify-center">
              <User size={22} strokeWidth={1.5} />
            </div>

            {/* menu items — only visible when fully open */}
            <div className={`absolute top-[52px] left-0 right-0 transition-opacity duration-150
              ${menuState === 'open' ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}>
              <div className="mx-5 h-[1px] bg-gray-200" />
              {["Account", "Settings", "Info"].map((item) => (
                <button
                  key={item}
                  onClick={e => e.stopPropagation()}
                  className="w-full text-left px-6 py-[14px] font-[family-name:--font-cinzel] text-[13px] tracking-widest cursor-pointer hover:bg-black hover:text-white transition-colors duration-200"
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
        </div>
    </nav>

    <main className="flex items-center justify-center h-[75vh]">
      <Link href="/create">
        <button className="font-[family-name:--font-cinzel] cursor-pointer px-16 py-8 text-[36px] tracking-widest text-black border-[3px] border-black relative
          before:absolute before:inset-[6px] before:border-[1px] before:border-black before:pointer-events-none
          hover:bg-black hover:text-white hover:before:border-white transition-colors duration-300">
          Build Your Server
        </button>
      </Link>
    </main>

    {/* your servers section */}
    <section className="px-[250px]">
      <h2 className="font-[family-name:--font-cinzel] text-[42px]">Your Servers</h2>
      <div className="h-[1px] bg-black"></div>
      <div className="flex flex-wrap justify-center gap-6 mt-8 pb-16">
        {loading ? (
          <span className="font-[family-name:--font-cinzel] text-gray-400 text-[18px] tracking-widest">Loading...</span>
        ) : servers.length === 0 ? (
          <span className="font-[family-name:--font-cinzel] text-gray-400 text-[18px] tracking-widest">No servers yet — build one above.</span>
        ) : (
          servers.map((server) => (
            <Link key={server.id} href={`/sandbox?specId=${server.id}`}>
              <div className="w-[280px] aspect-[4/3] font-[family-name:--font-cinzel] cursor-pointer flex flex-col justify-between px-8 py-8 text-black border-[2px] border-gray-400 relative
                before:absolute before:inset-[5px] before:border-[1px] before:border-gray-300 before:pointer-events-none
                hover:border-black hover:before:border-gray-500 transition-colors duration-300">
                <button
                  onClick={(e) => handleDeleteClick(e, server.id)}
                  className="absolute top-3 right-3 z-10 p-1.5 text-gray-300 hover:text-black transition-colors duration-200 cursor-pointer"
                  aria-label="Delete server"
                >
                  <Trash2 size={19} strokeWidth={1.5} />
                </button>
                <span className="text-[22px] tracking-widest leading-tight break-words">{server.id}</span>
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] tracking-wider text-gray-400 truncate font-[family-name:--font-geist-mono]">{server.baseUrl || "—"}</span>
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

    {/* Delete confirmation modal */}
    {confirmDelete && (
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <div className="absolute inset-0 bg-black/30" onClick={() => setConfirmDelete(null)} />
        <div className="relative bg-white border-[2px] border-black px-12 py-10 flex flex-col items-center gap-6
          before:absolute before:inset-[6px] before:border-[1px] before:border-black before:pointer-events-none">
          <span className="font-[family-name:--font-cinzel] text-[22px] tracking-widest text-black">Delete Server?</span>
          <span className="font-[family-name:--font-geist-sans] text-[14px] text-gray-500 text-center">
            <span className="font-[family-name:--font-cinzel] text-black">{confirmDelete}</span> will be permanently removed.
          </span>
          <div className="flex gap-4">
            <button
              onClick={() => setConfirmDelete(null)}
              className="font-[family-name:--font-cinzel] cursor-pointer px-8 py-4 text-[15px] tracking-widest text-gray-400 border-[2px] border-gray-300 relative
                before:absolute before:inset-[4px] before:border-[1px] before:border-gray-300 before:pointer-events-none
                hover:border-black hover:text-black hover:before:border-black transition-colors duration-300"
            >
              Cancel
            </button>
            <button
              onClick={handleDeleteConfirm}
              className="font-[family-name:--font-cinzel] cursor-pointer px-8 py-4 text-[15px] tracking-widest text-white bg-black border-[2px] border-black relative
                before:absolute before:inset-[4px] before:border-[1px] before:border-white before:pointer-events-none
                hover:bg-white hover:text-black hover:before:border-black transition-colors duration-300"
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
