"use client"
import Image from "next/image"
import Link from "next/link"
import { useState, useEffect } from "react"
import { Mail, Hash } from "lucide-react"
import { siGoogle, siGithub, siSpotify, siNotion, siStripe, siDiscord } from "simple-icons"

interface SavedServer {
  id: string
  baseUrl: string
  toolCount: number
  createdAt: string
}

const premadeServers = [
  { name: "Google",  simpleIcon: siGoogle,   lucideIcon: null },
  { name: "GitHub",  simpleIcon: siGithub,   lucideIcon: null },
  { name: "Spotify", simpleIcon: siSpotify,  lucideIcon: null },
  { name: "Notion",  simpleIcon: siNotion,   lucideIcon: null },
  { name: "Slack",   simpleIcon: null,       lucideIcon: Hash },
  { name: "Stripe",  simpleIcon: siStripe,   lucideIcon: null },
  { name: "Discord", simpleIcon: siDiscord,  lucideIcon: null },
  { name: "Email",   simpleIcon: null,       lucideIcon: Mail },
]

export default function Home() {
  const [servers, setServers] = useState<SavedServer[]>([])
  const [loading, setLoading] = useState(true)

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
    <nav className="flex items-center justify-between px-6 pl-20">
        <Image src="/logoName.svg" alt="Helios" width={200} height={200} />
        <div className="flex font-[family-name:--font-cinzel]" style={{ gap: "clamp(10px, 4vw, 168px)" }}>
          <button className="text-[52px] cursor-pointer flex flex-col items-center group">
            Info
            <span className="block h-[2px] w-full bg-gray-500 group-hover:bg-black mt-[-6px]"></span>
          </button>
          <button className="text-[52px] cursor-pointer flex flex-col items-center group">
            Keys
            <span className="block h-[2px] w-full bg-gray-500 group-hover:bg-black mt-[-6px]"></span>
          </button>
          <button className="text-[52px] cursor-pointer flex flex-col items-center group">
            Account
            <span className="block h-[2px] w-full bg-gray-500 group-hover:bg-black mt-[-6px]"></span>
          </button>
        </div>
        <div className="w-[220px]"></div>
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

    {/* pre-made servers section */}
    <section className="px-[250px] pb-24">
      <h2 className="font-[family-name:--font-cinzel] text-[42px]">Pre-made Servers</h2>
      <div className="h-[1px] bg-black"></div>
      <div className="flex flex-wrap justify-center gap-6 mt-8">
        {premadeServers.map(({ name, simpleIcon, lucideIcon: LucideIcon }) => (
          <div key={name} className="w-[280px] aspect-[4/3] font-[family-name:--font-cinzel] cursor-pointer flex flex-col items-center justify-center gap-4 text-[20px] tracking-widest text-black border-[2px] border-gray-400 relative
            before:absolute before:inset-[5px] before:border-[1px] before:border-gray-300 before:pointer-events-none
            hover:border-black hover:before:border-gray-500 transition-colors duration-300">
            {simpleIcon ? (
              <svg role="img" viewBox="0 0 24 24" width={48} height={48} xmlns="http://www.w3.org/2000/svg">
                <path d={simpleIcon.path} />
              </svg>
            ) : LucideIcon ? (
              <LucideIcon size={48} strokeWidth={1.5} />
            ) : null}
            {name}
          </div>
        ))}
      </div>
    </section>

  </div>
  )
}
