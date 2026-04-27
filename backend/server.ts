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

// Allowlist of recognized auto_path_params source sentinels. Any value outside
// this set is rejected at call time — prevents a malicious catalog from smuggling
// an arbitrary sentinel (e.g. "env_var:SECRET") that the dispatcher would act on.
const VALID_AUTO_PATH_SOURCES = new Set(["auth_username"])

/**
 * SSRF guard — rejects baseUrls that point at internal infrastructure.
 * Link-local (169.254.x.x) and loopback (127.x, ::1) are blocked in ALL
 * environments. RFC1918 private ranges (10.x, 172.16-31.x, 192.168.x) are
 * only blocked in production so local dev against localhost/LAN still works.
 */
function assertSafeBaseUrl(baseUrl: string): void {
  if (!baseUrl) return // composite registries use "" — nothing to validate
  let parsed: URL
  try {
    parsed = new URL(baseUrl)
  } catch {
    throw new Error(`baseUrl "${baseUrl}" is not a valid URL`)
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`baseUrl must use http or https (got "${parsed.protocol}")`)
  }

  const host = parsed.hostname.toLowerCase()

  // Always block: loopback and link-local (includes AWS IMDS 169.254.169.254)
  if (host === "localhost") {
    // Allow localhost only outside production
    if (process.env.NODE_ENV === "production") {
      throw new Error("baseUrl must not target localhost in production")
    }
    return
  }
  if (host === "::1" || host === "[::1]" || host === "0.0.0.0") {
    throw new Error(`baseUrl must not target loopback address "${host}"`)
  }

  // IPv6 link-local (fe80::/10) — covers fe80:: through febf::
  if (/^fe[89ab]/i.test(host.replace(/^\[|\]$/g, ""))) {
    throw new Error(`baseUrl must not target IPv6 link-local address "${host}"`)
  }

  // IPv6 unique local (fc00::/7) — covers fc:: and fd::
  if (/^f[cd]/i.test(host.replace(/^\[|\]$/g, ""))) {
    throw new Error(`baseUrl must not target IPv6 unique-local address "${host}"`)
  }

  // IPv4-mapped IPv6 (::ffff:x.x.x.x) — strips brackets then checks
  const strippedHost = host.replace(/^\[|\]$/g, "")
  const ipv4mapped = strippedHost.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i)
  if (ipv4mapped) {
    // Re-validate the embedded IPv4 portion by recursing via assertSafeBaseUrl on a synthetic URL
    try {
      assertSafeBaseUrl(`${parsed.protocol}//` + ipv4mapped[1])
    } catch (err: unknown) {
      throw new Error(`baseUrl contains a blocked IPv4-mapped IPv6 address: ${(err as Error).message}`)
    }
    return
  }

  // Decimal and hex numeric IP encodings (e.g. http://2130706433/ → 127.0.0.1)
  const bareHost = host.replace(/^\[|\]$/g, "")
  if (/^\d+$/.test(bareHost) || /^0x[0-9a-f]+$/i.test(bareHost)) {
    throw new Error(`baseUrl uses a numeric/hex IP encoding "${bareHost}" — use a standard dotted-quad IP or hostname instead`)
  }

  // IPv4 checks
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (ipv4) {
    const [, a, b, c] = ipv4.map(Number)
    // 127.x.x.x — loopback (all environments)
    if (a === 127) throw new Error("baseUrl must not target loopback (127.x.x.x)")
    // 169.254.x.x — link-local / IMDS (all environments)
    if (a === 169 && b === 254) throw new Error("baseUrl must not target link-local address (169.254.x.x)")

    if (process.env.NODE_ENV === "production") {
      // RFC1918 private ranges — block only in production
      if (a === 10) throw new Error("baseUrl must not target private network (10.x.x.x) in production")
      if (a === 172 && b >= 16 && b <= 31) throw new Error("baseUrl must not target private network (172.16-31.x.x) in production")
      if (a === 192 && b === 168) throw new Error("baseUrl must not target private network (192.168.x.x) in production")
    }
  }
}

/**
 * Registers one EndpointDefinition as a live MCP tool.
 *
 * Template behavior (from enrichment):
 *  - fixed_query_params → always appended to URL, AI never asked about them
 *  - auth.template      → looked up from DB on EVERY call (never baked in)
 *
 * Sandbox mode (unrestricted=false): non-GET calls are ALWAYS simulated.
 * Production/Try mode (unrestricted=true): every method executes live.
 */
function registerDynamicTool(
  server: McpServer,
  endpoint: EndpointDefinition,
  baseUrl: string,
  userId: string,          // required for live auth DB lookup
  unrestricted: boolean    // true = execute all methods, false = simulate non-GET
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
  console.log(`[register] ${endpoint.name} | query: [${(endpoint.handler.query_params || []).join(", ")}] | fixed: [${Object.keys(endpoint.handler.fixed_query_params || {}).join(", ")}] | auth: ${enrichment.auth?.template ?? "none"}`)

  const hasInputParams = Object.keys(schema).length > 0
  server.registerTool(
    endpoint.name,
    {
      description: endpoint.description,
      inputSchema: hasInputParams ? schema : undefined
    },
    async (args) => {
      // ── 0. Decode HTML-encoded entities in markup-format params ────────────
      // Claude defensively HTML-encodes special characters in string values
      // even when the description explicitly says "use raw characters" — Twilio's
      // TwiML field is the canonical bite, returning error 12100 ("Document parse
      // failure"). We decode:
      //   &lt; / &gt;     — angle brackets (must be literal for tag delimiters)
      //   &quot; / &#34;  — double quotes (must be literal in attribute values
      //                     like <Pause length="1"/>; harmless inside body text
      //                     because XML parsers treat both forms identically)
      //   &apos; / &#39;  — single quotes (same reasoning as above)
      // We deliberately do NOT decode &amp; — actual ampersands inside markup
      // body text MUST stay encoded, and Claude correctly emits &amp; for them.
      // Driven by the spec `format` field — generic, not provider-specific.
      const props = endpoint.input_schema.properties
      for (const k in args) {
        const v = args[k]
        if (typeof v !== "string") continue
        const fmt = String(props[k]?.format || "").toLowerCase()
        if (fmt !== "twiml" && fmt !== "xml" && fmt !== "html") continue
        if (v.includes("&lt;") || v.includes("&gt;") || v.includes("&quot;") || v.includes("&#34;") || v.includes("&apos;") || v.includes("&#39;")) {
          args[k] = v
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .replace(/&#34;/g, '"')
            .replace(/&apos;/g, "'")
            .replace(/&#39;/g, "'")
        }
      }

      // ── 0a. Strip XML wrappers and tool-call leakage from markup values ───
      // Claude has three distinct over-engineering habits in markup-format
      // fields, each fatal to the receiving parser:
      //   (1) Wraps the payload in `<![CDATA[ ... ]]>` — valid syntax inside
      //       a parent element, but not a valid root.
      //   (2) Prefixes an XML prolog `<?xml version="1.0" ... ?>` — fine in
      //       a full document, fatal in a fragment field.
      //   (3) Leaks its own tool-call wrapper tags (`</invoke>`, `</Twiml>`)
      //       at the tail when the parameter VALUE is itself XML, producing
      //       trailing junk after the well-formed root closes.
      // Strip order: prolog → CDATA peel → prolog again (LLM nests them) →
      // truncate-at-root-close (handles tail leakage).
      for (const k in args) {
        const v = args[k]
        if (typeof v !== "string") continue
        const fmt = String(props[k]?.format || "").toLowerCase()
        if (fmt !== "twiml" && fmt !== "xml" && fmt !== "html") continue
        let cleaned = v.trim()
        cleaned = cleaned.replace(/^\s*<\?xml[^?]*\?>\s*/i, "")
        const cdataMatch = cleaned.match(/^\s*<!\[CDATA\[([\s\S]*)\]\]>\s*$/)
        if (cdataMatch) cleaned = cdataMatch[1].trim()
        cleaned = cleaned.replace(/^\s*<\?xml[^?]*\?>\s*/i, "")
        // Truncate anything after the closing root tag. Find the root element
        // name from the first `<Foo...>` and cut at its first `</Foo>`. If
        // the root is self-closing or never closes, we leave the value alone.
        const rootMatch = cleaned.match(/^<\s*([a-zA-Z][\w-]*)/)
        if (rootMatch) {
          const closeRe = new RegExp(`</\\s*${rootMatch[1]}\\s*>`, "i")
          const closeMatch = cleaned.match(closeRe)
          if (closeMatch && closeMatch.index !== undefined) {
            cleaned = cleaned.slice(0, closeMatch.index + closeMatch[0].length)
          }
        }
        if (cleaned !== v) args[k] = cleaned
      }

      // ── 0b. Drop URL fields when a sibling content field is populated ──────
      // The LLM defensively fills both `Url` and `Twiml` (or `body` and `webhook_url`,
      // etc.) on the same call. Twilio's rule — and most APIs with a content/URL
      // dual surface — is that the URL wins when both are present, which silently
      // overrides the user's intended message with whatever the URL returns
      // (often a placeholder or a demo endpoint). Detect the conflict by spec
      // `format` and strip the URL side. Generic across providers.
      const hasNonEmptyMarkup = Object.entries(args).some(([k, v]) => {
        if (typeof v !== "string" || v.trim() === "") return false
        const fmt = String(props[k]?.format || "").toLowerCase()
        return fmt === "twiml" || fmt === "xml" || fmt === "html"
      })
      if (hasNonEmptyMarkup) {
        for (const k of Object.keys(args)) {
          const v = args[k]
          if (typeof v !== "string" || v.trim() === "") continue
          const fmt = String(props[k]?.format || "").toLowerCase()
          if (fmt === "uri") delete args[k]
        }
      }

      // ── 0. Restore original param names ────────────────────────────────────
      // Anthropic rejects schema keys that violate ^[a-zA-Z0-9_.-]{1,64}$, so
      // generate_tool_registry.ts may have renamed some properties. The AI
      // calls us with sanitized names; the target API expects the originals.
      const paramNameMap = endpoint.handler.param_name_map
      if (paramNameMap) {
        const restored: Record<string, any> = {}
        for (const k in args) restored[paramNameMap[k] ?? k] = args[k]
        args = restored
      }

      // ── 1a. Fetch saved credential once — needed for both auto_path_params
      //         (step 1b) and the auth header (step 5). Avoids a double DB hit.
      const auth = enrichment.auth
      console.log(`[auth:${endpoint.name}] template=${auth?.template ?? "none"} integration_id="${auth?.integration_id ?? ""}" userId="${userId}"`)
      let storedKey: string | null = null
      if (auth && auth.integration_id) {
        storedKey = await getStoredApiKey(userId, auth.integration_id)
        console.log(`[auth:${endpoint.name}] key_found=${!!storedKey}`)
      }

      // ── 1b. Auto-fill path params from saved credential (e.g. a basic-auth
      //         username embedded in the URL path). The LLM never sees these
      //         params; without this, models invent placeholder strings and 404.
      let url = baseUrl + endpoint.handler.path
      const autoPathParams = endpoint.handler.auto_path_params
      if (autoPathParams && Object.keys(autoPathParams).length > 0) {
        // Reject auto_path_params with unknown source sentinels. A malicious or
        // malformed catalog could smuggle arbitrary sentinel values here — only
        // "auth_username" is a supported source.
        for (const [paramName, source] of Object.entries(autoPathParams)) {
          if (!VALID_AUTO_PATH_SOURCES.has(source)) {
            console.warn(`[security] Tool "${endpoint.name}" has unknown auto_path_params source "${source}" for param "${paramName}" — skipping tool call`)
            return { content: [{ type: "text", text: `Configuration error: unsupported auto_path_params source "${source}". Regenerate the tool catalog.` }] }
          }
        }
        // A credential is required to fill these params. Surface a clear message
        // rather than silently substituting an empty string and sending a broken URL.
        if (!storedKey) {
          const groupId = auth?.integration_id || endpoint.name
          return { content: [{ type: "text", text: `Credential for "${groupId}" not configured — set it via the API Keys panel.` }] }
        }
        // Passwords may contain ":" — only split on the first colon so the password
        // half is preserved intact.
        const colonIdx = storedKey.indexOf(":")
        const authUser = colonIdx >= 0 ? storedKey.slice(0, colonIdx) : storedKey
        for (const [paramName, source] of Object.entries(autoPathParams)) {
          if (source === "auth_username" && authUser) {
            url = url.replace(`{${paramName}}`, encodeURIComponent(authUser))
          }
        }
      }

      // ── 1c. Substitute remaining path params from AI-supplied args ─────────
      // Iterate args (already in original-name space) rather than the schema
      // properties (which may be in sanitized space) so path placeholders match.
      for (const paramName in args) {
        if (url.includes(`{${paramName}}`) && args[paramName] !== undefined) {
          url = url.replace(`{${paramName}}`, encodeURIComponent(String(args[paramName])))
        }
      }

      // ── 1d. Guard: reject if any {placeholder} remains unsubstituted ───────
      // A live request with literal braces in the URL path will 404 or 422 with
      // no useful error. Catching it here produces an actionable message.
      const unresolved = url.match(/\{[^}]+\}/)
      if (unresolved) {
        return { content: [{ type: "text", text: `Missing required path parameter: ${unresolved[0]}. Provide the value and try again.` }] }
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

      // ── 5. Apply auth using the credential fetched in step 1a ─────────────
      if (auth && storedKey) {
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

      // ── 6. Finalize URL ────────────────────────────────────────────────────
      if (params.toString()) {
        url += "?" + params.toString()
      }

      const method = endpoint.handler.method.toUpperCase()

      // ── 7. Build body for non-GET (shared by simulation + live execute paths) ──
      const qp = endpoint.handler.query_params || []
      const bodyParams: Record<string, any> = {}
      if (method !== "GET") {
        for (const key in args) {
          if (!endpoint.handler.path.includes(`{${key}}`) && !qp.includes(key) && args[key] !== undefined) {
            bodyParams[key] = args[key]
          }
        }
      }

      // ── 7a. Sandbox mode: simulate non-GET, never hit the real API ────────
      if (!unrestricted && method !== "GET") {
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

      // ── 8. Execute live call — GET always, non-GET only in unrestricted mode ──
      // H3-gap: validate the FINAL url (post path-param substitution) to catch
      // composite-registry tools where baseUrl is "" and the full URL is assembled
      // from handler.path — the init-time check on baseUrl "" is a no-op for these.
      try {
        assertSafeBaseUrl(url)
      } catch (err: unknown) {
        return { content: [{ type: "text", text: `Refused to dispatch: ${(err as Error).message}` }] }
      }

      const fetchInit: RequestInit = { method, headers, redirect: "manual" }
      if (method !== "GET" && Object.keys(bodyParams).length > 0) {
        // body_format is captured from the OpenAPI requestBody content type at parse
        // time. Defaults to JSON when absent (most modern APIs).
        if (endpoint.handler.body_format === "form") {
          headers["Content-Type"] = headers["Content-Type"] || "application/x-www-form-urlencoded"
          const formBody = new URLSearchParams()
          for (const [k, v] of Object.entries(bodyParams)) {
            if (v === undefined || v === null) continue
            formBody.append(k, typeof v === "object" ? JSON.stringify(v) : String(v))
          }
          fetchInit.body = formBody.toString()
        } else if (endpoint.handler.body_format === "multipart") {
          // Let fetch set the Content-Type header including the boundary — if we set
          // it ourselves the boundary token is missing and the server rejects the body.
          // Case-insensitive sweep: specs derived from Postman/curl often ship lowercase keys.
          for (const k of Object.keys(headers)) {
            if (k.toLowerCase() === "content-type") delete headers[k]
          }
          const form = new FormData()
          for (const [k, v] of Object.entries(bodyParams)) {
            if (v === undefined || v === null) continue
            form.append(k, typeof v === "object" ? JSON.stringify(v) : String(v))
          }
          fetchInit.body = form
        } else {
          headers["Content-Type"] = headers["Content-Type"] || "application/json"
          fetchInit.body = JSON.stringify(bodyParams)
        }
      }
      let response: Awaited<ReturnType<typeof fetch>>
      try {
        console.log(`[tool:${endpoint.name}] ${method} ${url}`)
        const controller = new AbortController()
        const fetchTimer = setTimeout(() => controller.abort(), 10_000)
        try {
          response = await fetch(url, { ...fetchInit, signal: controller.signal })
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

      // H4: reject redirects — fetch is set to redirect:"manual" so 3xx responses
      // are surfaced here rather than followed. This prevents open-redirect SSRF
      // where a public URL 302s to an internal address like 169.254.169.254.
      if (response.status >= 300 && response.status < 400) {
        console.warn(`[tool:${endpoint.name}] Redirect (${response.status}) refused — SSRF protection`)
        return { content: [{ type: "text", text: `Request refused: API returned a redirect (HTTP ${response.status}) which is not followed for security reasons.` }] }
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
    const unrestricted = params?.unrestricted === true

    if (!toolsData || !Array.isArray(toolsData.tools)) {
      res.status(400).json({ jsonrpc: "2.0", error: { code: -32602, message: "toolsRegistry missing or invalid in initialize params" }, id: null })
      return
    }

    if (!toolsData.schema_version || toolsData.schema_version < 2) {
      console.warn("[catalog] Legacy catalog detected — regenerate to pick up auto_path_params and body_format fields.")
    }

    // SSRF guard — validate baseUrl before registering any tools.
    // Composite catalogs set baseUrl to "" (tools have per-tool baseUrls baked in via path) — skip those.
    try {
      assertSafeBaseUrl(toolsData.baseUrl)
    } catch (err: any) {
      res.status(400).json({ jsonrpc: "2.0", error: { code: -32602, message: `Unsafe baseUrl: ${err.message}` }, id: null })
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
      registerDynamicTool(server, tool, toolsData.baseUrl, userId, unrestricted)
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