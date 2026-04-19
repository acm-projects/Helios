"use client"

import Link from "next/link"
import { useEffect, useRef } from "react"
import { createPortal } from "react-dom"
import { X, ExternalLink, ArrowRight } from "lucide-react"
import type { InfoSummary } from "@/lib/infoSummaries"

type Props = {
  chapter: string
  summary: InfoSummary
  onClose: () => void
}

export function InfoPopover({ chapter, summary, onClose }: Props) {
  const cardRef = useRef<HTMLDivElement | null>(null)

  // Esc to close + lock body scroll + blur page-wrapper while open
  useEffect(() => {
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    document.documentElement.classList.add("popup-open")
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => {
      document.body.style.overflow = prevOverflow
      document.documentElement.classList.remove("popup-open")
      window.removeEventListener("keydown", onKey)
    }
  }, [onClose])

  if (typeof document === "undefined") return null

  const content = (
    // NOTE: no opacity animation on this wrapper — parent opacity traps
    // backdrop-filter on the scrim child. Card drop-in animation covers
    // the visual fade-in on its own.
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center pt-[12vh] px-6"
      onClick={onClose}
      aria-modal="true"
      role="dialog"
    >
      {/* Scrim: blurs the page behind, no darkening */}
      <div aria-hidden="true" className="absolute inset-0 scrim-blur" />

      {/* Popover card */}
      <div
        ref={cardRef}
        onClick={e => e.stopPropagation()}
        className="relative z-[2] w-full max-w-[540px] glass-mid rounded-2xl overflow-hidden animate-info-drop-in"
        style={{ boxShadow: "0 32px 80px rgba(0,0,0,0.55)" }}
      >
        <div className="relative px-7 pt-6 pb-6 flex flex-col gap-4">
          {/* Header */}
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1.5 min-w-0">
              <span className="font-[family-name:--font-cinzel] text-[10px] tracking-[0.3em] uppercase text-[#C9A84C]/75">
                Quick Reference
              </span>
              <h3 className="font-[family-name:--font-cinzel] text-[18px] tracking-[0.12em] text-white/92 leading-tight">
                {summary.title}
              </h3>
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-white/55 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
            >
              <X size={16} strokeWidth={1.6} />
            </button>
          </div>

          {/* Divider */}
          <div className="h-px bg-white/[0.09]" />

          {/* Intro */}
          <p className="font-[family-name:--font-cormorant] italic text-[15.5px] leading-relaxed text-white/78">
            {summary.intro}
          </p>

          {/* Points */}
          <ul className="flex flex-col gap-2.5">
            {summary.points.map((p, i) => (
              <li
                key={i}
                className="flex gap-3 font-[family-name:--font-cormorant] text-[14.5px] leading-relaxed text-white/72"
              >
                <span className="shrink-0 mt-[7px] w-1 h-1 rounded-full bg-[#C9A84C]/70" />
                <span>{p}</span>
              </li>
            ))}
          </ul>

          {/* External quick links */}
          {summary.links && summary.links.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-1">
              {summary.links.map(link => (
                <a
                  key={link.href}
                  href={link.href}
                  target={link.external ? "_blank" : undefined}
                  rel={link.external ? "noopener noreferrer" : undefined}
                  data-no-transition="true"
                  className="group inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-white/[0.14] bg-white/[0.04] hover:bg-white/[0.08] hover:border-white/[0.24] transition-colors"
                >
                  <span className="font-[family-name:--font-geist-mono] text-[11.5px] tracking-wide text-white/80 group-hover:text-white">
                    {link.label}
                  </span>
                  {link.external && (
                    <ExternalLink size={11} strokeWidth={1.8} className="text-white/50 group-hover:text-white/85" />
                  )}
                </a>
              ))}
            </div>
          )}

          {/* Footer: link to full chapter */}
          <div className="pt-2 flex justify-end">
            <Link
              href={`/info?chapter=${encodeURIComponent(chapter)}`}
              onClick={onClose}
              className="group inline-flex items-center gap-2 px-4 py-2 rounded-full border border-[#C9A84C]/30 bg-[#C9A84C]/[0.08] hover:bg-[#C9A84C]/[0.14] hover:border-[#C9A84C]/55 transition-colors"
            >
              <span className="font-[family-name:--font-cinzel] text-[11px] tracking-[0.22em] uppercase text-[#E8C46A]">
                Read Full Chapter
              </span>
              <ArrowRight size={13} strokeWidth={1.8} className="text-[#E8C46A] group-hover:translate-x-0.5 transition-transform" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  )

  return createPortal(content, document.body)
}

export default InfoPopover
