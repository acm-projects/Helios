"use client"
import { Suspense, useState, useEffect, useLayoutEffect, useRef } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { Send, User, Bot, ChevronDown, ChevronRight } from "lucide-react"
import Link from "next/link"
import { isLoggedIn, getAuthHeaders } from "@/lib/auth"
import { InfoBubble } from "@/app/components/InfoBubble"
import { lookupProviderKeyUrl, lookupBasicAuthLabels } from "@/lib/providerKeys"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import rehypeRaw from "rehype-raw"

const cn = (...classes: (string | undefined | null | false)[]) => classes.filter(Boolean).join(" ")

const METHOD_BADGE_STYLES: Record<string, string> = {
  GET: "method-get",
  POST: "method-post",
  PUT: "method-put",
  PATCH: "method-patch",
  DELETE: "method-delete",
}

interface Message {
  id: string
  role: "user" | "assistant" | "tool_call"
  content: string
  toolDetails?: { name: string; input: Record<string, any> }[]
  timestamp: Date
}

interface Tool {
  type: string
  function: { name: string; description: string; parameters: unknown }
  handler?: { method: string; path: string; query_params?: string[] }
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

function SandboxContent() {
  const searchParams = useSearchParams()
  const specId = searchParams.get("specId")
  const compositeId = searchParams.get("compositeId")
  const router = useRouter()

  const [sessionId, setSessionId] = useState("")
  const [allTools, setAllTools] = useState<Tool[]>([])
  const [toolToggles, setToolToggles] = useState<Record<string, boolean>>({})
  const [activeTools, setActiveTools] = useState<Tool[]>([])
  const [authContext, setAuthContext] = useState<AuthContext | undefined>(undefined)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const chatScrollRef = useRef<HTMLDivElement>(null)


  useEffect(() => {
    if (!isLoggedIn()) { router.replace("/auth"); return }

    if (compositeId) {
      const raw = sessionStorage.getItem(`helios_session_${compositeId}`)
      if (!raw) return
      const { tools } = JSON.parse(raw)
      const toolList: Tool[] = tools ?? []

      const registryTools = toolList.map((t: Tool) => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters ?? { type: "object", properties: {} },
        handler: {
          method: t.handler?.method ?? "GET",
          path: t.handler?.path ?? "",
          headers: {},
          query_params: t.handler?.query_params ?? [],
          fixed_query_params: (t.handler as any)?.fixed_query_params,
          param_name_map: (t.handler as any)?.param_name_map,
          body_format: (t.handler as any)?.body_format,
          auto_path_params: (t.handler as any)?.auto_path_params,
        }
      }))

      let localGroupMap: Record<string, string> = {}
      let localAuthMap: Record<string, AuthConfig[]> = {}
      const groupsRaw = sessionStorage.getItem(`helios_groups_${compositeId}`)
      if (groupsRaw) {
        try {
          const parsed = JSON.parse(groupsRaw)
          localGroupMap = parsed.toolMap ?? parsed
          localAuthMap = parsed.authMap ?? {}
          setToolGroupMap(localGroupMap)
        } catch { }
      }

      fetch("http://localhost:8000/api/sandbox/start", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ toolsRegistry: { baseUrl: "", tools: registryTools }, groupMap: localGroupMap, authMap: localAuthMap })
      })
        .then(res => res.json())
        .then(data => {
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
        // Saved composite: backend returns groupMap/authMap so the API Keys panel
        // can render per-child rows instead of collapsing to one specId-named row.
        if (specId && data.groupMap && data.authMap) {
          setToolGroupMap(data.groupMap)
          try {
            sessionStorage.setItem(
              `helios_groups_${specId}`,
              JSON.stringify({ toolMap: data.groupMap, authMap: data.authMap })
            )
          } catch { }
        }
        const initialToggles: Record<string, boolean> = {}
        tools.forEach((t: Tool) => { initialToggles[t.function.name] = t.enabled ?? true })
        // Merge in-flight toggle edits from a prior sandbox → verify trip so
        // navigating back doesn't silently revert the user's deselections.
        if (specId) {
          const togglesRaw = sessionStorage.getItem(`helios_toggles_${specId}`)
          if (togglesRaw) {
            try {
              const pending: Record<string, boolean> = JSON.parse(togglesRaw)
              for (const name in pending) {
                if (name in initialToggles) initialToggles[name] = pending[name]
              }
            } catch { /* ignore malformed */ }
          }
        }
        const mergedTools = tools.map(t => ({ ...t, enabled: initialToggles[t.function.name] ?? true }))
        setAllTools(mergedTools)
        setActiveTools(mergedTools.filter(t => initialToggles[t.function.name]))
        if (data.authContext) setAuthContext(data.authContext)
        setToolToggles(initialToggles)
      })
      .catch(() => {
        setMessages([{ id: Date.now().toString(), role: "assistant", content: "Could not reach the server. Make sure the backend is running.", timestamp: new Date() }])
        setAllTools([])
      })
  }, [specId, compositeId, router])

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }) }, [messages])

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto"
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + "px"
    }
  }, [input])

  const toggleTool = (name: string) => setToolToggles(prev => ({ ...prev, [name]: !prev[name] }))

  const switchPanelTab = (tab: "tools" | "keys") => {
    if (tab === panelTab) return
    if (panelTabTimer.current) clearTimeout(panelTabTimer.current)
    // Phase 1: fade out current content
    setPanelContentVisible(false)
    panelTabTimer.current = setTimeout(() => {
      // Phase 2: swap tab — grid rows start animating to new height
      setPanelTab(tab)
      // Phase 3: fade in new content (starts while height is mid-transition)
      panelTabTimer.current = setTimeout(() => setPanelContentVisible(true), 120)
    }, 150)
  }

  const handleApply = async () => {
    const pending = Object.entries(basicAuthFields).filter(
      ([, f]) => f?.user?.trim() && f?.pass?.trim()
    )
    if (pending.length > 0) {
      await Promise.all(pending.map(([groupName]) => handleSaveBasicAuth(groupName)))
    }
    const filtered = allTools.filter(t => toolToggles[t.function.name])
    setActiveTools(filtered)
    setMessages([])
  }

  const handleNavigateToVerify = () => {
    if (compositeId) {
      // Persist current toggle state so verify reflects sandbox deselections.
      // Source of truth = allTools (what the user just saw in the panel) merged with
      // any other fields from storage (sessionId, etc).
      const raw = sessionStorage.getItem(`helios_session_${compositeId}`)
      const sessionRest = raw ? JSON.parse(raw) : { sessionId }
      const updatedTools = allTools.map((t: Tool) => {
        const name = t.function.name
        const isEnabled = name in toolToggles ? toolToggles[name] === true : (t.enabled !== false)
        return { ...t, enabled: isEnabled }
      })
      sessionStorage.setItem(
        `helios_session_${compositeId}`,
        JSON.stringify({ ...sessionRest, tools: updatedTools })
      )
      const url = specId
        ? `/verify?compositeId=${compositeId}&specId=${encodeURIComponent(specId)}`
        : `/verify?compositeId=${compositeId}`
      router.push(url)
      return
    }
    if (specId) {
      const draft = sessionStorage.getItem(`helios_draft_${specId}`)
      if (draft) {
        const draftData = JSON.parse(draft)
        if (Array.isArray(draftData.catalog)) {
          const updatedCatalog = draftData.catalog.map((item: { name: string; enabled?: boolean }) => ({
            ...item, enabled: toolToggles[item.name] ?? item.enabled ?? true
          }))
          sessionStorage.setItem(`helios_draft_${specId}`, JSON.stringify({ ...draftData, catalog: updatedCatalog }))
        }
      } else {
        sessionStorage.setItem(`helios_toggles_${specId}`, JSON.stringify(toolToggles))
      }
      router.push(`/verify?specId=${specId}`)
    }
  }

  const handleEdit = () => {
    // For composites, preserve each tool's child apiName from groupMap so
    // launchSandbox can rebuild the per-child authMap. Without this, every
    // tool collapses to specId and auth grouping is destroyed.
    const fallbackName = specId ?? "Server"
    const toolItems = allTools.map(t => ({
      id: t.function.name,
      name: t.function.name,
      description: t.function.description ?? "",
      method: t.handler?.method,
      path: t.handler?.path,
      baseUrl: "",
      source: "past" as const,
      apiName: toolGroupMap[t.function.name] ?? fallbackName,
      input_schema: t.function.parameters as object,
      handler: t.handler,
    }))
    sessionStorage.setItem("helios_create_tools", JSON.stringify(toolItems))
    sessionStorage.setItem("helios_edit_source", specId!)
    // Seed per-apiName drafts so launchSandbox can find auth for each group.
    // Pulls from the same helios_groups_<key> blob the panel already uses.
    const groupsKey = compositeId ?? specId
    if (groupsKey) {
      try {
        const raw = sessionStorage.getItem(`helios_groups_${groupsKey}`)
        if (raw) {
          const parsed = JSON.parse(raw)
          const authMap: Record<string, AuthConfig[]> = parsed.authMap ?? {}
          const seeded = new Set(toolItems.map(t => t.apiName))
          for (const apiName of seeded) {
            const auth = authMap[apiName]
            if (auth && auth.length > 0) {
              sessionStorage.setItem(`helios_draft_${apiName}`, JSON.stringify({
                baseUrl: "", auth, toolCount: toolItems.filter(t => t.apiName === apiName).length,
              }))
            }
          }
        }
      } catch { }
    }
    router.push("/create")
  }

  const handleSend = async () => {
    if (!input.trim() || isLoading) return
    const messageText = input.trim()
    const userMessage: Message = { id: Date.now().toString(), role: "user", content: messageText, timestamp: new Date() }
    setMessages(prev => [...prev, userMessage])
    setInput("")
    setIsLoading(true)

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 60000)

    // Only send user/assistant turns — "tool_call" is a frontend-only display role
    // with no Anthropic equivalent, and sending it causes validation errors on the backend.
    const cleanHistory = messages
      .filter(m => m.role === "user" || m.role === "assistant")
      .map(m => ({ role: m.role as "user" | "assistant", content: m.content }))

    fetch("http://localhost:8000/api/sandbox/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAuthHeaders() },
      body: JSON.stringify({
        sessionId,
        tools: activeTools,
        history: cleanHistory,
        message: messageText,
        authContext
      }),
      signal: controller.signal
    })
      .then(async res => {
        clearTimeout(timeout)
        const data = await res.json()

        if (!res.ok) {
          const is429 = res.status === 429
          const errText = is429
            ? "Rate limit reached — too many requests this minute. Wait a moment and try again."
            : (data?.error ?? "Something went wrong. Please try again.")
          setMessages(prev => [...prev, { id: Date.now().toString(), role: "assistant", content: errText, timestamp: new Date() }])
          setIsLoading(false)
          return
        }

        const allToolCalls: { name: string; input: Record<string, any> }[] = (data.history ?? [])
          .filter((m: any) => m.role === "assistant" && Array.isArray(m.content))
          .flatMap((m: any) => (m.content as any[]).filter(b => b.type === "tool_use").map(b => ({ name: b.name, input: b.input ?? {} })))

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
        const reply = typeof data.reply === "string" && data.reply.trim()
          ? data.reply
          : "No response received. Please try again."
        newMessages.push({ id: Date.now().toString(), role: "assistant", content: reply, timestamp: new Date() })
        setMessages(prev => [...prev, ...newMessages])
        setIsLoading(false)
      })
      .catch(err => {
        clearTimeout(timeout)
        const reason = err.name === "AbortError"
          ? "Request timed out — the AI took too long to respond."
          : "Failed to reach the server."
        setMessages(prev => [...prev, { id: Date.now().toString(), role: "assistant", content: reason, timestamp: new Date() }])
        setIsLoading(false)
      })
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  const enabledCount = Object.values(toolToggles).filter(Boolean).length

  const [expandedToolCalls, setExpandedToolCalls] = useState<Set<string>>(new Set())
  const [panelOpen, setPanelOpen] = useState(false)
  const [panelTab, setPanelTab] = useState<"tools" | "keys">("tools")
  const [panelContentVisible, setPanelContentVisible] = useState(true)
  const panelTabTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({})
  const [hasSecurityScheme, setHasSecurityScheme] = useState<boolean | null>(null)
  const [toolGroupMap, setToolGroupMap] = useState<Record<string, string>>({})
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [savedKeyStatus, setSavedKeyStatus] = useState<Record<string, boolean>>({})
  const [isSavingKey, setIsSavingKey] = useState<string | null>(null)
  const [oauth2Fields, setOauth2Fields] = useState<Record<string, { clientId: string; clientSecret: string }>>({})
  const [basicAuthFields, setBasicAuthFields] = useState<Record<string, { user: string; pass: string }>>({})
  const [oauth2ConnectStatus, setOauth2ConnectStatus] = useState<Record<string, { ok: boolean; msg: string }>>({})
  const [isConnecting, setIsConnecting] = useState<string | null>(null)
  const toolsButtonRef = useRef<HTMLButtonElement>(null)
  const [panelPos, setPanelPos] = useState<{ left: number; bottom: number }>({ left: 24, bottom: 130 })

  useLayoutEffect(() => {
    if (!panelOpen) return
    const reposition = () => {
      const rect = toolsButtonRef.current?.getBoundingClientRect()
      if (!rect) return
      setPanelPos({ left: rect.left, bottom: window.innerHeight - rect.top + 10 })
    }
    reposition()
    window.addEventListener("resize", reposition)
    return () => window.removeEventListener("resize", reposition)
  }, [panelOpen])

  useEffect(() => {
    const groupsKey = compositeId ?? specId
    const groupsRaw = groupsKey ? sessionStorage.getItem(`helios_groups_${groupsKey}`) : null
    if (groupsRaw) {
      try {
        const parsed = JSON.parse(groupsRaw)
        const authMap: Record<string, AuthConfig[]> = parsed.authMap ?? {}
        if (Object.keys(authMap).length > 0) {
          setHasSecurityScheme(Object.values(authMap).some(configs => configs.some(c => c.type !== "none")))
          return
        }
      } catch { /* fall through to spec-based detection */ }
    }
    if (compositeId) { setHasSecurityScheme(false); return }
    if (!specId) { setHasSecurityScheme(false); return }
    const draft = sessionStorage.getItem(`helios_draft_${specId}`)
    if (!draft) { setHasSecurityScheme(!!authContext && Object.keys(authContext).length > 0); return }
    try {
      const { spec } = JSON.parse(draft)
      const has3 = spec?.components?.securitySchemes && Object.keys(spec.components.securitySchemes).length > 0
      const has2 = spec?.securityDefinitions && Object.keys(spec.securityDefinitions).length > 0
      const hasCtx = !!authContext && Object.keys(authContext).length > 0
      setHasSecurityScheme(!!(has3 || has2 || hasCtx))
    } catch { setHasSecurityScheme(false) }
  }, [specId, compositeId, authContext, allTools])

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
      if (res.ok) { setSavedKeyStatus(prev => ({ ...prev, [groupName]: true })); setApiKeys(prev => ({ ...prev, [groupName]: "" })) }
    } catch { }
    setIsSavingKey(null)
  }

  const handleSaveBasicAuth = async (groupName: string) => {
    const fields = basicAuthFields[groupName]
    if (!fields?.user?.trim() || !fields?.pass?.trim()) return
    setIsSavingKey(groupName)
    try {
      const res = await fetch(`http://localhost:8000/api/keys/${encodeURIComponent(groupName)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ key: `${fields.user.trim()}:${fields.pass.trim()}` })
      })
      if (res.ok) {
        setSavedKeyStatus(prev => ({ ...prev, [groupName]: true }))
        setBasicAuthFields(prev => ({ ...prev, [groupName]: { user: "", pass: "" } }))
      }
    } catch { }
    setIsSavingKey(null)
  }

  const handleOAuth2Connect = async (groupName: string, tokenUrl: string) => {
    const fields = oauth2Fields[groupName]
    if (!fields?.clientId?.trim() || !fields?.clientSecret?.trim()) return
    setIsConnecting(groupName)
    try {
      const res = await fetch("http://localhost:8000/api/keys/oauth2/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ groupName, tokenUrl, clientId: fields.clientId.trim(), clientSecret: fields.clientSecret.trim() })
      })
      const data = await res.json()
      if (res.ok) {
        setOauth2ConnectStatus(prev => ({ ...prev, [groupName]: { ok: true, msg: "Connected" } }))
        setSavedKeyStatus(prev => ({ ...prev, [groupName]: true }))
        setOauth2Fields(prev => ({ ...prev, [groupName]: { clientId: "", clientSecret: "" } }))
      } else {
        setOauth2ConnectStatus(prev => ({ ...prev, [groupName]: { ok: false, msg: data.error ?? "Connection failed" } }))
      }
    } catch {
      setOauth2ConnectStatus(prev => ({ ...prev, [groupName]: { ok: false, msg: "Request failed" } }))
    }
    setIsConnecting(null)
  }

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
    <div className="flex flex-col h-screen w-full relative overflow-hidden">

      {/* ── Background ─────────────────────────────────────────────────── */}

      {/* ── Header ───────────────────────────────────────────────────── */}
      <div className="relative z-30 flex items-center px-8 h-[93px] flex-shrink-0">
        <div className="flex-1 flex items-center">
          <div className="relative">
            <Link href="/" className="absolute inset-0 cursor-pointer z-10" aria-label="Home" />
            <span className="font-[family-name:--font-cinzel] font-semibold text-[32px] tracking-[0.35em] pr-[0.35em] select-none pointer-events-none"
              style={{ color: "#ffffff", textShadow: "0 0 40px rgba(255,255,255,0.15)" }}>
              HELIOS
            </span>
          </div>
        </div>
        <div className="flex items-center gap-4 font-[family-name:--font-cinzel] text-[22px] tracking-[0.18em]">
          <Link href="/create" className="step-inactive cursor-pointer">Create</Link>
          <span className="step-divider text-[10px]">✦</span>
          <span className="step-active pb-1 inline-flex items-center gap-2.5">
            Sandbox
            <InfoBubble
              chapter="how-it-works"
              quick="How an MCP server actually runs — initialize, list tools, call tools. The three JSON-RPC phases behind this chat."
              size={16}
              className="align-baseline"
            />
          </span>
          <span className="step-divider text-[10px]">✦</span>
          <span onClick={handleNavigateToVerify} className="step-inactive cursor-pointer hover:text-white/60 transition-colors">Verify</span>
          <span className="step-divider text-[10px]">✦</span>
          <span className="step-inactive">Download</span>
        </div>
        <div className="flex-1 flex items-center justify-end gap-2.5">
          {specId ? (
            <>
              <button
                onClick={handleEdit}
                disabled={allTools.length === 0}
                className="font-[family-name:--font-cinzel] text-[16px] tracking-[0.14em] px-7 py-3 glass rounded-xl
                  text-white/45 hover:text-white/75 hover:bg-white/[0.10] transition-all duration-200 cursor-pointer
                  disabled:opacity-30 disabled:cursor-not-allowed"
              >
                Edit
              </button>
              <Link href="/">
                <button className="font-[family-name:--font-cinzel] text-[16px] tracking-[0.14em] px-7 py-3 glass rounded-xl
                  text-white/45 hover:text-white/75 hover:bg-white/[0.10] transition-all duration-200 cursor-pointer">
                  Cancel
                </button>
              </Link>
            </>
          ) : (
            <Link href="/create">
              <button className="font-[family-name:--font-cinzel] text-[16px] tracking-[0.14em] px-7 py-3 glass rounded-xl
                text-white/45 hover:text-white/75 hover:bg-white/[0.10] transition-all duration-200 cursor-pointer">
                ← Back
              </button>
            </Link>
          )}
          <button onClick={handleNavigateToVerify}
            className="btn-gold font-[family-name:--font-cinzel] text-[16px] tracking-[0.14em] px-7 py-3 rounded-xl cursor-pointer">
            Next →
          </button>
        </div>
      </div>

      {/* ── Body ───────────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-col flex-1 overflow-hidden">

          {/* Messages */}
          <div ref={chatScrollRef} className="flex-1 min-h-0 overflow-y-auto px-4 pt-10 pb-6">
            <div className="max-w-[820px] mx-auto space-y-5">

              {messages.map((message) => {
                if (message.role === "tool_call") {
                  const isExpanded = expandedToolCalls.has(message.id)
                  return (
                    <div key={message.id} className="flex flex-col gap-0">
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
                        <div className="flex-1 h-px bg-white/[0.12]" />
                        <div className="flex items-center gap-2">
                          {isExpanded
                            ? <ChevronDown size={12} className="text-white/30 flex-shrink-0" />
                            : <ChevronRight size={12} className="text-white/30 flex-shrink-0" />}
                          <span className="font-[family-name:--font-cinzel] text-[10px] tracking-[0.16em] text-white/55 group-hover:text-white/75 transition-colors whitespace-nowrap">
                            {message.toolDetails?.length ?? 1} tool{(message.toolDetails?.length ?? 1) !== 1 ? "s" : ""} called
                          </span>
                          <span className="font-[family-name:--font-geist-mono] text-[10px] text-white/45 whitespace-nowrap hidden sm:inline">
                            {message.content}
                          </span>
                        </div>
                        <div className="flex-1 h-px bg-white/[0.12]" />
                      </button>

                      {isExpanded && message.toolDetails && (
                        <div className="flex flex-col gap-2 pt-2 pb-1 px-1">
                          {message.toolDetails.map((tc, i) => (
                            <div key={i} className="glass rounded-xl px-4 py-3">
                              <div className="font-[family-name:--font-cinzel] text-[11px] tracking-wider text-[#C9A84C]/80 mb-2">{tc.name}</div>
                              {Object.keys(tc.input).length > 0 ? (
                                <pre className="font-[family-name:--font-geist-mono] text-[10px] text-white/60 whitespace-pre-wrap break-all leading-relaxed">
                                  {JSON.stringify(tc.input, null, 2)}
                                </pre>
                              ) : (
                                <span className="font-[family-name:--font-geist-mono] text-[10px] text-white/45">no arguments</span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                }

                return (
                  <div key={message.id} className={cn("flex gap-3", message.role === "user" ? "justify-end" : "justify-start")}>
                    {message.role === "assistant" && (
                      <div
                        aria-label="Helios"
                        className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center"
                        style={{
                          background: "linear-gradient(135deg,#C9A84C,#E8C46A)",
                          boxShadow: "0 0 0 1px rgba(255,255,255,0.18) inset, 0 2px 6px rgba(0,0,0,0.25)",
                        }}
                      >
                        <span
                          className="font-[family-name:--font-cinzel] font-semibold text-[20px] leading-none"
                          style={{ color: "rgba(0,0,0,0.82)", letterSpacing: "0.02em" }}
                        >
                          H
                        </span>
                      </div>
                    )}
                    {/* Bubble — backdrop-filter samples the fixed background at GPU level, zero JS needed */}
                    <div className={cn(
                      "max-w-[72%] overflow-hidden",
                      message.role === "user" ? "rounded-2xl rounded-tr-sm" : "rounded-2xl rounded-tl-sm"
                    )} style={{ backdropFilter: "blur(12px) saturate(1.4) brightness(0.68)", WebkitBackdropFilter: "blur(12px) saturate(1.4) brightness(0.68)", backgroundColor: "rgba(255,255,255,0.06)" }}>
                    {/* Inner card — visual styling lives here */}
                    <div className={cn(
                      "px-4 py-3",
                      message.role === "user"
                        ? "border border-white/[0.15] text-white/90"
                        : "text-white/85"
                    )}>
                      {message.role === "assistant" ? (
                        <div className="font-[family-name:--font-cormorant] text-[17px] leading-relaxed prose-sandbox">
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            rehypePlugins={[rehypeRaw]}
                            components={{
                              p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
                              h1: ({ children }) => <h1 className="font-[family-name:--font-cinzel] text-[18px] tracking-wider text-white/95 mb-3 mt-1">{children}</h1>,
                              h2: ({ children }) => <h2 className="font-[family-name:--font-cinzel] text-[16px] tracking-wider text-white/90 mb-2 mt-1">{children}</h2>,
                              h3: ({ children }) => <h3 className="font-[family-name:--font-cinzel] text-[14px] tracking-wider text-white/85 mb-1 mt-1">{children}</h3>,
                              strong: ({ children }) => <strong className="text-white/95 font-semibold">{children}</strong>,
                              em: ({ children }) => <em className="text-white/75 italic">{children}</em>,
                              ul: ({ children }) => <ul className="list-disc list-inside space-y-1 mb-2 text-white/80">{children}</ul>,
                              ol: ({ children }) => <ol className="list-decimal list-inside space-y-1 mb-2 text-white/80">{children}</ol>,
                              li: ({ children }) => <li className="leading-relaxed">{children}</li>,
                              code: ({ children, className }) => {
                                const isBlock = className?.includes("language-")
                                return isBlock
                                  ? <code className="block font-[family-name:--font-geist-mono] text-[13px] bg-black/30 border border-white/[0.10] rounded-lg px-3 py-2 my-2 text-white/70 whitespace-pre-wrap overflow-x-auto">{children}</code>
                                  : <code className="font-[family-name:--font-geist-mono] text-[13px] bg-black/25 border border-white/[0.10] rounded px-1.5 py-0.5 text-[#C9A84C]/80">{children}</code>
                              },
                              pre: ({ children }) => <pre className="my-2">{children}</pre>,
                              blockquote: ({ children }) => <blockquote className="border-l-2 border-[#C9A84C]/40 pl-3 my-2 text-white/60 italic">{children}</blockquote>,
                              a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-[#C9A84C]/80 hover:text-[#C9A84C] underline underline-offset-2 transition-colors">{children}</a>,
                              hr: () => <hr className="border-white/[0.12] my-3" />,
                              table: ({ children }) => <table className="w-full text-[14px] border-collapse my-2">{children}</table>,
                              th: ({ children }) => <th className="font-[family-name:--font-cinzel] text-[11px] tracking-wider text-white/60 border border-white/[0.12] px-3 py-1.5 bg-white/[0.04]">{children}</th>,
                              td: ({ children }) => <td className="border border-white/[0.10] px-3 py-1.5 text-white/75">{children}</td>,
                            }}
                          >
                            {message.content}
                          </ReactMarkdown>
                        </div>
                      ) : (
                        <p className="leading-relaxed whitespace-pre-wrap break-words font-[family-name:--font-cormorant] text-[17px]">
                          {message.content}
                        </p>
                      )}
                    </div>{/* end inner card */}
                    </div>{/* end bubble */}
                    {message.role === "user" && (
                      <div className="flex-shrink-0 w-8 h-8 rounded-full overflow-hidden flex items-center justify-center" style={{ backdropFilter: "blur(12px) saturate(1.4) brightness(0.68)", WebkitBackdropFilter: "blur(12px) saturate(1.4) brightness(0.68)", backgroundColor: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)" }}>
                        <User className="w-4 h-4 text-white/60" />
                      </div>
                    )}
                  </div>
                )
              })}

              {isLoading && (
                <div className="flex gap-3 justify-start">
                  <div
                    aria-label="Helios"
                    className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center"
                    style={{
                      background: "linear-gradient(135deg,#C9A84C,#E8C46A)",
                      boxShadow: "0 0 0 1px rgba(255,255,255,0.18) inset, 0 2px 6px rgba(0,0,0,0.25)",
                    }}
                  >
                    <span
                      className="font-[family-name:--font-cinzel] font-semibold text-[20px] leading-none"
                      style={{ color: "rgba(0,0,0,0.82)", letterSpacing: "0.02em" }}
                    >
                      H
                    </span>
                  </div>
                  <div className="glass rounded-2xl rounded-bl-sm px-4 py-3 flex items-center gap-3">
                    <div className="flex gap-1.5 items-center">
                      <div className="w-2 h-2 rounded-full bg-white/50 dot-1" />
                      <div className="w-2 h-2 rounded-full bg-white/50 dot-2" />
                      <div className="w-2 h-2 rounded-full bg-white/50 dot-3" />
                    </div>
                    <span className="font-[family-name:--font-cinzel] text-[11px] tracking-widest text-white/60">Thinking...</span>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* Input area */}
          <div className="flex-shrink-0 relative z-[0] overflow-hidden border-t border-white/[0.09]">
            <div
              aria-hidden="true"
              className="absolute pointer-events-none bar-blur"
              style={{ inset: "-50px", zIndex: -1 }}
            />
            <div className="max-w-[820px] mx-auto px-4 pt-3 pb-4">

              {/* Toolbar */}
              <div className="flex items-center justify-between mb-3">
                <div className="relative">
                  <button
                    ref={toolsButtonRef}
                    onClick={() => setPanelOpen(prev => !prev)}
                    className={cn(
                      "font-[family-name:--font-cinzel] text-[11px] tracking-[0.14em] px-4 py-2 rounded-xl border transition-all duration-200 cursor-pointer",
                      panelOpen
                        ? "bg-[#C9A84C]/20 border-[#C9A84C]/40 text-[#C9A84C]"
                        : "glass text-white/65 hover:text-white/85 hover:bg-white/[0.10]"
                    )}
                  >
                    {allTools.length === 0
                      ? (messages.length > 0 ? "Error" : "Loading...")
                      : `Tools  ${enabledCount}/${allTools.length}  ${panelOpen ? "▴" : "▾"}`}
                  </button>

                  {panelOpen && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setPanelOpen(false)} />
                      <div
                        className="fixed z-50 w-[380px] glass-mid rounded-2xl overflow-hidden shadow-[0_24px_60px_rgba(0,0,0,0.5)]"
                        style={{ left: panelPos.left, bottom: panelPos.bottom }}
                      >
                        {/* Blur layer — samples page bg through chat for readability, same pattern as server cards */}
                        <div
                          aria-hidden="true"
                          className="absolute pointer-events-none"
                          style={{
                            inset: "-50px",
                            backgroundImage: "var(--page-bg, url('/Background-Dusk(2).jpg'))",
                            backgroundSize: "cover",
                            backgroundPosition: "center",
                            backgroundAttachment: "fixed",
                            filter: "blur(8px) saturate(1.2) brightness(0.72)",
                            zIndex: -1,
                          }}
                        />

                        {/* Tab headers */}
                        <div className="flex border-b border-white/[0.18]">
                          {(["tools", "keys"] as const).map(tab => (
                            <button
                              key={tab}
                              onClick={() => switchPanelTab(tab)}
                              className={cn(
                                "font-[family-name:--font-cinzel] text-[13px] tracking-[0.14em] px-6 py-3 uppercase transition-colors duration-150 cursor-pointer",
                                panelTab === tab
                                  ? "text-[#C9A84C] border-b-2 border-[#C9A84C] -mb-px"
                                  : "text-white/70 hover:text-white/85"
                              )}
                            >
                              {tab === "tools" ? "Tool List" : "API Keys"}
                            </button>
                          ))}
                        </div>

                        {/* Tool List tab — grid-template-rows animates height smoothly */}
                        <div style={{
                          display: "grid",
                          gridTemplateRows: panelTab === "tools" ? "1fr" : "0fr",
                          transition: "grid-template-rows 220ms ease-in-out",
                        }}>
                        <div className="overflow-hidden">
                        <div className={cn(
                          "max-h-[300px] overflow-y-auto transition-opacity duration-150",
                          panelTab === "tools" && panelContentVisible ? "opacity-100" : "opacity-0"
                        )}>
                          <div>
                            {toolGroups.map(group => {
                              const isExpanded = expandedGroups.has(group.name)
                              const groupEnabled = group.tools.filter(t => toolToggles[t.function.name] ?? true).length
                              return (
                                <div key={group.name}>
                                  <button
                                    onClick={() => setExpandedGroups(prev => {
                                      const next = new Set(prev)
                                      if (next.has(group.name)) next.delete(group.name)
                                      else next.add(group.name)
                                      return next
                                    })}
                                    className="w-full flex items-center justify-between px-4 py-3 bg-white/[0.04] border-b border-white/[0.15] hover:bg-white/[0.07] transition-colors cursor-pointer"
                                  >
                                    <span className="font-[family-name:--font-cinzel] text-[13px] tracking-wider text-white/90">{group.name}</span>
                                    <div className="flex items-center gap-3">
                                      <span className="font-[family-name:--font-geist-mono] text-[11px] text-white/55">{groupEnabled}/{group.tools.length}</span>
                                      <span className="font-[family-name:--font-geist-mono] text-[11px] text-white/60">{isExpanded ? "▴" : "▾"}</span>
                                    </div>
                                  </button>
                                  <div
                                    className="overflow-hidden transition-[max-height] duration-300 ease-in-out"
                                    style={{ maxHeight: isExpanded ? `${group.tools.length * 52}px` : "0px" }}
                                  >
                                    {group.tools.map((tool) => {
                                      const enabled = toolToggles[tool.function.name] ?? true
                                      return (
                                        <div
                                          key={tool.function.name}
                                          onClick={() => toggleTool(tool.function.name)}
                                          className={cn(
                                            "flex items-center gap-3 px-4 py-3 pl-7 cursor-pointer transition-colors border-b border-white/[0.12]",
                                            enabled ? "hover:bg-white/[0.06]" : "bg-black/[0.10] hover:bg-black/[0.15]"
                                          )}
                                        >
                                          <div className={cn(
                                            "flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-all",
                                            enabled ? "border-[#C9A84C]/50 bg-[#C9A84C]/15" : "border-white/[0.18] bg-transparent"
                                          )}>
                                            {enabled && (
                                              <svg width="8" height="6" viewBox="0 0 8 6" fill="none">
                                                <path d="M1 3L3 5L7 1" stroke="#C9A84C" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                              </svg>
                                            )}
                                          </div>
                                          {tool.handler?.method && (
                                            <span className={cn(
                                              "flex-shrink-0 font-[family-name:--font-geist-mono] text-[9px] tracking-widest px-1.5 py-0.5 rounded",
                                              enabled
                                                ? (METHOD_BADGE_STYLES[tool.handler.method.toUpperCase()] ?? "method-get")
                                                : "bg-white/[0.04] text-white/20 border border-white/[0.07]"
                                            )}>
                                              {tool.handler.method.toUpperCase()}
                                            </span>
                                          )}
                                          <span className={cn(
                                            "font-[family-name:--font-cinzel] text-[13px] tracking-wide truncate flex-1 transition-colors",
                                            enabled ? "text-white/90" : "text-white/30"
                                          )}>
                                            {tool.function.name}
                                          </span>
                                        </div>
                                      )
                                    })}
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                        </div>
                        </div>

                        {/* API Keys tab */}
                        <div style={{
                          display: "grid",
                          gridTemplateRows: panelTab === "keys" ? "1fr" : "0fr",
                          transition: "grid-template-rows 220ms ease-in-out",
                        }}>
                        <div className="overflow-hidden">
                        <div className={cn(
                          "max-h-[300px] overflow-y-auto px-4 py-4 transition-opacity duration-150",
                          panelTab === "keys" && panelContentVisible ? "opacity-100" : "opacity-0"
                        )}>
                          <div>
                            {hasSecurityScheme === false ? (
                              <div className="py-4 flex items-center justify-center">
                                <span className="font-[family-name:--font-cinzel] text-[12px] tracking-widest text-white/30 text-center">
                                  No API keys needed for any tools.
                                </span>
                              </div>
                            ) : (
                              <div className="flex flex-col gap-5">
                                {toolGroups.map(group => {
                                  const groupAuthMap: Record<string, AuthConfig[]> = (() => {
                                    const key = compositeId ?? specId
                                    if (!key) return {}
                                    try {
                                      const raw = sessionStorage.getItem(`helios_groups_${key}`)
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
                                  const oauth2TokenUrl = isOAuth2ClientCreds
                                    ? (groupAuthConfigs.find(c => c.type === "oauth2")?.tokenUrl ?? authContext?.tokenUrl)
                                    : undefined

                                  const providerUrl = lookupProviderKeyUrl(group.name)
                                  return (
                                    <div key={group.name} className="flex flex-col gap-2">
                                      <div className="flex items-center justify-between">
                                        <span className="inline-flex items-center gap-1.5 font-[family-name:--font-cinzel] text-[13px] tracking-wider text-white/90">
                                          {group.name}
                                          {providerUrl ? (
                                            <InfoBubble
                                              externalUrl={providerUrl}
                                              quick={`Open the ${group.name} developer dashboard to grab the credentials for this integration.`}
                                              size={13}
                                            />
                                          ) : (
                                            <InfoBubble
                                              chapter="api-keys"
                                              quick="Where to find API keys for any provider — including how to hunt down dev dashboards Helios doesn't index by default."
                                              size={13}
                                            />
                                          )}
                                        </span>
                                        <span className={cn(
                                          "font-[family-name:--font-geist-mono] text-[10px] tracking-wider",
                                          savedKeyStatus[group.name] ? "text-[#6EE7B7]" : "text-red-400/70"
                                        )}>
                                          {savedKeyStatus[group.name] ? "● Provided" : "○ Missing"}
                                        </span>
                                      </div>

                                      {isOAuth2ClientCreds && oauth2TokenUrl ? (
                                        <div className="flex flex-col gap-2">
                                          <span className="font-[family-name:--font-cormorant] text-[13px] italic text-white/55">
                                            OAuth 2.0 — enter your app credentials to connect:
                                          </span>
                                          <input type="text" placeholder="Client ID"
                                            value={oauth2Fields[group.name]?.clientId ?? ""}
                                            onChange={e => setOauth2Fields(prev => ({ ...prev, [group.name]: { ...prev[group.name], clientId: e.target.value } }))}
                                            className="glass-input rounded-lg px-3 py-2 text-[12px] font-[family-name:--font-geist-mono]"
                                          />
                                          <div className="flex gap-2">
                                            <input type="password" placeholder="Client Secret"
                                              value={oauth2Fields[group.name]?.clientSecret ?? ""}
                                              onChange={e => setOauth2Fields(prev => ({ ...prev, [group.name]: { ...prev[group.name], clientSecret: e.target.value } }))}
                                              className="flex-1 glass-input rounded-lg px-3 py-2 text-[12px] font-[family-name:--font-geist-mono]"
                                            />
                                            <button
                                              onClick={() => handleOAuth2Connect(group.name, oauth2TokenUrl)}
                                              disabled={!oauth2Fields[group.name]?.clientId?.trim() || !oauth2Fields[group.name]?.clientSecret?.trim() || isConnecting === group.name}
                                              className={cn(
                                                "font-[family-name:--font-cinzel] text-[10px] tracking-widest px-4 py-2 rounded-lg transition-colors whitespace-nowrap",
                                                !oauth2Fields[group.name]?.clientId?.trim() || !oauth2Fields[group.name]?.clientSecret?.trim() || isConnecting === group.name
                                                  ? "bg-white/[0.05] text-white/25 cursor-not-allowed"
                                                  : "btn-gold cursor-pointer"
                                              )}
                                            >
                                              {isConnecting === group.name ? "..." : "Connect"}
                                            </button>
                                          </div>
                                          {oauth2ConnectStatus[group.name]?.msg && (
                                            <span className={cn(
                                              "font-[family-name:--font-geist-mono] text-[10px]",
                                              oauth2ConnectStatus[group.name].ok ? "text-[#6EE7B7]" : "text-red-400"
                                            )}>
                                              {oauth2ConnectStatus[group.name].ok ? "✓ " : "✗ "}{oauth2ConnectStatus[group.name].msg}
                                            </span>
                                          )}
                                        </div>
                                      ) : isOAuth2AuthCode ? (
                                        <div className="flex flex-col gap-2">
                                          <span className="font-[family-name:--font-cormorant] text-[13px] italic text-white/55">
                                            OAuth 2.0 — paste your access token below.
                                          </span>
                                          <div className="flex gap-2">
                                            <input type="password"
                                              placeholder={savedKeyStatus[group.name] ? "Update token..." : "Paste access_token..."}
                                              value={apiKeys[group.name] ?? ""}
                                              onChange={e => setApiKeys(prev => ({ ...prev, [group.name]: e.target.value }))}
                                              className="flex-1 glass-input rounded-lg px-3 py-2 text-[12px] font-[family-name:--font-geist-mono]"
                                            />
                                            <button onClick={() => handleSaveKey(group.name)}
                                              disabled={!apiKeys[group.name]?.trim() || isSavingKey === group.name}
                                              className={cn(
                                                "font-[family-name:--font-cinzel] text-[10px] tracking-widest px-4 py-2 rounded-lg transition-colors",
                                                !apiKeys[group.name]?.trim() || isSavingKey === group.name
                                                  ? "bg-white/[0.05] text-white/25 cursor-not-allowed"
                                                  : "btn-gold cursor-pointer"
                                              )}
                                            >
                                              {isSavingKey === group.name ? "..." : "Save"}
                                            </button>
                                          </div>
                                        </div>
                                      ) : isBasicAuth ? (
                                        (() => {
                                          const labels = lookupBasicAuthLabels(group.name)
                                          const fields = basicAuthFields[group.name]
                                          const basicDisabled = !fields?.user?.trim() || !fields?.pass?.trim() || isSavingKey === group.name
                                          return (
                                            <div className="flex flex-col gap-2">
                                              <span className="font-[family-name:--font-cormorant] text-[13px] italic text-white/55">
                                                Basic Auth — enter your credentials below.
                                              </span>
                                              <input type="text"
                                                placeholder={labels.user}
                                                value={fields?.user ?? ""}
                                                onChange={e => setBasicAuthFields(prev => ({ ...prev, [group.name]: { user: e.target.value, pass: prev[group.name]?.pass ?? "" } }))}
                                                className="glass-input rounded-lg px-3 py-2 text-[12px] font-[family-name:--font-geist-mono]"
                                              />
                                              <div className="flex gap-2">
                                                <input type="password"
                                                  placeholder={labels.pass}
                                                  value={fields?.pass ?? ""}
                                                  onChange={e => setBasicAuthFields(prev => ({ ...prev, [group.name]: { user: prev[group.name]?.user ?? "", pass: e.target.value } }))}
                                                  className="flex-1 glass-input rounded-lg px-3 py-2 text-[12px] font-[family-name:--font-geist-mono]"
                                                />
                                                <button
                                                  onClick={() => handleSaveBasicAuth(group.name)}
                                                  disabled={basicDisabled}
                                                  className={cn(
                                                    "font-[family-name:--font-cinzel] text-[10px] tracking-widest px-4 py-2 rounded-lg transition-colors whitespace-nowrap",
                                                    basicDisabled ? "bg-white/[0.05] text-white/25 cursor-not-allowed" : "btn-gold cursor-pointer"
                                                  )}
                                                >
                                                  {isSavingKey === group.name ? "..." : "Save"}
                                                </button>
                                              </div>
                                              {labels.hint && (
                                                <span className="font-[family-name:--font-cormorant] text-[12px] italic text-white/40">
                                                  {labels.hint}
                                                </span>
                                              )}
                                            </div>
                                          )
                                        })()
                                      ) : (
                                        <div className="flex gap-2">
                                          <input type="password"
                                            placeholder={savedKeyStatus[group.name] ? "Update key..." : "Enter API key..."}
                                            value={apiKeys[group.name] ?? ""}
                                            onChange={e => setApiKeys(prev => ({ ...prev, [group.name]: e.target.value }))}
                                            className="flex-1 glass-input rounded-lg px-3 py-2 text-[12px] font-[family-name:--font-geist-mono]"
                                          />
                                          <button onClick={() => handleSaveKey(group.name)}
                                            disabled={!apiKeys[group.name]?.trim() || isSavingKey === group.name}
                                            className={cn(
                                              "font-[family-name:--font-cinzel] text-[10px] tracking-widest px-4 py-2 rounded-lg transition-colors",
                                              !apiKeys[group.name]?.trim() || isSavingKey === group.name
                                                ? "bg-white/[0.05] text-white/25 cursor-not-allowed"
                                                : "btn-gold cursor-pointer"
                                            )}
                                          >
                                            {isSavingKey === group.name ? "..." : "Save"}
                                          </button>
                                        </div>
                                      )}
                                    </div>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        </div>
                        </div>
                        </div>

                        {/* Footer */}
                        <div className="border-t border-white/[0.18] p-3">
                          <button
                            onClick={() => { handleApply(); setPanelOpen(false) }}
                            className="w-full btn-gold font-[family-name:--font-cinzel] py-2.5 text-[12px] tracking-[0.14em] rounded-xl cursor-pointer"
                          >
                            Apply & Reset Chat
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>

                <button
                  onClick={() => setMessages([])}
                  className="font-[family-name:--font-cinzel] text-[11px] tracking-[0.14em] glass px-4 py-2 rounded-xl
                    text-white/60 hover:text-white/80 hover:bg-white/[0.10] transition-all duration-200 cursor-pointer"
                >
                  Reset Chat
                </button>
              </div>

              {/* Input box */}
              <div className={cn(
                "relative flex items-end gap-2 glass rounded-2xl p-2 overflow-hidden transition-all duration-200",
                "focus-within:border-[#C9A84C]/40 focus-within:shadow-[0_0_0_2px_rgba(201,168,76,0.10)]"
              )}>
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Test your tools..."
                  rows={1}
                  disabled={isLoading}
                  className="flex-1 resize-none bg-transparent px-3 py-2 text-[17px] font-[family-name:--font-cormorant] text-white/88
                    placeholder:text-white/25 focus:outline-none min-h-[40px] max-h-[200px] leading-relaxed"
                />
                <button
                  type="button"
                  aria-label="Send message"
                  onClick={handleSend}
                  disabled={!input.trim() || isLoading}
                  className={cn(
                    "flex-shrink-0 p-2.5 rounded-xl transition-all duration-200",
                    input.trim() && !isLoading
                      ? "btn-gold cursor-pointer"
                      : "bg-white/[0.05] text-white/20 cursor-not-allowed"
                  )}
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>

            </div>
          </div>{/* end input area */}
        </div>
      </div>
    </div>
  )
}

export default function SandboxPage() {
  return (
    <Suspense>
      <SandboxContent />
    </Suspense>
  )
}
