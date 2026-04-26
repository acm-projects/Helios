import { chromium } from "playwright"
import { mkdirSync, readdirSync } from "node:fs"
import { resolve } from "node:path"

const url = process.argv[2] || "http://localhost:3001/try"
const dir = resolve("temporary screenshots")
mkdirSync(dir, { recursive: true })

const existing = readdirSync(dir)
  .map((f) => f.match(/^screenshot-(\d+)\.png$/))
  .filter(Boolean)
  .map((m) => parseInt(m[1], 10))
const next = (existing.length ? Math.max(...existing) : 0) + 1
const out = resolve(dir, `screenshot-${next}.png`)

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })
await ctx.addInitScript(() => {
  localStorage.setItem("helios_token", "fake-local-test-token")
})
const page = await ctx.newPage()
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 })
await page.waitForTimeout(2500)
await page.screenshot({ path: out, fullPage: false })
await browser.close()
console.log(out)
