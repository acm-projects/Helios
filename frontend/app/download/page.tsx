"use client"
import { Suspense } from "react"
import { useSearchParams } from "next/navigation"
import Image from "next/image"
import Link from "next/link"
import { getAuthHeaders } from "@/lib/auth"

function DownloadContent() {
  const params = useSearchParams()
  const specId = params.get("specId")

  function handleDownload() {
    const url = `http://localhost:8000/api/servers/${specId}/download`
    const a = document.createElement("a")
    a.href = url
    a.setAttribute("download", `${specId}-mcp-server.zip`)
    // attach auth header via fetch + blob since <a> can't send headers
    fetch(url, { headers: getAuthHeaders() })
      .then(res => res.blob())
      .then(blob => {
        a.href = URL.createObjectURL(blob)
        a.click()
        URL.revokeObjectURL(a.href)
      })
  }

  return (
    <div className="min-h-screen flex flex-col">
      <nav className="flex items-center px-6 pl-20">
        <Image src="/logoName.svg" alt="Helios" width={200} height={200} />
      </nav>

      <main className="flex-1 flex items-center justify-center">
        <div className="relative border-[2px] border-black px-14 py-12 w-[480px] flex flex-col gap-6
          before:absolute before:inset-[6px] before:border-[1px] before:border-black before:pointer-events-none">

          <h1 className="font-[family-name:--font-cinzel] text-[18px] tracking-widest uppercase">
            Your server is ready
          </h1>

          <p className="font-[family-name:--font-geist-sans] text-[14px] text-gray-500">
            Download the ZIP, unpack it, fill in <code className="bg-gray-100 px-1">.env</code> with your credentials, then run:
          </p>

          <pre className="bg-gray-50 border border-gray-200 px-4 py-3 text-[13px] font-mono text-gray-700">
            npm install{"\n"}npm start
          </pre>

          <div className="flex flex-col gap-3">
            <button
              onClick={handleDownload}
              className="font-[family-name:--font-cinzel] cursor-pointer px-8 py-4 text-[13px] tracking-widest text-white bg-black border-[2px] border-black relative
                before:absolute before:inset-[4px] before:border-[1px] before:border-white before:pointer-events-none
                hover:bg-white hover:text-black hover:before:border-black transition-colors duration-300"
            >
              Download ZIP
            </button>

            <button
              disabled
              className="font-[family-name:--font-cinzel] px-8 py-4 text-[13px] tracking-widest text-gray-400 border-[2px] border-gray-200 relative
                before:absolute before:inset-[4px] before:border-[1px] before:border-gray-200 before:pointer-events-none cursor-not-allowed"
            >
              Use in Helios — coming soon
            </button>
          </div>

          <Link href="/" className="font-[family-name:--font-geist-sans] text-[13px] text-gray-400 text-center hover:text-black transition-colors duration-200">
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
