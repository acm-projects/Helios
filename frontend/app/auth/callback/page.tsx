"use client"
import { Suspense, useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { setToken } from "@/lib/auth"

function CallbackHandler() {
  const router = useRouter()
  const params = useSearchParams()

  useEffect(() => {
    const code = params.get("code")
    const error = params.get("error")

    if (!code) {
      router.replace(`/auth?error=${error ?? "unknown"}`)
      return
    }

    fetch("http://localhost:8000/api/auth/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    })
      .then((res) => {
        if (!res.ok) throw new Error("exchange_failed")
        return res.json()
      })
      .then((data: { token: string }) => {
        setToken(data.token)
        router.replace("/")
      })
      .catch(() => {
        router.replace("/auth?error=exchange_failed")
      })
  }, [params, router])

  return (
    <div className="min-h-screen flex items-center justify-center">
      <p className="font-[family-name:--font-geist-sans] text-[14px] text-gray-400">
        Signing you in...
      </p>
    </div>
  )
}

export default function AuthCallback() {
  return (
    <Suspense>
      <CallbackHandler />
    </Suspense>
  )
}
