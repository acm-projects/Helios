"use client"
import { useState, useEffect, useRef } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { Send, User, Bot, ChevronDown, ChevronRight } from "lucide-react"
import Image from "next/image"
import Link from "next/link"
import { isLoggedIn, getAuthHeaders } from "@/lib/auth"

const cn = (...classes: (string | undefined | null | false)[]) => classes.filter(Boolean).join(" ")

const METHOD_BADGE_STYLES: Record<string, string> = {
  GET:    "border border-gray-300 text-gray-500 bg-white",
  POST:   "bg-gray-800 text-white",
  PUT:    "bg-gray-600 text-white",
  PATCH:  "bg-gray-500 text-white",
  DELETE: "bg-black text-white",
}

interface Message {
  id: string
  role: "user" | "assistant" | "tool_call"
  content: string  // for tool_call: "toolA · toolB" summary
  toolDetails?: { name: string; input: Record<string, any> }[]  // expandable args
  timestamp: Date
}

interface Tool {
  type: string
  function: {
    name: string
    description: string
    parameters: unknown
  }
  handler?: {
    method: string
    path: string
    query_params?: string[]
  }
  enabled?: boolean
}

interface AuthConfig {
  type: "api_key" | "bearer_token" | "basic_auth" | "oauth2" | "none"
  in?: "header" | "query"
  name?: string
  authorizationUrl?: string
  tokenUrl?: string
  scopes?: Record<string, string>
  oauthFlow?: "client_credentials" | "authorization_code" | "implicit" | "password"
}

interface AuthContext {
  oauth2Url?: string
  tokenUrl?: string
  basicAuthNote?: string
}


export default function Sandbox() {
  const searchParams = useSearchParams()
  const specId      = searchParams.get("specId")
  const compositeId = searchParams.get("compositeId")
  const router = useRouter()

  // sandbox state
  const [sessionId, setSessionId] = useState("")
  const [allTools, setAllTools] = useState<Tool[]>([])
  const [toolToggles, setToolToggles] = useState<Record<string, boolean>>({})
  const [activeTools, setActiveTools] = useState<Tool[]>([])
  const [authContext, setAuthContext] = useState<AuthContext | undefined>(undefined)

  // chat UI state
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // initialize sandbox on page load
  useEffect(() => {
    if (!isLoggedIn()) { router.replace("/auth"); return }

    // Composite path — re-initialize the MCP session on every page load.
    // sessionStorage holds the tools but NOT a reusable session — server.ts sessions
    // are in-memory only and are lost on restart, so we always start fresh here.
    if (compositeId) {
      const raw = sessionStorage.getItem(`helios_session_${compositeId}`)
      if (!raw) return
      const { tools } = JSON.parse(raw)
      const toolList: Tool[] = tools ?? []

      const registryTools = toolList.map((t: Tool) => ({
        name:         t.function.name,
        description:  t.function.description,
        input_schema: t.function.parameters ?? { type: "object", properties: {} },
        handler: {
          method:             t.handler?.method ?? "GET",
          path:               t.handler?.path ?? "",
          headers:            {},
          query_params:       t.handler?.query_params ?? [],
          fixed_query_params: (t.handler as any)?.fixed_query_params
        }
      }))

      // Load the toolName → apiName map and authMap saved by the create page
      let localGroupMap: Record<string, string> = {}
      let localAuthMap: Record<string, AuthConfig[]> = {}
      const groupsRaw = sessionStorage.getItem(`helios_groups_${compositeId}`)
      if (groupsRaw) {
        try {
          const parsed = JSON.parse(groupsRaw)
          // Support both new { toolMap, authMap } format and old flat Record<string,string> format
          localGroupMap = parsed.toolMap ?? parsed
          localAuthMap  = parsed.authMap ?? {}
          setToolGroupMap(localGroupMap)
        } catch {}
      }

      fetch("http://localhost:8000/api/sandbox/start", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ toolsRegistry: { baseUrl: "", tools: registryTools }, groupMap: localGroupMap, authMap: localAuthMap })
      })
        .then(res => res.json())
        .then(data => {
          // Update sessionStorage with the new sessionId for this page load
          sessionStorage.setItem(`helios_session_${compositeId}`, JSON.stringify({ sessionId: data.sessionId, tools: toolList }))
          setSessionId(data.sessionId)
          setAllTools(toolList)
          setActiveTools(toolList.filter((t: Tool) => t.enabled !== false))
          if (data.authContext) setAuthContext(data.authContext)
          const initialToggles: Record<string, boolean> = {}
          toolList.forEach((t: Tool) => { initialToggles[t.function.name] = t.enabled ?? true })
          setToolToggles(initialToggles)
        })
      return
    }

    // Standard path — spec-based initialization
    const draft = specId ? sessionStorage.getItem(`helios_draft_${specId}`) : null
    const draftData = draft ? JSON.parse(draft) : null

    fetch("http://localhost:8000/api/sandbox/start", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAuthHeaders() },
      body: JSON.stringify({ specId, spec: draftData?.spec ?? undefined, baseUrl: draftData?.baseUrl ?? undefined })
    })
      .then(res => res.json())
      .then(data => {
        if (data.error) {
          setMessages([{ id: Date.now().toString(), role: "assistant", content: `Failed to load server: ${data.error}`, timestamp: new Date() }])
          setAllTools([])
          return
        }
        const tools: Tool[] = data.tools ?? []
        setSessionId(data.sessionId)
        setAllTools(tools)
        setActiveTools(tools.filter(t => t.enabled !== false))
        if (data.authContext) setAuthContext(data.authContext)
        const initialToggles: Record<string, boolean> = {}
        tools.forEach((t: Tool) => { initialToggles[t.function.name] = t.enabled ?? true })
        setToolToggles(initialToggles)
      })
      .catch(() => {
        setMessages([{ id: Date.now().toString(), role: "assistant", content: "Could not reach the server. Make sure the backend is running.", timestamp: new Date() }])
        setAllTools([])
      })
  }, [specId, compositeId, router])

  // scroll to bottom on new message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  // auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto"
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + "px"
    }
  }, [input])

  const toggleTool = (name: string) => {
    setToolToggles(prev => ({ ...prev, [name]: !prev[name] }))
  }

  // Applying a new tool set resets chat — the old history references tools that may no longer be active.
  const handleApply = () => {
    const filtered = allTools.filter(t => toolToggles[t.function.name])
    setActiveTools(filtered)
    setMessages([])
  }

  const handleNavigateToVerify = () => {
    if (compositeId) {
      // Composite session — pass compositeId so verify can read tools from sessionStorage
      router.push(`/verify?compositeId=${compositeId}`)
      return
    }
    if (specId) {
      const draft = sessionStorage.getItem(`helios_draft_${specId}`)
      if (draft) {
        // New server — update existing draft catalog with current toggle states
        const draftData = JSON.parse(draft)
        if (Array.isArray(draftData.catalog)) {
          const updatedCatalog = draftData.catalog.map((item: { name: string; enabled?: boolean }) => ({
            ...item,
            enabled: toolToggles[item.name] ?? item.enabled ?? true
          }))
          sessionStorage.setItem(`helios_draft_${specId}`, JSON.stringify({ ...draftData, catalog: updatedCatalog }))
        }
      } else {
        // Existing server — write toggle overrides so Verify can apply them on top of the DB catalog
        sessionStorage.setItem(`helios_toggles_${specId}`, JSON.stringify(toolToggles))
      }
      router.push(`/verify?specId=${specId}`)
    }
  }

  const handleSend = async () => {
    if (!input.trim() || isLoading) return

    const messageText = input.trim()

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: messageText,
      timestamp: new Date()
    }
    setMessages(prev => [...prev, userMessage])
    setInput("")
    setIsLoading(true)

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 60000) // 1 min max

    fetch("http://localhost:8000/api/sandbox/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAuthHeaders() },
      body: JSON.stringify({
        sessionId,
        tools: activeTools,
        // tool_call messages are UI-only; strip them before sending history to the backend
        history: messages.filter(m => m.role !== "tool_call").map(m => ({ role: m.role, content: m.content })),
        message: messageText,
        authContext
      }),
      signal: controller.signal
    })
      .then(res => res.json())
      .then(data => {
        clearTimeout(timeout)
        // Collect all tool calls across all agentic steps — Anthropic format: type === "tool_use" blocks
        const allToolCalls: { name: string; input: Record<string, any> }[] = (data.history ?? [])
          .filter((m: any) => m.role === "assistant" && Array.isArray(m.content))
          .flatMap((m: any) =>
            (m.content as any[])
              .filter(b => b.type === "tool_use")
              .map(b => ({ name: b.name, input: b.input ?? {} }))
          )

        const newMessages: Message[] = []
        if (allToolCalls.length > 0) {
          newMessages.push({
            id: Date.now().toString() + "-tool",
            role: "tool_call",
            content: allToolCalls.map(t => t.name).join("  ·  "),
            toolDetails: allToolCalls,
            timestamp: new Date()
          })
        }
        newMessages.push({
          id: Date.now().toString(),
          role: "assistant",
          content: data.reply,
          timestamp: new Date()
        })
        setMessages(prev => [...prev, ...newMessages])
        setIsLoading(false)
      })
      .catch(err => {
        clearTimeout(timeout)
        const reason = err.name === "AbortError" ? "Request timed out — the AI took too long to respond." : "Failed to reach the server."
        setMessages(prev => [...prev, {
          id: Date.now().toString(),
          role: "assistant",
          content: reason,
          timestamp: new Date()
        }])
        setIsLoading(false)
      })
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const enabledCount = Object.values(toolToggles).filter(Boolean).length

  const [expandedToolCalls, setExpandedToolCalls] = useState<Set<string>>(new Set())
  const [panelOpen, setPanelOpen]           = useState(false)
  const [panelTab, setPanelTab]             = useState<"tools" | "keys">("tools")
  const [apiKeys, setApiKeys]               = useState<Record<string, string>>({})
  const [hasSecurityScheme, setHasSecurityScheme] = useState<boolean | null>(null)
  const [toolGroupMap, setToolGroupMap]     = useState<Record<string, string>>({})
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [savedKeyStatus, setSavedKeyStatus] = useState<Record<string, boolean>>({})
  const [isSavingKey, setIsSavingKey]       = useState<string | null>(null)
  // OAuth2 client credentials state — keyed by group name
  const [oauth2Fields, setOauth2Fields] = useState<Record<string, { clientId: string; clientSecret: string }>>({})
  const [oauth2ConnectStatus, setOauth2ConnectStatus] = useState<Record<string, { ok: boolean; msg: string }>>({})
  const [isConnecting, setIsConnecting] = useState<string | null>(null)

  useEffect(() => {
    // Composite session — check if any API in the authMap requires a non-none key
    if (compositeId) {
      const groupsRaw = sessionStorage.getItem(`helios_groups_${compositeId}`)
      if (!groupsRaw) { setHasSecurityScheme(false); return }
      try {
        const parsed = JSON.parse(groupsRaw)
        const authMap: Record<string, AuthConfig[]> = parsed.authMap ?? {}
        const hasAuth = Object.values(authMap).some(configs =>
          configs.some(c => c.type !== "none")
        )
        setHasSecurityScheme(hasAuth)
      } catch { setHasSecurityScheme(false) }
      return
    }
    // Standard specId session — inspect the raw spec stored in the draft
    if (!specId) { setHasSecurityScheme(false); return }
    const draft = sessionStorage.getItem(`helios_draft_${specId}`)
    if (!draft) {
      // Even without a draft, if authContext has content, there IS auth
      setHasSecurityScheme(!!authContext && Object.keys(authContext).length > 0)
      return
    }
    try {
      const { spec } = JSON.parse(draft)
      const has3 = spec?.components?.securitySchemes && Object.keys(spec.components.securitySchemes).length > 0
      const has2 = spec?.securityDefinitions && Object.keys(spec.securityDefinitions).length > 0
      setHasSecurityScheme(!!(has3 || has2))
    } catch { setHasSecurityScheme(false) }
  }, [specId, compositeId, authContext])

  // Fetch saved key status from DB whenever the API Keys tab is opened
  useEffect(() => {
    if (!panelOpen || panelTab !== "keys") return
    const groups = Object.keys(toolGroupMap).length > 0
      ? [...new Set(Object.values(toolGroupMap))] as string[]
      : specId ? [specId] : []
    if (groups.length === 0) return
    Promise.all(
      groups.map(async g => {
        try {
          const res = await fetch(`http://localhost:8000/api/keys/${encodeURIComponent(g)}/status`, { headers: getAuthHeaders() })
          const data = await res.json()
          return [g, data.exists ?? false] as [string, boolean]
        } catch { return [g, false] as [string, boolean] }
      })
    ).then(entries => setSavedKeyStatus(Object.fromEntries(entries)))
  }, [panelOpen, panelTab])

  const handleSaveKey = async (groupName: string) => {
    const key = apiKeys[groupName]
    if (!key?.trim()) return
    setIsSavingKey(groupName)
    try {
      const res = await fetch(`http://localhost:8000/api/keys/${encodeURIComponent(groupName)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ key: key.trim() })
      })
      if (res.ok) {
        setSavedKeyStatus(prev => ({ ...prev, [groupName]: true }))
        setApiKeys(prev => ({ ...prev, [groupName]: "" }))
      }
    } catch {}
    setIsSavingKey(null)
  }

  // OAuth2 Client Credentials flow — exchanges clientId+clientSecret on the backend, stores access_token
  const handleOAuth2Connect = async (groupName: string, tokenUrl: string) => {
    const fields = oauth2Fields[groupName]
    if (!fields?.clientId?.trim() || !fields?.clientSecret?.trim()) return
    setIsConnecting(groupName)
    setOauth2ConnectStatus(prev => ({ ...prev, [groupName]: { ok: false, msg: "" } }))
    try {
      const res = await fetch("http://localhost:8000/api/oauth2/client-credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({
          integrationId: groupName,
          clientId: fields.clientId.trim(),
          clientSecret: fields.clientSecret.trim(),
          tokenUrl,
        })
      })
      const data = await res.json()
      if (res.ok) {
        setSavedKeyStatus(prev => ({ ...prev, [groupName]: true }))
        const expiryMsg = data.expiresIn ? ` (expires in ${Math.round(data.expiresIn / 60)}min)` : ""
        setOauth2ConnectStatus(prev => ({ ...prev, [groupName]: { ok: true, msg: `Connected${expiryMsg}` } }))
        setOauth2Fields(prev => ({ ...prev, [groupName]: { clientId: "", clientSecret: "" } }))
      } else {
        setOauth2ConnectStatus(prev => ({ ...prev, [groupName]: { ok: false, msg: data.error ?? "Connection failed" } }))
      }
    } catch (err: any) {
      setOauth2ConnectStatus(prev => ({ ...prev, [groupName]: { ok: false, msg: "Network error" } }))
    }
    setIsConnecting(null)
  }

  // Build ordered group list from toolGroupMap (composite) or a single group (specId)
  const toolGroups: { name: string; tools: Tool[] }[] = (() => {
    if (allTools.length === 0) return []
    if (Object.keys(toolGroupMap).length > 0) {
      const seen: string[] = []
      const map: Record<string, Tool[]> = {}
      allTools.forEach(tool => {
        const g = toolGroupMap[tool.function.name] ?? "Other"
        if (!map[g]) { map[g] = []; seen.push(g) }
        map[g].push(tool)
      })
      return seen.map(name => ({ name, tools: map[name] }))
    }
    return [{ name: specId ?? "Session", tools: allTools }]
  })()

  return (
    <div className="flex flex-col h-screen w-full bg-white">

      {/* Nav — original style restored */}
      <nav className="flex items-center justify-between px-6 pl-20 flex-shrink-0">
        <Link href="/">
          <Image src="/logoName.svg" alt="Helios" width={180} height={180} className="cursor-pointer" />
        </Link>

        <div className="flex items-center gap-4 font-[family-name:--font-cinzel] text-[32px] tracking-widest">
          <span className="text-gray-400">Create</span>
          <span className="text-gray-400 text-[20px] mb-1">✦</span>
          <span className="flex flex-col items-center text-black">
            Sandbox
            <span className="block h-[2px] w-full bg-black mt-[-4px]"></span>
          </span>
          <span className="text-gray-400 text-[20px] mb-1">✦</span>
          <span onClick={handleNavigateToVerify} className="text-gray-400 hover:text-black transition-colors duration-200 cursor-pointer">Verify</span>
          <span className="text-gray-400 text-[20px] mb-1">✦</span>
          <span className="text-gray-400">Download</span>
        </div>

        <div className="flex items-center gap-3 w-[220px] justify-end">
          <Link href="/create" className="font-[family-name:--font-cinzel] text-[14px] tracking-widest text-gray-400 border-[2px] border-gray-300 px-4 py-2 hover:border-black hover:text-black transition-colors duration-200">
            ← Back
          </Link>
          <button onClick={handleNavigateToVerify} className="font-[family-name:--font-cinzel] text-[14px] tracking-widest text-white bg-black border-[2px] border-black px-4 py-2 hover:bg-white hover:text-black transition-colors duration-200 cursor-pointer">
            Next →
          </button>
        </div>
      </nav>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden border-t-[2px] border-black">
        <div className="flex flex-col flex-1 overflow-hidden">

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-6">
            <div className="max-w-2xl mx-auto space-y-6">

              {messages.map((message) => {
                if (message.role === "tool_call") {
                  const isExpanded = expandedToolCalls.has(message.id)
                  return (
                    <div key={message.id} className="flex flex-col gap-0">
                      {/* Collapsed row — always visible */}
                      <button
                        type="button"
                        onClick={() => setExpandedToolCalls(prev => {
                          const next = new Set(prev)
                          if (next.has(message.id)) next.delete(message.id)
                          else next.add(message.id)
                          return next
                        })}
                        className="flex items-center gap-3 py-1 w-full cursor-pointer group"
                      >
                        <div className="flex-1 h-[1px] bg-gray-200"></div>
                        <div className="flex items-center gap-2">
                          {isExpanded
                            ? <ChevronDown size={13} className="text-gray-400 flex-shrink-0" />
                            : <ChevronRight size={13} className="text-gray-400 flex-shrink-0" />
                          }
                          <span className="font-[family-name:--font-cinzel] text-[11px] tracking-widest text-gray-400 group-hover:text-black transition-colors whitespace-nowrap">
                            {message.toolDetails?.length ?? 1} tool{(message.toolDetails?.length ?? 1) !== 1 ? "s" : ""} called
                          </span>
                          <span className="font-[family-name:--font-geist-mono] text-[10px] text-gray-300 whitespace-nowrap hidden sm:inline">
                            {message.content}
                          </span>
                        </div>
                        <div className="flex-1 h-[1px] bg-gray-200"></div>
                      </button>

                      {/* Expanded detail — one card per tool call */}
                      {isExpanded && message.toolDetails && (
                        <div className="flex flex-col gap-2 pt-2 pb-1 px-1">
                          {message.toolDetails.map((tc, i) => (
                            <div key={i} className="border-[1px] border-gray-200 px-4 py-3">
                              <div className="font-[family-name:--font-cinzel] text-[11px] tracking-widest text-black mb-2">
                                {tc.name}
                              </div>
                              {Object.keys(tc.input).length > 0 ? (
                                <pre className="font-[family-name:--font-geist-mono] text-[10px] text-gray-500 whitespace-pre-wrap break-all leading-relaxed">
                                  {JSON.stringify(tc.input, null, 2)}
                                </pre>
                              ) : (
                                <span className="font-[family-name:--font-geist-mono] text-[10px] text-gray-300">no arguments</span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                }

                return (
                  <div key={message.id} className={cn("flex gap-4", message.role === "user" ? "justify-end" : "justify-start")}>
                    {message.role === "assistant" && (
                      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-black flex items-center justify-center">
                        <Bot className="w-5 h-5 text-white" />
                      </div>
                    )}
                    <div className={cn(
                      "max-w-[70%] px-4 py-3",
                      message.role === "user" ? "bg-black text-white" : "border-[1px] border-gray-300 text-black"
                    )}>
                      <p className="text-sm leading-relaxed whitespace-pre-wrap break-words font-[family-name:--font-geist-sans]">
                        {message.content}
                      </p>
                    </div>
                    {message.role === "user" && (
                      <div className="flex-shrink-0 w-8 h-8 rounded-full border-[2px] border-black flex items-center justify-center">
                        <User className="w-5 h-5 text-black" />
                      </div>
                    )}
                  </div>
                )
              })}

              {isLoading && (
                <div className="flex gap-4 justify-start">
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-black flex items-center justify-center">
                    <Bot className="w-5 h-5 text-white" />
                  </div>
                  <div className="border-[1px] border-gray-300 px-4 py-3 flex items-center gap-3">
                    <div className="flex gap-1">
                      <div className="w-2 h-2 rounded-full bg-black/40 animate-bounce [animation-delay:0ms]" />
                      <div className="w-2 h-2 rounded-full bg-black/40 animate-bounce [animation-delay:150ms]" />
                      <div className="w-2 h-2 rounded-full bg-black/40 animate-bounce [animation-delay:300ms]" />
                    </div>
                    <span className="font-[family-name:--font-cinzel] text-[11px] tracking-widest text-gray-400">Thinking...</span>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* Input area */}
          <div className="border-t-[1px] border-gray-200 bg-white">
            <div className="max-w-2xl mx-auto px-4 pt-3 pb-4">

              {/* Toolbar row — Tools dropdown + Reset Chat */}
              <div className="flex items-center justify-between mb-3">

                {/* Tools panel button */}
                <div className="relative">
                  <button
                    onClick={() => setPanelOpen(prev => !prev)}
                    className={cn(
                      "relative font-[family-name:--font-cinzel] text-[11px] tracking-widest px-4 py-2 border-[2px] transition-colors duration-200 cursor-pointer",
                      "before:absolute before:inset-[3px] before:border-[1px] before:pointer-events-none",
                      panelOpen
                        ? "border-black bg-black text-white before:border-white"
                        : "border-gray-300 text-gray-500 before:border-gray-200 hover:border-black hover:text-black hover:before:border-gray-400"
                    )}
                  >
                    {allTools.length === 0 ? (messages.length > 0 ? "Error" : "Loading...") : `Tools  ${enabledCount}/${allTools.length}  ${panelOpen ? "▴" : "▾"}`}
                  </button>

                  {/* Two-tab panel */}
                  {panelOpen && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setPanelOpen(false)} />
                      <div className="absolute bottom-full mb-2 left-0 z-50 w-[360px] bg-white border-[2px] border-black">

                        {/* Tab headers */}
                        <div className="flex border-b-[1px] border-gray-200">
                          {(["tools", "keys"] as const).map(tab => (
                            <button
                              key={tab}
                              onClick={() => setPanelTab(tab)}
                              className={cn(
                                "font-[family-name:--font-cinzel] text-[11px] tracking-widest px-6 py-3 uppercase transition-colors duration-150 cursor-pointer",
                                panelTab === tab
                                  ? "text-black border-b-[2px] border-black -mb-[1px]"
                                  : "text-gray-400 hover:text-black"
                              )}
                            >
                              {tab === "tools" ? "Tool List" : "API Keys"}
                            </button>
                          ))}
                        </div>

                        {/* Tool List tab */}
                        {panelTab === "tools" && (
                          <div className="max-h-[300px] overflow-y-auto">
                            {toolGroups.map(group => {
                              const isExpanded   = expandedGroups.has(group.name)
                              const groupEnabled = group.tools.filter(t => toolToggles[t.function.name] ?? true).length
                              return (
                                <div key={group.name}>
                                  {/* Group header — click to expand/collapse */}
                                  <button
                                    onClick={() => setExpandedGroups(prev => {
                                      const next = new Set(prev)
                                      if (next.has(group.name)) next.delete(group.name)
                                      else next.add(group.name)
                                      return next
                                    })}
                                    className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 border-b-[1px] border-gray-100 hover:bg-gray-100 transition-colors duration-150 cursor-pointer"
                                  >
                                    <span className="font-[family-name:--font-cinzel] text-[12px] tracking-widest text-black">{group.name}</span>
                                    <div className="flex items-center gap-3">
                                      <span className="font-[family-name:--font-geist-mono] text-[10px] text-gray-400">{groupEnabled}/{group.tools.length}</span>
                                      <span className="font-[family-name:--font-geist-mono] text-[10px] text-gray-400">{isExpanded ? "▴" : "▾"}</span>
                                    </div>
                                  </button>

                                  {/* Tools — only visible when expanded */}
                                  {isExpanded && group.tools.map((tool, i) => {
                                    const enabled = toolToggles[tool.function.name] ?? true
                                    return (
                                      <div
                                        key={tool.function.name}
                                        onClick={() => toggleTool(tool.function.name)}
                                        className={cn(
                                          "flex items-center gap-3 px-4 py-3 pl-7 cursor-pointer transition-colors duration-150",
                                          i !== group.tools.length - 1 && "border-b-[1px] border-gray-100",
                                          enabled ? "bg-white hover:bg-gray-50" : "bg-gray-50 hover:bg-gray-100"
                                        )}
                                      >
                                        <div className={cn(
                                          "flex-shrink-0 w-4 h-4 border-[2px] flex items-center justify-center transition-colors duration-150",
                                          enabled ? "border-black bg-black" : "border-gray-300 bg-white"
                                        )}>
                                          {enabled && (
                                            <svg width="8" height="6" viewBox="0 0 8 6" fill="none">
                                              <path d="M1 3L3 5L7 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                            </svg>
                                          )}
                                        </div>
                                        {tool.handler?.method && (
                                          <span className={cn(
                                            "flex-shrink-0 font-[family-name:--font-geist-mono] text-[9px] tracking-widest px-1.5 py-0.5",
                                            enabled
                                              ? (METHOD_BADGE_STYLES[tool.handler.method.toUpperCase()] ?? "border border-gray-300 text-gray-500 bg-white")
                                              : "border border-gray-200 text-gray-300 bg-white"
                                          )}>
                                            {tool.handler.method.toUpperCase()}
                                          </span>
                                        )}
                                        <span className={cn(
                                          "font-[family-name:--font-cinzel] text-[12px] tracking-wide truncate flex-1 transition-colors duration-150",
                                          enabled ? "text-black" : "text-gray-400"
                                        )}>
                                          {tool.function.name}
                                        </span>
                                      </div>
                                    )
                                  })}
                                </div>
                              )
                            })}
                          </div>
                        )}

                        {/* API Keys tab */}
                        {panelTab === "keys" && (
                          <div className="max-h-[300px] overflow-y-auto px-4 py-4">
                            {hasSecurityScheme === false ? (
                              <div className="py-4 flex items-center justify-center">
                                <span className="font-[family-name:--font-cinzel] text-[12px] tracking-widest text-gray-400 text-center">
                                  No API keys needed for any tools.
                                </span>
                              </div>
                            ) : (
                              <div className="flex flex-col gap-5">
                                {toolGroups.map(group => {
                                  // Determine auth type for this group
                                  const groupAuthMap: Record<string, AuthConfig[]> = (() => {
                                    if (!compositeId) return {}
                                    try {
                                      const raw = sessionStorage.getItem(`helios_groups_${compositeId}`)
                                      return raw ? (JSON.parse(raw).authMap ?? {}) : {}
                                    } catch { return {} }
                                  })()
                                  const groupAuthConfigs: AuthConfig[] = groupAuthMap[group.name] ?? []
                                  const isOAuth2ClientCreds = groupAuthConfigs.some(c => c.type === "oauth2" && c.oauthFlow === "client_credentials")
                                    || (!compositeId && !!authContext?.tokenUrl && !authContext?.oauth2Url)
                                  const isOAuth2AuthCode = groupAuthConfigs.some(c => c.type === "oauth2" && c.oauthFlow !== "client_credentials")
                                    || (!compositeId && !!authContext?.oauth2Url)
                                  const isBasicAuth = groupAuthConfigs.some(c => c.type === "basic_auth")
                                    || (group.name === (specId ?? "") && !!authContext?.basicAuthNote)
                                  const oauth2TokenUrl = isOAuth2ClientCreds ? (groupAuthConfigs.find(c => c.type === "oauth2")?.tokenUrl ?? authContext?.tokenUrl) : undefined

                                  return (
                                    <div key={group.name} className="flex flex-col gap-2">
                                      <div className="flex items-center justify-between">
                                        <span className="font-[family-name:--font-cinzel] text-[11px] tracking-widest text-black">{group.name}</span>
                                        <span className={cn(
                                          "font-[family-name:--font-geist-mono] text-[10px] tracking-wider",
                                          savedKeyStatus[group.name] ? "text-green-600" : "text-red-400"
                                        )}>
                                          {savedKeyStatus[group.name] ? "● Provided" : "○ Missing"}
                                        </span>
                                      </div>

                                      {/* OAuth2 — Client Credentials connect form */}
                                      {isOAuth2ClientCreds && oauth2TokenUrl ? (
                                        <div className="flex flex-col gap-2">
                                          <span className="font-[family-name:--font-geist-sans] text-[10px] text-gray-500">
                                            OAuth 2.0 — enter your app credentials to connect:
                                          </span>
                                          <input
                                            type="text"
                                            placeholder="Client ID"
                                            value={oauth2Fields[group.name]?.clientId ?? ""}
                                            onChange={e => setOauth2Fields(prev => ({ ...prev, [group.name]: { ...prev[group.name], clientId: e.target.value } }))}
                                            className="font-[family-name:--font-geist-mono] text-[12px] border-[1px] border-gray-300 px-3 py-2 outline-none focus:border-black transition-colors duration-200"
                                          />
                                          <div className="flex gap-2">
                                            <input
                                              type="password"
                                              placeholder="Client Secret"
                                              value={oauth2Fields[group.name]?.clientSecret ?? ""}
                                              onChange={e => setOauth2Fields(prev => ({ ...prev, [group.name]: { ...prev[group.name], clientSecret: e.target.value } }))}
                                              className="flex-1 font-[family-name:--font-geist-mono] text-[12px] border-[1px] border-gray-300 px-3 py-2 outline-none focus:border-black transition-colors duration-200"
                                            />
                                            <button
                                              onClick={() => handleOAuth2Connect(group.name, oauth2TokenUrl)}
                                              disabled={!oauth2Fields[group.name]?.clientId?.trim() || !oauth2Fields[group.name]?.clientSecret?.trim() || isConnecting === group.name}
                                              className={cn(
                                                "font-[family-name:--font-cinzel] text-[10px] tracking-widest px-4 py-2 transition-colors duration-200 whitespace-nowrap",
                                                !oauth2Fields[group.name]?.clientId?.trim() || !oauth2Fields[group.name]?.clientSecret?.trim() || isConnecting === group.name
                                                  ? "bg-gray-200 text-gray-400 cursor-not-allowed"
                                                  : "bg-black text-white hover:bg-gray-800 cursor-pointer"
                                              )}
                                            >
                                              {isConnecting === group.name ? "Connecting..." : "Connect"}
                                            </button>
                                          </div>
                                          {oauth2ConnectStatus[group.name]?.msg && (
                                            <span className={cn(
                                              "font-[family-name:--font-geist-mono] text-[10px]",
                                              oauth2ConnectStatus[group.name].ok ? "text-green-600" : "text-red-500"
                                            )}>
                                              {oauth2ConnectStatus[group.name].ok ? "✓ " : "✗ "}{oauth2ConnectStatus[group.name].msg}
                                            </span>
                                          )}
                                        </div>
                                      ) : isOAuth2AuthCode ? (
                                        /* OAuth2 Authorization Code — user pastes their own access_token */
                                        <div className="flex flex-col gap-2">
                                          <span className="font-[family-name:--font-geist-sans] text-[10px] text-gray-500">
                                            OAuth 2.0 — paste your access token below.
                                          </span>
                                          <div className="flex gap-2">
                                            <input
                                              type="password"
                                              placeholder={savedKeyStatus[group.name] ? "Update token..." : "Paste access_token..."}
                                              value={apiKeys[group.name] ?? ""}
                                              onChange={e => setApiKeys(prev => ({ ...prev, [group.name]: e.target.value }))}
                                              className="flex-1 font-[family-name:--font-geist-mono] text-[12px] border-[1px] border-gray-300 px-3 py-2 outline-none focus:border-black transition-colors duration-200"
                                            />
                                            <button
                                              onClick={() => handleSaveKey(group.name)}
                                              disabled={!apiKeys[group.name]?.trim() || isSavingKey === group.name}
                                              className={cn(
                                                "font-[family-name:--font-cinzel] text-[10px] tracking-widest px-4 py-2 transition-colors duration-200",
                                                !apiKeys[group.name]?.trim() || isSavingKey === group.name
                                                  ? "bg-gray-200 text-gray-400 cursor-not-allowed"
                                                  : "bg-black text-white hover:bg-gray-800 cursor-pointer"
                                              )}
                                            >
                                              {isSavingKey === group.name ? "..." : "Save"}
                                            </button>
                                          </div>
                                        </div>
                                      ) : (
                                        /* Regular API key / BasicAuth input */
                                        <>
                                          {isBasicAuth && (
                                            <span className="font-[family-name:--font-geist-sans] text-[10px] text-gray-500">
                                              Basic Auth — enter as <code className="bg-gray-100 px-1">username:password</code>
                                            </span>
                                          )}
                                          <div className="flex gap-2">
                                            <input
                                              type="password"
                                              placeholder={savedKeyStatus[group.name] ? "Update key..." : isBasicAuth ? "username:password" : "Enter API key..."}
                                              value={apiKeys[group.name] ?? ""}
                                              onChange={e => setApiKeys(prev => ({ ...prev, [group.name]: e.target.value }))}
                                              className="flex-1 font-[family-name:--font-geist-mono] text-[12px] border-[1px] border-gray-300 px-3 py-2 outline-none focus:border-black transition-colors duration-200"
                                            />
                                            <button
                                              onClick={() => handleSaveKey(group.name)}
                                              disabled={!apiKeys[group.name]?.trim() || isSavingKey === group.name}
                                              className={cn(
                                                "font-[family-name:--font-cinzel] text-[10px] tracking-widest px-4 py-2 transition-colors duration-200",
                                                !apiKeys[group.name]?.trim() || isSavingKey === group.name
                                                  ? "bg-gray-200 text-gray-400 cursor-not-allowed"
                                                  : "bg-black text-white hover:bg-gray-800 cursor-pointer"
                                              )}
                                            >
                                              {isSavingKey === group.name ? "..." : "Save"}
                                            </button>
                                          </div>
                                        </>
                                      )}
                                    </div>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Footer */}
                        <div className="border-t-[1px] border-gray-200 p-4">
                          <button
                            onClick={() => { handleApply(); setPanelOpen(false) }}
                            className="w-full relative font-[family-name:--font-cinzel] py-3 text-[12px] tracking-widest text-black border-[2px] border-black
                              before:absolute before:inset-[3px] before:border-[1px] before:border-black before:pointer-events-none
                              hover:bg-black hover:text-white hover:before:border-white transition-colors duration-300 cursor-pointer"
                          >
                            Apply & Reset Chat
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>

                {/* Reset Chat */}
                <button
                  onClick={() => setMessages([])}
                  className="font-[family-name:--font-cinzel] text-[11px] tracking-widest text-gray-400 border-[2px] border-gray-300 px-4 py-2 hover:border-black hover:text-black transition-colors duration-200 cursor-pointer"
                >
                  Reset Chat
                </button>
              </div>

              {/* Input box — original style */}
              <div className="relative flex items-end gap-2 border-[2px] border-gray-300 bg-white p-2 focus-within:border-black transition-colors duration-200">
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Test your tools..."
                  rows={1}
                  className="flex-1 resize-none bg-transparent px-3 py-2 text-sm font-[family-name:--font-geist-sans] placeholder:text-gray-400 focus:outline-none min-h-[40px] max-h-[200px]"
                  disabled={isLoading}
                />
                <button
                  type="button"
                  aria-label="Send message"
                  onClick={handleSend}
                  disabled={!input.trim() || isLoading}
                  className={cn(
                    "flex-shrink-0 p-2 transition-colors",
                    input.trim() && !isLoading
                      ? "bg-black text-white hover:bg-gray-800 cursor-pointer"
                      : "bg-gray-100 text-gray-400 cursor-not-allowed"
                  )}
                >
                  <Send className="w-5 h-5" />
                </button>
              </div>

            </div>
          </div>

        </div>
      </div>

    </div>
  )
}
