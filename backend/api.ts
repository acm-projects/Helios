// API server — port 8000. The layer between the frontend and the two backend services (MCP + MongoDB).
// Handles spec parsing, sandbox session management, and saved server CRUD.
import dotenv from "dotenv"
dotenv.config()
import {generateToolRegistry, parseSwaggerUrl, parseAuthConfig, buildEnrichmentFromAuthConfigs } from "./generate_tool_registry.ts";
import type { AuthConfig } from "./generate_tool_registry.ts";
import { connectMongo, createMongo, getMongo, getAllMongo, removeMongo, updateMongo } from "./crud.js";
import {initializeAgent, callTool, messageAI } from "./sandbox.ts";
import authRouter from "./auth/auth.routes.js";
import { authMiddleware } from "./auth/auth.middleware.js";
import { storeApiKey, getStoredApiKey } from "./auth/apiKeyManager.js";
import express from "express"
import cors from "cors"
import mongoose from "mongoose"

const app = express()
app.use(cors())
app.use(express.json({ limit: "50mb" })) // large limit needed for specs with 50-100+ tools

await connectMongo()
await mongoose.connect(process.env.MONGODB_URI!)

// Shared shape for tools sent to OpenAI and back to the frontend
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



// Parses a spec and returns the tool catalog to the frontend for review.
// Accepts either { url, name } or { spec, name } (raw JSON object from file upload).
// Does NOT save to the DB yet — that only happens when the user confirms via POST /catalog.
app.post("/api/spec/parse", authMiddleware, async (req, res) => {
    const specId = req.body.name
    if (!specId) return res.status(400).json({ error: "name cannot be empty" })

    const existing = await getMongo({ _id: specId }, req.user!.userId)
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
            const doc = await getMongo({ _id: req.body.specId }, req.user!.userId)
            if (!doc) return res.status(404).json({ error: "Spec not found" })

            // ALWAYS generate fresh registry to auto-upgrade to latest enrichment templates
            registry = await generateToolRegistry(doc)
            
            // Apply saved user overrides (renames, descriptions, disable toggles)
            if (doc._catalog && Array.isArray(doc._catalog) && doc._catalog.length > 0) {
                const savedCatalogMap = new Map<string, any>(doc._catalog.map((t: any) => [`${t.handler?.method}:${t.handler?.path}`, t]))
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
    const TOKEN_BUDGET = 60000;  // ~96 tools × ~200tk schemas + conversation room
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

    const history = req.body.history
    history.push({ role: "user", content: req.body.message })

    // Build auth-aware context for the system prompt
    const authHints: string[] = []
    const toolsRegistry = req.body.tools ?? []
    const seenAuthTypes = new Set<string>()
    // Detect auth type hints from tool headers/fixed_query_params patterns
    for (const tool of toolsRegistry) {
        const h = tool.handler ?? {}
        if (h.headers?.Authorization?.startsWith("Bearer ")) seenAuthTypes.add("bearer")
        if (h.headers?.Authorization?.startsWith("Basic ")) seenAuthTypes.add("basic")
        if (h.fixed_query_params && Object.keys(h.fixed_query_params).length > 0) seenAuthTypes.add("apikey")
    }
    // Detect from tools that have no injected auth (missing auth = possible oauth2/basic flow needed)
    const authContext = req.body.authContext as { oauth2Url?: string; tokenUrl?: string; basicAuthNote?: string } | undefined
    if (authContext?.oauth2Url) {
        authHints.push(`This API uses OAuth 2.0. If the user does not have an access token yet, tell them: "To authorize, visit: ${authContext.oauth2Url} — log in and copy the access_token from the response. Then paste it into the API Keys panel (Tools button → API Keys tab) and save it."`)
    }
    if (authContext?.tokenUrl && !authContext?.oauth2Url) {
        authHints.push(`This API uses OAuth 2.0 Client Credentials. To get an access token, the user must POST to ${authContext.tokenUrl} with their client_id and client_secret. Tell them to paste the resulting access_token into the API Keys panel.`)
    }
    if (authContext?.basicAuthNote) {
        authHints.push(`This API uses Basic Auth. The API key field expects "username:password" (colon-separated, no spaces). ${authContext.basicAuthNote}`)
    }
    const authInstruction = authHints.length > 0
        ? ` AUTH CONTEXT: ${authHints.join(" ")}`
        : ""

    // Detect if Spotify API is in the toolkit (by checking for Spotify tool names or base URL)
    const hasSpotify = toolsRegistry.some((t: any) =>
        (t.handler?.path ?? "").includes("api.spotify.com") ||
        (t.function?.name ?? t.name ?? "").startsWith("get_an_artist") ||
        (t.function?.name ?? t.name ?? "").startsWith("search") && (t.handler?.path ?? "").includes("spotify")
    )
    const spotifyHints = hasSpotify
        ? ` SPOTIFY API RULES: (1) Any endpoint that accepts a "market" parameter MUST include market="US" (or the user's country) — omitting it causes a 400 error. (2) For recommendations, seed_genres must be comma-separated lowercase slugs like "indie,rock,pop" — NOT phrases like "indie rock". Call get_recommendation_genres first if you are unsure of valid genre slugs. (3) Use "search" (not get_categories) for finding music by mood or vibe. (4) If a tool returns an API error, read the error message, fix the parameters, and retry once.`
        : ""

    const systemPrompt = {
        role: "system" as const,
        content: `You are a sandbox testing assistant for API tools. Always call the appropriate tool for every user request — including POST, PUT, PATCH, and DELETE operations. GET requests return real data from the live API. POST, PUT, PATCH, and DELETE requests are intercepted by the sandbox: the tool never touches the real API and instead returns a simulation of what would have been sent. When you receive a sandbox_simulation response, you are done — present the simulated_request to the user as a success and stop immediately. Do not call the same tool again. Never describe a simulation as an error, failure, or technical issue. If an API tool returns an error, read the exact error message and retry with corrected parameters before telling the user it failed. If a tool returns a 401 error, tell the user their API key or token is missing or expired and guide them to open the Tools panel → API Keys tab.${authInstruction}${spotifyHints}`
    }

    // Chat is stateless — the frontend sends the full history on every request.
    let iterations = 0;
    let totalTokens = 0;
    let forceTextNext = false;
    let lastToolNames: string = "";

    try {
        while (iterations < MAX_ITERATIONS && totalTokens < TOKEN_BUDGET) {
            const toolChoice = forceTextNext ? "none" : "auto";
            forceTextNext = false;
            const { message, tokens } = await messageAI([systemPrompt, ...history], req.body.tools, toolChoice);
            totalTokens += tokens;
            iterations++;

            // AI returned a plain response — it's done thinking
            if (!message.tool_calls || message.tool_calls.length === 0) {
                if (message.content) history.push({ role: "assistant", content: message.content });
                break;
            }

            // AI wants to call tools — execute ALL in parallel
            history.push(message);

            const toolResults = await Promise.allSettled(
                message.tool_calls.map(async (toolCall) => {
                    if (toolCall.type !== "function") {
                        return `Tool call skipped: unsupported type "${toolCall.type}".`;
                    }

                    let args: any;
                    try {
                        args = JSON.parse(toolCall.function.arguments);
                    } catch {
                        return "Tool call failed: arguments were malformed or too large to parse. Try a shorter input.";
                    }

                    try {
                        const toolResponse = await callTool(req.body.sessionId, toolCall.function.name, args);
                        const limited = Array.isArray(toolResponse) && toolResponse.length > 100
                            ? toolResponse.slice(0, 100)
                            : toolResponse;
                        let content = JSON.stringify(limited);
                        if (content.length > MAX_RESPONSE_CHARS) {
                            content = content.slice(0, MAX_RESPONSE_CHARS) + `... [truncated — ${content.length - MAX_RESPONSE_CHARS} characters omitted]`;
                        }
                        return content;
                    } catch (toolErr: any) {
                        // If a non-GET tool fails (e.g. Zod validation in server.ts rejects the args),
                        // build a fallback simulation from the args we already have so it still shows up.
                        const toolDef = (req.body.tools ?? []).find((t: any) => t.function?.name === toolCall.function.name)
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
                        // Session expired or evicted — tell the user to refresh instead of a cryptic error
                        if (toolErr.message.includes("-32000") || toolErr.message.includes("Invalid request") || toolErr.message.includes("unexpected response")) {
                            return "SESSION_EXPIRED"
                        }
                        return `Tool execution error: ${toolErr.message}`;
                    }
                })
            );

            // Push one response per tool_call — index-paired so the ID is always correct
            for (let i = 0; i < message.tool_calls.length; i++) {
                const result = toolResults[i];
                const content = result.status === "fulfilled"
                    ? result.value
                    : `Unexpected error for tool call ${message.tool_calls[i].id}.`;
                history.push({ role: "tool", tool_call_id: message.tool_calls[i].id, content });
            }

            const toolNames = message.tool_calls.map(tc => ("function" in tc ? tc.function.name : tc.type)).join(", ");
            console.log(`[Step ${iterations}] Tools: ${toolNames} | Tokens so far: ${totalTokens}`);

            // Session expired — stop the loop and tell the user to refresh
            const sessionExpired = history.slice(-message.tool_calls.length).some(
                (m: any) => m.role === "tool" && m.content === "SESSION_EXPIRED"
            )
            if (sessionExpired) {
                history.push({ role: "assistant", content: "Your sandbox session has expired. Please refresh the page to start a new one." })
                break
            }

            // If any tool response was a sandbox simulation, break immediately — no retry
            const simulationResults = history.slice(-message.tool_calls.length).filter(
                (m: any) => m.role === "tool" && typeof m.content === "string" && m.content.includes("sandbox_simulation")
            );
            if (simulationResults.length > 0) {
                // Extract the simulated_request text and surface it as the assistant reply
                const simTexts = simulationResults.map((m: any) => {
                    try {
                        const parsed = JSON.parse(m.content);
                        const entry = Array.isArray(parsed) ? parsed.find((e: any) => e.type === "text") : null;
                        const sim = entry ? JSON.parse(entry.text) : null;
                        if (sim?.simulated_request) {
                            const r = sim.simulated_request;
                            return `**Sandbox simulation** — ${r.method} ${r.url}\n\`\`\`json\n${JSON.stringify(r.body ?? {}, null, 2)}\n\`\`\``;
                        }
                    } catch {}
                    return "Sandbox simulation complete.";
                });
                history.push({ role: "assistant", content: simTexts.join("\n\n") });
                break;
            }

            // Only cut off tool calls if the exact same tool(s) fired twice in a row
            if (toolNames === lastToolNames) {
                forceTextNext = true;
            }
            lastToolNames = toolNames;
        }

        // Hit a limit — tell the user why it stopped
        if (iterations >= MAX_ITERATIONS) {
            const msg = `I reached my step limit (${MAX_ITERATIONS} attempts) without completing the task. Try breaking it into smaller steps.`;
            history.push({ role: "assistant", content: msg });
        } else if (totalTokens >= TOKEN_BUDGET) {
            const msg = `I used too many tokens (${totalTokens}) and had to stop. The conversation is getting too long — try starting a new one.`;
            history.push({ role: "assistant", content: msg });
        }
    } catch (err: any) {
        console.error("Chat handler error:", err.message);
        const msg = `Something went wrong: ${err.message}`;
        history.push({ role: "assistant", content: msg });
    }

    res.json({ reply: history[history.length - 1].content, history })
})

app.get("/api/servers/:specId/catalog", authMiddleware, async (req, res) => {
    try {
        const doc = await getMongo({ _id: req.params.specId }, req.user!.userId)
        if (!doc) return res.status(404).json({ error: "Spec not found" })

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
        if (doc._catalog && Array.isArray(doc._catalog) && doc._catalog.length > 0) {
            const savedCatalogMap = new Map<string, any>(doc._catalog.map((t: any) => [`${t.handler?.method}:${t.handler?.path}`, t]))
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

        const existing = await getMongo({ _id: req.params.specId }, req.user!.userId)

        if (!existing) {
            // New server — first time saving. Create the full document now.
            if (!spec) return res.status(400).json({ error: "spec required for new server" })
            spec._id = req.params.specId
            spec._baseUrl = baseUrl || ""
            spec._toolCount = toolCount || catalog.length
            spec._createdAt = new Date().toISOString()
            spec._catalog = catalog
            await createMongo(spec, req.user!.userId)
        } else {
            // Existing server — just update the catalog
            await updateMongo({ _id: req.params.specId }, { _catalog: catalog }, req.user!.userId)
        }

        res.json({ ok: true })
    } catch (err: any) {
        res.status(500).json({ error: err.message })
    }
})

app.delete("/api/servers/:specId", authMiddleware, async (req, res) => {
    try {
        const deleted = await removeMongo({ _id: req.params.specId }, req.user!.userId)
        if (!deleted) return res.status(404).json({ error: "Server not found" })
        res.json({ ok: true })
    } catch (err: any) {
        res.status(500).json({ error: err.message })
    }
})

app.get("/api/servers", authMiddleware, async (req, res) => {
    try {
        const all = await getAllMongo(req.user!.userId)
        const servers = all.map((s: any) => ({
            id: s._id,
            baseUrl: s._baseUrl || "",
            toolCount: Array.isArray(s._catalog) ? s._catalog.filter((t: any) => t.enabled !== false).length : (s._toolCount || 0),
            createdAt: s._createdAt || ""
        }))
        res.json({ servers })
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
