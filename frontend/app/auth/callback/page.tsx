"use client"
import { Suspense, useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { setToken } from "@/lib/auth"

function CallbackHandler() {
  const router = useRouter()
  const params = useSearchParams()

  useEffect(() => {
    const token = params.get("token")
    const error = params.get("error")

    if (token) {
      setToken(token)
      router.replace("/")
    } else {
      router.replace(`/auth?error=${error ?? "unknown"}`)
    }
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
