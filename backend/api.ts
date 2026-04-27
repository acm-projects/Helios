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
            fixed_query_params: tool.handler.fixed_query_params,
            param_name_map: tool.handler.param_name_map,
            body_format: tool.handler.body_format,
            auto_path_params: tool.handler.auto_path_params,
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
        const result = await filterToolsByIntent({ schema_version: 2, baseUrl: "", tools: catalog, auth: [] }, userIntent.trim())
        res.json({ catalog: result.tools })
    } catch (err: any) {
        res.status(500).json({ error: err.message })
    }
})

// Shared registry builder for both sandbox (GET-only simulation) and try (unrestricted).
// Three entry paths:
//   toolsRegistry — pre-built composite registry from the create page (multi-API, baseUrl is "")
//   spec          — unsaved new server passed directly from the frontend
//   specId        — existing saved server, loaded from DB
async function buildMcpRegistry(req: any): Promise<
    | { ok: true; registry: any; frontendTools: any[]; groupMap?: Record<string, string>; authMap?: Record<string, AuthConfig[]> }
    | { ok: false; status: number; error: string }
> {
    let registry: any = null
    let frontendTools: any[] | null = null
    let outGroupMap: Record<string, string> | undefined
    let outAuthMap: Record<string, AuthConfig[]> | undefined

    if (req.body.toolsRegistry) {
        const reg = req.body.toolsRegistry
        if (!Array.isArray(reg.tools) || reg.tools.length === 0) {
            return { ok: false, status: 400, error: "toolsRegistry must have a non-empty tools array" }
        }
        const invalid = reg.tools.find((t: any) => !t.name || !t.handler?.method || !t.handler?.path)
        if (invalid) {
            return { ok: false, status: 400, error: `Tool "${invalid.name || "unknown"}" is missing required fields (name, handler.method, handler.path)` }
        }
    }

    try {
        if (req.body.toolsRegistry) {
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
                }),
                auth: aggregateAuthMap(authMap),
            }
            frontendTools = req.body.toolsRegistry.tools.map((tool: any) => toOpenAITool(tool))
            if (Object.keys(groupMap).length > 0) outGroupMap = groupMap
            if (Object.keys(authMap).length > 0) outAuthMap = authMap
        } else if (req.body.spec) {
            registry = await generateToolRegistry(req.body.spec)
            if (!registry.baseUrl && req.body.baseUrl) {
                registry = { ...registry, baseUrl: req.body.baseUrl }
            }
            registry.tools = registry.tools.map((tool: any) => {
                if (tool.enrichment && tool.enrichment.auth && req.body.specId) {
                    tool.enrichment.auth.integration_id = req.body.specId
                }
                return tool
            })
        } else {
            const doc = await Spec.findOne({ _id: req.body.specId, userId: req.user!.userId }).lean()
            if (!doc) return { ok: false, status: 404, error: "Spec not found" }

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
                registry = { baseUrl: "", tools: allCatalogTools.filter((t: any) => t.enabled !== false), auth: aggregateAuthMap(authMap) }
                frontendTools = allCatalogTools.map((t: any) => toOpenAITool(t, t.enabled !== false))
                if (Object.keys(groupMap).length > 0) outGroupMap = groupMap
                if (Object.keys(authMap).length > 0) outAuthMap = authMap
            } else {
                if (doc.catalog && Array.isArray(doc.catalog) && doc.catalog.length > 0) {
                    const enabledTools = doc.catalog.filter((t: any) => t.enabled !== false)
                    if (enabledTools.length === 0) return { ok: false, status: 400, error: "No enabled tools in saved catalog" }
                    registry = { baseUrl: doc.baseUrl || "", tools: enabledTools, auth: doc.auth ?? [] }
                } else {
                    registry = await generateToolRegistry(doc)
                    registry.tools = registry.tools.map((t: any) => ({ ...t, enabled: true }))
                }
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
                frontendTools = (doc.catalog ?? registry.tools).map((tool: any) => toOpenAITool(tool, tool.enabled !== false))
            }
        }
    } catch (err: any) {
        return { ok: false, status: 400, error: "Failed to load spec: " + err.message }
    }

    return { ok: true, registry, frontendTools: frontendTools ?? registry.tools.map((tool: any) => toOpenAITool(tool)), groupMap: outGroupMap, authMap: outAuthMap }
}

// Flatten a composite authMap (groupName → AuthConfig[]) into a single auth
// array so buildAuthContext can surface oauth2/basic/api_key hints. Composite
// registries previously hardcoded auth: [{ type: "none" }], which caused the
// frontend's hasSecurityScheme check to incorrectly say no keys were needed.
// Rolling window over chat history. Maintains the tail of entries that fit
// within maxChars of serialized content, updated incrementally. Replaces the
// previous per-turn truncateHistory(hist) scan that was O(n) each call and
// O(n²) over a long conversation.
function createRollingHistory(history: any[], maxChars: number) {
    const lenOf = (entry: any): number => {
        const raw = entry?.content
        if (raw === undefined) return 0
        if (typeof raw === "string") return raw.length
        try { return (JSON.stringify(raw) ?? "").length } catch { return 0 }
    }

    const view: any[] = []
    let chars = 0

    // Seed from the tail of the incoming history, keeping at least the last 2
    // entries even if a single entry exceeds the budget.
    for (let i = history.length - 1; i >= 0; i--) {
        const entryLen = lenOf(history[i])
        if (chars + entryLen > maxChars && view.length >= 2) break
        view.unshift(history[i])
        chars += entryLen
    }

    return {
        view,
        push(entry: any) {
            history.push(entry)
            view.push(entry)
            chars += lenOf(entry)
            while (chars > maxChars && view.length > 2) {
                const dropped = view.shift()
                chars -= lenOf(dropped)
            }
        }
    }
}

function aggregateAuthMap(authMap: Record<string, AuthConfig[]>): AuthConfig[] {
    const out: AuthConfig[] = []
    for (const configs of Object.values(authMap ?? {})) {
        for (const c of configs ?? []) {
            if (c && c.type !== "none") out.push(c)
        }
    }
    return out.length > 0 ? out : [{ type: "none" }]
}

function buildAuthContext(registry: any): Record<string, string> {
    const authContextObj: Record<string, string> = {}
    const registryAuth: AuthConfig[] = registry.auth ?? []
    for (const a of registryAuth) {
        if (a.type === "oauth2") {
            if (a.authorizationUrl) authContextObj.oauth2Url = a.authorizationUrl
            if (a.tokenUrl) authContextObj.tokenUrl = a.tokenUrl
        } else if (a.type === "basic_auth") {
            authContextObj.basicAuthNote = "Enter your credentials as \"username:password\" in the API Keys panel."
        } else if (a.type === "api_key" || a.type === "bearer_token") {
            authContextObj.apiKeyNote = a.type
        }
    }
    return authContextObj
}

app.post("/api/sandbox/start", authMiddleware, async (req, res) => {
    const built = await buildMcpRegistry(req)
    if (!built.ok) return res.status(built.status).json({ error: built.error })
    let sessionId: string
    try {
        sessionId = await initializeAgent(built.registry, req.user!.userId, false)
    } catch (err: any) {
        return res.status(500).json({ error: "Failed to start MCP session: " + err.message })
    }
    const authContextObj = buildAuthContext(built.registry)
    res.json({
        sessionId,
        tools: built.frontendTools,
        baseUrl: built.registry.baseUrl ?? "",
        authContext: Object.keys(authContextObj).length > 0 ? authContextObj : undefined,
        groupMap: built.groupMap,
        authMap: built.authMap,
    })
})

// Try mode: every method executes live, no simulation. Used by /try page for downloaded servers.
app.post("/api/try/start", authMiddleware, async (req, res) => {
    const built = await buildMcpRegistry(req)
    if (!built.ok) return res.status(built.status).json({ error: built.error })
    let sessionId: string
    try {
        sessionId = await initializeAgent(built.registry, req.user!.userId, true)
    } catch (err: any) {
        return res.status(500).json({ error: "Failed to start MCP session: " + err.message })
    }
    const authContextObj = buildAuthContext(built.registry)
    res.json({
        sessionId,
        tools: built.frontendTools,
        baseUrl: built.registry.baseUrl ?? "",
        authContext: Object.keys(authContextObj).length > 0 ? authContextObj : undefined,
        groupMap: built.groupMap,
        authMap: built.authMap,
    })
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
    const sandboxCredentialPolicy = ` CREDENTIAL POLICY: All API credentials (API keys, tokens, usernames, passwords, client IDs, client secrets, and any provider-specific identifiers) are stored securely on the server and auto-injected into every outgoing request by the dispatcher. You NEVER need them, you NEVER ask the user for them, and you NEVER echo, request, or display them in conversation. If the user volunteers a credential in chat, acknowledge it but do not store or use it — instruct them to save it in the Tools → API Keys panel instead. Only when a tool returns 401/403 should you tell the user their saved credential is missing or invalid and point them to Tools → API Keys.`
    const authInstruction = sandboxCredentialPolicy + (authHints.length > 0 ? ` AUTH CONTEXT: ${authHints.join(" ")}` : "")

    const todayStr = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })

    const systemContent = `Today's date is ${todayStr}. You are a sandbox testing assistant for API tools. Always call the appropriate tool for every user request — including POST, PUT, PATCH, and DELETE operations. GET requests return real data from the live API. POST, PUT, PATCH, and DELETE requests are intercepted by the sandbox: the tool never touches the real API and instead returns a simulation of what would have been sent. When you receive a sandbox_simulation response, you are done — present the simulated_request to the user as a success and stop immediately. Do not call the same tool again. Never describe a simulation as an error, failure, or technical issue. CONTENT FIELDS ARE THE DELIVERABLE: when a tool parameter accepts user-facing content (message bodies, email bodies, SMS text, TwiML scripts, post content, chat messages), put the COMPLETE substantive content in that parameter — the exact words the recipient would see or hear in production. Do not write placeholders, generic greetings, or summaries; if the user asked you to convey specific information, embed it verbatim inside the content parameter. If a tool exposes BOTH a content field AND a URL/webhook field, populate ONLY the content field and leave every URL field unset — never fill both, never invent placeholder URLs, never use demo URLs. If an API tool returns an error, read the exact error message and retry with corrected parameters before telling the user it failed. If a tool returns a 401 error, tell the user their API key or token is missing or expired and guide them to open the Tools panel → API Keys tab.${authInstruction}`

    let iterations = 0;
    let totalTokens = 0;
    let forceTextNext = false;
    let lastToolNames = "";

    // Rolling window keeps history within Anthropic's 30k input-tokens/minute budget.
    // 20k chars ≈ 5k tokens, leaving headroom for system prompt + tools. rolling.push
    // appends to both history (returned to frontend) and the view (sent to the API)
    // and trims the front of view incrementally — always preserving the last 2 entries.
    const rolling = createRollingHistory(history, 20_000)

    try {
        while (iterations < MAX_ITERATIONS && totalTokens < TOKEN_BUDGET) {
            const toolChoice = forceTextNext ? "none" : "auto";
            forceTextNext = false;
            const { message, tokens } = await messageAI(systemContent, rolling.view, anthropicTools, toolChoice);
            totalTokens += tokens;
            iterations++;

            // Extract tool use blocks from Claude's response
            const toolUseBlocks = message.content.filter((b: any) => b.type === "tool_use") as any[]
            const textBlocks = message.content.filter((b: any) => b.type === "text") as any[]
            const textContent = textBlocks.map((b: any) => b.text).join("")

            // No tool calls — model is done
            if (toolUseBlocks.length === 0) {
                rolling.push({ role: "assistant", content: message.content })
                break
            }

            // Store assistant turn with full content blocks (tool_use + text)
            rolling.push({ role: "assistant", content: message.content })

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
            rolling.push({ role: "user", content: toolResultBlocks })

            const toolNames = toolUseBlocks.map((b: any) => b.name).join(", ")
            console.log(`[Step ${iterations}] Tools: ${toolNames} | Tokens so far: ${totalTokens}`)

            // Session expired — surface clean message and stop
            const sessionExpired = toolResultBlocks.some((b: any) => b.content === "SESSION_EXPIRED")
            if (sessionExpired) {
                rolling.push({ role: "assistant", content: "Your sandbox session has expired. Please refresh the page to start a new one." })
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
                rolling.push({ role: "assistant", content: simTexts.join("\n\n") })
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
            rolling.push({ role: "assistant", content: `I reached my step limit (${MAX_ITERATIONS} attempts) without completing the task. Try breaking it into smaller steps.` })
        } else if (totalTokens >= TOKEN_BUDGET) {
            rolling.push({ role: "assistant", content: `I used too many tokens (${totalTokens}) and had to stop. The conversation is getting too long — try starting a new one.` })
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

// Try mode chat — production server prompt, no simulation, real writes execute live.
app.post("/api/try/chat", authMiddleware, async (req, res) => {
    const MAX_ITERATIONS = 10;
    const TOKEN_BUDGET = 60000;
    // Try mode is not simulation-bound — list endpoints (calendar events, search
    // results, etc.) routinely return 5–20 KB of useful data. 2k was a sandbox
    // optimization that caused "events from 2020" hallucinations when response
    // metadata timestamps leaked through before items[] was reached.
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

    const history: any[] = req.body.history
    const historyBaseLen = history.length
    history.push({ role: "user", content: req.body.message })

    const anthropicTools = (req.body.tools ?? [])
        .filter((t: any) => t.function?.name)
        .map(toAnthropicTool)

    const sanitizePromptField = (s: string) => s.replace(/[\n\r`]/g, " ").slice(0, 300)

    const authHints: string[] = []
    const authContext = req.body.authContext as { oauth2Url?: string; tokenUrl?: string; basicAuthNote?: string } | undefined
    if (authContext?.oauth2Url) {
        authHints.push(`This API uses OAuth 2.0. If a tool returns 401, the access token is missing or expired — direct the user to visit ${sanitizePromptField(authContext.oauth2Url)} and paste the resulting access_token into the Tools → API Keys panel.`)
    }
    if (authContext?.tokenUrl && !authContext?.oauth2Url) {
        authHints.push(`This API uses OAuth 2.0 Client Credentials. If a tool returns 401, the user must POST to ${sanitizePromptField(authContext.tokenUrl)} with their client_id and client_secret, then paste the resulting access_token into Tools → API Keys.`)
    }
    if (authContext?.basicAuthNote) {
        authHints.push(`This API uses Basic Auth. ${sanitizePromptField(authContext.basicAuthNote)}`)
    }
    const credentialPolicy = ` CREDENTIAL POLICY: All API credentials (API keys, tokens, usernames, passwords, client IDs, client secrets, and any provider-specific identifiers) are stored securely on the server and auto-injected into every outgoing request by the dispatcher. You NEVER need them, you NEVER ask the user for them, and you NEVER echo, request, or display them in conversation. If the user volunteers a credential in chat, acknowledge it but do not store or use it — instruct them to save it in the Tools → API Keys panel instead. Only when a tool returns 401/403 should you tell the user their saved credential is missing or invalid and point them to Tools → API Keys.`
    const authInstruction = credentialPolicy + (authHints.length > 0 ? ` AUTH CONTEXT: ${authHints.join(" ")}` : "")

    const todayStr = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })

    const systemContent = `Today's date is ${todayStr}. You are a live assistant connected to the user's real APIs through their generated MCP server. Every tool call executes against the production API — GET, POST, PUT, PATCH, DELETE all hit the real service and cause real side effects. This is not a sandbox; there are no simulations. Before any destructive or irreversible write (delete, bulk update, send, etc.) briefly confirm the intent with the user in plain language — a one-line check is enough. Always call the correct tool for the task and execute it. CONTENT FIELDS ARE THE DELIVERABLE: when a tool parameter accepts user-facing content (message bodies, email bodies, SMS text, TwiML scripts, post content, voicemail scripts, chat messages), put the COMPLETE substantive content in that parameter — the exact words the recipient will see or hear. Do not write placeholders, generic greetings, or summaries; the chat reply is for the user, but the parameter value is what actually gets sent or spoken. If the user asked you to convey specific information (an availability window, a status update, etc.), embed that information verbatim inside the content parameter. If a tool exposes BOTH a content field (Twiml, body, message, content) AND a URL/webhook field (Url, webhook_url, callback_url, action), populate ONLY the content field and leave every URL field unset — never fill both, never invent placeholder URLs, never use demo URLs (e.g. webhook.site, demo.twilio.com, example.com), even when the schema marks them optional. The URL fields are for cases where the user has their own hosted webhook; if you don't have such a URL from the user, omit them entirely. When listing or searching, pass explicit filters the API supports (date ranges, query strings, pagination) — never rely on default ordering. If a tool response ends with "[truncated — N characters omitted]", the real response was longer than shown; only the prefix (usually response metadata) is visible, so do not claim the items array is empty or assume the visible timestamps are the user's data. Instead, narrow the query (tighter date range, explicit fields, pagination) and retry. If a tool returns an error, read the message carefully, correct the parameters, and retry once. If a tool returns 401, tell the user their credentials are missing or expired and point them to Tools → API Keys. Be direct and conversational — you are helping the user operate their own systems.${authInstruction}`

    let iterations = 0;
    let totalTokens = 0;

    // Rolling window — same bookkeeping as the sandbox handler. See createRollingHistory.
    const rolling = createRollingHistory(history, 20_000)

    try {
        while (iterations < MAX_ITERATIONS && totalTokens < TOKEN_BUDGET) {
            // Production mode: no forced-text-next — multi-hop tool chains must work.
            const { message, tokens } = await messageAI(systemContent, rolling.view, anthropicTools, "auto");
            totalTokens += tokens;
            iterations++;

            const toolUseBlocks = message.content.filter((b: any) => b.type === "tool_use") as any[]

            if (toolUseBlocks.length === 0) {
                rolling.push({ role: "assistant", content: message.content })
                break
            }

            rolling.push({ role: "assistant", content: message.content })

            const toolResults = await Promise.allSettled(
                toolUseBlocks.map(async (block: any) => {
                    try {
                        const toolResponse = await callTool(sessionId, block.name, block.input)
                        const limited = Array.isArray(toolResponse) && toolResponse.length > 100
                            ? toolResponse.slice(0, 100)
                            : toolResponse
                        let content = JSON.stringify(limited)
                        if (content.length > MAX_RESPONSE_CHARS) {
                            content = content.slice(0, MAX_RESPONSE_CHARS) + `... [truncated — ${content.length - MAX_RESPONSE_CHARS} characters omitted]`
                        }
                        return content
                    } catch (toolErr: any) {
                        const errMsg = String(toolErr?.message ?? toolErr ?? "unknown error")
                        if (errMsg.includes("-32000") || errMsg.includes("Invalid request") || errMsg.includes("unexpected response")) {
                            return "SESSION_EXPIRED"
                        }
                        return `Tool execution error: ${errMsg}`
                    }
                })
            )

            const toolResultBlocks = toolUseBlocks.map((block: any, i: number) => {
                const result = toolResults[i]
                return {
                    type: "tool_result" as const,
                    tool_use_id: block.id,
                    content: result.status === "fulfilled" ? result.value : `Unexpected error for tool "${block.name}".`
                }
            })
            rolling.push({ role: "user", content: toolResultBlocks })

            const toolNames = toolUseBlocks.map((b: any) => b.name).join(", ")
            console.log(`[try Step ${iterations}] Tools: ${toolNames} | Tokens so far: ${totalTokens}`)

            const sessionExpired = toolResultBlocks.some((b: any) => b.content === "SESSION_EXPIRED")
            if (sessionExpired) {
                // Roll back so the client can retry with a fresh session
                history.splice(historyBaseLen)
                return res.status(410).json({ sessionExpired: true, error: "Session expired — a fresh one will be started automatically." })
            }
        }

        if (iterations >= MAX_ITERATIONS) {
            rolling.push({ role: "assistant", content: `I reached my step limit (${MAX_ITERATIONS} attempts) without completing the task. Try breaking it into smaller steps.` })
        } else if (totalTokens >= TOKEN_BUDGET) {
            rolling.push({ role: "assistant", content: `I used too many tokens (${totalTokens}) and had to stop. Start a new conversation.` })
        }
    } catch (err: any) {
        const errMsg = String(err?.message ?? err ?? "unknown error")
        console.error("Try chat handler error:", errMsg)
        history.splice(historyBaseLen)
        const is429 = err?.status === 429 || errMsg.includes("rate_limit")
        if (is429) {
            return res.status(429).json({
                error: "Rate limit reached — too many requests this minute. Wait a few seconds and try again.",
                retryAfterMs: 30_000
            })
        }
        return res.status(500).json({ error: "Internal server error" })
    }

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

        // Composite servers have no parseable spec — return saved catalog plus the
        // per-group authMap and toolMap so callers can preserve child API identity
        // when importing the composite into another server. `auth` is the flattened
        // aggregate kept for backward compat with older callers.
        if (doc.type === "composite") {
            const catalog = (doc.catalog ?? []).map((t: any) => ({ ...t, enabled: t.enabled !== false }))
            const auth = doc.authMap ? aggregateAuthMap(doc.authMap as any) : (doc.auth ?? [])
            return res.json({ catalog, baseUrl: "", auth, authMap: doc.authMap ?? null, groupMap: doc.groupMap ?? null, fromSaved: true })
        }

        if (doc.catalog && Array.isArray(doc.catalog) && doc.catalog.length > 0) {
            // Saved catalog exists — return it directly, no re-parse needed
            const catalog = doc.catalog.map((t: any) => ({ ...t, enabled: t.enabled !== false }))
            return res.json({ catalog, baseUrl: doc.baseUrl || "", auth: doc.auth ?? [], fromSaved: true })
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
        res.json({ catalog, baseUrl: registry.baseUrl || "", auth: registry.auth ?? [], fromSaved: false })
    } catch (err: any) {
        res.status(500).json({ error: err.message })
    }
})

app.post("/api/servers/:specId/catalog", authMiddleware, async (req, res) => {
    try {
        const { catalog, spec, baseUrl, toolCount, replace } = req.body
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
        } else if (replace) {
            // Overwrite the existing server's catalog/spec — preserve userId, createdAt, star position
            existing.catalog = catalog
            existing.toolCount = toolCount || catalog.length
            if (baseUrl) existing.baseUrl = baseUrl
            if (spec) {
                if (spec.type !== undefined)     existing.type     = spec.type ?? null
                if (spec.auth !== undefined)     { existing.auth     = spec.auth ?? [];   existing.markModified("auth") }
                if (spec.groupMap !== undefined) { existing.groupMap = spec.groupMap ?? null; existing.markModified("groupMap") }
                if (spec.authMap !== undefined)  { existing.authMap  = spec.authMap  ?? null; existing.markModified("authMap") }
            }
            // catalog is Mixed[] — same caveat as above for nested edits
            existing.markModified("catalog")
            await existing.save()
        } else {
            return res.status(409).json({ error: `A server named "${req.params.specId}" already exists. Please choose a different name.`, conflict: true })
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
        const all = await Spec.find({ userId: req.user!.userId })
            .select("_id baseUrl toolCount createdAt starX starY catalog")
            .lean()

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
    const specId = req.params.specId as string
    try {
        const doc = await Spec.findOne({ _id: specId, userId: req.user!.userId }).lean()
        if (!doc) return res.status(404).json({ error: "Server not found" })

        const catalog = doc.catalog
        if (!Array.isArray(catalog) || catalog.length === 0) {
            return res.status(400).json({ error: "No tools found for this server" })
        }

        const registry = {
            schema_version: 2,
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

// Escapes HTML special characters to prevent XSS in interpolated HTML strings.
// Applied to any user/OAuth-provider-supplied value before it appears in a page.
function escapeHtml(s: string): string {
    return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]!))
}

// Step 2: auth server redirects here with ?code=&state=
// No authMiddleware — this is a browser redirect, not a fetch with a JWT
app.get("/api/oauth2/callback", async (req, res) => {
    const { code, state, error } = req.query as Record<string, string>

    // H5: targetOrigin locked to FRONTEND_ORIGIN — never "*", which would let any
    // origin read the postMessage payload (contains ok/message from the OAuth flow).
    const TARGET_ORIGIN = process.env.FRONTEND_ORIGIN || "http://localhost:3000"

    const closePopup = (ok: boolean, message: string) => {
        const safeMessage = escapeHtml(message)
        res.send(`<!DOCTYPE html><html><body><script>
        window.opener?.postMessage(${JSON.stringify({ heliosOAuth: true, ok, message: escapeHtml(message) })}, ${JSON.stringify(TARGET_ORIGIN)});
        window.close();
        </script><p>${safeMessage}</p></body></html>`)
    }

    if (error) return closePopup(false, `Authorization denied: ${escapeHtml(error)}`)
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
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 10_000)
        let tokenRes: Response
        try {
            tokenRes = await fetch(session.tokenUrl, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: params.toString(),
                signal: controller.signal,
            })
        } finally {
            clearTimeout(timer)
        }
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

        type Integration = {
            integrationId: string;
            authType: "apiKey" | "oauth2" | "bearer_token" | "basic_auth" | "none";
            oauthFlow?: string;
            tokenUrl?: string;
            authorizationUrl?: string;
            scopes?: string[];
            keyPresent: boolean;
            tokenExpired: boolean;
        }

        // First pass: enumerate integrations from authMap / flat auth / catalog enrichment.
        // keyPresent/tokenExpired are filled in after a single batched ApiKey lookup
        // below — replaces an N+1 pattern that fired one findOne per integration.
        const integrations: Integration[] = []
        const seen = new Set<string>()

        if (doc.authMap) {
            // Only surface integrations that an enabled catalog tool actually
            // routes to via groupMap. This guards against orphan authMap entries
            // left behind by older saves (e.g. a stale Gmail/Maps entry from a
            // contaminated launchSandbox run).
            const usedGroups: Set<string> | null = (() => {
                if (!doc.groupMap) return null
                const enabledNames = new Set(
                    (doc.catalog ?? [])
                        .filter((t: any) => t.enabled !== false)
                        .map((t: any) => t.name)
                )
                const used = new Set<string>()
                for (const [toolName, group] of Object.entries(doc.groupMap as Record<string, string>)) {
                    if (enabledNames.size === 0 || enabledNames.has(toolName)) used.add(group)
                }
                return used
            })()

            for (const [groupName, configs] of Object.entries(doc.authMap as Record<string, any[]>)) {
                if (seen.has(groupName)) continue
                if (usedGroups && !usedGroups.has(groupName)) continue
                const cfg = configs?.[0]
                if (!cfg || cfg.type === "none") continue
                seen.add(groupName)
                integrations.push({
                    integrationId: groupName,
                    authType: cfg.type,
                    oauthFlow: cfg.oauthFlow,
                    tokenUrl: cfg.tokenUrl,
                    authorizationUrl: cfg.authorizationUrl,
                    scopes: cfg.scopes ? Object.keys(cfg.scopes) : undefined,
                    keyPresent: false,
                    tokenExpired: false,
                })
            }
        } else {
            const flatAuth = Array.isArray(doc.auth) ? (doc.auth as any[]).filter((a: any) => a?.type && a.type !== "none") : []
            const integrationId = req.params.serverId as string

            if (flatAuth.length > 0) {
                const cfg = flatAuth[0]
                if (!seen.has(integrationId)) {
                    seen.add(integrationId)
                    integrations.push({
                        integrationId,
                        authType: cfg.type,
                        oauthFlow: cfg.oauthFlow,
                        tokenUrl: cfg.tokenUrl,
                        authorizationUrl: cfg.authorizationUrl,
                        scopes: cfg.scopes ? Object.keys(cfg.scopes) : undefined,
                        keyPresent: false,
                        tokenExpired: false,
                    })
                }
            } else {
                const firstAuthTool = (doc.catalog ?? []).find((t: any) =>
                    t.enrichment?.auth?.template && t.enrichment.auth.template !== "none"
                )
                if (firstAuthTool && !seen.has(integrationId)) {
                    const auth = firstAuthTool.enrichment.auth
                    const template = auth.template as string
                    const authType = template.includes("oauth2") ? "oauth2"
                        : template.includes("api_key") ? "apiKey"
                        : template === "basic_auth" ? "basic_auth"
                        : "bearer_token"
                    const oauthFlow = template === "oauth2_client_creds" ? "client_credentials"
                        : template === "oauth2_auth_code" ? "authorization_code"
                        : undefined
                    seen.add(integrationId)
                    integrations.push({
                        integrationId,
                        authType,
                        oauthFlow,
                        tokenUrl: auth.token_url,
                        authorizationUrl: auth.authorization_url,
                        keyPresent: false,
                        tokenExpired: false,
                    })
                }
            }
        }

        // Single batched lookup for every integration we built above.
        if (integrations.length > 0) {
            const ids = integrations.map(i => i.integrationId)
            const records = await ApiKey.find({
                userId: req.user!.userId,
                integrationId: { $in: ids },
            }).lean()
            const byId = new Map(records.map(r => [r.integrationId, r]))
            const now = new Date()
            for (const integration of integrations) {
                const record = byId.get(integration.integrationId)
                if (!record) continue
                integration.keyPresent = true
                integration.tokenExpired = !!(record.expiresAt && record.expiresAt <= now)
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
