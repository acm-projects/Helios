//starting protocol
/*
cd backend, npx tsx server.ts, npx tsx api.ts
cd frontend, npm run dev
*/
//ran on: http://localhost:3001/create

"use client"
import Image from "next/image"
import Link from "next/link"
import { useState } from "react"
import { useRouter } from "next/navigation"

export default function Create() {
  const [url, setUrl] = useState("")
  const [name, setName] = useState("")
  const [error, setError] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const router = useRouter()

  const handleSubmit = async () => {
    if (isLoading) return
    setIsLoading(true)
    setError("")
    const response = await fetch("http://localhost:8000/api/spec/parse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, name })
    })
    const data = await response.json()
    if (response.ok) {
      sessionStorage.setItem(`helios_draft_${data.specId}`, JSON.stringify({
        spec: data.spec,
        baseUrl: data.baseUrl,
        toolCount: data.toolCount,
        catalog: data.catalog
      }))
      router.push(`/sandbox?specId=${data.specId}`)
    } else {
      setError(data.error)
      setIsLoading(false)
    }
  }

  return (
  <div className="min-h-screen">
    <nav className="flex items-center justify-between px-6 pl-20">
      <Link href="/">
        <Image src="/logoName.svg" alt="Helios" width={200} height={200} className="cursor-pointer" />
      </Link>
      <div className="flex items-center gap-4 font-[family-name:--font-cinzel] text-[32px] tracking-widest">
        <span className="flex flex-col items-center text-black">
          Create
          <span className="block h-[2px] w-full bg-black mt-[-4px]"></span>
        </span>
        <span className="text-gray-400 text-[20px] mb-1">✦</span>
        <span className="text-gray-400">Sandbox</span>
        <span className="text-gray-400 text-[20px] mb-1">✦</span>
        <span className="text-gray-400">Verify</span>
        <span className="text-gray-400 text-[20px] mb-1">✦</span>
        <span className="text-gray-400">Download</span>
      </div>
      <div className="w-[220px]"></div>
    </nav>

    <main className="flex flex-col items-center justify-center h-[75vh] gap-8">
      <h1 className="font-[family-name:--font-cinzel] text-[48px] tracking-widest">New Server</h1>
      <div className="h-[1px] w-[480px] bg-black"></div>

      {error && <p className="font-[family-name:--font-cinzel] text-red-600 text-[22px] tracking-wider">{error}</p>}

      <div className="flex flex-col gap-4 w-[480px]">
        <input
          className="font-[family-name:--font-cinzel] border-[2px] border-gray-400 px-6 py-4 text-[18px] tracking-wider outline-none focus:border-black transition-colors duration-200 placeholder:text-gray-400"
          type="text"
          placeholder="Spec URL"
          value={url}
          onChange={e => setUrl(e.target.value)}
        />
        <input
          className="font-[family-name:--font-cinzel] border-[2px] border-gray-400 px-6 py-4 text-[18px] tracking-wider outline-none focus:border-black transition-colors duration-200 placeholder:text-gray-400"
          type="text"
          placeholder="Server Name"
          value={name}
          onChange={e => setName(e.target.value)}
        />
        <textarea
          className="font-[family-name:--font-cinzel] border-[2px] border-gray-400 px-6 py-4 text-[18px] tracking-wider outline-none focus:border-black transition-colors duration-200 placeholder:text-gray-400 resize-none"
          rows={4}
          placeholder="What do you want this server to do? (e.g. I only need search and retrieval endpoints)"
        />
      </div>

      <div className="flex items-center gap-6">
        <Link href="/">
          <button className="font-[family-name:--font-cinzel] cursor-pointer px-10 py-6 text-[24px] tracking-widest text-gray-400 border-[3px] border-gray-300 relative
            before:absolute before:inset-[6px] before:border-[1px] before:border-gray-300 before:pointer-events-none
            hover:border-black hover:text-black hover:before:border-black transition-colors duration-300">
            Back
          </button>
        </Link>
        <button
          onClick={handleSubmit}
          disabled={isLoading}
          className={`font-[family-name:--font-cinzel] px-16 py-6 text-[24px] tracking-widest border-[3px] relative
            before:absolute before:inset-[6px] before:border-[1px] before:pointer-events-none transition-colors duration-300
            ${isLoading
              ? "cursor-not-allowed text-gray-400 border-gray-300 before:border-gray-300"
              : "cursor-pointer text-black border-black before:border-black hover:bg-black hover:text-white hover:before:border-white"
            }`}
        >
          {isLoading ? "Generating..." : "Generate"}
        </button>
      </div>
    </main>
  </div>
  )
}
