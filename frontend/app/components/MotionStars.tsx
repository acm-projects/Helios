"use client"

import * as React from "react"

// Multi-color star palette — whites, ice-blues, golds, peach, red, violet, pink.
const STAR_COLORS = [
  "#ffffff", "#ffffff", "#ffffff",
  "#dfe7ff", "#c6d4ff", "#9bb0ff",
  "#fff0b8", "#ffcf6f",
  "#ffc79a", "#ff9458",
  "#ff7a5a",
  "#d4bcff", "#b495ff",
  "#ff9ed4",
]

const cn = (...classes: (string | undefined | null | false)[]) => classes.filter(Boolean).join(" ")

// Half-extent (px) of the star field around the viewport center. Generous
// enough to cover heavy browser zoom-out.
const FIELD_HALF = 3500

function generateStars(count: number) {
  const shadows: string[] = []
  for (let i = 0; i < count; i++) {
    const x = Math.floor(Math.random() * (FIELD_HALF * 2)) - FIELD_HALF
    const y = Math.floor(Math.random() * (FIELD_HALF * 2)) - FIELD_HALF
    const color = STAR_COLORS[Math.floor(Math.random() * STAR_COLORS.length)]
    shadows.push(`${x}px ${y}px ${color}`)
  }
  return shadows.join(", ")
}

type StarLayerProps = {
  count: number
  size: number
}

function StarLayer({ count, size }: StarLayerProps) {
  const [boxShadow, setBoxShadow] = React.useState<string>("")

  React.useEffect(() => {
    setBoxShadow(generateStars(count))
  }, [count])

  return (
    <div className="absolute top-1/2 left-1/2">
      <div
        className="absolute bg-transparent rounded-full"
        style={{ width: `${size}px`, height: `${size}px`, boxShadow }}
      />
    </div>
  )
}

type MotionStarsBackgroundProps = {
  className?: string
  // When true, no radial-gradient bg is painted — useful when stacking on top
  // of another background (like the galaxy canvas).
  transparent?: boolean
}

// Static multi-layer starfield centered on the viewport.
export function MotionStarsBackground({
  className,
  transparent = false,
}: MotionStarsBackgroundProps) {
  return (
    <div
      data-slot="stars-background"
      className={cn(
        "absolute inset-0 overflow-hidden",
        !transparent && "bg-[radial-gradient(ellipse_at_bottom,_#262626_0%,_#000_100%)]",
        className,
      )}
    >
      <StarLayer count={2200} size={1} />
      <StarLayer count={900} size={2} />
      <StarLayer count={400} size={3} />
    </div>
  )
}
