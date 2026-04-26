// MCP client — called by api.ts to communicate with server.ts (port 3000).
// Handles session initialization, tool listing, tool execution, and Claude AI calls.
import Anthropic from "@anthropic-ai/sdk";
import dotenv from "dotenv"
import { randomUUID } from "node:crypto"
import type { ToolsFile } from "./generate_tool_registry.ts"

dotenv.config({ override: true });

const MCP_URL = "http://localhost:3000/mcp"
const anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

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

export async function initializeAgent(registry: ToolsFile, userId: string, unrestricted: boolean = false): Promise<string> {
    const response = await mcpFetch({
        timeoutMs: 10_000,
        body: {
            jsonrpc: "2.0",
            id: randomUUID(),
            method: "initialize",
            params: {
                protocolVersion: "2024-11-05",
                capabilities: {},
                clientInfo: { name: unrestricted ? "helios-try" : "helios-sandbox", version: "1.0.0" },
                toolsRegistry: registry,
                userId,           // server.ts uses this for live per-user auth DB lookups
                unrestricted      // true = execute every method; false = simulate non-GET
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

/**
 * Compresses tool schemas before sending to Claude.
 * Strips parameter descriptions (Claude doesn't need them to call tools correctly)
 * and truncates tool descriptions. Reduces token count by ~60–70% for verbose APIs.
 */
export function compressToolsForClaude(tools: Anthropic.Messages.Tool[]): Anthropic.Messages.Tool[] {
    return tools.map(tool => ({
        name: tool.name,
        description: tool.description ? tool.description.slice(0, 140) : undefined,
        input_schema: compressSchema(tool.input_schema as any) as Anthropic.Messages.Tool["input_schema"]
    }))
}

function compressSchema(schema: any): any {
    if (!schema || typeof schema !== "object") return schema
    const out: any = { type: schema.type }
    if (schema.required?.length) out.required = schema.required
    if (schema.properties) {
        out.properties = {}
        for (const [key, prop] of Object.entries(schema.properties as Record<string, any>)) {
            const compressed: any = { type: prop?.type ?? "string" }
            if (prop?.enum?.length) compressed.enum = prop.enum
            if (prop?.items?.type) compressed.items = { type: prop.items.type }
            // Preserve description (truncated) — parameter descriptions carry format
            // hints injected by the parser (e.g. "pass raw XML, not a URL"). Stripping
            // them forced the LLM to guess by parameter name alone, which is how the
            // Twilio CreateCall tool ended up dialing demo URLs instead of using Twiml.
            if (prop?.description) compressed.description = String(prop.description).slice(0, 200)
            // Preserve format — server.ts decode logic depends on it (twiml/xml/html
            // angle-bracket repair) and it gives the LLM a useful field-type signal.
            if (prop?.format) compressed.format = prop.format
            out.properties[key] = compressed
        }
    }
    return out
}

/**
 * Calls Claude with automatic retry on 429 rate-limit errors.
 * Waits 12 s on first retry, 25 s on second — stays inside the 1-minute window.
 */
export async function messageAI(
    system: string,
    messages: Anthropic.Messages.MessageParam[],
    tools: Anthropic.Messages.Tool[],
    toolChoice?: "none" | "auto"
): Promise<{ message: Anthropic.Messages.Message, tokens: number }> {
    const compressed = compressToolsForClaude(tools)
    const toolParams = toolChoice === "none" || compressed.length === 0
        ? {}
        : { tools: compressed, tool_choice: { type: "auto" as const } }

    const RETRY_DELAYS_MS = [12_000, 25_000]
    let lastErr: any

    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
        if (attempt > 0) {
            console.warn(`[messageAI] 429 rate limit — retrying in ${RETRY_DELAYS_MS[attempt - 1]}ms (attempt ${attempt})`)
            await new Promise(r => setTimeout(r, RETRY_DELAYS_MS[attempt - 1]))
        }
        try {
            const response = await anthropicClient.messages.create({
                model: "claude-haiku-4-5-20251001",
                max_tokens: 4096,
                ...(system ? { system } : {}),
                messages,
                ...toolParams
            }, { timeout: 90_000 })

            return {
                message: response,
                tokens: (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0)
            }
        } catch (err: any) {
            lastErr = err
            const is429 = err?.status === 429 || String(err?.message ?? "").includes("rate_limit")
            if (!is429 || attempt >= RETRY_DELAYS_MS.length) throw err
        }
    }
    throw lastErr
}
