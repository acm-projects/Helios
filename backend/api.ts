// API server — port 8000. The layer between the frontend and the two backend services (MCP + MongoDB).
// Handles spec parsing, sandbox session management, and saved server CRUD.
import {generateToolRegistry, parseSwaggerUrl } from "./generate_tool_registry.ts";
import { connectMongo, createMongo, getMongo, getAllMongo, removeMongo, updateMongo } from "./crud.js";
import {initializeAgent, callTool, messageAI } from "./sandbox.ts";
import express from "express"
import cors from "cors"

const app = express()
app.use(cors())
app.use(express.json({ limit: "10mb" })) // parses JSON bodies so req.body.name etc. work

await connectMongo()

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
            query_params: tool.handler.query_params ?? []
        },
        enabled
    }
}

// Parses a spec URL and returns the tool catalog to the frontend for review.
// Does NOT save to the DB yet — that only happens when the user confirms via POST /catalog.
app.post("/api/spec/parse", async (req, res) => {
    let spec: any

    try {
        spec = await parseSwaggerUrl(req.body.url)
    } catch (err: any) {
        return res.status(400).json({ error: "invalid specURL" })
    }

    const specId = req.body.name
    if (!specId) return res.status(400).json({ error: "name cannot be empty" })

    // Check name uniqueness before letting the user proceed
    const existing = await getMongo({ _id: specId })
    if (existing) return res.status(400).json({ error: "The name is already taken. Please choose another name." })

    // Generate registry to build initial catalog — not saved to DB yet
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
        handler: tool.handler
    }))

    // If spec declares no base URL, infer it from the origin of the spec URL itself
    let baseUrl = registry.baseUrl
    if (!baseUrl && req.body.url) {
        try { baseUrl = new URL(req.body.url).origin } catch {}
    }

    // Return everything to the frontend — DB write happens only on Confirm & Save
    res.json({
        specId,
        spec,
        baseUrl,
        toolCount: registry.tools.length,
        catalog
    })
})

// Starts an MCP session. Three entry paths:
//   toolsRegistry — pre-built composite registry from the create page (multi-API, baseUrl is "")
//   spec          — unsaved new server passed directly from the frontend
//   specId        — existing saved server, loaded from DB
app.post("/api/sandbox/start", async (req, res) => {
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
            // Pre-built registry passed directly — skip spec loading entirely
            registry = req.body.toolsRegistry
            frontendTools = registry.tools.map((tool: any) => toOpenAITool(tool))
        } else if (req.body.spec) {
            // New unsaved server — spec passed directly from frontend (not yet in DB)
            registry = await generateToolRegistry(req.body.spec)
            // Apply baseUrl fallback passed from frontend if spec didn't declare one
            if (!registry.baseUrl && req.body.baseUrl) {
                registry = { ...registry, baseUrl: req.body.baseUrl }
            }
        } else {
            // Existing saved server — load from DB
            const doc = await getMongo({ _id: req.body.specId })
            if (!doc) return res.status(404).json({ error: "Spec not found" })

            if (doc._catalog && Array.isArray(doc._catalog) && doc._catalog.length > 0) {
                const enabledTools = doc._catalog.filter((t: any) => t.enabled !== false)
                if (enabledTools.length === 0) return res.status(400).json({ error: "No enabled tools in saved catalog" })
                registry = { baseUrl: doc._baseUrl || "", tools: enabledTools }
                frontendTools = doc._catalog.map((tool: any) => toOpenAITool(tool, tool.enabled !== false))
            } else {
                registry = await generateToolRegistry(doc)
            }
        }
    } catch (err: any) {
        return res.status(400).json({ error: "Failed to load spec: " + err.message })
    }

    let sessionId: string
    try {
        sessionId = await initializeAgent(registry)
    } catch (err: any) {
        return res.status(500).json({ error: "Failed to start MCP session: " + err.message })
    }

    const openAITools = frontendTools ?? registry.tools.map((tool: any) => toOpenAITool(tool))

    res.json({ sessionId, tools: openAITools })
})

app.post("/api/sandbox/chat", async (req, res) => {
    const MAX_ITERATIONS = 10;
    const TOKEN_BUDGET = 25000;
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

    const systemPrompt = {
        role: "system" as const,
        content: "You are a sandbox testing assistant for API tools. Always call the appropriate tool for every user request — including POST, PUT, PATCH, and DELETE operations. GET requests return real data from the live API. POST, PUT, PATCH, and DELETE requests are intercepted by the sandbox: the tool never touches the real API and instead returns a simulation of what would have been sent. When you receive a sandbox_simulation response, you are done — present the simulated_request to the user as a success and stop immediately. Do not call the same tool again. Never describe a simulation as an error, failure, or technical issue."
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



app.get("/api/servers/:specId/catalog", async (req, res) => {
    try {
        const doc = await getMongo({ _id: req.params.specId })
        if (!doc) return res.status(404).json({ error: "Spec not found" })

        if (doc._catalog && Array.isArray(doc._catalog) && doc._catalog.length > 0) {
            return res.json({ catalog: doc._catalog, baseUrl: doc._baseUrl || "", fromSaved: true })
        }

        const registry = await generateToolRegistry(doc)
        const catalog = registry.tools.map((tool: any) => ({
            name: tool.name,
            description: tool.description,
            enabled: true,
            input_schema: tool.input_schema,
            handler: tool.handler
        }))
        res.json({ catalog, baseUrl: registry.baseUrl || "", fromSaved: false })
    } catch (err: any) {
        res.status(500).json({ error: err.message })
    }
})

app.post("/api/servers/:specId/catalog", async (req, res) => {
    try {
        const { catalog, spec, baseUrl, toolCount } = req.body
        if (!Array.isArray(catalog)) return res.status(400).json({ error: "catalog must be an array" })

        const existing = await getMongo({ _id: req.params.specId })

        if (!existing) {
            // New server — first time saving. Create the full document now.
            if (!spec) return res.status(400).json({ error: "spec required for new server" })
            spec._id = req.params.specId
            spec._baseUrl = baseUrl || ""
            spec._toolCount = toolCount || catalog.length
            spec._createdAt = new Date().toISOString()
            spec._catalog = catalog
            await createMongo(spec)
        } else {
            // Existing server — just update the catalog
            await updateMongo({ _id: req.params.specId }, { _catalog: catalog })
        }

        res.json({ ok: true })
    } catch (err: any) {
        res.status(500).json({ error: err.message })
    }
})

app.delete("/api/servers/:specId", async (req, res) => {
    try {
        const deleted = await removeMongo({ _id: req.params.specId })
        if (!deleted) return res.status(404).json({ error: "Server not found" })
        res.json({ ok: true })
    } catch (err: any) {
        res.status(500).json({ error: err.message })
    }
})

app.get("/api/servers", async (req, res) => {
    try {
        const all = await getAllMongo()
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

app.listen(8000, () => {
    console.log("api server running on port 8000")
})