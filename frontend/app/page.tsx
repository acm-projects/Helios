//starting protocol
/*
cd backend, npx tsx server.ts, npx tsx api.ts
cd frontend, npm run dev
*/
//ran on: http://localhost:3000/

"use client"
import { useState } from "react"
import { useRouter } from "next/navigation"
export default function Home() {
  const [url, setUrl] = useState("")
  const [name, setName] = useState("")
  const router = useRouter()
  const [error, setError] = useState("")

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
    <div className="flex flex-col min-h-screen items-center justify-center gap-4">
      <h1 className="text-4xl font-bold mb-8">Helios</h1>
      {error && <p className="text-red-500">{error}</p>}
      <input className="w-64 text-center px-4 py-2" type="text" placeholder="Spec URL" value={url} onChange={e => setUrl(e.target.value)}/>
        <input className="w-64 text-center px-4 py-2" type="text" placeholder="Name" value={name} onChange={e => setName(e.target.value)} />
      <button onClick={handleSubmit}>Submit</button>
    </div>
  )
}

