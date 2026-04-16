// API server — port 8000. The layer between the frontend and the two backend services (MCP + MongoDB).
// Handles spec parsing, sandbox session management, and saved server CRUD.
import dotenv from "dotenv"
dotenv.config({ override: true })
import {generateToolRegistry, parseSwaggerUrl, parseAuthConfig, buildEnrichmentFromAuthConfigs } from "./generate_tool_registry.ts";
import { filterToolsByIntent } from "./filterToolsByIntent.ts";
import type { AuthConfig } from "./generate_tool_registry.ts";
import { generateServerZip } from "./generator.ts";
import { Spec } from "./models/spec.model.js"
import { ApiKey } from "./models/apiKey.model.js";
import {initializeAgent, callTool, messageAI, compressToolsForClaude } from "./sandbox.ts";
import authRouter from "./auth/auth.routes.js";
import { authMiddleware } from "./auth/auth.middleware.js";
import { storeApiKey, getStoredApiKey, storeOAuthClientCredentials, storeOAuthRefreshToken } from "./auth/apiKeyManager.js";
import express from "express"
import cors from "cors"
import mongoose from "mongoose"

const app = express()
const ALLOWED_ORIGIN = process.env.FRONTEND_ORIGIN || "http://localhost:3000"
app.use(cors({ origin: ALLOWED_ORIGIN, credentials: true }))
app.use(express.json({ limit: "50mb" })) // large limit needed for specs with 50-100+ tools

try {
  await mongoose.connect(process.env.MONGODB_URI!)
  console.log("[db] MongoDB connected")
} catch (err) {
  console.error("[db] Failed to connect to MongoDB:", err)
  process.exit(1)
}

// Shape sent to the frontend — stored in sessionStorage, sent back on every chat request
function toOpenAITool(tool: any, enabled = true) {
    return {
        type: "function" as const,
        function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.input_schema
        },
        handler: {
            method: tool.handler.method,
            path: tool.handler.path,
            query_params: tool.handler.query_params ?? [],
            fixed_query_params: tool.handler.fixed_query_params
        },
        enabled
    }
}

// Convert frontend tool format → Anthropic tool format for messageAI
function toAnthropicTool(tool: any) {
    return {
        name: tool.function.name,
        description: tool.function.description ?? "",
        input_schema: tool.function.parameters ?? { type: "object", properties: {} }
    }
}



function assignStarPosition(existingPositions: Array<{ starX: number; starY: number }>): { starX: number; starY: number } {
  const MIN_DIST = 9
  for (let attempt = 0; attempt < 120; attempt++) {
    const side = Math.random() < 0.5 ? "left" : "right"
    const starX = side === "left"
      ? 3  + Math.random() * 34   // 3–37%  (left zone)
      : 63 + Math.random() * 33   // 63–96% (right zone)
    const starY = 10 + Math.random() * 50 // 10–60vh
    const tooClose = existingPositions.some(p => {
      const dx = p.starX - starX
      const dy = (p.starY - starY) * 0.55
      return Math.sqrt(dx * dx + dy * dy) < MIN_DIST
    })
    if (!tooClose) return { starX, starY }
  }
  // Fallback — place anywhere in the zone if all attempts fail
  const side = Math.random() < 0.5 ? "left" : "right"
  return {
    starX: side === "left" ? 3 + Math.random() * 34 : 63 + Math.random() * 33,
    starY: 10 + Math.random() * 50,
  }
}

// Parses a spec and returns the tool catalog to the frontend for review.
// Accepts either { url, name } or { spec, name } (raw JSON object from file upload).
// Does NOT save to the DB yet — that only happens when the user confirms via POST /catalog.
app.post("/api/spec/parse", authMiddleware, async (req, res) => {
    const specId = req.body.name
    if (!specId) return res.status(400).json({ error: "name cannot be empty" })
    if (!/^[a-zA-Z0-9_\-]{1,64}$/.test(specId)) {
        return res.status(400).json({ error: "Name must be 1–64 characters (letters, numbers, hyphens, underscores only)" })
    }

    const existing = await Spec.findOne({ _id: specId, userId: req.user!.userId })
    if (existing) return res.status(400).json({ error: "The name is already taken. Please choose another name." })

    let spec: any

    if (req.body.spec) {
        // Raw JSON spec passed directly (file upload path)
        spec = req.body.spec
    } else if (req.body.url) {
        try {
            spec = await parseSwaggerUrl(req.body.url)
        } catch (err: any) {
            return res.status(400).json({ error: "invalid specURL" })
        }
    } else {
        return res.status(400).json({ error: "either url or spec is required" })
    }

    let registry: any
    try {
        registry = await generateToolRegistry(spec)
    } catch (err: any) {
        return res.status(400).json({ error: "Failed to generate tool registry: " + err.message })
    }

    const catalog = registry.tools.map((tool: any) => ({
        name: tool.name,
        description: tool.description,
        enabled: true,
        input_schema: tool.input_schema,
        handler: tool.handler,
        enrichment: tool.enrichment
    }))

    let baseUrl = registry.baseUrl
    if (!baseUrl && req.body.url) {
        try { baseUrl = new URL(req.body.url).origin } catch {}
    }

    res.json({
        specId,
        spec,
        baseUrl,
        toolCount: registry.tools.length,
        catalog,
        auth: registry.auth
    })
})

// Filters a parsed catalog down to tools relevant to the user's intent.
// Stateless — no DB interaction. Inserts between /api/spec/parse and sandbox start.
app.post("/api/spec/simplify", authMiddleware, async (req, res) => {
    const { catalog, userIntent } = req.body
    if (!Array.isArray(catalog) || catalog.length === 0) {
        return res.status(400).json({ error: "catalog must be a non-empty array" })
    }
    if (!userIntent || typeof userIntent !== "string" || !userIntent.trim()) {
        return res.status(400).json({ error: "userIntent must be a non-empty string" })
    }
    try {
        const result = await filterToolsByIntent({ baseUrl: "", tools: catalog, auth: [] }, userIntent.trim())
        res.json({ catalog: result.tools })
    } catch (err: any) {
        res.status(500).json({ error: err.message })
    }
})

// Starts an MCP session. Three entry paths:
//   toolsRegistry — pre-built composite registry from the create page (multi-API, baseUrl is "")
//   spec          — unsaved new server passed directly from the frontend
//   specId        — existing saved server, loaded from DB
app.post("/api/sandbox/start", authMiddleware, async (req, res) => {
    let registry: any = null
    let frontendTools: any[] | null = null

    if (req.body.toolsRegistry) {
        const reg = req.body.toolsRegistry
        if (!Array.isArray(reg.tools) || reg.tools.length === 0) {
            return res.status(400).json({ error: "toolsRegistry must have a non-empty tools array" })
        }
        const invalid = reg.tools.find((t: any) => !t.name || !t.handler?.method || !t.handler?.path)
        if (invalid) {
            return res.status(400).json({ error: `Tool "${invalid.name || "unknown"}" is missing required fields (name, handler.method, handler.path)` })
        }
    }

    try {
        if (req.body.toolsRegistry) {
            // Pre-built composite registry — inject integration_id per group
            registry = req.body.toolsRegistry
            const groupMap: Record<string, string> = req.body.groupMap ?? {}
            const authMap: Record<string, AuthConfig[]> = req.body.authMap ?? {}
            
            registry = {
                ...registry,
                tools: registry.tools.map((tool: any) => {
                    const groupName = groupMap[tool.name]
                    let enrichment = tool.enrichment
                    if (!enrichment) {
                        const authConfigs: AuthConfig[] = authMap[groupName] ?? [{ type: "none" }]
                        enrichment = buildEnrichmentFromAuthConfigs(authConfigs)
                    }
                    if (enrichment && enrichment.auth && groupName) {
                        enrichment.auth.integration_id = groupName
                    }
                    return { ...tool, enrichment }
                })
            }
            frontendTools = req.body.toolsRegistry.tools.map((tool: any) => toOpenAITool(tool))
        } else if (req.body.spec) {
            // New unsaved server — spec passed directly from frontend (not yet in DB)
            registry = await generateToolRegistry(req.body.spec)
            if (!registry.baseUrl && req.body.baseUrl) {
                registry = { ...registry, baseUrl: req.body.baseUrl }
            }
            // Set integration_id on enrichment so server.ts can lookup auth live
            registry.tools = registry.tools.map((tool: any) => {
                if (tool.enrichment && tool.enrichment.auth && req.body.specId) {
                    tool.enrichment.auth.integration_id = req.body.specId
                }
                return tool
            })
        } else {
            // Existing saved server — load from DB
            const doc = await Spec.findOne({ _id: req.body.specId, userId: req.user!.userId }).lean()
            if (!doc) return res.status(404).json({ error: "Spec not found" })

            // Composite saved servers have no spec to re-parse — rebuild from catalog
            if (doc.type === "composite") {
                const groupMap: Record<string, string> = doc.groupMap ?? {}
                const authMap: Record<string, AuthConfig[]> = doc.authMap ?? {}
                const allCatalogTools = (doc.catalog ?? []).map((t: any) => {
                    const groupName = groupMap[t.name]
                    let enrichment = t.enrichment
                    if (!enrichment || !enrichment.auth) {
                        const authConfigs: AuthConfig[] = authMap[groupName] ?? [{ type: "none" }]
                        enrichment = buildEnrichmentFromAuthConfigs(authConfigs)
                    }
                    if (enrichment?.auth && groupName) enrichment.auth.integration_id = groupName
                    return { ...t, enrichment }
                })
                // MCP sandbox only registers enabled tools; frontend panel sees all with enabled flags
                registry = { baseUrl: "", tools: allCatalogTools.filter((t: any) => t.enabled !== false), auth: [{ type: "none" }] }
                frontendTools = allCatalogTools.map((t: any) => toOpenAITool(t, t.enabled !== false))
            } else {
            if (doc.catalog && Array.isArray(doc.catalog) && doc.catalog.length > 0) {
                // Saved catalog exists — skip expensive re-parse and use stored tools directly
                const enabledTools = doc.catalog.filter((t: any) => t.enabled !== false)
                if (enabledTools.length === 0) return res.status(400).json({ error: "No enabled tools in saved catalog" })
                registry = { baseUrl: doc.baseUrl || doc.spec?.servers?.[0]?.url || "", tools: enabledTools, auth: doc.auth ?? [] }
            } else {
                // No saved catalog yet — must parse from spec
                registry = await generateToolRegistry(doc)
                registry.tools = registry.tools.map((t: any) => ({ ...t, enabled: true }))
            }

            // Set integration_id on enrichment so server.ts can lookup auth live.
            // If a catalog tool has no enrichment, build it from doc.auth so auth
            // is never silently skipped for saved non-composite servers.
            const flatAuthConfigs: AuthConfig[] = Array.isArray(doc.auth) && (doc.auth as any[]).some((a: any) => a?.type && a.type !== "none")
                ? doc.auth as AuthConfig[]
                : [{ type: "none" as const }]
            registry.tools = registry.tools.map((tool: any) => {
                let enrichment = tool.enrichment
                if (!enrichment || !enrichment.auth) {
                    enrichment = buildEnrichmentFromAuthConfigs(flatAuthConfigs)
                }
                if (enrichment && enrichment.auth) {
                    enrichment.auth.integration_id = req.body.specId
                }
                return { ...tool, enrichment }
            })

            // Frontend panel sees all catalog tools (including disabled); MCP sandbox only uses enabled ones above
            frontendTools = (doc.catalog ?? registry.tools).map((tool: any) => toOpenAITool(tool, tool.enabled !== false))
            } // end non-composite else
        }
    } catch (err: any) {
        return res.status(400).json({ error: "Failed to load spec: " + err.message })
    }

    let sessionId: string
    try {
        sessionId = await initializeAgent(registry, req.user!.userId)
    } catch (err: any) {
        return res.status(500).json({ error: "Failed to start MCP session: " + err.message })
    }

    const openAITools = frontendTools ?? registry.tools.map((tool: any) => toOpenAITool(tool))

    // Build authContext — carries OAuth2/BasicAuth URLs/notes for the AI system prompt
    const authContextObj: Record<string, string> = {}
    const registryAuth: AuthConfig[] = registry.auth ?? []
    for (const a of registryAuth) {
        if (a.type === "oauth2") {
            if (a.authorizationUrl) authContextObj.oauth2Url = a.authorizationUrl
            if (a.tokenUrl) authContextObj.tokenUrl = a.tokenUrl
        } else if (a.type === "basic_auth") {
            authContextObj.basicAuthNote = "Enter your credentials as \"username:password\" in the API Keys panel."
        }
    }

    res.json({ sessionId, tools: openAITools, baseUrl: registry.baseUrl ?? "", authContext: Object.keys(authContextObj).length > 0 ? authContextObj : undefined })
})

app.post("/api/sandbox/chat", authMiddleware, async (req, res) => {
    const MAX_ITERATIONS = 10;
    const TOKEN_BUDGET = 60000;
    // Per-tool response cap. Kept tight — tool results feed back as input tokens
    // on the next Claude call. 2k chars ≈ 500 tokens per tool result.
    const MAX_RESPONSE_CHARS = 2000;

    const sessionId = req.body.sessionId
    if (!sessionId || typeof sessionId !== "string" || !/^[0-9a-f-]{36}$/.test(sessionId)) {
        return res.status(400).json({ error: "Invalid or missing sessionId" })
    }
    if (!req.body.message || typeof req.body.message !== "string") {
        return res.status(400).json({ error: "message must be a non-empty string" })
    }
    if (!Array.isArray(req.body.history)) {
        return res.status(400).json({ error: "history must be an array" })
    }
    if (!Array.isArray(req.body.tools)) {
        return res.status(400).json({ error: "tools must be an array" })
    }
    if (req.body.history.length > 200) {
        return res.status(400).json({ error: "Conversation history is too long. Please start a new session." })
    }

    // History stored in Anthropic MessageParam format throughout.
    // We snapshot the incoming length so we can roll back to a clean state on error.
    const history: any[] = req.body.history
    const historyBaseLen = history.length
    history.push({ role: "user", content: req.body.message })

    // Convert frontend tools (OpenAI format) → Anthropic format
    const anthropicTools = (req.body.tools ?? [])
        .filter((t: any) => t.function?.name)
        .map(toAnthropicTool)

    // Build system prompt string
    const sanitizePromptField = (s: string) => s.replace(/[\n\r`]/g, " ").slice(0, 300)

    const authHints: string[] = []
    const toolsRegistry = req.body.tools ?? []
    const authContext = req.body.authContext as { oauth2Url?: string; tokenUrl?: string; basicAuthNote?: string } | undefined
    if (authContext?.oauth2Url) {
        authHints.push(`This API uses OAuth 2.0. If the user does not have an access token yet, tell them: "To authorize, visit: ${sanitizePromptField(authContext.oauth2Url)} — log in and copy the access_token from the response. Then paste it into the API Keys panel (Tools button → API Keys tab) and save it."`)
    }
    if (authContext?.tokenUrl && !authContext?.oauth2Url) {
        authHints.push(`This API uses OAuth 2.0 Client Credentials. To get an access token, the user must POST to ${sanitizePromptField(authContext.tokenUrl)} with their client_id and client_secret. Tell them to paste the resulting access_token into the API Keys panel.`)
    }
    if (authContext?.basicAuthNote) {
        authHints.push(`This API uses Basic Auth. The API key field expects "username:password" (colon-separated, no spaces). ${sanitizePromptField(authContext.basicAuthNote)}`)
    }
    const authInstruction = authHints.length > 0 ? ` AUTH CONTEXT: ${authHints.join(" ")}` : ""

    const hasSpotify = toolsRegistry.some((t: any) =>
        (t.handler?.path ?? "").includes("api.spotify.com") ||
        (t.function?.name ?? t.name ?? "").startsWith("get_an_artist") ||
        (t.function?.name ?? t.name ?? "").startsWith("search") && (t.handler?.path ?? "").includes("spotify")
    )
    const spotifyHints = hasSpotify
        ? ` SPOTIFY API RULES: (1) Any endpoint that accepts a "market" parameter MUST include market="US" — omitting it causes a 400 error. (2) For recommendations, seed_genres must be comma-separated lowercase slugs like "indie,rock,pop". Call get_recommendation_genres first if unsure. (3) Use "search" for finding music by mood or vibe. (4) If a tool returns an API error, fix the parameters and retry once.`
        : ""

    const todayStr = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })

    const systemContent = `Today's date is ${todayStr}. You are a sandbox testing assistant for API tools. Always call the appropriate tool for every user request — including POST, PUT, PATCH, and DELETE operations. GET requests return real data from the live API. POST, PUT, PATCH, and DELETE requests are intercepted by the sandbox: the tool never touches the real API and instead returns a simulation of what would have been sent. When you receive a sandbox_simulation response, you are done — present the simulated_request to the user as a success and stop immediately. Do not call the same tool again. Never describe a simulation as an error, failure, or technical issue. If an API tool returns an error, read the exact error message and retry with corrected parameters before telling the user it failed. If a tool returns a 401 error, tell the user their API key or token is missing or expired and guide them to open the Tools panel → API Keys tab.${authInstruction}${spotifyHints}`

    let iterations = 0;
    let totalTokens = 0;
    let forceTextNext = false;
    let lastToolNames = "";

    // Truncate history to stay under Anthropic's 30k input-tokens/minute rate limit.
    // Budget: 20k chars ≈ 5k tokens for history, leaving headroom for system prompt + tools.
    // Safety: always keeps the last 2 entries (current user turn + one assistant turn).
    // Bug fix: JSON.stringify(undefined) returns undefined (not "undefined"), so we must
    // guard the .length call — otherwise a missing content field crashes with TypeError.
    function truncateHistory(hist: any[]): any[] {
        if (hist.length === 0) return hist
        const MAX_CHARS = 20_000
        let total = 0
        for (let i = hist.length - 1; i >= 0; i--) {
            try {
                const raw = hist[i]?.content
                const serialized = raw === undefined ? ""
                    : typeof raw === "string" ? raw
                    : (JSON.stringify(raw) ?? "")
                total += serialized.length
            } catch { /* skip entries that can't be serialized */ }
            if (total > MAX_CHARS) {
                const keepFrom = Math.min(i + 1, hist.length - 2)
                return hist.slice(Math.max(0, keepFrom))
            }
        }
        return hist
    }

    try {
        while (iterations < MAX_ITERATIONS && totalTokens < TOKEN_BUDGET) {
            const toolChoice = forceTextNext ? "none" : "auto";
            forceTextNext = false;
            const { message, tokens } = await messageAI(systemContent, truncateHistory(history), anthropicTools, toolChoice);
            totalTokens += tokens;
            iterations++;

            // Extract tool use blocks from Claude's response
            const toolUseBlocks = message.content.filter((b: any) => b.type === "tool_use") as any[]
            const textBlocks = message.content.filter((b: any) => b.type === "text") as any[]
            const textContent = textBlocks.map((b: any) => b.text).join("")

            // No tool calls — model is done
            if (toolUseBlocks.length === 0) {
                history.push({ role: "assistant", content: message.content })
                break
            }

            // Store assistant turn with full content blocks (tool_use + text)
            history.push({ role: "assistant", content: message.content })

            // Execute all tool calls in parallel
            const toolResults = await Promise.allSettled(
                toolUseBlocks.map(async (block: any) => {
                    const args = block.input

                    try {
                        const toolResponse = await callTool(sessionId, block.name, args)
                        const limited = Array.isArray(toolResponse) && toolResponse.length > 100
                            ? toolResponse.slice(0, 100)
                            : toolResponse
                        let content = JSON.stringify(limited)
                        if (content.length > MAX_RESPONSE_CHARS) {
                            content = content.slice(0, MAX_RESPONSE_CHARS) + `... [truncated — ${content.length - MAX_RESPONSE_CHARS} characters omitted]`
                        }
                        return content
                    } catch (toolErr: any) {
                        // Guard: toolErr may not be an Error — always coerce message to string
                        const errMsg = String(toolErr?.message ?? toolErr ?? "unknown error")

                        // Non-GET tool failure → build fallback simulation from the args we have
                        const toolDef = (req.body.tools ?? []).find((t: any) => t.function?.name === block.name)
                        if (toolDef?.handler?.method && toolDef.handler.method.toUpperCase() !== "GET") {
                            const fallback = {
                                sandbox_simulation: true,
                                info: "Simulation (schema validation fallback)",
                                simulated_request: {
                                    method: toolDef.handler.method.toUpperCase(),
                                    url: toolDef.handler.path,
                                    headers: {},
                                    body: Object.keys(args).length > 0 ? args : null
                                }
                            }
                            return JSON.stringify([{ type: "text", text: JSON.stringify(fallback) }])
                        }
                        if (errMsg.includes("-32000") || errMsg.includes("Invalid request") || errMsg.includes("unexpected response")) {
                            return "SESSION_EXPIRED"
                        }
                        return `Tool execution error: ${errMsg}`
                    }
                })
            )

            // All tool results go into ONE user message with tool_result blocks (Anthropic requirement)
            const toolResultBlocks = toolUseBlocks.map((block: any, i: number) => {
                const result = toolResults[i]
                return {
                    type: "tool_result" as const,
                    tool_use_id: block.id,
                    content: result.status === "fulfilled" ? result.value : `Unexpected error for tool "${block.name}".`
                }
            })
            history.push({ role: "user", content: toolResultBlocks })

            const toolNames = toolUseBlocks.map((b: any) => b.name).join(", ")
            console.log(`[Step ${iterations}] Tools: ${toolNames} | Tokens so far: ${totalTokens}`)

            // Session expired — surface clean message and stop
            const sessionExpired = toolResultBlocks.some((b: any) => b.content === "SESSION_EXPIRED")
            if (sessionExpired) {
                history.push({ role: "assistant", content: "Your sandbox session has expired. Please refresh the page to start a new one." })
                break
            }

            // Sandbox simulation — extract and surface, then stop
            const simBlocks = toolResultBlocks.filter((b: any) => typeof b.content === "string" && b.content.includes("sandbox_simulation"))
            if (simBlocks.length > 0) {
                const simTexts = simBlocks.map((b: any) => {
                    try {
                        const parsed = JSON.parse(b.content)
                        const entry = Array.isArray(parsed) ? parsed.find((e: any) => e.type === "text") : null
                        const sim = entry ? JSON.parse(entry.text) : null
                        if (sim?.simulated_request) {
                            const r = sim.simulated_request
                            return `**Sandbox simulation** — ${r.method} ${r.url}\n\`\`\`json\n${JSON.stringify(r.body ?? {}, null, 2)}\n\`\`\``
                        }
                    } catch {}
                    return "Sandbox simulation complete."
                })
                history.push({ role: "assistant", content: simTexts.join("\n\n") })
                break
            }

            // After any tool call round, force the next iteration to text-only.
            // This drops the full tool list from the summarization call — saves ~3–5k tokens
            // per turn. Multi-hop chains (tool → tool) are rare in sandbox use and not
            // worth the token cost. Same-tool repeat detection kept as a fallback guard.
            forceTextNext = true
            lastToolNames = toolNames
        }

        if (iterations >= MAX_ITERATIONS) {
            history.push({ role: "assistant", content: `I reached my step limit (${MAX_ITERATIONS} attempts) without completing the task. Try breaking it into smaller steps.` })
        } else if (totalTokens >= TOKEN_BUDGET) {
            history.push({ role: "assistant", content: `I used too many tokens (${totalTokens}) and had to stop. The conversation is getting too long — try starting a new one.` })
        }
    } catch (err: any) {
        const errMsg = String(err?.message ?? err ?? "unknown error")
        console.error("Chat handler error:", errMsg)

        // Roll back any partial history mutations so the frontend doesn't send
        // a corrupted alternating-role array back on the next request.
        history.splice(historyBaseLen)

        const is429 = err?.status === 429 || errMsg.includes("rate_limit")
        if (is429) {
            return res.status(429).json({
                error: "Rate limit reached — the sandbox made too many requests this minute. Wait a few seconds and try again.",
                retryAfterMs: 30_000
            })
        }
        return res.status(500).json({ error: "Internal server error" })
    }

    // Normalize reply to string — history stores full Anthropic content blocks, frontend needs plain text
    const lastEntry = history[history.length - 1]
    const lastContent = lastEntry?.content
    const reply = typeof lastContent === "string"
        ? lastContent
        : Array.isArray(lastContent)
            ? lastContent.filter((b: any) => b.type === "text").map((b: any) => b.text).join("")
            : ""
    res.json({ reply, history })
})

app.get("/api/servers/:specId/catalog", authMiddleware, async (req, res) => {
    try {
        const doc = await Spec.findOne({ _id: req.params.specId, userId: req.user!.userId }).lean()
        if (!doc) return res.status(404).json({ error: "Spec not found" })

        // Composite servers have no parseable spec — return saved catalog directly
        if (doc.type === "composite") {
            const catalog = (doc.catalog ?? []).map((t: any) => ({ ...t, enabled: t.enabled !== false }))
            return res.json({ catalog, baseUrl: "", fromSaved: true })
        }

        if (doc.catalog && Array.isArray(doc.catalog) && doc.catalog.length > 0) {
            // Saved catalog exists — return it directly, no re-parse needed
            const catalog = doc.catalog.map((t: any) => ({ ...t, enabled: t.enabled !== false }))
            return res.json({ catalog, baseUrl: doc.baseUrl || "", fromSaved: true })
        }

        // No saved catalog — parse from spec and return defaults
        const registry = await generateToolRegistry(doc)
        const catalog = registry.tools.map((tool: any) => ({
            name: tool.name,
            description: tool.description,
            enabled: true,
            input_schema: tool.input_schema,
            handler: tool.handler,
            enrichment: tool.enrichment
        }))
        res.json({ catalog, baseUrl: registry.baseUrl || "", fromSaved: false })
    } catch (err: any) {
        res.status(500).json({ error: err.message })
    }
})

app.post("/api/servers/:specId/catalog", authMiddleware, async (req, res) => {
    try {
        const { catalog, spec, baseUrl, toolCount } = req.body
        if (!Array.isArray(catalog)) return res.status(400).json({ error: "catalog must be an array" })

        const existing = await Spec.findOne({ _id: req.params.specId, userId: req.user!.userId })

        if (!existing) {
            // New server — first time saving. Create the full document now.
            if (!spec) return res.status(400).json({ error: "spec required for new server" })
            const allSpecs = await Spec.find({ userId: req.user!.userId }, { starX: 1, starY: 1 }).lean()
            const existingPositions = allSpecs.filter(s => s.starX != null).map(s => ({ starX: s.starX!, starY: s.starY! }))
            const { starX, starY } = assignStarPosition(existingPositions)
            await Spec.create({
                _id: req.params.specId,
                userId: req.user!.userId,
                type: spec.type ?? null,
                baseUrl: baseUrl || "",
                toolCount: toolCount || catalog.length,
                createdAt: new Date().toISOString(),
                catalog,
                auth: spec.auth ?? [],
                groupMap: spec.groupMap ?? null,
                authMap: spec.authMap ?? null,
                starX,
                starY,
            })
        } else {
            return res.status(409).json({ error: `A server named "${req.params.specId}" already exists. Please choose a different name.` })
        }

        res.json({ ok: true })
    } catch (err: any) {
        res.status(500).json({ error: err.message })
    }
})

app.delete("/api/servers/:specId", authMiddleware, async (req, res) => {
    try {
        const deleted = await Spec.deleteOne({ _id: req.params.specId, userId: req.user!.userId })
        if (!deleted.deletedCount) return res.status(404).json({ error: "Server not found" })
        res.json({ ok: true })
    } catch (err: any) {
        res.status(500).json({ error: err.message })
    }
})

app.get("/api/servers", authMiddleware, async (req, res) => {
    try {
        const all = await Spec.find({ userId: req.user!.userId }).lean()

        // Lazily assign star positions for any server that doesn't have one yet.
        // Mutate in-memory FIRST so this response always has coordinates, then
        // persist fire-and-forget so a DB error can't block the mutation.
        const existingPositions = (all as any[])
            .filter(s => s.starX != null)
            .map(s => ({ starX: s.starX as number, starY: s.starY as number }))

        for (const s of all as any[]) {
            if (s.starX == null) {
                const pos = assignStarPosition(existingPositions)
                s.starX = pos.starX   // mutate in-memory before any await
                s.starY = pos.starY
                existingPositions.push(pos)
                // Persist in the background — failure just means next load retries
                Spec.updateOne(
                    { _id: s._id, userId: req.user!.userId },
                    { $set: { starX: pos.starX, starY: pos.starY } }
                ).catch(() => {})
            }
        }

        const servers = all.map((s: any) => ({
            id: s._id,
            baseUrl: s.baseUrl || "",
            toolCount: Array.isArray(s.catalog) ? s.catalog.filter((t: any) => t.enabled !== false).length : (s.toolCount || 0),
            createdAt: s.createdAt || "",
            starX: s.starX,
            starY: s.starY,
        }))
        res.json({ servers })
    } catch (err: any) {
        res.status(500).json({ error: err.message })
    }
})

// Download — generates a standalone MCP server ZIP for the given saved spec
app.get("/api/servers/:specId/download", authMiddleware, async (req, res) => {
    const specId = req.params.specId
    try {
        const doc = await Spec.findOne({ _id: specId, userId: req.user!.userId }).lean()
        if (!doc) return res.status(404).json({ error: "Server not found" })

        const catalog = doc.catalog
        if (!Array.isArray(catalog) || catalog.length === 0) {
            return res.status(400).json({ error: "No tools found for this server" })
        }

        const registry = {
            baseUrl: doc.baseUrl || "",
            tools: catalog.filter((t: any) => t.enabled !== false),
            auth: doc.auth || []
        }

        const zipBuffer = await generateServerZip(specId, registry)

        res.setHeader("Content-Type", "application/zip")
        res.setHeader("Content-Disposition", `attachment; filename="${specId}-mcp-server.zip"`)
        res.send(zipBuffer)
    } catch (err: any) {
        res.status(500).json({ error: err.message })
    }
})

// OAuth2 Client Credentials — exchange clientId+clientSecret for access_token (stores credentials for auto-refresh)
// Aliased at two paths: the canonical one and the one the sandbox currently calls
async function handleOAuthClientCredentials(req: express.Request, res: express.Response) {
    const { integrationId, groupName, clientId, clientSecret, tokenUrl } = req.body
    const id = integrationId ?? groupName
    if (!id || !clientId || !clientSecret || !tokenUrl) {
        return res.status(400).json({ error: "integrationId (or groupName), clientId, clientSecret, and tokenUrl are required" })
    }
    try {
        const { expiresIn } = await storeOAuthClientCredentials(req.user!.userId, String(id), clientId, clientSecret, tokenUrl)
        res.json({ ok: true, expiresIn })
    } catch (err: any) {
        res.status(400).json({ error: err.message })
    }
}

app.post("/api/oauth2/client-credentials", authMiddleware, handleOAuthClientCredentials)
// Fix: sandbox calls this path — keep it wired to the same handler
app.post("/api/keys/oauth2/connect", authMiddleware, handleOAuthClientCredentials)

// ── OAuth2 Authorization Code popup flow ─────────────────────────────────────
// In-memory store for pending auth sessions (UUID → state). TTL: 10 minutes.
interface PendingAuthState {
    userId: string
    integrationId: string
    clientId: string
    clientSecret: string
    tokenUrl: string
    expiresAt: number
}
const pendingAuth = new Map<string, PendingAuthState>()

// Clean up expired sessions every 5 minutes
setInterval(() => {
    const now = Date.now()
    for (const [k, v] of pendingAuth) if (v.expiresAt < now) pendingAuth.delete(k)
}, 5 * 60 * 1000)

const OAUTH_REDIRECT_URI = process.env.OAUTH_REDIRECT_URI || "http://localhost:8000/api/oauth2/callback"

// Step 1: frontend calls this to get the popup URL
app.post("/api/oauth2/authorize", authMiddleware, async (req, res) => {
    const { integrationId, clientId, clientSecret, authorizationUrl, tokenUrl, scopes } = req.body
    if (!integrationId || !clientId || !clientSecret || !authorizationUrl || !tokenUrl) {
        return res.status(400).json({ error: "integrationId, clientId, clientSecret, authorizationUrl, and tokenUrl are required" })
    }
    try {
        // SSRF guard on authorizationUrl
        const parsed = new URL(authorizationUrl)
        if (parsed.protocol !== "https:") return res.status(400).json({ error: "authorizationUrl must use HTTPS" })

        const state = crypto.randomUUID()
        pendingAuth.set(state, {
            userId: req.user!.userId,
            integrationId: String(integrationId),
            clientId, clientSecret,
            tokenUrl: String(tokenUrl),
            expiresAt: Date.now() + 10 * 60 * 1000,
        })

        const url = new URL(authorizationUrl)
        url.searchParams.set("response_type", "code")
        url.searchParams.set("client_id", clientId)
        url.searchParams.set("redirect_uri", OAUTH_REDIRECT_URI)
        url.searchParams.set("state", state)
        if (scopes) url.searchParams.set("scope", Array.isArray(scopes) ? scopes.join(" ") : String(scopes))
        // Request offline access so we get a refresh_token (Google, etc.)
        url.searchParams.set("access_type", "offline")
        url.searchParams.set("prompt", "consent")

        res.json({ url: url.toString() })
    } catch (err: any) {
        res.status(400).json({ error: err.message })
    }
})

// Step 2: auth server redirects here with ?code=&state=
// No authMiddleware — this is a browser redirect, not a fetch with a JWT
app.get("/api/oauth2/callback", async (req, res) => {
    const { code, state, error } = req.query as Record<string, string>

    const closePopup = (ok: boolean, message: string) => res.send(`
        <!DOCTYPE html><html><body><script>
        window.opener?.postMessage(${JSON.stringify({ heliosOAuth: true, ok, message })}, "*");
        window.close();
        </script><p>${message}</p></body></html>
    `)

    if (error) return closePopup(false, `Authorization denied: ${error}`)
    if (!code || !state) return closePopup(false, "Missing code or state")

    const session = pendingAuth.get(state)
    if (!session) return closePopup(false, "Session expired — please try again")
    if (session.expiresAt < Date.now()) {
        pendingAuth.delete(state)
        return closePopup(false, "Session expired — please try again")
    }
    pendingAuth.delete(state)

    try {
        const params = new URLSearchParams({
            grant_type: "authorization_code",
            code,
            redirect_uri: OAUTH_REDIRECT_URI,
            client_id: session.clientId,
            client_secret: session.clientSecret,
        })
        const tokenRes = await fetch(session.tokenUrl, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: params.toString(),
        })
        const tokenData = await tokenRes.json() as any
        if (!tokenRes.ok || !tokenData.access_token) {
            const msg = tokenData.error_description || tokenData.error || "Token exchange failed"
            return closePopup(false, msg)
        }

        await storeOAuthRefreshToken(session.userId, session.integrationId, {
            refreshToken: tokenData.refresh_token ?? "",
            tokenUrl: session.tokenUrl,
            clientId: session.clientId,
            clientSecret: session.clientSecret,
            accessToken: tokenData.access_token,
            expiresIn: tokenData.expires_in ?? null,
        })

        closePopup(true, "Connected! You can close this window.")
    } catch (err: any) {
        closePopup(false, "Token exchange failed: " + err.message)
    }
})

// Save an API key for an integration (upserts — calling again overwrites the old key)
app.post("/api/keys/:integrationId", authMiddleware, async (req, res) => {
    const { key } = req.body
    if (!key || typeof key !== "string") return res.status(400).json({ error: "key is required" })
    try {
        await storeApiKey(req.user!.userId, String(req.params.integrationId), key)
        res.json({ ok: true })
    } catch (err: any) {
        res.status(500).json({ error: err.message })
    }
})

// Check whether a key exists for an integration — returns exists: bool, never the key itself
app.get("/api/keys/:integrationId/status", authMiddleware, async (req, res) => {
    try {
        const record = await getStoredApiKey(req.user!.userId, String(req.params.integrationId))
        res.json({ exists: !!record })
    } catch (err: any) {
        res.status(500).json({ error: err.message })
    }
})

// Delete a stored key for an integration
app.delete("/api/keys/:integrationId", authMiddleware, async (req, res) => {
    try {
        await ApiKey.deleteOne({ userId: req.user!.userId, integrationId: req.params.integrationId })
        res.json({ ok: true })
    } catch (err: any) {
        res.status(500).json({ error: err.message })
    }
})

// Get all key statuses for a saved server — used by the /keys page
// Returns each auth integration the server uses + whether a key is stored for it
app.get("/api/servers/:serverId/keys", authMiddleware, async (req, res) => {
    try {
        const doc = await Spec.findOne({ _id: req.params.serverId, userId: req.user!.userId }).lean()
        if (!doc) return res.status(404).json({ error: "Server not found" })

        // Collect integration IDs → auth type from authMap or flat auth array
        const integrations: Array<{
            integrationId: string;
            authType: "apiKey" | "oauth2" | "bearer_token" | "basic_auth" | "none";
            oauthFlow?: string;
            tokenUrl?: string;
            authorizationUrl?: string;
            scopes?: string[];
            keyPresent: boolean;
            tokenExpired: boolean;
        }> = []

        const seen = new Set<string>()

        // authMap: groupName → AuthConfig[]
        if (doc.authMap) {
            for (const [groupName, configs] of Object.entries(doc.authMap as Record<string, any[]>)) {
                if (seen.has(groupName)) continue
                seen.add(groupName)
                const cfg = configs?.[0]
                if (!cfg || cfg.type === "none") continue
                const record = await ApiKey.findOne({ userId: req.user!.userId, integrationId: groupName }).lean()
                const tokenExpired = !!(record?.expiresAt && record.expiresAt <= new Date())
                integrations.push({
                    integrationId: groupName,
                    authType: cfg.type,
                    oauthFlow: cfg.oauthFlow,
                    tokenUrl: cfg.tokenUrl,
                    authorizationUrl: cfg.authorizationUrl,
                    scopes: cfg.scopes ? Object.keys(cfg.scopes) : undefined,
                    keyPresent: !!record,
                    tokenExpired,
                })
            }
        }

        // Flat auth array (non-composite servers): use specId as integrationId
        if (!doc.authMap) {
            const flatAuth = Array.isArray(doc.auth) ? (doc.auth as any[]).filter((a: any) => a?.type && a.type !== "none") : []

            if (flatAuth.length > 0) {
                // Auth config stored in doc.auth — use it directly
                const cfg = flatAuth[0]
                const integrationId = req.params.serverId
                if (!seen.has(integrationId)) {
                    seen.add(integrationId)
                    const record = await ApiKey.findOne({ userId: req.user!.userId, integrationId }).lean()
                    const tokenExpired = !!(record?.expiresAt && record.expiresAt <= new Date())
                    integrations.push({
                        integrationId,
                        authType: cfg.type,
                        oauthFlow: cfg.oauthFlow,
                        tokenUrl: cfg.tokenUrl,
                        authorizationUrl: cfg.authorizationUrl,
                        scopes: cfg.scopes ? Object.keys(cfg.scopes) : undefined,
                        keyPresent: !!record,
                        tokenExpired,
                    })
                }
            } else {
                // doc.auth is empty — fall back to catalog tool enrichments
                const firstAuthTool = (doc.catalog ?? []).find((t: any) =>
                    t.enrichment?.auth?.template && t.enrichment.auth.template !== "none"
                )
                if (firstAuthTool) {
                    const auth = firstAuthTool.enrichment.auth
                    const template = auth.template as string
                    const authType = template.includes("oauth2") ? "oauth2"
                        : template.includes("api_key") ? "api_key"
                        : template === "basic_auth" ? "basic_auth"
                        : "bearer_token"
                    const oauthFlow = template === "oauth2_client_creds" ? "client_credentials"
                        : template === "oauth2_auth_code" ? "authorization_code"
                        : undefined
                    const integrationId = req.params.serverId
                    if (!seen.has(integrationId)) {
                        seen.add(integrationId)
                        const record = await ApiKey.findOne({ userId: req.user!.userId, integrationId }).lean()
                        const tokenExpired = !!(record?.expiresAt && record.expiresAt <= new Date())
                        integrations.push({
                            integrationId,
                            authType,
                            oauthFlow,
                            tokenUrl: auth.token_url,
                            authorizationUrl: auth.authorization_url,
                            keyPresent: !!record,
                            tokenExpired,
                        })
                    }
                }
            }
        }

        res.json({ integrations })
    } catch (err: any) {
        res.status(500).json({ error: err.message })
    }
})

app.use("/api/auth", authRouter)

app.listen(8000, () => {
    console.log("api server running on port 8000")
})
