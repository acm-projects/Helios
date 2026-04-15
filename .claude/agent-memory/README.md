# Helios — Technical Reference

Helios is an MCP server generator. Users point it at an API spec, test the tools in a live sandbox, edit the catalog, and download a standalone TypeScript MCP server. The full flow runs across two backend processes, a Next.js frontend, and MongoDB.

---

## System Architecture

```
Browser (Next.js App Router)
        │
        │ HTTP (port 8000)
        ▼
   api.ts — Express API Server
   ├── Auth middleware (JWT)
   ├── Spec parsing (generate_tool_registry.ts)
   ├── Intent filtering (filterToolsByIntent.ts)
   ├── MongoDB (Spec, ApiKey, User models)
   ├── ZIP generation (generator.ts)
   └── sandbox.ts ──► MCP server (port 3000)
                            │
                        server.ts
                        ├── Session map (sessionId → McpServer + transport)
                        ├── registerDynamicTool() per tool
                        ├── Live auth DB lookup per tool call
                        └── GET = real API call | non-GET = simulation
```

---

## Full User Flow (Step by Step)

### 1. Spec Input (`app/page.tsx`)
User pastes an OpenAPI spec URL or uploads a JSON file. Frontend sends either `{ url, name }` or `{ spec, name }` to:

```
POST /api/spec/parse
```

`api.ts` validates the name isn't already taken for this user, then:
- If `url`: calls `parseSwaggerUrl(url)` → uses `SwaggerParser.dereference()` to fully resolve all `$ref` links
- If `spec`: uses the raw JSON object directly
- Runs `generateToolRegistry(spec)` → `parseOpenApiSpec()` which walks every path/method in the spec

**Output of `parseOpenApiSpec()`:**
- `baseUrl` — from `spec.servers[0].url` (OpenAPI 3.x) or `scheme://host+basePath` (Swagger 2.x)
- `tools[]` — one `EndpointDefinition` per operation, each with:
  - `input_schema` — JSON Schema built from path params, query params, and requestBody
  - `handler` — `{ method, path, query_params[], fixed_query_params{} }`
  - `enrichment` — auth template detected from security schemes (see Auth section)
- `auth[]` — `AuthConfig[]` for the whole spec

**Key detail — fixed_query_params:** Required query params with a known default (e.g. `api-version=1.0`) are detected and pulled out of the tool's `input_schema`. The AI never sees them. `server.ts` auto-injects them on every call.

**Key detail — implicit API key heuristic:** If the spec has no `securitySchemes` block, `detectImplicitApiKeyParam()` scans all operations for a query param named `key`, `api_key`, `token`, etc. that appears on ≥50% of endpoints. If found, it's treated as the auth param and excluded from tool schemas.

Response back to frontend: `{ specId, spec, baseUrl, toolCount, catalog, auth }`. **Nothing is saved to MongoDB yet at this stage.**

---

### 2. Intent Filtering (Optional, `app/verify/page.tsx`)
If the user provides a natural language intent, the verify page calls:

```
POST /api/spec/simplify
Body: { catalog, userIntent }
```

`filterToolsByIntent.ts` runs Claude Haiku (with a cached system prompt) and returns only the tool names needed for that intent. The full catalog is filtered to that subset. Fail-open: if the LLM call fails or hallucinates all names, the full catalog is returned unchanged.

---

### 3. Catalog Review & Save (`app/verify/page.tsx`)
User sees the tool catalog. They can:
- Toggle individual tools on/off
- Rename tools and edit descriptions
- Review auth type detected from the spec

On confirm, frontend calls:

```
POST /api/servers/:specId/catalog
Body: { catalog, spec, baseUrl, toolCount }
```

**This is the first DB write.** `api.ts` creates a `Spec` document in MongoDB:
```
{
  _id: specId (user-chosen name),
  userId,
  type: null | "composite",
  baseUrl,
  toolCount,
  catalog: [...],     // full edited catalog with enabled flags
  auth: [...],        // AuthConfig[] from the spec
  groupMap,           // composite only
  authMap,            // composite only
  createdAt
}
```

---

### 4. Sandbox Start (`app/sandbox/page.tsx`)
On sandbox page load, frontend calls:

```
POST /api/sandbox/start
```

Three entry paths in `api.ts`:

**Path A — `toolsRegistry` in body (composite multi-API session):**
Frontend sends a pre-built registry from the create page. `api.ts` injects `integration_id` into each tool's enrichment using the `groupMap` and `authMap` from the request.

**Path B — `spec` in body (new unsaved server, from verify page pre-save):**
`api.ts` runs `generateToolRegistry()` fresh on the spec and sets `integration_id = specId` on all tool enrichments.

**Path C — `specId` only (existing saved server):**
- Loads `Spec` doc from MongoDB
- If `type === "composite"`: rebuilds registry from `doc.catalog` using saved `groupMap`/`authMap`
- Otherwise: **always generates a fresh registry** from the saved spec (catches enrichment upgrades), then applies user overrides (renames, descriptions, enabled flags) by matching tools on `method:path` key

After building the registry, `api.ts` calls `initializeAgent(registry, userId)` in `sandbox.ts`:
- POSTs a JSON-RPC `initialize` request to `server.ts` at port 3000
- Passes `toolsRegistry` and `userId` inside `params`
- Gets back the `mcp-session-id` header from `server.ts`

`server.ts` on `initialize`:
- Creates a new `McpServer` instance
- Creates a `StreamableHTTPServerTransport` with a UUID session ID
- Calls `registerDynamicTool()` for every tool in the registry
- Stores the session in two Maps: `transports` and `MCPserver`, keyed by `sessionId`
- Starts a 30-minute TTL timer — idle sessions are evicted

`api.ts` then converts tools to OpenAI function format (`toOpenAITool()`) and returns `{ sessionId, tools, authContext }` to the frontend. The frontend stores `sessionId` and `tools` in `sessionStorage`.

---

### 5. Sandbox Chat (`app/sandbox/page.tsx`)
Stateless. Frontend sends full history on every message:

```
POST /api/sandbox/chat
Body: { sessionId, tools, history, message, authContext }
```

`api.ts` runs a multi-turn loop (max 10 iterations, 60k token budget):

1. Appends the user message to history
2. Converts tools from OpenAI format → Anthropic format (`toAnthropicTool()`)
3. Builds a system prompt including auth hints (OAuth2 URLs, Basic auth instructions) and API-specific rules (e.g. Spotify market param requirement)
4. Calls `messageAI()` in `sandbox.ts` → Anthropic Claude Sonnet 4.6
5. If the model returns tool_use blocks → execute all in parallel via `callTool()`
6. `callTool()` sends a `tools/call` JSON-RPC request to `server.ts`

**Inside `server.ts` tool execution:**
1. Substitutes path params (`{id}` → actual value)
2. Builds query params from AI-supplied args
3. Auto-injects `fixed_query_params`
4. Looks up the user's API key from MongoDB live (`getStoredApiKey(userId, integration_id)`)
5. Injects auth into headers or query string based on `enrichment.auth.template`
6. **If method ≠ GET**: returns a `sandbox_simulation` JSON object immediately — never touches the real API
7. **If GET**: executes real fetch with 10-second AbortController timeout

Tool results go back to `api.ts`, which packs them all into one `tool_result` user message (Anthropic format). Loop continues until: no more tool calls, session expired, sandbox simulation returned, iteration limit, or token budget hit.

Response: `{ reply, history }` — history in Anthropic `MessageParam[]` format.

---

### 6. Download (`app/download/page.tsx` or inline)
```
GET /api/servers/:specId/download
```
`api.ts` loads the catalog from MongoDB, filters to enabled tools only, passes to `generateServerZip()` in `generator.ts`.

`generator.ts` produces a ZIP containing:
- `server.ts` — standalone MCP server (no Helios dependency, no MongoDB, reads creds from `.env`)
- `.env.example` — env var names with placeholder values based on auth template
- `package.json` + `tsconfig.json`
- `README.md` — deployment instructions

The generated server uses `process.env` for auth, not DB lookups. Auth injection is baked into the generated tool handlers based on the `enrichment.auth.template`.

---

## Auth System

Auth is detected once during spec parsing (`detectAuthTemplate()`) and applied to all tools in that spec. Six templates:

| Template | Injection | DB key stored |
|---|---|---|
| `bearer_token` | `Authorization: Bearer {key}` | Access token |
| `api_key_header` | `{header_name}: {key}` | API key |
| `api_key_query` | `?{param_name}={key}` | API key |
| `oauth2_client_creds` | `Authorization: Bearer {exchanged_token}` | Access token (after client-creds exchange) |
| `oauth2_auth_code` | `Authorization: Bearer {user_token}` | User access token |
| `basic_auth` | `Authorization: Basic base64(user:pass)` | `username:password` string |

**OAuth2 Client Credentials exchange**: `POST /api/oauth2/client-credentials` — user provides `clientId` and `clientSecret`. `api.ts` exchanges them with the token endpoint (SSRF-guarded: HTTPS only, no private IPs), stores the resulting `access_token` as the API key. No terminal command needed from the user.

**API key storage**: `POST /api/keys/:integrationId` — upserts a key for the user+integrationId pair. `GET /api/keys/:integrationId/status` — returns `{ exists: bool }`, never the key itself.

**Live lookup in server.ts**: On every tool call, `getStoredApiKey(userId, integration_id)` hits MongoDB. Auth is never baked into the session — rotating a key takes effect immediately on the next call.

---

## Composite Multi-API Servers (`app/create/page.tsx`)

The create page lets users combine multiple saved specs into one MCP server. The frontend builds a `toolsRegistry` that merges tools from multiple specs, annotated with which group (spec) each tool belongs to. The `groupMap` (`toolName → groupName`) and `authMap` (`groupName → AuthConfig[]`) are sent to `POST /api/sandbox/start` and later to `POST /api/servers/:specId/catalog` for persistence.

Composite sessions are **always re-initialized on page load** — they have no parseable spec to regenerate from, so the frontend must rebuild the registry from scratch each time.

---

## Data Models

**`Spec`** (`models/spec.model.ts`) — one per saved MCP server per user
```
_id: string (user-chosen name)
userId: string
type: "composite" | null
baseUrl: string
toolCount: number
catalog: ToolCatalogEntry[]
auth: AuthConfig[]
groupMap: Record<toolName, groupName> | null
authMap: Record<groupName, AuthConfig[]> | null
createdAt: string
```

**`ApiKey`** (`models/apiKey.model.ts`) — per-user, per-integration API key storage

**`User`** (`auth/user.model.ts`) — accounts with JWT auth

---

## File Reference

| File | Role |
|---|---|
| `backend/api.ts` | Express API server (port 8000) — all business logic |
| `backend/server.ts` | MCP server (port 3000) — tool dispatch, session management |
| `backend/sandbox.ts` | MCP client + Anthropic SDK — called by api.ts |
| `backend/generate_tool_registry.ts` | OpenAPI parser, auth detection, type definitions |
| `backend/filterToolsByIntent.ts` | Claude Haiku intent filtering |
| `backend/generator.ts` | ZIP generation for downloadable standalone servers |
| `backend/auth/auth.routes.ts` | Login/register/refresh endpoints |
| `backend/auth/auth.middleware.ts` | JWT verification middleware |
| `backend/auth/apiKeyManager.ts` | Per-user API key store/retrieve |

---

## What Still Needs to Be Built

### High Priority
- **Recommended APIs on create page** — clicking the preset API cards does nothing. Needs to auto-fill the spec URL field and trigger a parse.
- **Intent prompt on spec page** — text field where user describes how they want to use the API. Calls `/api/spec/simplify` before showing the verify page. Currently `/api/spec/simplify` exists but is not wired to any UI.
- **API key input UI** — before sandbox starts, user needs a way to enter their API key without going through the sandbox panel. Should appear on the verify/confirm page. Key gets POSTed to `/api/keys/:integrationId` before `/api/sandbox/start` is called.

### Medium Priority
- **Response shaping** — strip irrelevant fields from API responses per endpoint using the OpenAPI response schema. Currently the full API response is passed to Claude, which wastes tokens and can hit the `MAX_RESPONSE_CHARS` truncation limit.
- **Store chat history in MongoDB** — currently history lives only in frontend `sessionStorage`. Long sessions are lost on page refresh.
- **MCP server boilerplate templates** — preset starting points for common API categories (email, calendar, storage). Would bypass the spec parse step.

### Lower Priority
- **OAuth authorization code flow** — full browser redirect → callback → token exchange. Needs a `/oauth/callback` route and temporary state storage. Post-MVP.
- **Spec input via JSON upload** — currently only URL fetch is fully wired. File upload path exists in the backend (`req.body.spec`) but the frontend UI is incomplete.
- **AI-generated spec from prose** — user describes an API in plain English, Claude generates a synthetic spec JSON. No backend work done yet.

---

## Known Bugs & Things to Watch

### Stale catalog `query_params: []`
**What:** If a server was saved to MongoDB before the `detectFixedQueryParams` logic was added, its catalog entries have `query_params: []`. On sandbox start, `api.ts` regenerates a fresh registry and applies saved overrides — but it matches by `method:path`. If the saved catalog is the source of truth (composite servers), empty `query_params` will persist.
**Fix:** Delete and re-add the server from the home page to force a fresh parse.

### Composite session must be re-initialized on every page load
**What:** `server.ts` holds sessions in-memory. A backend restart wipes them. Composite servers have no spec stored — the frontend must re-POST the full `toolsRegistry` to `/api/sandbox/start` every time the sandbox page loads.
**Fix:** Already handled — sandbox page always calls `/api/sandbox/start` on mount. If you see session errors on composite servers, the page is likely re-using a stale `sessionId` from `sessionStorage`. Always clear it before calling start.

### Tool name collision on composite servers
**What:** If two merged specs have tools with the same `operationId` or generated name (e.g. both have a `get_users` endpoint), the second tool silently overwrites the first in `server.ts`'s `registerDynamicTool` loop.
**Status:** No dedup logic exists yet. Naming conflicts must be resolved manually in the catalog editor.

### `MAX_RESPONSE_CHARS = 8000` truncation
**What:** API responses larger than 8000 chars are hard-truncated before being fed back to Claude. This can cause the model to work with partial data and produce wrong answers.
**Watch for:** Large list endpoints (e.g. GET /products with 100+ items). The array slice (`toolResponse.slice(0, 100)`) before JSON serialization partially mitigates this but doesn't help for large single objects.
**Long-term fix:** Response shaping (see above).

### Session TTL is 30 minutes, not per-request
**What:** `refreshSessionTimer()` resets the 30-minute clock on every request to `server.ts`. But `api.ts` is the only caller — if the user is idle on the sandbox page for >30 min without sending a message, the session evicts.
**Surface:** The next `callTool()` throws an error containing `-32000` or `Invalid request`, which `api.ts` detects and surfaces as `"Your sandbox session has expired."` This is handled correctly. Just make sure this string check stays in sync with any MCP error code changes.

### Zod schema validation errors on non-GET tools
**What:** `server.ts` validates args through Zod before executing. If Claude passes a wrong type (e.g. a string where an integer is expected), Zod throws before the simulation branch runs. `api.ts` catches this in the `toolErr` handler and builds a fallback simulation from the raw args — but the fallback uses `toolDef.handler.path` as the URL, not the fully constructed URL with params substituted.
**Impact:** The simulated request shown to the user has an unresolved path like `/users/{id}` instead of `/users/123`. Minor UX issue.

### `toOpenAITool` vs `toAnthropicTool` format mismatch surface
**What:** `api.ts` converts tools to OpenAI format for the frontend (`toOpenAITool`) and back to Anthropic format for `messageAI` (`toAnthropicTool`). If either conversion is wrong, the AI silently can't call tools.
**Watch for:** Any new fields added to `EndpointDefinition` or `ToolEnrichment` need to be explicitly carried through both conversion functions. Fields not in the OpenAI format spec are dropped — only `name`, `description`, `parameters`, and `handler` survive the round-trip.
