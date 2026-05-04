"use client"
import { useState } from "react"
import { useRouter } from "next/navigation"
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
      if (!res.ok) { setError(data.error ?? "Something went wrong"); return }
      setToken(data.token)
      router.refresh()
      router.push("/")
    } catch {
      setError("Could not connect to server")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen relative flex flex-col">

      {/* ── Background ──────────────────────────────────────────────────── */}

      {/* ── Header ───────────────────────────────────────────────────── */}
      {/* Auth page suppresses the top-left HELIOS title — branding lives
          in the gold badge above the auth card instead. */}
      <div className="relative z-30 flex items-center px-8 h-[62px]" />

      {/* ── Auth card ────────────────────────────────────────────────────── */}
      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="glass-mid rounded-3xl px-10 py-10 w-full max-w-[420px] animate-fade-up
          shadow-[0_32px_80px_rgba(0,0,0,0.45)]">

          {/* Logo + heading */}
          <div className="flex flex-col items-center gap-3 mb-8">
            <span
              className="font-[family-name:--font-cinzel] text-[44px] font-bold tracking-[0.15em] leading-none"
              style={{
                background: "linear-gradient(135deg,#C9A84C,#E8C46A)",
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                WebkitTextFillColor: "transparent",
                color: "transparent",
              }}
            >
              Helios
            </span>
            <p className="font-[family-name:--font-cormorant] text-[15px] italic text-white/40">
              {view === "login" ? "Welcome back" : "Create your account"}
            </p>
          </div>

          {/* Tab switcher */}
          <div className="flex mb-7 rounded-xl overflow-hidden p-1"
            style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.09)" }}>
            {(["login", "register"] as View[]).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => { setView(v); setError(null) }}
                className={`flex-1 py-2.5 font-[family-name:--font-cinzel] text-[11px] tracking-[0.18em] uppercase
                  rounded-lg transition-all duration-200 cursor-pointer ${
                  view === v
                    ? "bg-white/[0.12] text-white shadow-sm border border-white/[0.12]"
                    : "text-white/35 hover:text-white/60"
                }`}
              >
                {v === "login" ? "Sign In" : "Register"}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <label className="font-[family-name:--font-cinzel] text-[10px] tracking-[0.22em] text-white/40 uppercase">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoComplete="email"
                placeholder="you@example.com"
                className="glass-input rounded-xl px-4 py-3 text-[14px] font-[family-name:--font-geist-sans]"
              />
            </div>

            <div className="flex flex-col gap-2">
              <label className="font-[family-name:--font-cinzel] text-[10px] tracking-[0.22em] text-white/40 uppercase">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                autoComplete={view === "login" ? "current-password" : "new-password"}
                minLength={8}
                placeholder="••••••••"
                className="glass-input rounded-xl px-4 py-3 text-[14px] font-[family-name:--font-geist-sans]"
              />
            </div>

            {error && (
              <p className="font-[family-name:--font-cormorant] text-[15px] text-red-400/90 text-center">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="mt-2 btn-gold cursor-pointer rounded-xl py-3.5 text-[13px] font-[family-name:--font-cinzel] tracking-[0.18em]"
            >
              {submitting ? "..." : view === "login" ? "Sign In" : "Create Account"}
            </button>
          </form>

          <div className="flex items-center gap-3 my-6">
            <div className="flex-1 h-px bg-white/[0.09]" />
            <span className="font-[family-name:--font-cormorant] text-[13px] text-white/30 italic">or</span>
            <div className="flex-1 h-px bg-white/[0.09]" />
          </div>

          <a
            href="http://localhost:8000/api/auth/google"
            className="flex items-center justify-center gap-3 glass rounded-xl px-4 py-3
              font-[family-name:--font-geist-sans] text-[13px] text-white/60
              hover:text-white hover:bg-white/[0.11] transition-all duration-200 cursor-pointer"
          >
            <svg width="16" height="16" viewBox="0 0 48 48">
              <path fill="#4285F4" d="M44.5 20H24v8.5h11.7C34.2 33.6 29.7 37 24 37c-7.2 0-13-5.8-13-13s5.8-13 13-13c3.1 0 6 1.1 8.1 3l6-6C34.6 5.1 29.6 3 24 3 12.4 3 3 12.4 3 24s9.4 21 21 21c10.5 0 20-7.7 20-21 0-1.4-.1-2.7-.5-4z"/>
              <path fill="#34A853" d="M6.3 14.7l7 5.1C15 16.1 19.1 13 24 13c3.1 0 6 1.1 8.1 3l6-6C34.6 5.1 29.6 3 24 3c-7.7 0-14.3 4.4-17.7 11.7z"/>
              <path fill="#FBBC05" d="M24 45c5.5 0 10.5-1.9 14.4-5.1l-6.7-5.5C29.7 36.1 27 37 24 37c-5.7 0-10.2-3.4-11.7-8.5l-7 5.4C8.6 40.5 15.8 45 24 45z"/>
              <path fill="#EA4335" d="M44.5 20H24v8.5h11.7c-.8 2.3-2.3 4.2-4.2 5.5l6.7 5.5C42 36.2 45 30.6 45 24c0-1.4-.1-2.7-.5-4z"/>
            </svg>
            Continue with Google
          </a>

          <p className="mt-6 font-[family-name:--font-cormorant] text-[14px] text-white/35 text-center">
            {view === "login" ? "No account?" : "Already have one?"}{" "}
            <button
              type="button"
              onClick={() => { setView(view === "login" ? "register" : "login"); setError(null) }}
              className="text-[#C9A84C] hover:text-[#E8C46A] transition-colors cursor-pointer underline decoration-[#C9A84C]/40"
            >
              {view === "login" ? "Register" : "Sign in"}
            </button>
          </p>
        </div>
      </main>
    </div>
  )
}
