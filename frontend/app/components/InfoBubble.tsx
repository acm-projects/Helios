"use client"
import { useRef, useState } from "react"
import { Info } from "lucide-react"
import { getInfoSummary } from "@/lib/infoSummaries"
import InfoPopover from "./InfoPopover"

type Props = {
  chapter?: string
  externalUrl?: string
  /** Legacy tooltip text — kept for API compatibility; no longer rendered. */
  quick?: string
  ariaLabel?: string
  size?: number
  className?: string
}

/**
 * Clickable info glyph.
 * - Internal chapter: opens an in-page popover with a condensed chapter summary
 *   over a blurred full-page backdrop. Falls back to linking to
 *   /info?chapter=... if no summary is registered for the chapter.
 * - externalUrl: opens the provider dashboard in a new tab (unchanged).
 */
export function InfoBubble({ chapter, externalUrl, ariaLabel, size = 18, className }: Props) {
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement | null>(null)

  const isExternal = !!externalUrl
  const summary = chapter ? getInfoSummary(chapter) : null
  const label = ariaLabel ?? (isExternal ? "Open provider dashboard" : "Learn more")

  const icon = (
    <Info
      size={size}
      strokeWidth={1.8}
      className="text-white/80 hover:text-white transition-colors duration-150"
    />
  )

  const btnClass =
    `inline-flex items-center justify-center w-6 h-6 rounded-full cursor-pointer align-middle ${className ?? ""}`.trim()

  // External: just an anchor to the provider dashboard.
  if (isExternal) {
    return (
      <a
        href={externalUrl}
        target="_blank"
        rel="noopener noreferrer"
        data-no-transition="true"
        aria-label={label}
        className={btnClass}
      >
        {icon}
      </a>
    )
  }

  // Internal, but no summary registered → fall back to navigating to /info.
  if (chapter && !summary) {
    return (
      <a
        href={`/info?chapter=${encodeURIComponent(chapter)}`}
        aria-label={label}
        className={btnClass}
      >
        {icon}
      </a>
    )
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={btnClass}
      >
        {icon}
      </button>

      {open && chapter && summary && (
        <InfoPopover chapter={chapter} summary={summary} onClose={() => setOpen(false)} />
      )}
    </>
  )
}

export default InfoBubble
