"use client"
import { Suspense, useState, useEffect, useLayoutEffect, useRef } from "react"
import { createPortal } from "react-dom"
import { useSearchParams, useRouter } from "next/navigation"
import { Send, User, ChevronDown, ChevronRight } from "lucide-react"
import Link from "next/link"
import { isLoggedIn, getAuthHeaders } from "@/lib/auth"
import { InfoBubble } from "@/app/components/InfoBubble"
import { MotionStarsBackground } from "@/app/components/MotionStars"
import RandomPlanet from "@/components/ui/random-planet"
import { getServerStarColor } from "@/lib/serverStars"
import { lookupProviderKeyUrl, lookupBasicAuthLabels } from "@/lib/providerKeys"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import rehypeRaw from "rehype-raw"

// ── Utilities ──────────────────────────────────────────────────────────────────
const cn = (...classes: (string | undefined | null | false)[]) => classes.filter(Boolean).join(" ")

const METHOD_BADGE_STYLES: Record<string, string> = {
  GET: "method-get", POST: "method-post", PUT: "method-put",
  PATCH: "method-patch", DELETE: "method-delete",
}

// ── Types (mirrored from sandbox) ──────────────────────────────────────────────
interface Message {
  id: string
  role: "user" | "assistant" | "tool_call"
  content: string
  toolDetails?: { name: string; input: Record<string, unknown> }[]
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

interface Integration {
  integrationId: string
  authType: "api_key" | "apiKey" | "oauth2" | "bearer_token" | "basic_auth" | "none"
  oauthFlow?: "client_credentials" | "authorization_code" | "implicit" | "password"
  tokenUrl?: string
  authorizationUrl?: string
  scopes?: string[]
  keyPresent: boolean
  tokenExpired: boolean
}

// ── Galaxy generation ──────────────────────────────────────────────────────────
function xorshift32(seed: number) {
  let s = (seed >>> 0) || 31337
  return () => {
    s ^= s << 13; s ^= s >> 17; s ^= s << 5
    return (s >>> 0) / 0x100000000
  }
}

function hashStr(str: string): number {
  let h = 5381
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0
  return Math.abs(h) || 31337
}

function drawGalaxy(canvas: HTMLCanvasElement, seed: number): void {
  const ctx = canvas.getContext("2d")!
  const W = canvas.width
  const H = canvas.height
  const rng = xorshift32(seed)

  // 1. Deep space base
  ctx.fillStyle = "#020810"
  ctx.fillRect(0, 0, W, H)

  // 2. Pick nebula color scheme from seed
  const bias = rng()
  let nR: number, nG: number, nB: number
  if (bias < 0.33) { nR = 18; nG = 65; nB = 130 }         // electric blue-teal
  else if (bias < 0.66) { nR = 55; nG = 25; nB = 135 }    // violet-blue
  else { nR = 30; nG = 80; nB = 155 }                       // steel blue

  // 3. Milky Way band — rotated cloud sweep
  const bandAngle = (rng() * 50 - 25) * (Math.PI / 180)
  const bandCY = H * (0.28 + rng() * 0.44)
  const numClouds = 14 + Math.floor(rng() * 6)

  ctx.save()
  ctx.translate(W / 2, bandCY)
  ctx.rotate(bandAngle)
  for (let i = 0; i < numClouds; i++) {
    const t = (i / numClouds) - 0.5
    const cx = t * W * 1.4
    const cy = (rng() - 0.5) * H * 0.22
    const rx = W * (0.07 + rng() * 0.14)
    const ry = H * (0.055 + rng() * 0.09)
    const op = 0.045 + rng() * 0.11
    const bright = 0.45 + rng() * 0.55
    const r = Math.floor(nR * bright + rng() * 15)
    const g = Math.floor(nG * bright + rng() * 10)
    const b = Math.floor(nB * bright + rng() * 20)
    const maxR = Math.max(rx, ry)
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR)
    grad.addColorStop(0, `rgba(${r},${g},${b},${op})`)
    grad.addColorStop(0.45, `rgba(${r},${g},${b},${op * 0.45})`)
    grad.addColorStop(1, `rgba(${r},${g},${b},0)`)
    ctx.save()
    ctx.translate(cx, cy)
    ctx.scale(1, ry / rx)
    ctx.beginPath()
    ctx.arc(0, 0, rx, 0, Math.PI * 2)
    ctx.fillStyle = grad
    ctx.fill()
    ctx.restore()
  }
  ctx.restore()

  // 4. Galaxy core glow
  const cX = W * (0.25 + rng() * 0.5)
  const cY = H * (0.25 + rng() * 0.5)
  const coreGrad = ctx.createRadialGradient(cX, cY, 0, cX, cY, W * 0.32)
  coreGrad.addColorStop(0, `rgba(${nR + 35},${nG + 50},${nB + 25},0.20)`)
  coreGrad.addColorStop(0.28, `rgba(${nR},${nG},${nB},0.09)`)
  coreGrad.addColorStop(0.65, `rgba(${nR},${nG},${nB},0.03)`)
  coreGrad.addColorStop(1, "rgba(0,0,0,0)")
  ctx.fillStyle = coreGrad
  ctx.fillRect(0, 0, W, H)
}

// ── Galaxy Canvas ─────────────────────────────────────────────────────────────
function GalaxyCanvas({ seed }: { seed: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const draw = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
      drawGalaxy(canvas, seed)
    }
    draw()
    window.addEventListener("resize", draw)
    // visualViewport fires on browser zoom (Ctrl +/-) more reliably than the
    // window resize event in some browsers — keeps the nebula filling the screen.
    window.visualViewport?.addEventListener("resize", draw)
    return () => {
      window.removeEventListener("resize", draw)
      window.visualViewport?.removeEventListener("resize", draw)
    }
  }, [seed])

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none"
      style={{ zIndex: -10 }}
    />
  )
}

// ── Try page content ──────────────────────────────────────────────────────────
function TryContent() {
  const searchParams = useSearchParams()
  const specId = searchParams.get("specId")
  const router = useRouter()

  // Galaxy
  const galaxySeed = specId ? hashStr(specId) : 31337
  const starColor = specId ? getServerStarColor(specId) : "#ffcf6f"

  // Sandbox state (same as sandbox page)
  const [sessionId, setSessionId] = useState("")
  const [allTools, setAllTools] = useState<Tool[]>([])
  const [toolToggles, setToolToggles] = useState<Record<string, boolean>>({})
  const [activeTools, setActiveTools] = useState<Tool[]>([])
  const [authContext, setAuthContext] = useState<AuthContext | undefined>(undefined)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [toolGroupMap, setToolGroupMap] = useState<Record<string, string>>({})
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [expandedToolCalls, setExpandedToolCalls] = useState<Set<string>>(new Set())
  const [panelOpen, setPanelOpen] = useState(false)
  const [panelTab, setPanelTab] = useState<"tools" | "keys">("tools")
  const [panelContentVisible, setPanelContentVisible] = useState(true)
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({})
  const [savedKeyStatus, setSavedKeyStatus] = useState<Record<string, boolean>>({})
  const [isSavingKey, setIsSavingKey] = useState<string | null>(null)
  const [oauth2Fields, setOauth2Fields] = useState<Record<string, { clientId: string; clientSecret: string }>>({})
  const [basicAuthFields, setBasicAuthFields] = useState<Record<string, { user: string; pass: string }>>({})
  const [oauth2ConnectStatus, setOauth2ConnectStatus] = useState<Record<string, { ok: boolean; msg: string }>>({})
  const [isConnecting, setIsConnecting] = useState<string | null>(null)
  const [integrations, setIntegrations] = useState<Integration[]>([])
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

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const panelTabTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const headerRef = useRef<HTMLDivElement>(null)
  const chatRef = useRef<HTMLDivElement>(null)
  const inputAreaRef = useRef<HTMLDivElement>(null)

  // Auth guard
  useEffect(() => {
    if (!isLoggedIn()) { router.replace("/auth"); return }
  }, [router])

  // Start session (try mode — unrestricted, every method executes live)
  useEffect(() => {
    if (!specId) return

    const raw = sessionStorage.getItem(`helios_try_session_${specId}`)
    if (raw) {
      try {
        const parsed = JSON.parse(raw)
        const { tools, sessionId: sid, authContext: cachedAuthCtx } = parsed
        // Pre-fix caches don't have authContext — skip them and refetch so the
        // API Keys tab gets the oauth2/basic_auth context it needs.
        const hasAuthCtxField = Object.prototype.hasOwnProperty.call(parsed, "authContext")
        if (sid && hasAuthCtxField) {
          setSessionId(sid)
          setAllTools(tools ?? [])
          setActiveTools((tools ?? []).filter((t: Tool) => t.enabled !== false))
          if (cachedAuthCtx) setAuthContext(cachedAuthCtx)
          const toggles: Record<string, boolean> = {}
            ; (tools ?? []).forEach((t: Tool) => { toggles[t.function.name] = t.enabled ?? true })
          setToolToggles(toggles)
          return
        }
      } catch { /* fall through to fresh start */ }
    }

    fetch("http://localhost:8000/api/try/start", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAuthHeaders() },
      body: JSON.stringify({ specId }),
    })
      .then(res => res.json())
      .then(data => {
        if (data.error) {
          setMessages([{ id: Date.now().toString(), role: "assistant", content: `Failed to load server: ${data.error}`, timestamp: new Date() }])
          return
        }
        const tools: Tool[] = data.tools ?? []
        sessionStorage.setItem(`helios_try_session_${specId}`, JSON.stringify({ sessionId: data.sessionId, tools, authContext: data.authContext }))
        setSessionId(data.sessionId)
        setAllTools(tools)
        setActiveTools(tools.filter(t => t.enabled !== false))
        if (data.authContext) setAuthContext(data.authContext)
        const toggles: Record<string, boolean> = {}
        tools.forEach((t: Tool) => { toggles[t.function.name] = t.enabled ?? true })
        setToolToggles(toggles)
      })
      .catch(() => {
        setMessages([{ id: Date.now().toString(), role: "assistant", content: "Could not reach the server.", timestamp: new Date() }])
      })
  }, [specId])

  // Integrations fetch when keys panel opens — matches the /keys page so saves land under the correct integrationId
  const loadIntegrations = () => {
    if (!specId) return
    fetch(`http://localhost:8000/api/servers/${encodeURIComponent(specId)}/keys`, { headers: getAuthHeaders() })
      .then(res => res.json())
      .then(data => {
        const list: Integration[] = data.integrations ?? []
        setIntegrations(list)
        setSavedKeyStatus(Object.fromEntries(list.map(i => [i.integrationId, i.keyPresent && !i.tokenExpired])))
      })
      .catch(() => { })
  }
  useEffect(() => {
    if (!panelOpen || panelTab !== "keys" || !specId) return
    loadIntegrations()
  }, [panelOpen, panelTab, specId])

  // Auto-scroll
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }) }, [messages])

  // Textarea resize
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto"
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + "px"
    }
  }, [input])

  // Anime.js entrance animation
  useEffect(() => {
    let cancelled = false
    import("animejs").then(({ createTimeline }) => {
      if (cancelled) return
      const tl = createTimeline({ defaults: { ease: "outExpo" } })
      if (headerRef.current) tl.add(headerRef.current, { opacity: [0, 1], y: [-18, 0], duration: 650 }, 0)
      if (chatRef.current) tl.add(chatRef.current, { opacity: [0, 1], duration: 700 }, 180)
      if (inputAreaRef.current) tl.add(inputAreaRef.current, { opacity: [0, 1], y: [18, 0], duration: 600 }, 280)
    })
    return () => { cancelled = true }
  }, [])

  // Animate new messages in
  useEffect(() => {
    if (messages.length === 0) return
    const last = messages[messages.length - 1]
    const el = document.querySelector(`[data-msg="${last.id}"]`)
    if (!el) return
    import("animejs").then(({ animate }) => {
      animate(el, {
        opacity: [0, 1],
        y: [14, 0],
        duration: 400,
        ease: "outExpo",
      })
    })
  }, [messages])

  // Tools grouping
  const toolGroups = (() => {
    if (allTools.length === 0) return []
    if (Object.keys(toolGroupMap).length > 0) {
      const seen: string[] = []
      const map: Record<string, Tool[]> = {}
      allTools.forEach(t => {
        const g = toolGroupMap[t.function.name] ?? "Other"
        if (!map[g]) { map[g] = []; seen.push(g) }
        map[g].push(t)
      })
      return seen.map(name => ({ name, tools: map[name] }))
    }
    return [{ name: specId ?? "Session", tools: allTools }]
  })()

  const enabledCount = Object.values(toolToggles).filter(Boolean).length

  const switchPanelTab = (tab: "tools" | "keys") => {
    if (tab === panelTab) return
    if (panelTabTimer.current) clearTimeout(panelTabTimer.current)
    setPanelContentVisible(false)
    panelTabTimer.current = setTimeout(() => {
      setPanelTab(tab)
      panelTabTimer.current = setTimeout(() => setPanelContentVisible(true), 120)
    }, 150)
  }

  const handleApply = async () => {
    const pending = Object.entries(basicAuthFields).filter(
      ([, f]) => f?.user?.trim() && f?.pass?.trim()
    )
    if (pending.length > 0) {
      await Promise.all(pending.map(([id]) => handleSaveBasicAuth(id)))
    }
    setActiveTools(allTools.filter(t => toolToggles[t.function.name]))
    setMessages([])
  }

  const startTrySession = async (): Promise<{ sessionId: string; tools: Tool[] } | null> => {
    try {
      const res = await fetch("http://localhost:8000/api/try/start", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ specId }),
      })
      const data = await res.json()
      if (data.error) return null
      const tools: Tool[] = data.tools ?? []
      sessionStorage.setItem(`helios_try_session_${specId}`, JSON.stringify({ sessionId: data.sessionId, tools, authContext: data.authContext }))
      setSessionId(data.sessionId)
      setAllTools(tools)
      setActiveTools(tools.filter(t => t.enabled !== false))
      if (data.authContext) setAuthContext(data.authContext)
      const toggles: Record<string, boolean> = {}
      tools.forEach(t => { toggles[t.function.name] = t.enabled ?? true })
      setToolToggles(toggles)
      return { sessionId: data.sessionId, tools }
    } catch {
      return null
    }
  }

  const sendChatRequest = async (sid: string, tools: Tool[], cleanHistory: Array<{ role: "user" | "assistant"; content: string }>, messageText: string, signal: AbortSignal) => {
    return fetch("http://localhost:8000/api/try/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAuthHeaders() },
      body: JSON.stringify({ sessionId: sid, tools, history: cleanHistory, message: messageText, authContext }),
      signal,
    })
  }

  const handleSend = async () => {
    if (!input.trim() || isLoading) return
    const messageText = input.trim()
    const userMsg: Message = { id: Date.now().toString(), role: "user", content: messageText, timestamp: new Date() }
    setMessages(prev => [...prev, userMsg])
    setInput("")
    setIsLoading(true)

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 60000)
    const cleanHistory = messages
      .filter(m => m.role === "user" || m.role === "assistant")
      .map(m => ({ role: m.role as "user" | "assistant", content: m.content }))

    try {
      let res = await sendChatRequest(sessionId, activeTools, cleanHistory, messageText, controller.signal)

      // Session expired (backend MCP lost our transport) → clear cache, start a fresh session, retry once
      if (res.status === 410) {
        sessionStorage.removeItem(`helios_try_session_${specId}`)
        const restarted = await startTrySession()
        if (restarted) {
          const freshActive = restarted.tools.filter(t => t.enabled !== false)
          res = await sendChatRequest(restarted.sessionId, freshActive, [], messageText, controller.signal)
        }
      }

      clearTimeout(timeout)
      const data = await res.json()

      if (!res.ok) {
        const is429 = res.status === 429
        const is410 = res.status === 410
        setMessages(prev => [...prev, {
          id: Date.now().toString(), role: "assistant",
          content: is429 ? "Rate limit reached — wait a moment and try again."
            : is410 ? "Could not recover session — try refreshing the page."
              : (data?.error ?? "Something went wrong."),
          timestamp: new Date(),
        }])
        setIsLoading(false)
        return
      }

      const allToolCalls = (data.history ?? [])
        .filter((m: { role: string; content: unknown }) => m.role === "assistant" && Array.isArray(m.content))
        .flatMap((m: { content: Array<{ type: string; name?: string; input?: Record<string, unknown> }> }) =>
          (m.content).filter(b => b.type === "tool_use").map(b => ({ name: b.name!, input: b.input ?? {} }))
        )
      const newMessages: Message[] = []
      if (allToolCalls.length > 0) {
        newMessages.push({
          id: Date.now().toString() + "-tool", role: "tool_call",
          content: allToolCalls.map((t: { name: string }) => t.name).join("  ·  "),
          toolDetails: allToolCalls, timestamp: new Date(),
        })
      }
      const reply = typeof data.reply === "string" && data.reply.trim() ? data.reply : "No response received."
      newMessages.push({ id: Date.now().toString(), role: "assistant", content: reply, timestamp: new Date() })
      setMessages(prev => [...prev, ...newMessages])
      setIsLoading(false)
    } catch (err: any) {
      clearTimeout(timeout)
      setMessages(prev => [...prev, {
        id: Date.now().toString(), role: "assistant",
        content: err?.name === "AbortError" ? "Request timed out." : "Failed to reach the server.",
        timestamp: new Date(),
      }])
      setIsLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  const handleSaveKey = async (integrationId: string) => {
    const key = apiKeys[integrationId]
    if (!key?.trim()) return
    setIsSavingKey(integrationId)
    try {
      const res = await fetch(`http://localhost:8000/api/keys/${encodeURIComponent(integrationId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ key: key.trim() }),
      })
      if (res.ok) {
        setSavedKeyStatus(prev => ({ ...prev, [integrationId]: true }))
        setApiKeys(prev => ({ ...prev, [integrationId]: "" }))
        loadIntegrations()
      }
    } catch { /* ignore */ }
    setIsSavingKey(null)
  }

  const handleSaveBasicAuth = async (integrationId: string) => {
    const fields = basicAuthFields[integrationId]
    if (!fields?.user?.trim() || !fields?.pass?.trim()) return
    setIsSavingKey(integrationId)
    try {
      const res = await fetch(`http://localhost:8000/api/keys/${encodeURIComponent(integrationId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ key: `${fields.user.trim()}:${fields.pass.trim()}` }),
      })
      if (res.ok) {
        setSavedKeyStatus(prev => ({ ...prev, [integrationId]: true }))
        setBasicAuthFields(prev => ({ ...prev, [integrationId]: { user: "", pass: "" } }))
        loadIntegrations()
      }
    } catch { /* ignore */ }
    setIsSavingKey(null)
  }

  const handleOAuth2Connect = async (integration: Integration) => {
    const { integrationId, oauthFlow, tokenUrl, authorizationUrl, scopes } = integration
    const fields = oauth2Fields[integrationId]
    if (!fields?.clientId?.trim() || !fields?.clientSecret?.trim()) return
    setIsConnecting(integrationId)
    setOauth2ConnectStatus(prev => ({ ...prev, [integrationId]: { ok: false, msg: "" } }))
    try {
      if (oauthFlow === "client_credentials") {
        const res = await fetch("http://localhost:8000/api/oauth2/client-credentials", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...getAuthHeaders() },
          body: JSON.stringify({ integrationId, clientId: fields.clientId.trim(), clientSecret: fields.clientSecret.trim(), tokenUrl }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? "Connection failed")
      } else {
        // Authorization Code popup
        const res = await fetch("http://localhost:8000/api/oauth2/authorize", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...getAuthHeaders() },
          body: JSON.stringify({ integrationId, clientId: fields.clientId.trim(), clientSecret: fields.clientSecret.trim(), authorizationUrl, tokenUrl, scopes }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? "Failed to build auth URL")
        const popup = window.open(data.url, "helios_oauth", "width=520,height=640,scrollbars=yes")
        if (!popup) throw new Error("Popup blocked — allow popups and retry.")
        await new Promise<void>((resolve, reject) => {
          const handler = (event: MessageEvent) => {
            if (!event.data?.heliosOAuth) return
            window.removeEventListener("message", handler)
            clearInterval(pollClosed)
            if (event.data.ok) resolve()
            else reject(new Error(event.data.message ?? "Authorization failed"))
          }
          window.addEventListener("message", handler)
          const pollClosed = setInterval(() => {
            if (popup.closed) {
              window.removeEventListener("message", handler)
              clearInterval(pollClosed)
              reject(new Error("Window closed before authorization completed"))
            }
          }, 500)
        })
      }
      setOauth2ConnectStatus(prev => ({ ...prev, [integrationId]: { ok: true, msg: "Connected" } }))
      setSavedKeyStatus(prev => ({ ...prev, [integrationId]: true }))
      setOauth2Fields(prev => ({ ...prev, [integrationId]: { clientId: "", clientSecret: "" } }))
      loadIntegrations()
    } catch (err: any) {
      setOauth2ConnectStatus(prev => ({ ...prev, [integrationId]: { ok: false, msg: err?.message ?? "Request failed" } }))
    }
    setIsConnecting(null)
  }

  if (!specId) {
    return (
      <div className="flex flex-col h-screen w-full relative overflow-hidden">
        <GalaxyCanvas seed={galaxySeed} />
        <div className="fixed inset-0 pointer-events-none" style={{ zIndex: -9 }}>
          <MotionStarsBackground transparent />
        </div>

        {/* Left-docked procedural planet — over stars, under UI */}
        <div
          className="fixed left-[-1100px] top-1/2 -translate-y-1/2 pointer-events-none"
          style={{ zIndex: 1 }}
          aria-hidden="true"
        >
          <RandomPlanet size={1600} rotationSpeed={0.045} color={starColor} seed={galaxySeed} />
        </div>

        <div className="relative z-30 flex items-center px-8 h-[93px] flex-shrink-0">
          <div className="flex-1 flex items-center">
            <div className="relative">
              <Link href="/" className="absolute inset-0 cursor-pointer z-10" aria-label="Home" />
              <span
                className="font-[family-name:--font-cinzel] font-semibold text-[32px] tracking-[0.35em] pr-[0.35em] select-none pointer-events-none"
                style={{ color: "#ffffff", textShadow: "0 0 40px rgba(255,255,255,0.15)" }}
              >
                HELIOS
              </span>
            </div>
          </div>
          <div className="flex-1" />
          <div className="flex-1 flex justify-end">
            <Link href="/download">
              <button
                className="font-[family-name:--font-cinzel] text-[14px] tracking-[0.14em] px-6 py-2.5 rounded-xl text-white/45 hover:text-white/75 transition-all duration-200 cursor-pointer"
                style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.10)", backdropFilter: "blur(8px)" }}
              >
                ← Dashboard
              </button>
            </Link>
          </div>
        </div>

        <div className="relative z-10 flex-1 flex items-center justify-center px-8">
          <div className="glass rounded-2xl px-10 py-12 max-w-[520px] w-full flex flex-col items-center text-center gap-4">
            <p className="font-[family-name:--font-cinzel] text-[16px] tracking-[0.16em] text-white/55">
              No server selected
            </p>
            <p className="font-[family-name:--font-cormorant] text-[17px] italic text-white/35 leading-relaxed">
              The Try page runs a live MCP session against one of your generated servers.
              Pick a server from the dashboard to start a session.
            </p>
            <Link
              href="/download"
              className="mt-3 btn-gold rounded-xl px-7 py-2.5 font-[family-name:--font-cinzel] text-[12px] tracking-[0.14em] cursor-pointer"
            >
              Go to Dashboard
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen w-full relative overflow-hidden">

      {/* Galaxy background — static canvas: nebula, core glow */}
      <GalaxyCanvas seed={galaxySeed} />

      {/* Static multi-layer starfield. Masked so stars inside the sphere's disc are clipped. */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          zIndex: -9,
          WebkitMaskImage: "radial-gradient(circle 548px at -110px 50%, transparent 99%, black 100%)",
          maskImage: "radial-gradient(circle 548px at -110px 50%, transparent 99%, black 100%)",
        }}
      >
        <MotionStarsBackground transparent />
      </div>

      {/* Left-docked procedural star — over stars, under UI */}
      <div
        className="fixed left-[-1100px] top-1/2 -translate-y-1/2 pointer-events-none"
        style={{ zIndex: 1 }}
        aria-hidden="true"
      >
        <RandomPlanet size={1100} rotationSpeed={0.010} color={starColor} seed={galaxySeed} />
      </div>

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div ref={headerRef} className="relative z-30 flex items-center px-8 h-[93px] flex-shrink-0" style={{ opacity: 0 }}>
        {/* Left — logo */}
        <div className="flex-1 flex items-center">
          <div className="relative">
            <Link href="/" className="absolute inset-0 cursor-pointer z-10" aria-label="Home" />
            <span
              className="font-[family-name:--font-cinzel] font-semibold text-[32px] tracking-[0.35em] pr-[0.35em] select-none pointer-events-none"
              style={{ color: "#ffffff", textShadow: "0 0 40px rgba(255,255,255,0.15)" }}
            >
              HELIOS
            </span>
          </div>
        </div>

        {/* Center — server badge */}
        {specId && (
          <div className="flex items-center gap-3">
            <div
              className="flex items-center gap-2.5 px-5 py-2 rounded-full"
              style={{
                background: "rgba(30, 90, 180, 0.15)",
                border: "1px solid rgba(100, 160, 255, 0.22)",
                backdropFilter: "blur(12px)",
              }}
            >
              {/* Pulsing live dot */}
              <span
                className="inline-block w-1.5 h-1.5 rounded-full"
                style={{
                  background: "oklch(72% 0.15 200)",
                  boxShadow: "0 0 6px 2px oklch(72% 0.15 200 / 0.5)",
                  animation: "star-pulse 2s ease-in-out infinite",
                }}
              />
              <span className="font-[family-name:--font-geist-mono] text-[11px] tracking-[0.16em] text-white/60">
                {specId}
              </span>
              <span
                className="font-[family-name:--font-cinzel] text-[9px] tracking-[0.22em] px-2 py-0.5 rounded-full"
                style={{ background: "rgba(100, 160, 255, 0.12)", color: "oklch(72% 0.15 200)" }}
              >
                LIVE
              </span>
            </div>
          </div>
        )}

        {/* Right — back button */}
        <div className="flex-1 flex justify-end">
          <Link href="/download">
            <button
              className="font-[family-name:--font-cinzel] text-[14px] tracking-[0.14em] px-6 py-2.5 rounded-xl
                text-white/45 hover:text-white/75 transition-all duration-200 cursor-pointer"
              style={{
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.10)",
                backdropFilter: "blur(8px)",
              }}
            >
              ← Dashboard
            </button>
          </Link>
        </div>
      </div>

      {/* ── Body ────────────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-col flex-1 overflow-hidden">

          {/* Messages */}
          <div ref={chatRef} className="flex-1 min-h-0 overflow-y-auto px-4 pt-10 pb-6" style={{ opacity: 0 }}>
            <div className="max-w-[820px] mx-auto space-y-5">

              {messages.map(message => {
                if (message.role === "tool_call") {
                  const isExpanded = expandedToolCalls.has(message.id)
                  return (
                    <div key={message.id} data-msg={message.id} className="flex flex-col gap-0">
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
                        <div className="flex-1 h-px bg-white/[0.10]" />
                        <div className="flex items-center gap-2">
                          {isExpanded
                            ? <ChevronDown size={12} className="text-white/30" />
                            : <ChevronRight size={12} className="text-white/30" />}
                          <span className="font-[family-name:--font-cinzel] text-[10px] tracking-[0.16em] text-white/50 group-hover:text-white/70 transition-colors whitespace-nowrap">
                            {message.toolDetails?.length ?? 1} tool{(message.toolDetails?.length ?? 1) !== 1 ? "s" : ""} called
                          </span>
                          <span className="font-[family-name:--font-geist-mono] text-[10px] text-white/40 whitespace-nowrap hidden sm:inline">
                            {message.content}
                          </span>
                        </div>
                        <div className="flex-1 h-px bg-white/[0.10]" />
                      </button>
                      {isExpanded && message.toolDetails && (
                        <div className="flex flex-col gap-2 pt-2 pb-1 px-1">
                          {message.toolDetails.map((tc, i) => (
                            <div key={i} className="glass rounded-xl px-4 py-3">
                              <div className="font-[family-name:--font-cinzel] text-[11px] tracking-wider text-[#C9A84C]/80 mb-2">{tc.name}</div>
                              {Object.keys(tc.input).length > 0 ? (
                                <pre className="font-[family-name:--font-geist-mono] text-[10px] text-white/55 whitespace-pre-wrap break-all leading-relaxed">
                                  {JSON.stringify(tc.input, null, 2)}
                                </pre>
                              ) : (
                                <span className="font-[family-name:--font-geist-mono] text-[10px] text-white/40">no arguments</span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                }

                return (
                  <div key={message.id} data-msg={message.id} className={cn("flex gap-3", message.role === "user" ? "justify-end" : "justify-start")}>
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
                    <div className={cn(
                      "max-w-[72%] overflow-hidden",
                      message.role === "user" ? "rounded-2xl rounded-tr-sm" : "rounded-2xl rounded-tl-sm"
                    )} style={{
                      backdropFilter: "blur(14px) saturate(1.6) brightness(0.55)",
                      WebkitBackdropFilter: "blur(14px) saturate(1.6) brightness(0.55)",
                      backgroundColor: "rgba(255,255,255,0.05)",
                    }}>
                      <div className={cn(
                        "px-4 py-3",
                        message.role === "user" ? "border border-white/[0.13] text-white/88" : "text-white/83"
                      )}>
                        {message.role === "assistant" ? (
                          <div className="font-[family-name:--font-cormorant] text-[17px] leading-relaxed prose-sandbox">
                            <ReactMarkdown
                              remarkPlugins={[remarkGfm]}
                              rehypePlugins={[rehypeRaw]}
                              components={{
                                p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                                h1: ({ children }) => <h1 className="font-[family-name:--font-cinzel] text-[18px] tracking-wider text-white/95 mb-3 mt-1">{children}</h1>,
                                h2: ({ children }) => <h2 className="font-[family-name:--font-cinzel] text-[16px] tracking-wider text-white/88 mb-2 mt-1">{children}</h2>,
                                h3: ({ children }) => <h3 className="font-[family-name:--font-cinzel] text-[14px] tracking-wider text-white/82 mb-1 mt-1">{children}</h3>,
                                strong: ({ children }) => <strong className="text-white/95 font-semibold">{children}</strong>,
                                em: ({ children }) => <em className="text-white/70 italic">{children}</em>,
                                ul: ({ children }) => <ul className="list-disc list-inside space-y-1 mb-2 text-white/78">{children}</ul>,
                                ol: ({ children }) => <ol className="list-decimal list-inside space-y-1 mb-2 text-white/78">{children}</ol>,
                                li: ({ children }) => <li className="leading-relaxed">{children}</li>,
                                code: ({ children, className }) => {
                                  const isBlock = className?.includes("language-")
                                  return isBlock
                                    ? <code className="block font-[family-name:--font-geist-mono] text-[13px] bg-black/35 border border-white/[0.09] rounded-lg px-3 py-2 my-2 text-white/65 whitespace-pre-wrap overflow-x-auto">{children}</code>
                                    : <code className="font-[family-name:--font-geist-mono] text-[13px] bg-black/28 border border-white/[0.09] rounded px-1.5 py-0.5 text-[#C9A84C]/75">{children}</code>
                                },
                                pre: ({ children }) => <pre className="my-2">{children}</pre>,
                                a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-[#C9A84C]/75 hover:text-[#C9A84C] underline underline-offset-2 transition-colors">{children}</a>,
                                table: ({ children }) => <table className="w-full text-[14px] border-collapse my-2">{children}</table>,
                                th: ({ children }) => <th className="font-[family-name:--font-cinzel] text-[11px] tracking-wider text-white/55 border border-white/[0.10] px-3 py-1.5 bg-white/[0.04]">{children}</th>,
                                td: ({ children }) => <td className="border border-white/[0.09] px-3 py-1.5 text-white/72">{children}</td>,
                              }}
                            >{message.content}</ReactMarkdown>
                          </div>
                        ) : (
                          <p className="leading-relaxed whitespace-pre-wrap break-words font-[family-name:--font-cormorant] text-[17px]">
                            {message.content}
                          </p>
                        )}
                      </div>
                    </div>
                    {message.role === "user" && (
                      <div className="flex-shrink-0 w-8 h-8 rounded-full overflow-hidden flex items-center justify-center"
                        style={{
                          backdropFilter: "blur(12px) saturate(1.4) brightness(0.6)",
                          WebkitBackdropFilter: "blur(12px) saturate(1.4) brightness(0.6)",
                          backgroundColor: "rgba(255,255,255,0.06)",
                          border: "1px solid rgba(255,255,255,0.10)",
                        }}>
                        <User className="w-4 h-4 text-white/55" />
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
                      <div className="w-2 h-2 rounded-full bg-white/45 dot-1" />
                      <div className="w-2 h-2 rounded-full bg-white/45 dot-2" />
                      <div className="w-2 h-2 rounded-full bg-white/45 dot-3" />
                    </div>
                    <span className="font-[family-name:--font-cinzel] text-[11px] tracking-widest text-white/55">Thinking...</span>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* ── Input area ─────────────────────────────────────────────── */}
          <div ref={inputAreaRef} className="flex-shrink-0 relative z-20 overflow-hidden border-t border-white/[0.07]" style={{ opacity: 0 }}>
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
                        : "glass text-white/60 hover:text-white/80 hover:bg-white/[0.09]"
                    )}
                  >
                    {allTools.length === 0
                      ? (messages.length > 0 ? "Error" : "Loading...")
                      : `Tools  ${enabledCount}/${allTools.length}  ${panelOpen ? "▴" : "▾"}`}
                  </button>

                  {panelOpen && createPortal(
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setPanelOpen(false)} />
                      <div
                        className="fixed z-50 w-[380px] glass-mid rounded-2xl overflow-hidden shadow-[0_24px_60px_rgba(0,0,0,0.5)]"
                        style={{
                          left: panelPos.left,
                          bottom: panelPos.bottom,
                          background: "rgba(2, 8, 20, 0.55)",
                          backdropFilter: "blur(14px) saturate(1.4)",
                          WebkitBackdropFilter: "blur(14px) saturate(1.4)",
                        }}
                      >

                        {/* Tab headers */}
                        <div className="flex border-b border-white/[0.16]">
                          {(["tools", "keys"] as const).map(tab => (
                            <button key={tab} onClick={() => switchPanelTab(tab)}
                              className={cn(
                                "font-[family-name:--font-cinzel] text-[13px] tracking-[0.14em] px-6 py-3 uppercase transition-colors duration-150 cursor-pointer",
                                panelTab === tab ? "text-[#C9A84C] border-b-2 border-[#C9A84C] -mb-px" : "text-white/65 hover:text-white/82"
                              )}>
                              {tab === "tools" ? "Tool List" : "API Keys"}
                            </button>
                          ))}
                        </div>

                        {/* Tools tab */}
                        <div style={{ display: "grid", gridTemplateRows: panelTab === "tools" ? "1fr" : "0fr", transition: "grid-template-rows 220ms ease-in-out" }}>
                          <div className="overflow-hidden">
                            <div className={cn("max-h-[300px] overflow-y-auto transition-opacity duration-150", panelTab === "tools" && panelContentVisible ? "opacity-100" : "opacity-0")}>
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
                                      className="w-full flex items-center justify-between px-4 py-3 bg-white/[0.04] border-b border-white/[0.13] hover:bg-white/[0.07] transition-colors cursor-pointer"
                                    >
                                      <span className="font-[family-name:--font-cinzel] text-[13px] tracking-wider text-white/88">{group.name}</span>
                                      <div className="flex items-center gap-3">
                                        <span className="font-[family-name:--font-geist-mono] text-[11px] text-white/50">{groupEnabled}/{group.tools.length}</span>
                                        <span className="font-[family-name:--font-geist-mono] text-[11px] text-white/55">{isExpanded ? "▴" : "▾"}</span>
                                      </div>
                                    </button>
                                    <div className="overflow-hidden transition-[max-height] duration-300 ease-in-out"
                                      style={{ maxHeight: isExpanded ? `${group.tools.length * 52}px` : "0px" }}>
                                      {group.tools.map(tool => {
                                        const enabled = toolToggles[tool.function.name] ?? true
                                        return (
                                          <div key={tool.function.name}
                                            onClick={() => setToolToggles(prev => ({ ...prev, [tool.function.name]: !prev[tool.function.name] }))}
                                            className={cn(
                                              "flex items-center gap-3 px-4 py-3 pl-7 cursor-pointer transition-colors border-b border-white/[0.10]",
                                              enabled ? "hover:bg-white/[0.06]" : "bg-black/[0.10] hover:bg-black/[0.14]"
                                            )}>
                                            <div className={cn(
                                              "flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-all",
                                              enabled ? "border-[#C9A84C]/50 bg-[#C9A84C]/15" : "border-white/[0.16] bg-transparent"
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
                                                enabled ? (METHOD_BADGE_STYLES[tool.handler.method.toUpperCase()] ?? "method-get") : "bg-white/[0.04] text-white/20 border border-white/[0.07]"
                                              )}>{tool.handler.method.toUpperCase()}</span>
                                            )}
                                            <span className={cn(
                                              "font-[family-name:--font-cinzel] text-[13px] tracking-wide truncate flex-1 transition-colors",
                                              enabled ? "text-white/88" : "text-white/28"
                                            )}>{tool.function.name}</span>
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

                        {/* Keys tab */}
                        <div style={{ display: "grid", gridTemplateRows: panelTab === "keys" ? "1fr" : "0fr", transition: "grid-template-rows 220ms ease-in-out" }}>
                          <div className="overflow-hidden">
                            <div className={cn("max-h-[300px] overflow-y-auto px-4 py-4 transition-opacity duration-150", panelTab === "keys" && panelContentVisible ? "opacity-100" : "opacity-0")}>
                              {integrations.length === 0 ? (
                                <div className="py-4 flex items-center justify-center">
                                  <span className="font-[family-name:--font-cinzel] text-[12px] tracking-widest text-white/28 text-center">
                                    No API keys needed for any tools.
                                  </span>
                                </div>
                              ) : (
                                <div className="flex flex-col gap-5">
                                  {integrations.map(integration => {
                                    const id = integration.integrationId
                                    const isOAuth = integration.authType === "oauth2"
                                    const isBasicAuth = integration.authType === "basic_auth"
                                    const isPresent = !!savedKeyStatus[id]
                                    const providerUrl = lookupProviderKeyUrl(id)
                                    return (
                                      <div key={id} className="flex flex-col gap-2">
                                        <div className="flex items-center justify-between">
                                          <span className="inline-flex items-center gap-1.5 font-[family-name:--font-cinzel] text-[13px] tracking-wider text-white/88">
                                            {id}
                                            {providerUrl ? (
                                              <InfoBubble
                                                externalUrl={providerUrl}
                                                quick={`Open the ${id} developer dashboard to grab the credentials for this integration.`}
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
                                          <span className={cn("font-[family-name:--font-geist-mono] text-[10px] tracking-wider", isPresent ? "text-[#6EE7B7]" : "text-red-400/65")}>
                                            {isPresent ? "● Provided" : "○ Missing"}
                                          </span>
                                        </div>
                                        {isOAuth && integration.oauthFlow !== "implicit" ? (
                                          <div className="flex flex-col gap-2">
                                            <span className="font-[family-name:--font-cormorant] text-[13px] italic text-white/50">
                                              {integration.oauthFlow === "client_credentials"
                                                ? "OAuth 2.0 — Helios will exchange these credentials for a token."
                                                : "OAuth 2.0 — Helios will open the login page in a popup."}
                                            </span>
                                            <input type="text" placeholder="Client ID"
                                              value={oauth2Fields[id]?.clientId ?? ""}
                                              onChange={e => setOauth2Fields(prev => ({ ...prev, [id]: { ...prev[id], clientId: e.target.value } }))}
                                              className="glass-input rounded-lg px-3 py-2 text-[12px] font-[family-name:--font-geist-mono]" />
                                            <div className="flex gap-2">
                                              <input type="password" placeholder="Client Secret"
                                                value={oauth2Fields[id]?.clientSecret ?? ""}
                                                onChange={e => setOauth2Fields(prev => ({ ...prev, [id]: { ...prev[id], clientSecret: e.target.value } }))}
                                                className="flex-1 glass-input rounded-lg px-3 py-2 text-[12px] font-[family-name:--font-geist-mono]" />
                                              <button
                                                onClick={() => handleOAuth2Connect(integration)}
                                                disabled={!oauth2Fields[id]?.clientId?.trim() || !oauth2Fields[id]?.clientSecret?.trim() || isConnecting === id}
                                                className={cn("font-[family-name:--font-cinzel] text-[10px] tracking-widest px-4 py-2 rounded-lg transition-colors whitespace-nowrap",
                                                  (!oauth2Fields[id]?.clientId?.trim() || !oauth2Fields[id]?.clientSecret?.trim() || isConnecting === id)
                                                    ? "bg-white/[0.05] text-white/22 cursor-not-allowed" : "btn-gold cursor-pointer")}>
                                                {isConnecting === id ? "..." : "Connect"}
                                              </button>
                                            </div>
                                            {oauth2ConnectStatus[id]?.msg && (
                                              <span className={cn("font-[family-name:--font-geist-mono] text-[10px]", oauth2ConnectStatus[id].ok ? "text-[#6EE7B7]" : "text-red-400")}>
                                                {oauth2ConnectStatus[id].ok ? "✓ " : "✗ "}{oauth2ConnectStatus[id].msg}
                                              </span>
                                            )}
                                          </div>
                                        ) : isBasicAuth ? (
                                          (() => {
                                            const labels = lookupBasicAuthLabels(id)
                                            const fields = basicAuthFields[id]
                                            const basicDisabled = !fields?.user?.trim() || !fields?.pass?.trim() || isSavingKey === id
                                            return (
                                              <div className="flex flex-col gap-2">
                                                <span className="font-[family-name:--font-cormorant] text-[13px] italic text-white/50">
                                                  Basic Auth — enter your credentials below.
                                                </span>
                                                <input type="text"
                                                  placeholder={labels.user}
                                                  value={fields?.user ?? ""}
                                                  onChange={e => setBasicAuthFields(prev => ({ ...prev, [id]: { user: e.target.value, pass: prev[id]?.pass ?? "" } }))}
                                                  className="glass-input rounded-lg px-3 py-2 text-[12px] font-[family-name:--font-geist-mono]" />
                                                <div className="flex gap-2">
                                                  <input type="password"
                                                    placeholder={labels.pass}
                                                    value={fields?.pass ?? ""}
                                                    onChange={e => setBasicAuthFields(prev => ({ ...prev, [id]: { user: prev[id]?.user ?? "", pass: e.target.value } }))}
                                                    className="flex-1 glass-input rounded-lg px-3 py-2 text-[12px] font-[family-name:--font-geist-mono]" />
                                                  <button
                                                    onClick={() => handleSaveBasicAuth(id)}
                                                    disabled={basicDisabled}
                                                    className={cn(
                                                      "font-[family-name:--font-cinzel] text-[10px] tracking-widest px-4 py-2 rounded-lg transition-colors whitespace-nowrap",
                                                      basicDisabled ? "bg-white/[0.05] text-white/22 cursor-not-allowed" : "btn-gold cursor-pointer"
                                                    )}
                                                  >
                                                    {isSavingKey === id ? "..." : "Save"}
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
                                              placeholder={isPresent ? "Update key..." : "Enter API key..."}
                                              value={apiKeys[id] ?? ""}
                                              onChange={e => setApiKeys(prev => ({ ...prev, [id]: e.target.value }))}
                                              className="flex-1 glass-input rounded-lg px-3 py-2 text-[12px] font-[family-name:--font-geist-mono]" />
                                            <button onClick={() => handleSaveKey(id)}
                                              disabled={!apiKeys[id]?.trim() || isSavingKey === id}
                                              className={cn("font-[family-name:--font-cinzel] text-[10px] tracking-widest px-4 py-2 rounded-lg transition-colors",
                                                (!apiKeys[id]?.trim() || isSavingKey === id) ? "bg-white/[0.05] text-white/22 cursor-not-allowed" : "btn-gold cursor-pointer")}>
                                              {isSavingKey === id ? "..." : "Save"}
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

                        {/* Panel footer */}
                        <div className="border-t border-white/[0.16] p-3">
                          <button onClick={() => { handleApply(); setPanelOpen(false) }}
                            className="w-full btn-gold font-[family-name:--font-cinzel] py-2.5 text-[12px] tracking-[0.14em] rounded-xl cursor-pointer">
                            Apply & Reset Chat
                          </button>
                        </div>
                      </div>
                    </>,
                    document.body
                  )}
                </div>

                <button
                  onClick={() => setMessages([])}
                  className="font-[family-name:--font-cinzel] text-[11px] tracking-[0.14em] glass px-4 py-2 rounded-xl
                    text-white/55 hover:text-white/78 hover:bg-white/[0.09] transition-all duration-200 cursor-pointer"
                >
                  Reset Chat
                </button>
              </div>

              {/* Input box */}
              <div className={cn(
                "relative flex items-end gap-2 glass rounded-2xl p-2 overflow-hidden transition-all duration-200",
                "focus-within:border-[#C9A84C]/38 focus-within:shadow-[0_0_0_2px_rgba(201,168,76,0.08)]"
              )}>
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask your server anything..."
                  rows={1}
                  disabled={isLoading}
                  className="flex-1 resize-none bg-transparent px-3 py-2 text-[17px] font-[family-name:--font-cormorant] text-white/85
                    placeholder:text-white/22 focus:outline-none min-h-[40px] max-h-[200px] leading-relaxed"
                />
                <button
                  type="button"
                  aria-label="Send message"
                  onClick={handleSend}
                  disabled={!input.trim() || isLoading}
                  className={cn(
                    "flex-shrink-0 p-2.5 rounded-xl transition-all duration-200",
                    input.trim() && !isLoading ? "btn-gold cursor-pointer" : "bg-white/[0.05] text-white/18 cursor-not-allowed"
                  )}
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function TryPage() {
  return (
    <Suspense>
      <TryContent />
    </Suspense>
  )
}
