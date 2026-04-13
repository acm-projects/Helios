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

          <div className="flex items-center gap-3 mt-6">
            <div className="flex-1 h-px bg-gray-200" />
            <span className="font-[family-name:--font-geist-sans] text-[12px] text-gray-400">or</span>
            <div className="flex-1 h-px bg-gray-200" />
          </div>

          <a
            href="http://localhost:8000/api/auth/google"
            className="mt-4 flex items-center justify-center gap-3 border-[1.5px] border-gray-300 px-8 py-3 text-[13px] font-[family-name:--font-geist-sans] text-gray-700 hover:border-black hover:text-black transition-colors duration-200 cursor-pointer"
          >
            <svg width="18" height="18" viewBox="0 0 48 48">
              <path fill="#4285F4" d="M44.5 20H24v8.5h11.7C34.2 33.6 29.7 37 24 37c-7.2 0-13-5.8-13-13s5.8-13 13-13c3.1 0 6 1.1 8.1 3l6-6C34.6 5.1 29.6 3 24 3 12.4 3 3 12.4 3 24s9.4 21 21 21c10.5 0 20-7.7 20-21 0-1.4-.1-2.7-.5-4z"/>
              <path fill="#34A853" d="M6.3 14.7l7 5.1C15 16.1 19.1 13 24 13c3.1 0 6 1.1 8.1 3l6-6C34.6 5.1 29.6 3 24 3c-7.7 0-14.3 4.4-17.7 11.7z"/>
              <path fill="#FBBC05" d="M24 45c5.5 0 10.5-1.9 14.4-5.1l-6.7-5.5C29.7 36.1 27 37 24 37c-5.7 0-10.2-3.4-11.7-8.5l-7 5.4C8.6 40.5 15.8 45 24 45z"/>
              <path fill="#EA4335" d="M44.5 20H24v8.5h11.7c-.8 2.3-2.3 4.2-4.2 5.5l6.7 5.5C42 36.2 45 30.6 45 24c0-1.4-.1-2.7-.5-4z"/>
            </svg>
            Continue with Google
          </a>

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
