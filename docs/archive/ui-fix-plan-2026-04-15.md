# Helios UI Fix Plan
Generated from team feedback — 2026-04-15

---

## Files in scope
- `app/page.tsx` — Home / dashboard
- `app/create/page.tsx` — Create / Edit tool builder
- `app/sandbox/page.tsx` — Sandbox chat
- `app/verify/page.tsx` — Tool catalog verify
- `app/globals.css` — Shared glass utilities

---

## Checklist

### page.tsx (Home)
- [x] Move HELIOS title to left — same style as other page headers, no decorative sparkle lines
- [x] "MCP Server Generator" subtitle: `text-white/35` → `text-white/60`
- [x] "Transform any API" italic: `text-white/35` → `text-white/60`
- [x] "Your Servers" section heading: `text-white/35` → `text-white/65`
- [x] Server cards — tool count badge: `text-white/45` → `text-white/65`
- [x] Server cards — base URL: `text-white/35` → `text-white/55`
- [x] Info / Keys buttons: `text-white/55` → `text-white/75`
- [x] Empty / loading state text: bump opacity
- [x] Account dropdown items: `text-white/60` → `text-white/75`

### create/page.tsx (Create / Edit)
- [x] Detect edit mode (`helios_edit_source` in sessionStorage on mount)
- [x] Show "Edit" in step breadcrumb instead of "Create" when in edit mode
- [x] Change Cancel button label to "← Back" in edit mode
- [x] Auto-expand tool group when it's first added (`handlePopupConfirm` → add apiName to `expanded`)
- [x] Intent page: bold the tool count (`<strong>`) in "it will filter your N tools"
- [x] Section labels (Previous, Added Tools): bump opacity to `/70`
- [x] Popup description text: `text-white/30` → `text-white/55`
- [x] "Coming soon" text: `text-white/35` → `text-white/55`
- [x] Bottom bar hint text: `text-white/55` → `text-white/75`
- [x] Size up: popup Add button `py-3.5` → `py-4`, `text-[16px]` → `text-[17px]`

### sandbox/page.tsx (Sandbox)
- [x] Fix Tool List → API Keys tab transition glitch: always render both panels, animate both with max-height simultaneously
- [x] Increase chat area width: `max-w-2xl` → `max-w-[820px]` (both messages + input areas)
- [x] "Thinking..." text: `text-white/35` → `text-white/60`
- [x] Tool call "N tools called" text: `text-white/30` → `text-white/55`
- [x] Tool input JSON: `text-white/40` → `text-white/60`
- [x] Reset Chat button: `text-white/35` → `text-white/60`
- [x] Panel tab unselected: `text-white/55` → `text-white/70`

### verify/page.tsx (Verify / Tool Catalog)
- [x] Fetch server list on mount; warn if chosen server name already exists (amber warning, non-blocking)
- [x] Warning: "A server named '...' already exists — saving will overwrite it."
- [x] Stats line: `text-white/50` → `text-white/70`
- [x] Tool description text: `text-white/40` → `text-white/60`
- [x] Edit label/input labels: `text-white/30` → `text-white/55`
- [x] Path text in edit expand: `text-white/20` → `text-white/45`
- [x] Back button: `text-white/45` → `text-white/65`
- [x] Tool name size: `text-[12px]` → `text-[14px]`
- [x] Tool row padding: `py-4` → `py-5`

### globals.css
- [x] `glass-input` border: `rgba(255,255,255,0.666)` → `rgba(255,255,255,0.22)` (was too white)
- [x] Added `.glass-blur` utility with `blur(24px)` for inline panels

---

## Notes
- TypeScript: `✓ Compiled successfully` — clean
- `/sandbox` prerender error is pre-existing (useSearchParams needs Suspense) — not from these changes
- Fonts: Cormorant (body) + Cinzel (labels/display). Geist Mono only for code/URLs/method badges.
- Edit mode: detected via `sessionStorage.getItem("helios_edit_source")` — no new page needed.
- Duplicate name: client-side amber warning + backend upsert handles the actual save.
