//tool generation functions
import {generateToolRegistry, parseSwaggerUrl } from "./generate_tool_registry.ts";
//database functions
import { connectMongo, createMongo, getMongo, getAllMongo, removeMongo, updateMongo } from "./crud.js";
//sandbox client functions
import {initializeAgent, callTool, messageAI } from "./sandbox.ts";
import express from "express"
//server functions our "new main"

import cors from "cors"

//start server
const app = express()
app.use(cors())
app.use(express.json({ limit: "10mb" })) //tells our server our req, and res are in json format, so we can use calls like req.body.name

//connect to database
await connectMongo()

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

app.post("/api/sandbox/start", async (req, res) => {
    let registry: any = null
    let frontendTools: any[] | null = null

    try {
        if (req.body.spec) {
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
                frontendTools = doc._catalog.map((tool: any) => ({
                    type: "function" as const,
                    function: {
                        name: tool.name,
                        description: tool.description,
                        parameters: tool.input_schema
                    },
                    handler: {
                        method: tool.handler.method,
                        path: tool.handler.path
                    },
                    enabled: tool.enabled !== false
                }))
            } else {
                registry = await generateToolRegistry(doc)
            }
        }
    } catch (err: any) {
        return res.status(400).json({ error: "Failed to load spec: " + err.message })
    }

    const sessionId = await initializeAgent(registry)

    const openAITools = frontendTools ?? registry.tools.map((tool: any) => ({
        type: "function" as const,
        function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.input_schema
        },
        handler: {
            method: tool.handler.method,
            path: tool.handler.path
        },
        enabled: true
    }))

    res.json({ sessionId, tools: openAITools })
})

app.post("/api/sandbox/chat", async (req, res) => {
    const MAX_ITERATIONS = 10;
    const TOKEN_BUDGET = 25000;
    const MAX_RESPONSE_CHARS = 8000;

    const history = req.body.history
    history.push({ role: "user", content: req.body.message })

    const systemPrompt = {
        role: "system" as const,
        content: "You are a sandbox testing assistant for API tools. GET requests execute against the real API. POST, PUT, PATCH, and DELETE requests are never executed — the tool returns a simulation showing what would have been sent. When you receive a sandbox_simulation response, present the simulated_request to the user clearly as a success. Never treat a simulation as an error or failure."
    }

    let iterations = 0;
    let totalTokens = 0;

    try {
        while (iterations < MAX_ITERATIONS && totalTokens < TOKEN_BUDGET) {
            const { message, tokens } = await messageAI([systemPrompt, ...history], req.body.tools);
            totalTokens += tokens;
            iterations++;

            // AI returned a plain response — it's done thinking
            if (!message.tool_calls || message.tool_calls.length === 0) {
                if (message.content) history.push({ role: "assistant", content: message.content });
                break;
            }

            // AI wants to call a tool — execute it and loop
            history.push(message);
            const toolCall = message.tool_calls[0];
            if (toolCall.type !== "function") break;
            const toolName = toolCall.function.name;

            let args: any;
            try {
                args = JSON.parse(toolCall.function.arguments);
            } catch {
                const msg = "I tried to call a tool but the arguments were too large or malformed to parse. Try using a shorter input (e.g. a URL instead of a base64 image).";
                history.push({ role: "assistant", content: msg });
                break;
            }

            const toolResponse = await callTool(req.body.sessionId, toolName, args);
            const limited = Array.isArray(toolResponse) && toolResponse.length > 100
                ? toolResponse.slice(0, 100)
                : toolResponse;

            let content = JSON.stringify(limited);
            if (content.length > MAX_RESPONSE_CHARS) {
                content = content.slice(0, MAX_RESPONSE_CHARS) + `... [truncated — ${content.length - MAX_RESPONSE_CHARS} characters omitted]`;
            }

            history.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content
            });

            console.log(`[Step ${iterations}] Tool: ${toolName} | Tokens so far: ${totalTokens}`);
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
            return res.json({ catalog: doc._catalog, fromSaved: true })
        }

        const registry = await generateToolRegistry(doc)
        const catalog = registry.tools.map((tool: any) => ({
            name: tool.name,
            description: tool.description,
            enabled: true,
            input_schema: tool.input_schema,
            handler: tool.handler
        }))
        res.json({ catalog, fromSaved: false })
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

app.get("/api/servers", async (req, res) => {
    const all = await getAllMongo()
    const servers = all.map((s: any) => ({
        id: s._id,
        baseUrl: s._baseUrl || "",
        toolCount: s._toolCount || 0,
        createdAt: s._createdAt || ""
    }))
    res.json({ servers })
})

app.listen(8000, () => {
    console.log("api server running on port 8000")
})