"use client"

import { useEffect } from "react"
import { useRouter, usePathname } from "next/navigation"

const EXIT_MS = 180

export default function PageTransitionHandler() {
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (e.defaultPrevented) return
      if (e.button !== 0) return
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return

      const anchor = (e.target as HTMLElement | null)?.closest("a")
      if (!anchor) return
      if (anchor.target && anchor.target !== "_self") return
      if (anchor.hasAttribute("download")) return
      if (anchor.dataset.noTransition === "true") return

      const href = anchor.getAttribute("href")
      if (!href) return
      if (!href.startsWith("/") || href.startsWith("//")) return

      const url = new URL(href, window.location.origin)
      if (url.pathname === pathname) return

      e.preventDefault()
      e.stopPropagation()

      const wrapper = document.querySelector(".page-wrapper") as HTMLElement | null
      if (wrapper) {
        wrapper.classList.remove("page-entering")
        wrapper.classList.add("page-leaving")
      }

      window.setTimeout(() => {
        router.push(href)
      }, EXIT_MS)
    }

    document.addEventListener("click", handler, true)
    return () => document.removeEventListener("click", handler, true)
  }, [router, pathname])

  return null
}
