import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

const BASE = 'http://localhost:3001';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.setViewportSize({ width: 1440, height: 900 });

// ── 1. Capture auth page (accessible without login) ──────────────────
await page.goto(`${BASE}/auth`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500); // let animations settle
await page.screenshot({ path: 'screenshot-auth-before.png' });

// ── 2. Inspect computed styles on the full ancestor chain ─────────────
const ancestorReport = await page.evaluate(() => {
  const results = [];

  // Find all glass elements
  const glassEls = document.querySelectorAll('.glass, .glass-mid, .glass-blur');
  if (glassEls.length === 0) {
    results.push({ note: 'No .glass elements found on this page' });
  }

  for (const el of glassEls) {
    const chain = [];
    let node = el;
    while (node && node.tagName !== 'HTML') {
      const cs = window.getComputedStyle(node);
      const transform = cs.transform;
      const filter = cs.filter;
      const opacity = parseFloat(cs.opacity);
      const willChange = cs.willChange;
      const isolation = cs.isolation;
      const overflow = cs.overflow;
      const backdropFilter = cs.backdropFilter || cs.webkitBackdropFilter;
      const zIndex = cs.zIndex;
      const position = cs.position;

      const flags = [];
      if (transform !== 'none' && transform !== 'matrix(1, 0, 0, 1, 0, 0)') flags.push(`transform: ${transform}`);
      if (filter !== 'none') flags.push(`filter: ${filter}`);
      if (opacity < 1) flags.push(`opacity: ${opacity}`);
      if (willChange && willChange !== 'auto') flags.push(`will-change: ${willChange}`);
      if (isolation === 'isolate') flags.push(`isolation: isolate`);
      if (overflow === 'hidden') flags.push(`overflow: hidden`);

      chain.push({
        tag: node.tagName + (node.className ? '.' + [...node.classList].join('.').substring(0, 80) : ''),
        compositing_flags: flags,
        backdrop_filter_on_self: backdropFilter !== 'none' ? backdropFilter : null,
        z_index: zIndex,
        position,
      });
      node = node.parentElement;
    }
    results.push({
      element: el.tagName + '.' + [...el.classList].join('.').substring(0, 80),
      ancestor_chain: chain,
    });
    break; // just the first glass element is enough
  }

  return results;
});

// ── 3. Check the motion.div specifically ─────────────────────────────
const motionDivReport = await page.evaluate(() => {
  // Find any div with transform applied (likely Framer Motion)
  const allDivs = document.querySelectorAll('div');
  const transformed = [];
  for (const div of allDivs) {
    const cs = window.getComputedStyle(div);
    const t = cs.transform;
    if (t && t !== 'none' && t !== 'matrix(1, 0, 0, 1, 0, 0)') {
      transformed.push({
        classes: [...div.classList].join(' ').substring(0, 100),
        transform: t,
        willChange: cs.willChange,
        opacity: cs.opacity,
        children: div.childElementCount,
      });
    }
  }
  return transformed;
});

// ── 4. Detailed ::before check ────────────────────────────────────────
const beforeReport = await page.evaluate(() => {
  const el = document.querySelector('.glass');
  if (!el) return 'No .glass element';

  // We can't directly query computed styles of ::before via JS in this way,
  // but we can check the element's stacking context properties
  const cs = window.getComputedStyle(el);
  const beforeCs = window.getComputedStyle(el, '::before');

  return {
    element: {
      position: cs.position,
      zIndex: cs.zIndex,
      isolation: cs.isolation,
      transform: cs.transform,
      opacity: cs.opacity,
      overflow: cs.overflow,
    },
    before: {
      backdropFilter: beforeCs.backdropFilter || beforeCs.webkitBackdropFilter,
      height: beforeCs.height,
      position: beforeCs.position,
      zIndex: beforeCs.zIndex,
      maskImage: beforeCs.maskImage || beforeCs.webkitMaskImage,
      content: beforeCs.content,
    }
  };
});

// ── 5. Check background element ───────────────────────────────────────
const bgReport = await page.evaluate(() => {
  // Fixed elements with background-image
  const fixed = [...document.querySelectorAll('*')].filter(el => {
    const cs = window.getComputedStyle(el);
    return cs.position === 'fixed' && cs.backgroundImage !== 'none';
  });
  return fixed.map(el => ({
    tag: el.tagName,
    classes: [...el.classList].join(' '),
    zIndex: window.getComputedStyle(el).zIndex,
    backgroundImage: window.getComputedStyle(el).backgroundImage.substring(0, 120),
    filter: window.getComputedStyle(el).filter,
  }));
});

const report = {
  url: page.url(),
  glassAncestorChain: ancestorReport,
  transformedDivs: motionDivReport,
  glassElementDetail: beforeReport,
  backgroundElements: bgReport,
};

writeFileSync('blur-investigation-report.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

await browser.close();
