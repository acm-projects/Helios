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
  const router = useRouter()

  const handleSubmit = async () => {
    const response = await fetch("http://localhost:8000/api/spec/parse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, name })
    })
    const data = await response.json()
    if (response.ok) {
      router.push(`/sandbox?specId=${data.specId}`)
    } else {
      setError(data.error)
    }
  }

  return (
  <div className="min-h-screen">
    <nav className="flex items-center justify-between px-6 pl-20">
      <Link href="/">
        <Image src="/logoName.svg" alt="Helios" width={200} height={200} className="cursor-pointer" />
      </Link>
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

      <button
        onClick={handleSubmit}
        className="font-[family-name:--font-cinzel] cursor-pointer px-16 py-6 text-[24px] tracking-widest text-black border-[3px] border-black relative
          before:absolute before:inset-[6px] before:border-[1px] before:border-black before:pointer-events-none
          hover:bg-black hover:text-white hover:before:border-white transition-colors duration-300"
      >
        Generate
      </button>
    </main>
  </div>
  )
}
