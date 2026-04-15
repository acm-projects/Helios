"use client"
import { Suspense, useState, useEffect } from "react"
import { useSearchParams } from "next/navigation"
import Image from "next/image"
import Link from "next/link"
import { Download, Check, Sparkles } from "lucide-react"
import { getAuthHeaders } from "@/lib/auth"

function DownloadContent() {
  const params = useSearchParams()
  const specId = params.get("specId")

  const [pageReady, setPageReady] = useState(false)
  useEffect(() => {
    document.fonts.ready.then(() => requestAnimationFrame(() => setPageReady(true)))
  }, [])

  // Mark this server as new so the home page can play its shooting-star entry
  useEffect(() => {
    if (specId) sessionStorage.setItem("helios_new_server", specId)
  }, [specId])

  function handleDownload() {
    const url = `http://localhost:8000/api/servers/${specId}/download`
    fetch(url, { headers: getAuthHeaders() })
      .then(res => res.blob())
      .then(blob => {
        const a = document.createElement("a")
        a.href = URL.createObjectURL(blob)
        a.setAttribute("download", `${specId}-mcp-server.zip`)
        a.click()
        URL.revokeObjectURL(a.href)
      })
  }

  return (
    <div className={`min-h-screen relative flex flex-col ${pageReady ? "animate-page-enter" : "opacity-0"}`}>

      {/* ── Background ────────────────────────────────────────────────── */}

      {/* ── Nav ────────────────────────────────────────────────────────── */}
      <nav className="glass-nav flex items-center justify-between px-8 h-[62px]">
        <Link href="/">
          <Image src="/logoName.svg" alt="Helios" width={120} height={40} className="brightness-0 invert opacity-90 cursor-pointer" />
        </Link>
        <div className="flex items-center gap-1">
          <button className="font-[family-name:--font-cinzel] text-[12px] tracking-[0.15em] px-4 py-2 text-white/55 hover:text-white/90 transition-colors cursor-pointer">Info</button>
          <button className="font-[family-name:--font-cinzel] text-[12px] tracking-[0.15em] px-4 py-2 text-white/55 hover:text-white/90 transition-colors cursor-pointer">Keys</button>
          <button className="font-[family-name:--font-cinzel] text-[12px] tracking-[0.15em] px-5 py-2 rounded-full bg-white/[0.07] border border-white/[0.14] text-white/70 hover:bg-white/12 hover:text-white transition-all cursor-pointer">Account</button>
        </div>
      </nav>

      {/* ── Main content ──────────────────────────────────────────────── */}
      <main className="flex-1 flex items-center justify-center px-4 py-6">
        <div className="glass-mid rounded-3xl px-12 py-8 w-full max-w-[540px] flex flex-col items-center gap-5
          shadow-[0_40px_100px_rgba(0,0,0,0.4)] animate-fade-up">

          {/* Checkmark icon */}
          <div className="w-14 h-14 rounded-full flex items-center justify-center"
            style={{ background: "rgba(110,231,183,0.15)", border: "2px solid rgba(110,231,183,0.35)" }}>
            <Check size={24} strokeWidth={2} style={{ color: "#6EE7B7" }} />
          </div>

          {/* Heading */}
          <div className="text-center flex flex-col gap-2">
            <h1 className="font-[family-name:--font-cinzel] text-[30px] tracking-wider text-white/92">
              Your server is ready.
            </h1>
            <p className="font-[family-name:--font-geist-mono] text-[13px] text-white/40">
              <span className="text-[#C9A84C]/80">{specId}</span> has been generated successfully.
            </p>
          </div>

          {/* Instruction text */}
          <p className="font-[family-name:--font-cormorant] text-[16px] italic text-white/40 text-center">
            Unpack the ZIP, fill in <code className="font-[family-name:--font-geist-mono] text-[13px] not-italic text-white/50 bg-white/[0.07] px-1.5 py-0.5 rounded">.env</code> with your credentials, then run:
          </p>

          <pre className="w-full glass rounded-xl px-5 py-3.5 font-[family-name:--font-geist-mono] text-[13px] text-white/60 leading-relaxed">
            npm install{"\n"}npm start
          </pre>

          {/* Actions */}
          <div className="w-full flex flex-col gap-3">

            {/* Download as ZIP */}
            <button
              onClick={handleDownload}
              className="btn-gold cursor-pointer rounded-xl py-3.5 flex items-center justify-center gap-2.5
                font-[family-name:--font-cinzel] text-[13px] tracking-[0.12em] w-full"
            >
              <Download size={16} strokeWidth={2} />
              Download as ZIP
            </button>

            {/* Try in Helios */}
            <button
              className="cursor-pointer rounded-xl py-3.5 flex items-center justify-center gap-2.5 w-full
                font-[family-name:--font-cinzel] text-[13px] tracking-[0.12em] text-white/75
                hover:text-white transition-all duration-200"
              style={{
                background: "rgba(167,139,250,0.10)",
                border: "1px solid rgba(167,139,250,0.22)",
              }}
              onMouseEnter={e => (e.currentTarget.style.background = "rgba(167,139,250,0.18)")}
              onMouseLeave={e => (e.currentTarget.style.background = "rgba(167,139,250,0.10)")}
            >
              <Sparkles size={15} strokeWidth={1.5} />
              Try in Helios
            </button>
          </div>

          <Link href="/" className="font-[family-name:--font-cormorant] text-[15px] italic text-white/30 hover:text-white/60 transition-colors duration-200">
            ← Back to dashboard
          </Link>
        </div>
      </main>
    </div>
  )
}

export default function DownloadPage() {
  return (
    <Suspense>
      <DownloadContent />
    </Suspense>
  )
}
