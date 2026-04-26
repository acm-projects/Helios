"use client"

import { useEffect, useMemo, useRef } from "react"
import { timer } from "d3-timer"
import { createNoise3D } from "simplex-noise"

interface RandomPlanetProps {
  size?: number
  seed?: number
  dotSpacingDeg?: number
  rotationSpeed?: number
  color?: string
  className?: string
}

function mulberry32(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "")
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h
  const n = parseInt(full, 16)
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
}
const rgba = (r: number, g: number, b: number, a: number) => `rgba(${r|0},${g|0},${b|0},${a})`
const scale = (rgb: [number, number, number], k: number): [number, number, number] =>
  [Math.min(255, rgb[0] * k), Math.min(255, rgb[1] * k), Math.min(255, rgb[2] * k)]

export default function RandomPlanet({
  size = 520,
  seed,
  dotSpacingDeg = 2,
  rotationSpeed = 0.07,
  color = "#ffcf6f",
  className = "",
}: RandomPlanetProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const resolvedSeed = useMemo(
    () => (seed !== undefined ? seed : Math.floor(Math.random() * 2 ** 31)),
    [seed],
  )

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const coronaMult = 1.8
    const canvasSide = Math.ceil(size * coronaMult)
    const radius = size / 2 - 2
    const cx = canvasSide / 2
    const cy = canvasSide / 2

    const dpr = window.devicePixelRatio || 1
    canvas.width = canvasSide * dpr
    canvas.height = canvasSide * dpr
    canvas.style.width = `${canvasSide}px`
    canvas.style.height = `${canvasSide}px`
    ctx.scale(dpr, dpr)

    const rng = mulberry32(resolvedSeed)
    const noise3D = createNoise3D(rng)

    const baseFreq = 1.2 + rng() * 0.6
    const octaves = 5

    const fbm = (x: number, y: number, z: number) => {
      let amp = 1
      let freq = baseFreq
      let sum = 0
      let norm = 0
      for (let i = 0; i < octaves; i++) {
        sum += amp * noise3D(x * freq, y * freq, z * freq)
        norm += amp
        amp *= 0.5
        freq *= 2
      }
      return sum / norm
    }

    // ── Granulation dots: percentile-banded size distribution ──
    // 10% empty · 40% small · 30% medium · 20% large.
    // Each dot is stored as a 3D unit vector on the sphere so we can rotate
    // it manually each frame and skip the back hemisphere — d3's projection()
    // call doesn't honour clipAngle, so backside dots would otherwise project
    // onto the same disc and drift in the opposite direction (visible bug).
    interface Dot3D { px: number; py: number; pz: number; size: number }
    const samples: { px: number; py: number; pz: number; n: number }[] = []
    const deg2rad = Math.PI / 180
    for (let lat = -88; lat <= 88; lat += dotSpacingDeg) {
      for (let lng = -180; lng < 180; lng += dotSpacingDeg) {
        const latR = lat * deg2rad
        const lngR = lng * deg2rad
        const cosLat = Math.cos(latR)
        // Match d3-geo's lng/lat → 3D convention: (lng=0, lat=0) sits at +Z,
        // (lng=90, lat=0) at +X, (lng=0, lat=90) at +Y.
        const px = cosLat * Math.sin(lngR)
        const py = Math.sin(latR)
        const pz = cosLat * Math.cos(lngR)
        samples.push({ px, py, pz, n: fbm(px, pz, py) })
      }
    }
    samples.sort((a, b) => a.n - b.n)
    const N = samples.length
    const dots: Dot3D[] = []
    for (let i = 0; i < N; i++) {
      const pct = i / N
      if (pct < 0.10) continue
      let sz: number
      if (pct < 0.50) sz = 1.0
      else if (pct < 0.80) sz = 1.7
      else sz = 2.6
      dots.push({ px: samples[i].px, py: samples[i].py, pz: samples[i].pz, size: sz })
    }

    const rotation: [number, number] = [rng() * 360, -10 + rng() * 20]

    // ── Mouse drag: rotate with cursor, pause auto-rotate while dragging ──
    let isDragging = false
    let dragStartX = 0
    let dragStartY = 0
    let dragStartRot: [number, number] = [0, 0]
    const dragSensitivity = 0.3

    const onMouseDown = (e: MouseEvent) => {
      isDragging = true
      dragStartX = e.clientX
      dragStartY = e.clientY
      dragStartRot = [rotation[0], rotation[1]]
      e.preventDefault()
    }
    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging) return
      const dx = e.clientX - dragStartX
      const dy = e.clientY - dragStartY
      rotation[0] = dragStartRot[0] + dx * dragSensitivity
      rotation[1] = Math.max(-80, Math.min(80, dragStartRot[1] + dy * dragSensitivity * 0.6))
    }
    const onMouseUp = () => { isDragging = false }

    canvas.addEventListener("mousedown", onMouseDown)
    window.addEventListener("mousemove", onMouseMove)
    window.addEventListener("mouseup", onMouseUp)

    const rgb = hexToRgb(color)

    // ── Pre-render static layer (disc + sunspots) ──
    const off = document.createElement("canvas")
    off.width = canvasSide * dpr
    off.height = canvasSide * dpr
    off.style.width = `${canvasSide}px`
    off.style.height = `${canvasSide}px`
    const oc = off.getContext("2d")!
    oc.scale(dpr, dpr)

    // Opaque tinted disc — blocks parallax stars behind the sphere
    // and gives the body a color distinct from the black starfield.
    const bodyTint = scale(rgb, 0.12)
    oc.fillStyle = rgba(bodyTint[0], bodyTint[1], bodyTint[2], 1)
    oc.beginPath()
    oc.arc(cx, cy, radius, 0, Math.PI * 2)
    oc.fill()

    // Soft rim highlight
    oc.strokeStyle = rgba(rgb[0], rgb[1], rgb[2], 0.35)
    oc.lineWidth = 1.1
    oc.beginPath()
    oc.arc(cx, cy, radius, 0, Math.PI * 2)
    oc.stroke()

    const dotColor = rgba(rgb[0], rgb[1], rgb[2], 0.92)

    const render = () => {
      ctx.clearRect(0, 0, canvasSide, canvasSide)
      ctx.drawImage(off, 0, 0, canvasSide, canvasSide)

      // Build rotation matrix matching d3-geo's rotate([λ, φ]) = Rx(-φ) ∘ Ry(λ).
      // Trig is computed once per frame, then 17 ops per visible dot.
      const cosL = Math.cos(rotation[0] * deg2rad)
      const sinL = Math.sin(rotation[0] * deg2rad)
      const cosF = Math.cos(rotation[1] * deg2rad)
      const sinF = Math.sin(rotation[1] * deg2rad)

      ctx.fillStyle = dotColor
      for (const d of dots) {
        // Rotated Z (depth) — positive = front hemisphere, negative = back.
        // Computed first so back-facing dots short-circuit before the 2D math.
        const rz = -cosF * sinL * d.px - sinF * d.py + cosF * cosL * d.pz
        if (rz <= 0) continue

        const rx = cosL * d.px + sinL * d.pz
        const ry = -sinF * sinL * d.px + cosF * d.py + sinF * cosL * d.pz

        ctx.beginPath()
        ctx.arc(cx + rx * radius, cy - ry * radius, d.size, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    const t = timer(() => {
      if (!isDragging) rotation[0] = (rotation[0] + rotationSpeed) % 360
      render()
    })

    return () => {
      t.stop()
      canvas.removeEventListener("mousedown", onMouseDown)
      window.removeEventListener("mousemove", onMouseMove)
      window.removeEventListener("mouseup", onMouseUp)
    }
  }, [size, resolvedSeed, dotSpacingDeg, rotationSpeed, color])

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{
        display: "block",
        pointerEvents: "auto",
        cursor: "grab",
        clipPath: `circle(${size / 2}px at 50% 50%)`,
      }}
      aria-hidden="true"
    />
  )
}
