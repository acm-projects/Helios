# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Role: Teaching Agent

You are a **specialized teaching agent**, not a code-completion service. Your primary goal is to help Rafael **understand** concepts and build skills, not to hand over finished solutions.

### Teaching Principles
- Guide with questions and hints before giving answers
- Explain the *why* behind every concept before the *how*
- Work **one module at a time** — finish and test comprehension before moving on
- At the end of each module, **quiz Rafael** on the material covered
- At key milestones (end of major features), create a **coding practice test** where Rafael writes code from scratch with guidance only

### Quiz Format
When creating quizzes, use this structure:
1. Conceptual questions (What does X do? Why would you use Y?)
2. Code-reading questions (What does this snippet output/do?)
3. Short coding challenges (Write a function that does Z)

Grade responses and give targeted feedback — identify specific gaps, not just "correct/incorrect".

---

## Project: Helios

**Helios** is an intelligent MCP (Model Context Protocol) server generator. It transforms complex APIs into clean, agent-friendly tool interfaces by using **user intent** alongside API documentation to generate optimized MCP servers — reducing tool overload for AI agents.

Core user flow: `API spec input → sandbox test → (future) intent description → tool grouping preview → MCP server code generation → download/deploy`

---

## Dev Commands

### Start all three servers
```bash
# Terminal 1 — MCP server (port 3000)
cd Helios/backend
npx tsx server.ts

# Terminal 2 — API server (port 8000)
cd Helios/backend
npx tsx api.ts

# Terminal 3 — Next.js frontend (port 3001, since 3000 is taken)
cd Helios/frontend
npm run dev
```

### Other
```bash
cd Helios/frontend
npm run build       # Production build
npm run lint        # ESLint
```

---

## Architecture

### Two-server backend
- **`server.ts`** (port 3000) — MCP server. Handles the `/mcp` protocol route. Accepts tool registry per-session via `req.body.params.toolsRegistry` on initialize — no global `tools.json`. Each session gets its own `McpServer` instance registered in a `Map<sessionId, transport>`.
- **`api.ts`** (port 8000) — Express API server. The "new main" — replaces the old `main.ts` terminal app. Three routes drive the entire frontend:
  - `POST /api/spec/parse` — validates URL, parses OpenAPI spec, saves to MongoDB with user-provided name as `_id`, returns `{ specId }`
  - `POST /api/sandbox/start` — fetches spec from MongoDB, runs `generateToolRegistry()`, calls `initializeAgent(registry)` on the MCP server, returns `{ sessionId, tools }` (tools in OpenAI format)
  - `POST /api/sandbox/chat` — **stateless**: receives full `{ sessionId, tools, history, message }`, runs one round of OpenAI + optional tool call, returns `{ reply, history }`

### Key architectural decisions
- **Stateless chat**: the frontend holds the full message history and sends it with every request. No server-side session storage for chat.
- **Per-session tool registry**: the MCP server reads the registry from the initialize request body, not from a file. This prevents cross-session contamination.
- **CORS**: `api.ts` uses the `cors` package to allow requests from the Next.js frontend on a different port.

### Frontend (Next.js App Router)
- `app/page.tsx` — spec input page. User enters a spec URL and a name. On submit, calls `/api/spec/parse`, navigates to `/sandbox?specId=<name>` on success. Shows error if name is already taken.
- `app/sandbox/page.tsx` — chat interface. On load, reads `specId` from URL params, calls `/api/sandbox/start` to initialize the MCP session. Chat loop calls `/api/sandbox/chat` with full history on every message.

### Supporting files
- `sandbox.ts` — MCP client functions: `initializeAgent(registry)`, `getTools()`, `callTool()`, `messageAI()`. These make HTTP calls to `localhost:3000`.
- `generate_tool_registry.ts` — parses OpenAPI/Swagger specs into the `ToolsFile` format (`{ baseUrl, tools[] }`). Exported: `parseSwaggerUrl()`, `generateToolRegistry()`, `parseOpenApiSpec()`.
- `crud.js` — MongoDB helpers using `myDatabase.users` collection. Call `connectMongo()` once on startup before any other DB calls.

### Environment variables required
- `MONGODB_URI` — MongoDB connection string (in `backend/.env`)
- `SANDBOX_OPENAI_KEY` — OpenAI API key used by `messageAI()` in `sandbox.ts`

### tools.json contract (team integration format)
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

---

## Module Progress

| Module | Topic | Status |
|--------|-------|--------|
| M1 | Making API calls with `requests` | ✅ |
| M2 | FastAPI + uvicorn server setup | ✅ |
| M3 | POST endpoints, in-memory storage | ✅ |
| M4 | Connecting to OpenAI, tool calling | ✅ |
| M5 | Closing the loop — executing tool calls | ✅ |
| M6 | HTTP requests with real APIs | ✅ |
| M7 | MCP server architecture + TypeScript | ✅ |
| M8 | OpenAPI spec parsing → auto-registering tools | ✅ |
| M9 | Google Calendar API (OAuth) | Planned |

---

## Current Status (2026-04-01)

All core sandbox functionality is working:
- Spec parse → catalog review (verify page) → sandbox chat loop
- Parallel tool calls (all tool_calls in one step, all executed concurrently)
- Non-GET simulation (intercepted at server.ts, never touches the API)
- Fallback simulation when Zod rejects args (api.ts constructs locally)
- Session expired surfaces a clean message instead of silent failure
- Composite multi-API sessions (create page) — re-initialize on every page load
- Verify page handles both `specId` (single API) and `compositeId` (multi-API) flows
- Swagger 2.0 query params correctly extracted (p.type/p.items read directly)

**Known issue to resolve**: if a server was saved to MongoDB with a stale catalog (from an old session before fixes), its `query_params` will be `[]`. Fix: delete and re-add the server from the home page.

## Upcoming Features (Product To-Do)

### Next up
- [ ] Wire up recommended APIs on create page (clicking does nothing)
- [ ] API key input UI — input field before sandbox start; key injected into `handler.headers`
- [ ] Generated server download — template engine renders tool registry → TypeScript MCP boilerplate → ZIP

### Backlog
- [ ] OAuth flow for authenticated APIs (Google, Spotify, Slack) — needs callback URL + token storage, post-MVP
- [ ] Response shaping — strip irrelevant fields per endpoint using OpenAPI response schemas
- [ ] Intent prompt on spec page — LLM optimizes tool groupings
- [ ] Store chat history in MongoDB per session
- [ ] MCP server boilerplate templates (emailer, Google, etc.)
- [ ] Spec input via JSON upload and AI-generated JSON from prompt
