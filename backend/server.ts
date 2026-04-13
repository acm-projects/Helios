// MCP server — port 3000. Pure tool dispatch: no AI, no DB writes.
// Each session gets its own McpServer instance with its own registered tools.
// The tool registry (with enrichment) is passed inside the initialize request body.
// Auth is looked up LIVE from MongoDB on every tool call — never baked into the session.
//
// Start: npx tsx server.ts
import dotenv from "dotenv"
dotenv.config()

import { randomUUID } from "node:crypto"
import express from "express"
import mongoose from "mongoose"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js"
import { z } from "zod"
import { Request, Response } from "express"
import type { ToolsFile, EndpointDefinition, ToolEnrichment } from "./generate_tool_registry.ts"
import { getStoredApiKey } from "./auth/apiKeyManager.ts"

/**
 * Registers one EndpointDefinition as a live MCP tool.
 *
 * Template behavior (from enrichment):
 *  - fixed_query_params → always appended to URL, AI never asked about them
 *  - auth.template      → looked up from DB on EVERY call (never baked in)
 *
 * Sandbox safety: non-GET calls are ALWAYS simulated, never executed.
 */
function registerDynamicTool(
  server: McpServer,
  endpoint: EndpointDefinition,
  baseUrl: string,
  userId: string          // required for live auth DB lookup
) {
  // Build Zod schema from input_schema — fixed_query_params are already excluded
  // from properties by generate_tool_registry.ts, so the AI never sees them.
  const schema: Record<string, any> = {}
  const required = Array.isArray(endpoint.input_schema.required) ? endpoint.input_schema.required : []
  for (const paramName in endpoint.input_schema.properties) {
    const paramInfo = endpoint.input_schema.properties[paramName]
    const isRequired = required.includes(paramName)
    let field: any
    if (paramInfo.type === "number" || paramInfo.type === "integer") {
      field = z.number().describe(paramInfo.description || "")
    } else if (paramInfo.type === "boolean") {
      field = z.boolean().describe(paramInfo.description || "")
    } else if (paramInfo.type === "object") {
      field = z.record(z.string(), z.any()).describe(paramInfo.description || "")
    } else if (paramInfo.type === "array") {
      const items = (paramInfo as any).items
      if (items?.type === "object") {
        field = z.array(z.record(z.string(), z.any())).describe(paramInfo.description || "")
      } else if (items?.type === "number" || items?.type === "integer") {
        field = z.array(z.number()).describe(paramInfo.description || "")
      } else if (items?.type === "boolean") {
        field = z.array(z.boolean()).describe(paramInfo.description || "")
      } else {
        field = z.array(z.string()).describe(paramInfo.description || "")
      }
    } else if (Array.isArray(paramInfo.enum) && paramInfo.enum.length > 0) {
      const [first, ...rest] = paramInfo.enum as [string, ...string[]]
      field = z.enum([first, ...rest]).describe(paramInfo.description || "")
    } else {
      field = z.string().describe(paramInfo.description || "")
    }
    schema[paramName] = isRequired ? field : field.optional()
  }

  const enrichment: ToolEnrichment = (endpoint as any).enrichment ?? { auth: null }
  console.log(`[register] ${endpoint.name} | fixed: [${Object.keys(endpoint.handler.fixed_query_params || {}).join(", ")}] | auth: ${enrichment.auth?.template ?? "none"}`)

  const hasInputParams = Object.keys(schema).length > 0
  server.registerTool(
    endpoint.name,
    {
      description: endpoint.description,
      inputSchema: hasInputParams ? schema : undefined
    },
    async (args) => {
      // ── 1. Substitute path params ──────────────────────────────────────────
      let url = baseUrl + endpoint.handler.path
      for (const paramName in endpoint.input_schema.properties) {
        if (endpoint.handler.path.includes(`{${paramName}}`) && args[paramName] !== undefined) {
          url = url.replace(`{${paramName}}`, String(args[paramName]))
        }
      }

      // ── 2. Build query params from AI-supplied args ────────────────────────
      const params = new URLSearchParams()
      for (const paramName of (endpoint.handler.query_params || [])) {
        const val = args[paramName]
        if (val !== undefined && val !== null && String(val).trim() !== "") {
          params.append(paramName, String(val))
        }
      }

      // ── 3. Auto-inject fixed query params (e.g. api-version=1.0) ──────────
      for (const [k, v] of Object.entries(endpoint.handler.fixed_query_params || {})) {
        params.set(k, v)
      }

      // ── 4. Build headers — start from static handler headers ──────────────
      const headers: Record<string, string> = { ...(endpoint.handler.headers || {}) }

      // ── 5. Live auth lookup — never baked in, always fresh from DB ─────────
      const auth = enrichment.auth
      console.log(`[auth:${endpoint.name}] template=${auth?.template ?? "none"} integration_id="${auth?.integration_id ?? ""}" userId="${userId}"`)
      if (auth && auth.integration_id) {
        const storedKey = await getStoredApiKey(userId, auth.integration_id)
        console.log(`[auth:${endpoint.name}] key_found=${!!storedKey}`)
        if (storedKey) {
          switch (auth.template) {
            case "bearer_token":
            case "oauth2_client_creds":
            case "oauth2_auth_code":
              headers["Authorization"] = `Bearer ${storedKey}`
              break
            case "api_key_header":
              headers[auth.header_name || "X-API-Key"] = storedKey
              break
            case "api_key_query":
              params.set(auth.param_name || "api_key", storedKey)
              break
            case "basic_auth":
              headers["Authorization"] = `Basic ${Buffer.from(storedKey).toString("base64")}`
              break
          }
        }
        // No storedKey → auth header omitted → API will return 401
        // The 401 branch below returns a clear message to the user
      }

      // ── 6. Finalize URL ────────────────────────────────────────────────────
      if (params.toString()) {
        url += "?" + params.toString()
      }

      const method = endpoint.handler.method.toUpperCase()

      // ── 7. Sandbox safety: non-GET calls are ALWAYS simulated ──────────────
      if (method !== "GET") {
        const qp = endpoint.handler.query_params || []
        const bodyParams: Record<string, any> = {}
        for (const key in args) {
          if (!endpoint.handler.path.includes(`{${key}}`) && !qp.includes(key) && args[key] !== undefined) {
            bodyParams[key] = args[key]
          }
        }
        const simulation = {
          sandbox_simulation: true,
          info: "Sandbox simulation complete. This is the final result — the sandbox does not execute write operations. Do not retry.",
          simulated_request: {
            method,
            url,
            headers: { ...headers, "Content-Type": "application/json" },
            body: Object.keys(bodyParams).length > 0 ? bodyParams : null
          }
        }
        return { content: [{ type: "text", text: JSON.stringify(simulation, null, 2) }] }
      }

      // ── 8. Execute GET — real call to live API ─────────────────────────────
      let response: Awaited<ReturnType<typeof fetch>>
      try {
        console.log(`[tool:${endpoint.name}] GET ${url}`)
        const controller = new AbortController()
        const fetchTimer = setTimeout(() => controller.abort(), 10_000)
        try {
          response = await fetch(url, { method: "GET", headers, signal: controller.signal })
        } finally {
          clearTimeout(fetchTimer)
        }
      } catch (err: any) {
        const msg = err.name === "AbortError"
          ? `Request to ${url} timed out after 10 seconds`
          : `Network error: ${err.message}`
        console.error(`[tool:${endpoint.name}] ${msg}`)
        return { content: [{ type: "text", text: msg }] }
      }

      const textResponse = await response.text()
      if (!response.ok) console.log(`[tool:${endpoint.name}] HTTP ${response.status} — ${textResponse.slice(0, 300)}`)

      if (!response.ok) {
        const reason =
          response.status === 429
            ? `Rate limit hit (429). Wait a moment and try again. Body: ${textResponse.slice(0, 200)}`
            : response.status === 401
            ? `Unauthorized (401) — the API key or Bearer token is missing or expired. Tell the user to re-enter their credentials in the Tools → API Keys panel. Body: ${textResponse.slice(0, 200)}`
            : `API error ${response.status}: ${textResponse.slice(0, 500)}`
        return { content: [{ type: "text", text: reason }] }
      }

      let data
      try {
        data = textResponse ? JSON.parse(textResponse) : "Success (Empty Response)"
      } catch {
        data = textResponse
      }

      return {
        content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data) }]
      }
    }
  )
}

// ─── Express App ───────────────────────────────────────────────────────────────

const app = express()
app.use(express.json({ limit: "50mb" }))

// Session maps — keyed by sessionId
const transports   = new Map<string, StreamableHTTPServerTransport>()
const MCPserver    = new Map<string, McpServer>()
const sessionTimers = new Map<string, ReturnType<typeof setTimeout>>()

const SESSION_TTL_MS = 30 * 60 * 1000

function refreshSessionTimer(sessionId: string) {
  const existing = sessionTimers.get(sessionId)
  if (existing) clearTimeout(existing)
  const timer = setTimeout(() => {
    transports.delete(sessionId)
    MCPserver.delete(sessionId)
    sessionTimers.delete(sessionId)
    console.log(`[session] Evicted idle session ${sessionId}`)
  }, SESSION_TTL_MS)
  sessionTimers.set(sessionId, timer)
}

async function postHandler(req: Request, res: Response) {
  const sessionId = req.headers["mcp-session-id"] as string | undefined

  if (sessionId && transports.has(sessionId)) {
    refreshSessionTimer(sessionId)
    const transport = transports.get(sessionId)!
    await transport.handleRequest(req, res, req.body)
    return
  }

  if (!sessionId && isInitializeRequest(req.body)) {
    const params = req.body.params as any
    const toolsData = params?.toolsRegistry as ToolsFile
    const userId    = (params?.userId as string) || ""

    if (!toolsData || !Array.isArray(toolsData.tools)) {
      res.status(400).json({ jsonrpc: "2.0", error: { code: -32602, message: "toolsRegistry missing or invalid in initialize params" }, id: null })
      return
    }

    const server = new McpServer({ name: "mcpServer", version: "1.0.0" })

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        transports.set(id, transport)
        MCPserver.set(id, server)
        refreshSessionTimer(id)
      }
    })

    transport.onclose = () => {
      if (transport.sessionId) {
        transports.delete(transport.sessionId)
        MCPserver.delete(transport.sessionId)
        const t = sessionTimers.get(transport.sessionId)
        if (t) { clearTimeout(t); sessionTimers.delete(transport.sessionId) }
      }
    }

    for (const tool of toolsData.tools) {
      registerDynamicTool(server, tool, toolsData.baseUrl, userId)
    }

    await server.connect(transport)
    await transport.handleRequest(req, res, req.body)
    return
  }

  res.status(400).json({ jsonrpc: "2.0", error: { code: -32000, message: "Invalid request" }, id: null })
}

async function getHandler(req: Request, res: Response) {
  const sessionId = req.headers["mcp-session-id"] as string | undefined
  if (!sessionId || !transports.has(sessionId)) {
    res.status(400).send("Invalid or missing session ID")
    return
  }
  await transports.get(sessionId)!.handleRequest(req, res)
}

async function deleteHandler(req: Request, res: Response) {
  const sessionId = req.headers["mcp-session-id"] as string | undefined
  if (!sessionId || !transports.has(sessionId)) {
    res.status(400).send("Invalid or missing session ID")
    return
  }
  await transports.get(sessionId)!.handleRequest(req, res)
}

app.post("/mcp", postHandler)
app.get("/mcp", getHandler)
app.delete("/mcp", deleteHandler)

// ─── Startup ───────────────────────────────────────────────────────────────────

async function start() {
  await mongoose.connect(process.env.MONGODB_URI!)
  console.log("[db] MongoDB connected")
  app.listen(3000, () => console.log("MCP server running on port 3000"))
}

start().catch(console.error)