// MCP server — port 3000. Pure tool dispatch: no AI, no DB.
// Each session gets its own McpServer instance with its own registered tools.
// The tool registry is passed inside the initialize request body, not loaded from a file,
// so sessions never share or contaminate each other's tool sets.
//
// Start: npx tsx server.ts
//
// Initialize:
// curl -v -X POST http://localhost:3000/mcp -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2024-11-05\",\"capabilities\":{},\"clientInfo\":{\"name\":\"test-client\",\"version\":\"1.0.0\"}}}"
// Call a tool (replace SESSION_ID):
// curl -v -X POST http://localhost:3000/mcp -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" -H "mcp-session-id: SESSION_ID" -d "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"get_post\",\"arguments\":{\"id\":1}}}"
import { randomUUID } from "node:crypto"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js"
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js"
import { z } from "zod"
import { Request, Response } from "express"
import type { ToolsFile, EndpointDefinition } from "./generate_tool_registry.ts"

// Converts one EndpointDefinition from the registry into a live MCP tool on the given server.
// Builds a Zod schema from input_schema.properties, then at call time:
// substitutes path params, appends query params, and either fetches (GET) or returns a simulation (non-GET).
function registerDynamicTool(server: McpServer, endpoint: EndpointDefinition, baseUrl: string) {
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
        } else {
            field = z.string().describe(paramInfo.description || "")
        }
        schema[paramName] = isRequired ? field : field.optional()
    }

    console.log(`[register] ${endpoint.name} | query_params: [${(endpoint.handler.query_params || []).join(", ")}]`)
    server.registerTool(
        endpoint.name,
        {
            description: endpoint.description,
            inputSchema: schema
        },
        async (args) => {
            let url = baseUrl + endpoint.handler.path
            for (const paramName in endpoint.input_schema.properties) {
                if (endpoint.handler.path.includes(`{${paramName}}`) && args[paramName] !== undefined) {
                    url = url.replace(`{${paramName}}`, String(args[paramName]))
                }
            }
            const params = new URLSearchParams()
            for (const paramName of (endpoint.handler.query_params || [])) {
                if (args[paramName] !== undefined) {
                    params.append(paramName, String(args[paramName]))
                }
            }
            if (params.toString()) {
                url += "?" + params.toString()
            }

            const method = endpoint.handler.method.toUpperCase();

            // Sandbox is read-only — non-GET calls are simulated, never executed
            if (method !== "GET") {
                const bodyParams: Record<string, any> = {};
                for (const key in args) {
                    if (!endpoint.handler.path.includes(`{${key}}`) && !endpoint.handler.query_params.includes(key) && args[key] !== undefined) {
                        bodyParams[key] = args[key];
                    }
                }
                const simulation = {
                    sandbox_simulation: true,
                    info: "Sandbox simulation complete. This is the final result — the sandbox does not execute write operations. Do not retry.",
                    simulated_request: {
                        method,
                        url,
                        headers: { ...(endpoint.handler.headers || {}), "Content-Type": "application/json" },
                        body: Object.keys(bodyParams).length > 0 ? bodyParams : null
                    }
                };
                return {
                    content: [{ type: "text", text: JSON.stringify(simulation, null, 2) }]
                }
            }

            let response: Awaited<ReturnType<typeof fetch>>
            try {
                console.log(`[tool:${endpoint.name}] Fetching: ${url}`)
                response = await fetch(url, { method: "GET", headers: endpoint.handler.headers || {} })
            } catch (err: any) {
                console.error(`[tool:${endpoint.name}] Network error fetching ${url}: ${err.message}`)
                return { content: [{ type: "text", text: `Network error: ${err.message}` }] }
            }
            const textResponse = await response.text();

            if (!response.ok) {
                const reason =
                    response.status === 429 ? "Rate limit hit — this API only allows a limited number of free requests. Wait a moment and try again." :
                    response.status === 402 ? "API quota exceeded — this free API has reached its usage limit." :
                    response.status === 403 ? "Access denied (403) — the API rejected the request. The free tier quota may be exhausted." :
                    `API returned an error: HTTP ${response.status} ${response.statusText}. Body: ${textResponse.slice(0, 300)}`
                return { content: [{ type: "text", text: reason }] }
            }

            let data;
            try {
                data = textResponse ? JSON.parse(textResponse) : "Success (Empty Response)";
            } catch (e) {
                data = textResponse;
            }

            return {
                content: [{ type: "text", text: typeof data === 'string' ? data : JSON.stringify(data) }]
            }
        }
    )

}

const app = createMcpExpressApp()

// All three Maps are keyed by sessionId. A session lives until the client disconnects or it goes idle.
const transports = new Map<string, StreamableHTTPServerTransport>()
const MCPserver = new Map<string, McpServer>()
const sessionTimers = new Map<string, ReturnType<typeof setTimeout>>()

const SESSION_TTL_MS = 30 * 60 * 1000 // 30 minutes

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

    // No session ID + initialize request = brand new session. Tool registry arrives in the request body.
    if (!sessionId && isInitializeRequest(req.body)) {
        const toolsData = (req.body.params as any)?.toolsRegistry as ToolsFile

        if (!toolsData || !Array.isArray(toolsData.tools)) {
            res.status(400).json({ jsonrpc: "2.0", error: { code: -32602, message: "toolsRegistry missing or invalid in initialize params" }, id: null })
            return
        }

        const server = new McpServer({
            name: "mcpServer",
            version: "1.0.0"
        })

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

        for (const tools of toolsData.tools) {
            registerDynamicTool(server, tools, toolsData.baseUrl)
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

app.listen(3000, () => {
    console.log("MCP server running on port 3000")
})