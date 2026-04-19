"use client"

import { useEffect, useRef, useState } from "react"

export default function Template({ children }: { children: React.ReactNode }) {
  const [entering, setEntering] = useState(true)
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onEnd = () => setEntering(false)
    el.addEventListener("animationend", onEnd, { once: true })
    const safety = window.setTimeout(onEnd, 650)
    return () => {
      el.removeEventListener("animationend", onEnd)
      window.clearTimeout(safety)
    }
  }, [])

  return (
    <div ref={ref} className={`page-wrapper transition-[filter] duration-300${entering ? " page-entering" : ""}`}>
      {children}
    </div>
  )
}
