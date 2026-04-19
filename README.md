# Helios

An intelligent MCP (Model Context Protocol) server generator. Helios transforms complex APIs into clean, agent-friendly tool interfaces by combining user intent with API documentation to produce optimized MCP servers — reducing tool overload for AI agents.

## User flow

```
API spec upload → intent description → tool grouping preview → mock server sandbox
    → edit tool catalog → MCP server code generation → download / deploy
```

## Stack

**Backend** (`backend/`) — Node.js, Express, TypeScript, MongoDB via Mongoose, Anthropic Claude API, SwaggerParser. Two processes:

- `api.ts` on port 8000 — user-facing REST API (auth, spec CRUD, sandbox / try orchestration, code generation)
- `server.ts` on port 3000 — MCP dispatcher (executes tool calls against real target APIs). Internal service; must not be publicly exposed

**Frontend** (`frontend/`) — Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4, shadcn/ui, Monaco editor.

## Repo layout

```
Helios/
├── backend/                # Express API + MCP dispatcher
│   ├── api.ts              # port 8000 — REST API
│   ├── server.ts           # port 3000 — MCP dispatcher
│   ├── generate_tool_registry.ts  # OpenAPI → tool registry (schema v2)
│   ├── auth/               # JWT + Google OAuth
│   ├── models/             # Mongoose schemas
│   └── scripts/            # premade catalog regen
├── frontend/               # Next.js app
│   ├── app/
│   │   ├── create/         # spec upload + intent
│   │   ├── verify/         # tool catalog editor
│   │   ├── sandbox/        # GET-only mock chat
│   │   ├── try/            # unrestricted live chat
│   │   ├── download/       # ZIP download
│   │   ├── info/           # chapter-based docs
│   │   └── keys/           # per-user API key manager
│   ├── lib/                # shared helpers (auth, provider keys, info summaries)
│   └── public/premade/     # bundled tool catalogs (twilio, etc.)
└── docs/archive/           # historical planning documents
```

## Quickstart

### Backend

```bash
cd backend
npm install
# .env must include: MONGODB_URI, JWT_SECRET, ANTHROPIC_API_KEY,
#                    GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, FRONTEND_URL
npx tsx api.ts       # port 8000
npx tsx server.ts    # port 3000 (separate terminal)
```

### Frontend

```bash
cd frontend
npm install
npm run dev          # port 3001 (3000 is taken by the MCP dispatcher)
```

## Environment

Backend needs `MONGODB_URI`, `JWT_SECRET`, `ANTHROPIC_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `FRONTEND_URL`, and optionally `NODE_ENV=production` to enable stricter SSRF guards.

## Project status

Active development on branch `feature-auth-integration`. Known outstanding items before public deployment: auth on port 3000, SSRF guard on `/api/spec/parse`, rate limiting, httpOnly cookie migration.
