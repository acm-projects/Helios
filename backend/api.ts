// API server — port 8000. The layer between the frontend and the two backend services (MCP + MongoDB).
// Handles spec parsing, sandbox session management, and saved server CRUD.
import dotenv from "dotenv"
dotenv.config({ override: true })
import {generateToolRegistry, parseSwaggerUrl, parseAuthConfig, buildEnrichmentFromAuthConfigs } from "./generate_tool_registry.ts";
import { filterToolsByIntent } from "./filterToolsByIntent.ts";
import type { AuthConfig } from "./generate_tool_registry.ts";
import { generateServerZip } from "./generator.ts";
import { Spec } from "./models/spec.model.js";
import {initializeAgent, callTool, messageAI } from "./sandbox.ts";
import authRouter from "./auth/auth.routes.js";
import { authMiddleware } from "./auth/auth.middleware.js";
import { storeApiKey, getStoredApiKey } from "./auth/apiKeyManager.js";
import express from "express"
import cors from "cors"
import mongoose from "mongoose"

const app = express()
const ALLOWED_ORIGIN = process.env.FRONTEND_ORIGIN || "http://localhost:3000"
app.use(cors({ origin: ALLOWED_ORIGIN, credentials: true }))
app.use(express.json({ limit: "50mb" })) // large limit needed for specs with 50-100+ tools

await mongoose.connect(process.env.MONGODB_URI!)

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



// Parses a spec and returns the tool catalog to the frontend for review.
// Accepts either { url, name } or { spec, name } (raw JSON object from file upload).
// Does NOT save to the DB yet — that only happens when the user confirms via POST /catalog.
app.post("/api/spec/parse", authMiddleware, async (req, res) => {
    const specId = req.body.name
    if (!specId) return res.status(400).json({ error: "name cannot be empty" })

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
                const tools = (doc.catalog ?? [])
                    .filter((t: any) => t.enabled !== false)
                    .map((t: any) => {
                        const groupName = groupMap[t.name]
                        let enrichment = t.enrichment
                        if (!enrichment || !enrichment.auth) {
                            const authConfigs: AuthConfig[] = authMap[groupName] ?? [{ type: "none" }]
                            enrichment = buildEnrichmentFromAuthConfigs(authConfigs)
                        }
                        if (enrichment?.auth && groupName) enrichment.auth.integration_id = groupName
                        return { ...t, enrichment }
                    })
                registry = { baseUrl: "", tools, auth: [{ type: "none" }] }
            } else {
            // ALWAYS generate fresh registry to auto-upgrade to latest enrichment templates
            registry = await generateToolRegistry(doc)
            
            // Apply saved user overrides (renames, descriptions, disable toggles)
            if (doc.catalog && Array.isArray(doc.catalog) && doc.catalog.length > 0) {
                const savedCatalogMap = new Map<string, any>(doc.catalog.map((t: any) => [`${t.handler?.method}:${t.handler?.path}`, t]))
                registry.tools = registry.tools.map((t: any) => {
                    const saved = savedCatalogMap.get(`${t.handler?.method}:${t.handler?.path}`)
                    if (saved) {
                        return { ...t, name: saved.name, description: saved.description, enabled: saved.enabled !== false }
                    }
                    return { ...t, enabled: true }
                }).filter((t: any) => t.enabled)
                
                if (registry.tools.length === 0) return res.status(400).json({ error: "No enabled tools in saved catalog" })
            } else {
                registry.tools = registry.tools.map((t: any) => ({ ...t, enabled: true }))
            }
            frontendTools = registry.tools.map((tool: any) => toOpenAITool(tool))

            // Set integration_id on enrichment so server.ts can lookup auth live
            registry.tools = registry.tools.map((tool: any) => {
                if (tool.enrichment && tool.enrichment.auth) {
                    tool.enrichment.auth.integration_id = req.body.specId
                }
                return tool
            })
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

    res.json({ sessionId, tools: openAITools, authContext: Object.keys(authContextObj).length > 0 ? authContextObj : undefined })
})

app.post("/api/sandbox/chat", authMiddleware, async (req, res) => {
    const MAX_ITERATIONS = 10;
    const TOKEN_BUDGET = 60000;
    const MAX_RESPONSE_CHARS = 8000;

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

    // History stored in Anthropic MessageParam format throughout
    const history: any[] = req.body.history
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

    const systemContent = `You are a sandbox testing assistant for API tools. Always call the appropriate tool for every user request — including POST, PUT, PATCH, and DELETE operations. GET requests return real data from the live API. POST, PUT, PATCH, and DELETE requests are intercepted by the sandbox: the tool never touches the real API and instead returns a simulation of what would have been sent. When you receive a sandbox_simulation response, you are done — present the simulated_request to the user as a success and stop immediately. Do not call the same tool again. Never describe a simulation as an error, failure, or technical issue. If an API tool returns an error, read the exact error message and retry with corrected parameters before telling the user it failed. If a tool returns a 401 error, tell the user their API key or token is missing or expired and guide them to open the Tools panel → API Keys tab.${authInstruction}${spotifyHints}`

    let iterations = 0;
    let totalTokens = 0;
    let forceTextNext = false;
    let lastToolNames = "";

    try {
        while (iterations < MAX_ITERATIONS && totalTokens < TOKEN_BUDGET) {
            const toolChoice = forceTextNext ? "none" : "auto";
            forceTextNext = false;
            const { message, tokens } = await messageAI(systemContent, history, anthropicTools, toolChoice);
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
                        if (toolErr.message.includes("-32000") || toolErr.message.includes("Invalid request") || toolErr.message.includes("unexpected response")) {
                            return "SESSION_EXPIRED"
                        }
                        return `Tool execution error: ${toolErr.message}`
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

            // Same tools twice in a row → force a text response next iteration
            if (toolNames === lastToolNames) forceTextNext = true
            lastToolNames = toolNames
        }

        if (iterations >= MAX_ITERATIONS) {
            history.push({ role: "assistant", content: `I reached my step limit (${MAX_ITERATIONS} attempts) without completing the task. Try breaking it into smaller steps.` })
        } else if (totalTokens >= TOKEN_BUDGET) {
            history.push({ role: "assistant", content: `I used too many tokens (${totalTokens}) and had to stop. The conversation is getting too long — try starting a new one.` })
        }
    } catch (err: any) {
        console.error("Chat handler error:", err.message)
        return res.status(500).json({ error: "Internal server error" })
    }

    // Normalize reply to string — history stores full Anthropic content blocks, frontend needs plain text
    const lastContent = history[history.length - 1].content
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

        const registry = await generateToolRegistry(doc)
        let catalog = registry.tools.map((tool: any) => ({
            name: tool.name,
            description: tool.description,
            enabled: true,
            input_schema: tool.input_schema,
            handler: tool.handler,
            enrichment: tool.enrichment
        }))

        // Restore overrides from saved catalog if presents
        if (doc.catalog && Array.isArray(doc.catalog) && doc.catalog.length > 0) {
            const savedCatalogMap = new Map<string, any>(doc.catalog.map((t: any) => [`${t.handler?.method}:${t.handler?.path}`, t]))
            catalog = catalog.map((t: any) => {
                const saved = savedCatalogMap.get(`${t.handler.method}:${t.handler.path}`)
                if (saved) {
                    return { ...t, name: saved.name, description: saved.description, enabled: saved.enabled !== false }
                }
                return t
            })
        }
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
            })
        } else {
            // Existing server — just update the catalog
            await Spec.updateOne({ _id: req.params.specId, userId: req.user!.userId }, { $set: { catalog } })
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
        const servers = all.map((s: any) => ({
            id: s._id,
            baseUrl: s.baseUrl || "",
            toolCount: Array.isArray(s.catalog) ? s.catalog.filter((t: any) => t.enabled !== false).length : (s.toolCount || 0),
            createdAt: s.createdAt || ""
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

// OAuth2 Client Credentials token exchange — exchanges clientId+clientSecret for an access_token
// and stores it as the API key for the given integration. No terminal command needed from the user.
app.post("/api/oauth2/client-credentials", authMiddleware, async (req, res) => {
    const { integrationId, clientId, clientSecret, tokenUrl } = req.body
    if (!integrationId || !clientId || !clientSecret || !tokenUrl) {
        return res.status(400).json({ error: "integrationId, clientId, clientSecret, and tokenUrl are required" })
    }
    // SSRF guard: only allow public HTTPS endpoints
    let parsedTokenUrl: URL
    try {
        parsedTokenUrl = new URL(tokenUrl)
    } catch {
        return res.status(400).json({ error: "tokenUrl is not a valid URL" })
    }
    if (parsedTokenUrl.protocol !== "https:") {
        return res.status(400).json({ error: "tokenUrl must use HTTPS" })
    }
    if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|169\.254\.)/.test(parsedTokenUrl.hostname)) {
        return res.status(400).json({ error: "tokenUrl must be a public URL" })
    }
    try {
        const params = new URLSearchParams({
            grant_type: "client_credentials",
            client_id: clientId,
            client_secret: clientSecret,
        })
        const tokenRes = await fetch(tokenUrl, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: params.toString(),
        })
        const tokenData = await tokenRes.json() as any
        if (!tokenRes.ok || !tokenData.access_token) {
            const msg = tokenData.error_description || tokenData.error || "Token exchange failed"
            return res.status(400).json({ error: msg })
        }
        // Store the access_token as the API key — applyAuth will inject it as a Bearer header
        await storeApiKey(req.user!.userId, String(integrationId), tokenData.access_token)
        res.json({ ok: true, expiresIn: tokenData.expires_in ?? null })
    } catch (err: any) {
        res.status(500).json({ error: "Token exchange request failed: " + err.message })
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

app.use("/api/auth", authRouter)

app.listen(8000, () => {
    console.log("api server running on port 8000")
})
