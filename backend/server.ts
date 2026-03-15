//Start server:
//npx tsx server.ts
//Initialize: 
//curl -v -X POST http://localhost:3000/mcp -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2024-11-05\",\"capabilities\":{},\"clientInfo\":{\"name\":\"test-client\",\"version\":\"1.0.0\"}}}"
//Call Post - change server-id
//curl -v -X POST http://localhost:3000/mcp -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" -H "mcp-session-id: SESSION_ID" -d "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"tools/call\",\"params\":{\"name\":\"get_post\",\"arguments\":{\"id\":1}}}"
import { randomUUID } from "node:crypto"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js"
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js"
import { z } from "zod"
import { Request, Response } from "express"



export interface ToolsFile {
    baseUrl: string
    tools: EndpointDefinition[]
}

export interface EndpointDefinition {
    type?: string
    function?: string
    name: string
    description: string
    input_schema: { type: string, properties: Record<string, { type: string, description: string }>, required: string[] }
    handler: { method: string, path: string, headers?: Record<string, string>, query_params: string[] }
}

function registerDynamicTool(server: McpServer, endpoint: EndpointDefinition, baseUrl: string) {
    const schema: Record<string, any> = {}
    for (const paramName in endpoint.input_schema.properties) {
        const paramInfo = endpoint.input_schema.properties[paramName]
        if (paramInfo.type === "number" || paramInfo.type === "integer") {
            schema[paramName] = z.number().describe(paramInfo.description || "")
        } else if (paramInfo.type === "array") {
            schema[paramName] = z.array(z.string()).describe(paramInfo.description || "")
        } else {
            schema[paramName] = z.string().describe(paramInfo.description || "")
        }
    }

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
            for (const paramName of endpoint.handler.query_params) {
                if (args[paramName] !== undefined) {
                    params.append(paramName, String(args[paramName]))
                }
            }
            if (params.toString()) {
                url += "?" + params.toString()
            }

            const method = endpoint.handler.method.toUpperCase();

            const bodyParams: Record<string, any> = {};
            let hasBody = false;

            if (["POST", "PUT", "PATCH"].includes(method)) {
                for (const key in args) {
                    if (!endpoint.handler.path.includes(`{${key}}`) && !endpoint.handler.query_params.includes(key) && args[key] !== undefined) {
                        bodyParams[key] = args[key];
                        hasBody = true;
                    }
                }
            }

            const fetchOptions: RequestInit = {
                method,
                headers: {
                    ...(endpoint.handler.headers || {}),
                    ...(hasBody ? { "Content-Type": "application/json" } : {})
                },
                ...(hasBody ? { body: JSON.stringify(bodyParams) } : {})
            };

            const response = await fetch(url, fetchOptions);
            const textResponse = await response.text();

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

const transports = new Map<string, StreamableHTTPServerTransport>()
const MCPserver = new Map<string, McpServer>()



async function postHandler(req: Request, res: Response) {
    const sessionId = req.headers["mcp-session-id"] as string | undefined

    if (sessionId && transports.has(sessionId)) {
        const transport = transports.get(sessionId)!
        await transport.handleRequest(req, res, req.body)
        return
    }

    if (!sessionId && isInitializeRequest(req.body)) {
        const toolsData = (req.body.params as any)?.toolsRegistry as ToolsFile

        const server = new McpServer({
            name: "mcpServer",
            version: "1.0.0"
        })

        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (id) => {
                transports.set(id, transport)
                MCPserver.set(id, server)
            }
        })

        transport.onclose = () => {
            if (transport.sessionId) {
                transports.delete(transport.sessionId)
                MCPserver.delete(transport.sessionId)
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

//Initialises and creates servers for any chat.
app.post("/mcp", postHandler)

app.get("/mcp", getHandler)

app.delete("/mcp", deleteHandler)

app.listen(3000, () => {
    console.log("MCP server running on port 3000")
})