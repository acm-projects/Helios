// One-off: convert public/Background-*.svg to .jpg using headless Chromium.
// Originals are preserved in public/_originals/ so the change is reversible.
//
// Run from frontend/: node scripts/rasterize-backgrounds.mjs

import { chromium } from "playwright"
import { readdirSync, mkdirSync, renameSync, statSync } from "fs"
import { resolve, dirname, basename, extname } from "path"
import { fileURLToPath } from "url"

const __dirname     = dirname(fileURLToPath(import.meta.url))
const publicDir     = resolve(__dirname, "..", "public")
const originalsDir  = resolve(publicDir, "_originals")
const TARGET_W      = 2560
const TARGET_H      = 1707   // ~3:2, matches Background SVG viewBoxes
const JPEG_QUALITY  = 85

const svgFiles = readdirSync(publicDir).filter(f => /^Background-.*\.svg$/i.test(f))
if (svgFiles.length === 0) {
  console.log("No Background-*.svg files found in public/. Nothing to do.")
  process.exit(0)
}

mkdirSync(originalsDir, { recursive: true })

console.log(`Converting ${svgFiles.length} file(s) at ${TARGET_W}x${TARGET_H} JPEG q${JPEG_QUALITY}:`)
const browser = await chromium.launch()

let totalBefore = 0
let totalAfter  = 0

for (const file of svgFiles) {
  const srcPath   = resolve(publicDir, file)
  const outName   = basename(file, extname(file)) + ".jpg"
  const outPath   = resolve(publicDir, outName)
  const beforeKb  = Math.round(statSync(srcPath).size / 1024)
  totalBefore    += beforeKb

  const page = await browser.newPage({
    viewport: { width: TARGET_W, height: TARGET_H },
    deviceScaleFactor: 1,
  })

  const fileUrl = "file:///" + srcPath.replace(/\\/g, "/")
  await page.goto(fileUrl, { waitUntil: "load" })
  // When Chromium opens a .svg directly, the SVG is the document root —
  // there's no <body>. Just size the SVG itself to fill the viewport.
  await page.evaluate(([w, h]) => {
    const svg = document.documentElement
    if (svg && svg.tagName && svg.tagName.toLowerCase() === "svg") {
      svg.setAttribute("width", String(w))
      svg.setAttribute("height", String(h))
      svg.setAttribute("preserveAspectRatio", "xMidYMid slice")
      svg.style.display = "block"
    }
  }, [TARGET_W, TARGET_H])
  // give it a beat to finish complex-path layout
  await page.waitForTimeout(400)

  await page.screenshot({
    path: outPath,
    type: "jpeg",
    quality: JPEG_QUALITY,
    clip: { x: 0, y: 0, width: TARGET_W, height: TARGET_H },
  })
  await page.close()

  renameSync(srcPath, resolve(originalsDir, file))

  const afterKb = Math.round(statSync(outPath).size / 1024)
  totalAfter   += afterKb
  console.log(`  ✓ ${file.padEnd(28)}  ${String(beforeKb).padStart(5)} KB  →  ${outName.padEnd(28)}  ${String(afterKb).padStart(4)} KB`)
}

await browser.close()

const mbBefore = (totalBefore / 1024).toFixed(2)
const mbAfter  = (totalAfter  / 1024).toFixed(2)
const saved    = (((totalBefore - totalAfter) / totalBefore) * 100).toFixed(1)
console.log(`\nTotal: ${mbBefore} MB → ${mbAfter} MB   (saved ${saved}%)`)
console.log(`Originals backed up at: public/_originals/`)
