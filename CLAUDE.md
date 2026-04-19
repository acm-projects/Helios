# CLAUDE.md — Helios

This file provides guidance to Claude Code when working inside the `Helios/` directory.

---

## Project: Helios

**Helios** is an intelligent MCP (Model Context Protocol) server generator. It transforms complex APIs into clean, agent-friendly tool interfaces using user intent alongside API documentation to generate optimized MCP servers — reducing tool overload for AI agents.

Core user flow: `API spec input → sandbox test → intent description → tool grouping preview → MCP server code generation → download/deploy`

---

## Screenshot Workflow

Playwright MCP is active — use it to visually verify UI changes and iterate until the result looks correct.

**Always screenshot from `http://localhost:3000`** (or port 3001 if 3000 is taken by the MCP server).

### How to take a screenshot
Use the Playwright MCP `browser_navigate` + `browser_screenshot` tools. Save screenshots to `Helios/frontend/temporary screenshots/` as auto-incremented PNGs — never overwrite a previous one:

```
screenshot-1.png, screenshot-2.png, screenshot-3.png ...
```

After taking a screenshot, **read the PNG immediately with the Read tool** so you can see and analyze the result directly before making the next change.

### Iteration loop
1. Make a UI change
2. Navigate to the page with Playwright
3. Take a screenshot → save to `temporary screenshots/screenshot-N.png`
4. Read the PNG with the Read tool
5. Identify what's wrong — be specific
6. Fix → repeat until it looks right

### What to check in each screenshot
- Spacing and padding (exact px — "gap should be 16px not 32px")
- Font size, weight, line-height
- Colors (exact hex values)
- Alignment — horizontal and vertical
- Border radius and shadows
- Image sizing and aspect ratios
- Responsive behavior if relevant

Never declare UI work done without taking a final screenshot and reading it.

---

## Assets

All logo and background images are SVGs located in `Helios/frontend/public/`. Use them directly via the `/` path in Next.js (e.g., `<img src="/logo.svg" />` or as a CSS `background-image`). SVGs are preferred over raster images for all branding and decorative elements — they scale perfectly and stay sharp at any size.

When building UI, always check `public/` first before creating placeholder visuals or importing external assets.

---

## Frontend Design

When building any new UI pages, components, or visual layouts for the Helios frontend, invoke the `frontend-design` skill:

```
/frontend-design
```

This applies to: new pages, redesigned components, landing/onboarding flows, dashboard layouts, and any visual work where design quality matters. Use it before writing frontend code, not after.

---

## Agent Routing

| Task | Agent |
|------|-------|
| Write backend API routes, services, middleware | `helios-backend-engineer` |
| Write frontend pages, components, UI | `helios-frontend-dev` |
| Wire frontend to backend (fetch, auth headers, state) | `frontend-backend-integrator` |
| Review backend integration code for production readiness | `backend-integration-auditor` |

---

## Work Protocol

Every task follows a plan → execute → verify loop. The specific steps differ by domain. Never skip the plan step. Never declare work done without running the verification for that domain.

---

### Frontend Work
**Agent: `helios-frontend-dev`** — invoke for any new page, component, or visual change.
**Skill: `/frontend-design`** — invoke before writing code for any new UI surface.

```
1. PLAN
   - State which page/component is changing and why
   - List every file you will touch (page.tsx, component, styles)
   - Describe the expected visual outcome before writing a single line
   - Check public/ for any SVGs or assets you'll need

2. DESIGN (new UI only)
   - Invoke /frontend-design skill before writing any code
   - Lock the design direction before implementation

3. EXECUTE
   - Read every file you're editing before changing it
   - Make one logical change at a time — don't bundle unrelated edits
   - Use shadcn/ui primitives, Tailwind only, no inline styles

4. VERIFY — screenshot loop (minimum 2 rounds)
   Round 1:
     - Start the dev server if not running (npm run dev in Helios/frontend)
     - Navigate to the page with Playwright browser_navigate
     - Take a screenshot → save to Helios/frontend/temporary screenshots/screenshot-N.png
     - Read the PNG with the Read tool
     - List every specific problem (wrong spacing, color, alignment, size)
     - Fix all issues found

   Round 2 (required):
     - Take another screenshot after fixes
     - Read it — confirm every problem from Round 1 is resolved
     - If new issues found, fix and take a Round 3

5. DONE CRITERIA
   - Final screenshot shows the intended result
   - No console errors visible
   - Loading and error states are handled (not just the happy path)
```

---

### Backend Work
**Agent: `helios-backend-engineer`** — invoke for any new route, model change, or service logic.
**Auditor: `backend-integration-auditor`** — invoke after writing any new route before marking it done.

```
1. PLAN
   - State the route(s) being added or changed
   - Identify: what it validates, what DB operations it runs, whether AI is involved
   - List every file you will touch (api.ts, models, auth, sandbox.ts, etc.)
   - Check if a similar route already exists — don't duplicate

2. EXECUTE
   - Read the full file before editing
   - Validate inputs at the route boundary before any DB or business logic
   - JWT auth check before any business logic on protected routes
   - AbortController + timeout on every external fetch()
   - Never log tokens, secrets, or keys
   - Use Mongoose models — never raw MongoDB driver

3. VERIFY — functional check (minimum 2 rounds)
   Round 1:
     - Start api.ts if not running (npx tsx api.ts in Helios/backend)
     - Test the route with a direct curl or fetch call
     - Confirm: correct status code, correct response shape, error cases return proper codes (400/401/404/500)
     - Test the failure path — bad input, missing auth, not found

   Round 2 (required):
     - Run backend-integration-auditor agent on the new route
     - Fix every issue it flags before proceeding

4. DONE CRITERIA
   - Happy path returns correct response
   - All error paths return correct HTTP codes
   - No secrets logged
   - Auditor has reviewed and found no blocking issues
```

---

### Integration Work
**Agent: `frontend-backend-integrator`** — invoke when wiring a frontend page to a backend route.

```
1. PLAN
   - State which frontend page is calling which backend route
   - Write out the exact request shape the frontend will send
   - Write out the exact response shape the backend returns
   - If shapes don't match — stop and resolve the mismatch before writing any code
     (show both shapes side by side, confirm which side is source of truth)
   - Identify which sessionStorage keys are read or written by this page

2. EXECUTE
   - Read both the frontend page and the backend route before touching either
   - Every fetch must have: try/catch, response.ok check, loading state, error state
   - Use getAuthHeaders() — never inline the JWT header
   - Write sessionStorage only on confirmed success
   - Sandbox page: always clear stale sessionId and re-call /api/sandbox/start on mount

3. VERIFY — end-to-end check (minimum 2 rounds)
   Round 1:
     - Start all three servers (MCP port 3000, API port 8000, frontend port 3001)
     - Navigate to the page with Playwright
     - Screenshot the initial load state — confirm loading spinner appears
     - Complete the action that triggers the fetch
     - Screenshot the result — confirm data displays correctly
     - Open browser devtools Network tab via Playwright and confirm:
         - Request payload matches what the backend expects
         - Response status is 2xx
         - No 401/403/404/500 errors

   Round 2 (required):
     - Test the failure path: disconnect or corrupt the request
     - Screenshot the error state — confirm error message is visible and non-technical
     - Confirm the UI does not freeze in a loading state on failure

4. DONE CRITERIA
   - Happy path: data loads and displays correctly
   - Error path: error message shown, loading state cleared
   - No shape mismatches between frontend payload and backend expectation
   - sessionStorage keys written at correct points in the flow
   - Final screenshots saved in temporary screenshots/ for reference
```

---

## Dev Commands

```bash
# Terminal 1 — MCP server (port 3000)
cd Helios/backend
npx tsx server.ts

# Terminal 2 — API server (port 8000)
cd Helios/backend
npx tsx api.ts

# Terminal 3 — Next.js frontend (port 3001)
cd Helios/frontend
npm run dev
```

```bash
# Other frontend commands
cd Helios/frontend
npm run build    # Production build
npm run lint     # ESLint
```

---

## Architecture

### Two-Server Backend
- **`server.ts`** (port 3000) — MCP server. Handles `/mcp` protocol route. Accepts tool registry per-session via `req.body.params.toolsRegistry` on initialize — no global `tools.json`. Each session gets its own `McpServer` instance in a `Map<sessionId, transport>`.
- **`api.ts`** (port 8000) — Express API server. Three routes drive the entire frontend:
  - `POST /api/spec/parse` — validates URL, parses OpenAPI spec, saves to MongoDB with user-provided name as `_id`, returns `{ specId }`
  - `POST /api/sandbox/start` — fetches spec from MongoDB, runs `generateToolRegistry()`, calls `initializeAgent(registry)` on the MCP server, returns `{ sessionId, tools }` (tools in OpenAI format)
  - `POST /api/sandbox/chat` — stateless: receives full `{ sessionId, tools, history, message }`, runs one round of OpenAI + optional tool call, returns `{ reply, history }`

### Key Architectural Decisions
- **Stateless chat** — frontend holds the full message history and sends it with every request
- **Per-session tool registry** — MCP server reads registry from the initialize request body, not from a file; prevents cross-session contamination
- **CORS** — `api.ts` uses the `cors` package to allow requests from the Next.js frontend on a different port

### Frontend (Next.js App Router)
- `app/page.tsx` — spec input page; user enters a spec URL and name, calls `/api/spec/parse`, navigates to `/sandbox?specId=<name>` on success
- `app/sandbox/page.tsx` — chat interface; on load reads `specId` from URL params, calls `/api/sandbox/start`, then chat loop calls `/api/sandbox/chat` with full history on every message

### Supporting Files
- `sandbox.ts` — MCP client functions: `initializeAgent(registry)`, `getTools()`, `callTool()`, `messageAI()`
- `generate_tool_registry.ts` — parses OpenAPI/Swagger specs into `ToolsFile` format (`{ baseUrl, tools[] }`); exports `parseSwaggerUrl()`, `generateToolRegistry()`, `parseOpenApiSpec()`
- `crud.js` — MongoDB helpers using `myDatabase.users` collection; call `connectMongo()` once on startup

### Environment Variables
- `MONGODB_URI` — MongoDB connection string (in `backend/.env`)
- `SANDBOX_OPENAI_KEY` — OpenAI API key used by `messageAI()` in `sandbox.ts`

---

## Tech Stack

### Frontend (`Helios/frontend/`)
- **Next.js 16** with App Router
- **React 19**, **TypeScript** (strict mode, path alias `@/*`)
- **Tailwind CSS v4** (PostCSS-based)
- **shadcn/ui** + **Monaco Editor** (planned)

### Backend (`Helios/backend/`)
- **Express + TypeScript** — `api.ts` and `server.ts`
- **MongoDB via Mongoose** — spec storage
- **OpenAI API** — sandbox chat and tool calling
- **Anthropic Claude API** — intent analysis and tool generation (planned)
- **swagger-parser** — OpenAPI spec parsing

---

## tools.json Contract (Team Integration Format)

```json
{
  "baseUrl": "https://api.example.com",
  "tools": [{
    "name": "tool_name",
    "description": "...",
    "input_schema": {
      "type": "object",
      "properties": { "paramName": { "type": "string", "description": "..." } },
      "required": ["paramName"]
    },
    "handler": {
      "method": "GET",
      "path": "/endpoint/{paramName}",
      "headers": {},
      "query_params": ["optionalParam"]
    }
  }]
}
```

`baseUrl` comes from `spec.servers[0].url` in the OpenAPI spec.

---

## Current Status

All core sandbox functionality is working:
- Spec parse → catalog review (verify page) → sandbox chat loop
- Parallel tool calls (all tool_calls in one step, executed concurrently)
- Non-GET simulation (intercepted at `server.ts`, never touches the real API)
- Fallback simulation when Zod rejects args
- Session expired surfaces a clean message instead of silent failure
- Composite multi-API sessions (create page) — re-initialized on every page load
- Verify page handles both `specId` (single API) and `compositeId` (multi-API) flows
- Swagger 2.0 query params correctly extracted

**Known issue:** If a server was saved to MongoDB with a stale catalog (from before the query_params fix), its `query_params` will be `[]`. Fix: delete and re-add the server from the home page.

---

## Upcoming Features

### Next Up
- [ ] Wire recommended APIs on create page (clicking does nothing)
- [ ] API key input UI — field before sandbox start; key injected into `handler.headers`
- [ ] Generated server download — template engine renders tool registry → TypeScript MCP boilerplate → ZIP

### Backlog
- [ ] OAuth flow for authenticated APIs (Google, Spotify, Slack)
- [ ] Response shaping — strip irrelevant fields per endpoint using OpenAPI response schemas
- [ ] Intent prompt on spec page — LLM optimizes tool groupings
- [ ] Store chat history in MongoDB per session
- [ ] MCP server boilerplate templates (emailer, Google, etc.)
- [ ] Spec input via JSON upload and AI-generated JSON from prompt
