// Per-server star tint. Mix of real stellar spectral classes (hot blue → red)
// plus exotic/fantasy nebula colors (cyan, lavender, purple, pink, magenta)
// for broader visual variety. Hash modulo palette length picks one per server.
export const SERVER_STAR_COLORS = [
  // Real stellar spectrum — hot to cool
  "#9bb0ff", // hot blue      (O/B)
  "#c6d4ff", // blue-white
  "#e8f0ff", // icy
  "#ffffff", // white         (A)
  "#fff0b8", // yellow-white  (F)
  "#ffcf6f", // yellow        (G, sun-like)
  "#ffc79a", // peach
  "#ff9458", // orange        (K)
  "#ff7a5a", // red            (M)

  // Exotic / nebula
  "#7dd3ff", // light blue / cyan
  "#89e8ff", // bright cyan
  "#d4bcff", // lavender
  "#b495ff", // purple
  "#a78bff", // deep violet
  "#ff9ed4", // nebula pink
  "#e884ff", // magenta
  "#9effc8", // mint / aqua
] as const

export function hashStr(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

export function getServerStarColor(id: string): string {
  const h = hashStr(id)
  return SERVER_STAR_COLORS[h % SERVER_STAR_COLORS.length]
}
