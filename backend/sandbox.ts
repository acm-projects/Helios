// MCP client — called by api.ts to communicate with server.ts (port 3000).
// Handles session initialization, tool listing, tool execution, and OpenAI calls.
import OpenAI from "openai";
import dotenv from "dotenv"
import { randomUUID } from "node:crypto"
import type { ToolsFile } from "./generate_tool_registry.ts"

dotenv.config();

const MCP_URL = "http://localhost:3000/mcp"
const openAIClient = new OpenAI({ apiKey: process.env.SANDBOX_OPENAI_KEY })

// Shared fetch helper with AbortController timeout
async function mcpFetch(options: {
    sessionId?: string
    body: object
    timeoutMs?: number
}): Promise<Response> {
    const { sessionId, body, timeoutMs = 15_000 } = options
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
        const headers: Record<string, string> = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream"
        }
        if (sessionId) headers["mcp-session-id"] = sessionId
        return await fetch(MCP_URL, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
            signal: controller.signal
        })
    } catch (err: any) {
        if (err.name === "AbortError") throw new Error(`MCP request timed out after ${timeoutMs}ms`)
        throw err
    } finally {
        clearTimeout(timer)
    }
}

// Parse SSE response — throws with the raw text on failure so failures are debuggable
function parseSseData(text: string, httpStatus: number): any {
    const dataLine = text.split("\n").find(line => line.startsWith("data: "))
    if (!dataLine) {
        throw new Error(`MCP server returned unexpected response (HTTP ${httpStatus}): ${text.slice(0, 300)}`)
    }
    const parsed = JSON.parse(dataLine.slice(6))
    if (parsed.error) {
        throw new Error(`MCP error ${parsed.error.code}: ${parsed.error.message}`)
    }
    return parsed
}

export async function initializeAgent(registry: ToolsFile): Promise<string> {
    const response = await mcpFetch({
        timeoutMs: 10_000,
        body: {
            jsonrpc: "2.0",
            id: randomUUID(),
            method: "initialize",
            params: {
                protocolVersion: "2024-11-05",
                capabilities: {},
                clientInfo: { name: "helios-sandbox", version: "1.0.0" },
                toolsRegistry: registry
            }
        }
    })

    const sessionId = response.headers.get("mcp-session-id")
    await response.text() // drain body — prevents socket leak on SSE connections
    if (!sessionId) throw new Error("No session ID returned from MCP server")
    return sessionId
}

export async function getTools(sessionId: string): Promise<any[]> {
    const response = await mcpFetch({
        sessionId,
        timeoutMs: 10_000,
        body: { jsonrpc: "2.0", id: randomUUID(), method: "tools/list", params: {} }
    })
    const text = await response.text()
    const data = parseSseData(text, response.status)
    if (!data.result?.tools) throw new Error("tools/list returned no tools")
    return data.result.tools
}

export async function callTool(sessionId: string, toolName: string, args: Record<string, any>): Promise<any[]> {
    const response = await mcpFetch({
        sessionId,
        timeoutMs: 15_000,
        body: {
            jsonrpc: "2.0",
            id: randomUUID(), // unique per call — fixes parallel tool call ID collision
            method: "tools/call",
            params: { name: toolName, arguments: args }
        }
    })
    const text = await response.text()
    const data = parseSseData(text, response.status)
    if (!data.result?.content) throw new Error(`tools/call returned no content for "${toolName}"`)
    return data.result.content
}

export async function messageAI(
    messageHistory: OpenAI.Chat.ChatCompletionMessageParam[],
    tools: any[],
    toolChoice?: "none" | "auto"
): Promise<{ message: OpenAI.Chat.ChatCompletionMessage, tokens: number }> {
    const response = await openAIClient.chat.completions.create({
        model: "gpt-4o-mini",
        max_tokens: 4096,
        messages: messageHistory,
        tools,
        ...(toolChoice ? { tool_choice: toolChoice } : {})
    })
    if (!response) throw new Error("No response from AI")
    return {
        message: response.choices[0].message,
        tokens: response.usage?.total_tokens ?? 0
    }
}
