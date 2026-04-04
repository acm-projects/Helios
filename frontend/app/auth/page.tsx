"use client"
import { useState } from "react"
import { useRouter } from "next/navigation"
import Image from "next/image"
import { setToken } from "@/lib/auth"

type View = "login" | "register"

export default function AuthPage() {
  const router = useRouter()
  const [view, setView] = useState<View>("login")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)

    const endpoint = view === "login" ? "/api/auth/login" : "/api/auth/register"

    try {
      const res = await fetch(`http://localhost:8000${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error ?? "Something went wrong")
        return
      }

      setToken(data.token)
      router.push("/")
    } catch {
      setError("Could not connect to server")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col">
      <nav className="flex items-center px-6 pl-20">
        <Image src="/logoName.svg" alt="Helios" width={200} height={200} />
      </nav>

      <main className="flex-1 flex items-center justify-center">
        <div className="relative border-[2px] border-black px-14 py-12 w-[440px]
          before:absolute before:inset-[6px] before:border-[1px] before:border-black before:pointer-events-none">

          {/* Tab switcher */}
          <div className="flex mb-10 border-b-[1px] border-gray-200">
            {(["login", "register"] as View[]).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => { setView(v); setError(null) }}
                className={`font-[family-name:--font-cinzel] text-[12px] tracking-widest px-6 pb-3 uppercase transition-colors duration-200 cursor-pointer
                  ${view === v
                    ? "border-b-[2px] border-black text-black -mb-[1px]"
                    : "text-gray-400 hover:text-black"
                  }`}
              >
                {v === "login" ? "Sign In" : "Register"}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <label className="font-[family-name:--font-cinzel] text-[11px] tracking-widest text-gray-500 uppercase">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="border-[1.5px] border-gray-300 px-4 py-3 text-[14px] font-[family-name:--font-geist-sans] outline-none focus:border-black transition-colors duration-200"
              />
            </div>

            <div className="flex flex-col gap-2">
              <label className="font-[family-name:--font-cinzel] text-[11px] tracking-widest text-gray-500 uppercase">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                autoComplete={view === "login" ? "current-password" : "new-password"}
                minLength={8}
                className="border-[1.5px] border-gray-300 px-4 py-3 text-[14px] font-[family-name:--font-geist-sans] outline-none focus:border-black transition-colors duration-200"
              />
            </div>

            {error && (
              <p className="font-[family-name:--font-geist-sans] text-[13px] text-red-500">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="mt-2 font-[family-name:--font-cinzel] cursor-pointer px-8 py-4 text-[13px] tracking-widest text-white bg-black border-[2px] border-black relative
                before:absolute before:inset-[4px] before:border-[1px] before:border-white before:pointer-events-none
                hover:bg-white hover:text-black hover:before:border-black transition-colors duration-300
                disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? "..." : view === "login" ? "Sign In" : "Create Account"}
            </button>
          </form>

          <p className="mt-6 font-[family-name:--font-geist-sans] text-[13px] text-gray-400 text-center">
            {view === "login" ? "No account?" : "Already have one?"}{" "}
            <button
              type="button"
              onClick={() => { setView(view === "login" ? "register" : "login"); setError(null) }}
              className="text-black underline cursor-pointer hover:no-underline"
            >
              {view === "login" ? "Register" : "Sign in"}
            </button>
          </p>
        </div>
      </main>
    </div>
  )
}
