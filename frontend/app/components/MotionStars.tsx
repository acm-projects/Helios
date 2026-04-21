"use client"

import * as React from "react"
import {
  type HTMLMotionProps,
  motion,
  type SpringOptions,
  type Transition,
  useMotionValue,
  useSpring,
} from "framer-motion"

// Multi-color star palette — keeps the warm/cool variety from the previous
// drifting starfield (whites, ice-blues, golds, peach, red, violet, pink).
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

type StarLayerProps = HTMLMotionProps<"div"> & {
  count: number
  size: number
  transition: Transition
}

function generateStars(count: number) {
  const shadows: string[] = []
  for (let i = 0; i < count; i++) {
    const x = Math.floor(Math.random() * 4000) - 2000
    const y = Math.floor(Math.random() * 4000) - 2000
    const color = STAR_COLORS[Math.floor(Math.random() * STAR_COLORS.length)]
    shadows.push(`${x}px ${y}px ${color}`)
  }
  return shadows.join(", ")
}

function StarLayer({
  count = 1000,
  size = 1,
  transition = { repeat: Infinity, duration: 50, ease: "linear" },
  className,
  ...props
}: StarLayerProps) {
  const [boxShadow, setBoxShadow] = React.useState<string>("")

  React.useEffect(() => {
    setBoxShadow(generateStars(count))
  }, [count])

  return (
    <motion.div
      data-slot="star-layer"
      animate={{ y: [0, -2000] }}
      transition={transition}
      className={cn("absolute top-0 left-0 w-full h-[2000px]", className)}
      {...props}
    >
      <div
        className="absolute bg-transparent rounded-full"
        style={{ width: `${size}px`, height: `${size}px`, boxShadow }}
      />
      <div
        className="absolute bg-transparent rounded-full top-[2000px]"
        style={{ width: `${size}px`, height: `${size}px`, boxShadow }}
      />
    </motion.div>
  )
}

type MotionStarsBackgroundProps = {
  factor?: number
  speed?: number
  spring?: SpringOptions
  className?: string
  // When true, no radial-gradient bg is painted — useful when stacking on top
  // of another background (like the galaxy canvas).
  transparent?: boolean
}

// Window-listener mouse parallax (instead of the snippet's onMouseMove on a
// wrapper) so this can sit behind page content as a `fixed inset-0`
// pointer-events-none layer and still react to the cursor.
export function MotionStarsBackground({
  factor = 0.05,
  speed = 120,
  spring = { stiffness: 50, damping: 20 },
  className,
  transparent = false,
}: MotionStarsBackgroundProps) {
  const offsetX = useMotionValue(0)
  const offsetY = useMotionValue(0)
  const springX = useSpring(offsetX, spring)
  const springY = useSpring(offsetY, spring)

  React.useEffect(() => {
    function onMove(e: MouseEvent) {
      const cx = window.innerWidth / 2
      const cy = window.innerHeight / 2
      offsetX.set(-(e.clientX - cx) * factor)
      offsetY.set(-(e.clientY - cy) * factor)
    }
    window.addEventListener("mousemove", onMove)
    return () => window.removeEventListener("mousemove", onMove)
  }, [factor, offsetX, offsetY])

  return (
    <div
      data-slot="stars-background"
      className={cn(
        "relative size-full overflow-hidden",
        !transparent && "bg-[radial-gradient(ellipse_at_bottom,_#262626_0%,_#000_100%)]",
        className,
      )}
    >
      <motion.div style={{ x: springX, y: springY }}>
        <StarLayer count={1000} size={1} transition={{ repeat: Infinity, duration: speed, ease: "linear" }} />
        <StarLayer count={400} size={2} transition={{ repeat: Infinity, duration: speed * 2, ease: "linear" }} />
        <StarLayer count={200} size={3} transition={{ repeat: Infinity, duration: speed * 3, ease: "linear" }} />
      </motion.div>
    </div>
  )
}
