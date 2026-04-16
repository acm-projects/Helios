import puppeteer from 'puppeteer'
import { mkdirSync } from 'fs'

const OUT = './blur-screenshots'
mkdirSync(OUT, { recursive: true })
const wait = ms => new Promise(r => setTimeout(r, ms))

const browser = await puppeteer.launch({
  headless: false,
  defaultViewport: { width: 1400, height: 900 },
})
const page = await browser.newPage()

async function shot(name) {
  await wait(1500)
  await page.screenshot({ path: `${OUT}/${name}.png` })
  console.log(`  screenshot: ${name}.png`)
}

async function getDiagnostics() {
  return page.evaluate(() => {
    const panel = document.querySelector('.glass-mid')
    if (!panel) return 'PANEL NOT FOUND'
    const cs = window.getComputedStyle(panel)
    const before = window.getComputedStyle(panel, '::before')

    // Check CSS variable
    const pageBg = getComputedStyle(document.documentElement).getPropertyValue('--page-bg').trim()

    // Check if ::before is visible: it should have non-empty background-image
    const beforeBg = before.backgroundImage

    // Check for any bad ancestors
    const bad = []
    let cur = panel.parentElement
    while (cur && cur !== document.body) {
      const s = window.getComputedStyle(cur)
      if ((s.transform && s.transform !== 'none') ||
          (s.willChange && s.willChange !== 'auto') ||
          (s.filter && s.filter !== 'none')) {
        bad.push({ cls: cur.className.slice(0,60), transform: s.transform, willChange: s.willChange, filter: s.filter })
      }
      cur = cur.parentElement
    }

    return {
      pageBgVar: pageBg || '(not set)',
      panelOverflow: cs.overflow,
      panelPosition: cs.position,
      panelZIndex: cs.zIndex,
      beforeBg: beforeBg?.slice(0, 80) || '(empty)',
      beforeFilter: before.filter || '(none)',
      beforeDisplay: before.display,
      badAncestors: bad,
    }
  })
}

// ── Login ──────────────────────────────────────────────────────────────────
await page.goto('http://localhost:3001/auth', { waitUntil: 'networkidle0' })
await page.waitForSelector('input[type="email"]', { timeout: 60000 })
await page.type('input[type="email"]', 'Rafam2406@gmail.com')
await page.type('input[type="password"]', 'Rafalou2015')
await Promise.all([
  page.keyboard.press('Enter'),
  page.waitForNavigation({ waitUntil: 'networkidle0' }).catch(() => {}),
])
await wait(1500)

// ── Hard nav to /create ────────────────────────────────────────────────────
await page.goto('http://localhost:3001/create', { waitUntil: 'networkidle0' })
await wait(2500)
const d1 = await getDiagnostics()
console.log('DIAGNOSTICS (fresh load):', JSON.stringify(d1, null, 2))
await shot('1-hard-nav-create')

// ── Client-side nav home → create ─────────────────────────────────────────
const homeLink = await page.$('a[href="/"], a[aria-label="Home"], header a')
if (homeLink) await homeLink.click()
await wait(2500)
await shot('2-home')

const createLink = await page.$('a[href="/create"]')
if (createLink) {
  await createLink.click()
} else {
  await page.goto('http://localhost:3001/create', { waitUntil: 'networkidle0' })
}
await wait(2500)
const d3 = await getDiagnostics()
console.log('DIAGNOSTICS (after nav):', JSON.stringify(d3, null, 2))
await shot('3-after-client-nav')

await browser.close()
