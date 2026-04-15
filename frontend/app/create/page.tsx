// Create page — user assembles a tool list from multiple sources, then launches the sandbox.
// Start: cd backend → npx tsx server.ts && npx tsx api.ts | cd frontend → npm run dev

"use client"
import Image from "next/image"
import Link from "next/link"
import { useState, useEffect, useRef, useCallback } from "react"
import { useRouter } from "next/navigation"
import { Search, X, ChevronDown, ChevronRight, Link2, FileText, Upload, Sparkles } from "lucide-react"
import { isLoggedIn, getAuthHeaders } from "@/lib/auth"
import yaml from "js-yaml"

const cn = (...classes: (string | undefined | null | false)[]) => classes.filter(Boolean).join(" ")

interface SavedServer {
  id: string
  baseUrl: string
  toolCount: number
  createdAt: string
}

interface ToolItem {
  id: string
  name: string
  description: string
  method?: string
  path?: string
  baseUrl?: string
  source: "custom" | "premade" | "past"
  apiName: string
  input_schema?: object
  handler?: { method: string; path: string; query_params?: string[] }
}

interface PopupTool {
  name: string
  description: string
  enabled?: boolean
  handler?: { method: string; path: string; query_params?: string[] }
  input_schema?: object
}

interface AuthConfig {
  type: "api_key" | "bearer_token" | "basic_auth" | "oauth2" | "none"
  in?: "header" | "query"
  name?: string
}

interface PendingDraft {
  specId?: string
  spec?: unknown
  baseUrl: string
  toolCount?: number
  catalog?: PopupTool[]
  auth?: AuthConfig[]
}

interface ParseSpecResponse {
  error?: string
  specId?: string
  spec?: unknown
  baseUrl?: string
  toolCount?: number
  catalog?: PopupTool[]
  auth?: AuthConfig[]
}

const METHOD_STYLES: Record<string, string> = {
  GET:    "method-get",
  POST:   "method-post",
  PUT:    "method-put",
  PATCH:  "method-patch",
  DELETE: "method-delete",
}

const RECOMMENDED_APIS = [
  { name: "Stripe",      description: "Payments & billing",   color: "#635BFF", initials: "St" },
  { name: "GitHub",      description: "Code repositories",    color: "#24292E", initials: "GH" },
  { name: "Slack",       description: "Team messaging",       color: "#4A154B", initials: "Sl" },
  { name: "OpenWeather", description: "Weather data",         color: "#E8421C", initials: "OW" },
  { name: "Notion",      description: "Docs & databases",     color: "#000000", initials: "No" },
  { name: "Linear",      description: "Issue tracking",       color: "#5E6AD2", initials: "Li" },
  { name: "Twilio",      description: "SMS & voice",          color: "#F22F46", initials: "Tw" },
  { name: "Airtable",    description: "Spreadsheet database", color: "#18BFFF", initials: "At" },
]

export default function Create() {
  const [url, setUrl]       = useState("")
  const [apiName, setApiName] = useState("")
  const [formError, setFormError] = useState("")
  const [isCreating, setIsCreating] = useState(false)

  const [servers, setServers]   = useState<SavedServer[]>([])
  const [searchQuery, setSearchQuery] = useState("")
  const [intent, setIntent] = useState("")
  const [page, setPage] = useState<0 | 1>(0)
  const [isDragging, setIsDragging] = useState(false)
  const [jsonError, setJsonError] = useState("")
  const [isParsing, setIsParsing] = useState(false)
  const [duplicateNotice, setDuplicateNotice] = useState<string[]>([])

  const [tools, setTools] = useState<ToolItem[]>([])
  const skipFirstSave = useRef(true)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [isGenerating, setIsGenerating] = useState(false)
  const [generateError, setGenerateError] = useState("")
  const [isSimplifying, setIsSimplifying] = useState(false)
  const [simplifyPreview, setSimplifyPreview] = useState<{
    originalCount: number
    filteredTools: Array<{ name: string; description: string }>
  } | null>(null)

  const MAX_TOOLS_PER_API = 60

  const [popupOpen, setPopupOpen]         = useState(false)
  const [popupLoading, setPopupLoading]   = useState(false)
  const [popupTools, setPopupTools]       = useState<PopupTool[]>([])
  const [popupSelected, setPopupSelected] = useState<Set<string>>(new Set())
  const [pendingSource, setPendingSource] = useState<"custom" | "premade" | "past">("custom")
  const [pendingApiName, setPendingApiName] = useState("")
  const [pendingDraft, setPendingDraft]   = useState<PendingDraft | null>(null)

  const router      = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [pageReady, setPageReady] = useState(false)
  useEffect(() => {
    document.fonts.ready.then(() => requestAnimationFrame(() => setPageReady(true)))
  }, [])

  useEffect(() => {
    if (!isLoggedIn()) { router.replace("/auth"); return }
    fetch("http://localhost:8000/api/servers", { headers: getAuthHeaders() })
      .then(res => {
        if (res.status === 401) { router.replace("/auth"); return null }
        return res.json()
      })
      .then(data => { if (data) setServers(data.servers ?? []) })
      .catch(() => {})
  }, [router])

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem("helios_create_tools")
      if (saved) setTools(JSON.parse(saved))
    } catch {}
  }, [])

  useEffect(() => {
    if (skipFirstSave.current) { skipFirstSave.current = false; return }
    sessionStorage.setItem("helios_create_tools", JSON.stringify(tools))
  }, [tools])
  useEffect(() => { setSimplifyPreview(null) }, [tools, intent])

  const triggerParse = async (specUrl: string, name: string, onError: (msg: string) => void) => {
    setIsCreating(true); setPopupLoading(true); setPopupOpen(true)
    setPendingSource("custom"); setPendingApiName(name)
    let res: Response, data: ParseSpecResponse
    try {
      res  = await fetch("http://localhost:8000/api/spec/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ url: specUrl, name }),
      })
      data = await res.json()
    } catch {
      onError("Could not reach the server.")
      setPopupOpen(false); setPopupLoading(false); setIsCreating(false)
      return
    }
    if (!res.ok) {
      onError(data.error ?? "Failed to parse spec.")
      setPopupOpen(false); setPopupLoading(false); setIsCreating(false)
      return
    }
    const catalog: PopupTool[] = data.catalog ?? []
    setPendingDraft({ specId: data.specId, spec: data.spec, baseUrl: data.baseUrl ?? "", toolCount: data.toolCount, catalog, auth: data.auth })
    setPopupTools(catalog)
    setPopupSelected(new Set(catalog.map((t: PopupTool) => t.name)))
    setPopupLoading(false); setIsCreating(false)
  }

  const handleCreateTool = async () => {
    const trimmedUrl = url.trim()
    if (!trimmedUrl || !apiName) { setFormError("Spec URL and API Name are required."); return }
    setFormError("")
    await triggerParse(trimmedUrl, apiName, msg => setFormError(msg))
  }

  const handleJsonFile = useCallback(async (file: File) => {
    if (!apiName) { setJsonError("Enter an API Name first."); return }
    const isYaml = file.name.endsWith(".yaml") || file.name.endsWith(".yml")
    const isJson = file.name.endsWith(".json")
    if (!isJson && !isYaml) { setJsonError("Only .json, .yaml, or .yml files are supported."); return }
    setJsonError(""); setIsParsing(true); setPopupLoading(true); setPopupOpen(true)
    setPendingSource("custom"); setPendingApiName(apiName)
    let spec: unknown
    try {
      const text = await file.text()
      spec = isYaml ? yaml.load(text) : JSON.parse(text)
    } catch {
      setJsonError(`Could not parse file — make sure it is valid ${isYaml ? "YAML" : "JSON"}.`)
      setPopupOpen(false); setPopupLoading(false); setIsParsing(false)
      return
    }
    let res: Response, data: ParseSpecResponse
    try {
      res  = await fetch("http://localhost:8000/api/spec/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ spec, name: apiName }),
      })
      data = await res.json()
    } catch {
      setJsonError("Could not reach the server.")
      setPopupOpen(false); setPopupLoading(false); setIsParsing(false)
      return
    }
    if (!res.ok) {
      setJsonError(data.error ?? "Failed to parse spec.")
      setPopupOpen(false); setPopupLoading(false); setIsParsing(false)
      return
    }
    const catalog: PopupTool[] = data.catalog ?? []
    setPendingDraft({ specId: data.specId, spec: data.spec, baseUrl: data.baseUrl ?? "", toolCount: data.toolCount, catalog, auth: data.auth })
    setPopupTools(catalog)
    setPopupSelected(new Set(catalog.map((t: PopupTool) => t.name)))
    setPopupLoading(false); setIsParsing(false)
  }, [apiName])

  const handlePopupConfirm = () => {
    const selected = popupTools.filter(t => popupSelected.has(t.name))
    const newTools: ToolItem[] = selected.map(t => ({
      id:           `${pendingApiName}-${t.name}-${Date.now()}`,
      name:         t.name,
      description:  t.description,
      method:       t.handler?.method,
      path:         t.handler?.path,
      baseUrl:      pendingDraft?.baseUrl ?? "",
      source:       pendingSource,
      apiName:      pendingApiName,
      input_schema: t.input_schema,
      handler:      t.handler,
    }))
    setTools(prev => {
      const existingNames = new Set(prev.map(t => t.name))
      const unique     = newTools.filter(t => !existingNames.has(t.name))
      const duplicates = newTools.filter(t =>  existingNames.has(t.name))
      if (duplicates.length > 0) setDuplicateNotice(duplicates.map(t => t.name))
      return unique.length > 0 ? [...prev, ...unique] : prev
    })
    if (pendingDraft?.specId) {
      try {
        sessionStorage.setItem(`helios_draft_${pendingDraft.specId}`, JSON.stringify({
          specId: pendingDraft.specId, baseUrl: pendingDraft.baseUrl, auth: pendingDraft.auth, toolCount: pendingDraft.toolCount,
        }))
      } catch {}
    }
    setPopupOpen(false); setUrl(""); setApiName("")
  }

  const toggleSelectAll = () => {
    setPopupSelected(
      popupSelected.size === popupTools.length ? new Set() : new Set(popupTools.map(t => t.name))
    )
  }

  const removeTool   = (id: string) => setTools(prev => prev.filter(t => t.id !== id))
  const toggleExpand = (apiName: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(apiName)) next.delete(apiName)
      else next.add(apiName)
      return next
    })
  }

  const handlePastServerClick = async (serverId: string) => {
    setPopupLoading(true); setPopupOpen(true)
    setPendingSource("past"); setPendingApiName(serverId); setPendingDraft(null)
    const res  = await fetch(`http://localhost:8000/api/servers/${serverId}/catalog`, { headers: getAuthHeaders() })
    const data = await res.json()
    if (!res.ok || data.error) { setPopupOpen(false); setPopupLoading(false); return }
    const catalog: PopupTool[] = (data.catalog ?? []).filter((t: PopupTool) => t.enabled !== false)
    setPendingDraft({ baseUrl: data.baseUrl ?? "" })
    setPopupTools(catalog)
    setPopupSelected(new Set(catalog.map((t: PopupTool) => t.name)))
    setPopupLoading(false)
  }

  const launchSandbox = async (registryTools: Array<{
    name: string; description: string; input_schema: object;
    handler: { method: string; path: string; headers: object; query_params: string[]; fixed_query_params?: any }
  }>) => {
    try {
      const res  = await fetch("http://localhost:8000/api/sandbox/start", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ toolsRegistry: { baseUrl: "", tools: registryTools } })
      })
      const data = await res.json()
      if (!res.ok) { setGenerateError(data.error ?? "Failed to start sandbox."); setIsGenerating(false); return }
      const syntheticId = `_composite_${Date.now()}`
      sessionStorage.setItem(`helios_session_${syntheticId}`, JSON.stringify({ sessionId: data.sessionId, tools: data.tools }))
      const toolMap: Record<string, string> = {}
      const authMap: Record<string, AuthConfig[]> = {}
      tools.forEach(t => {
        toolMap[t.name] = t.apiName
        if (!authMap[t.apiName] && t.apiName) {
          try {
            const draftRaw = sessionStorage.getItem(`helios_draft_${t.apiName}`)
            if (draftRaw) { const draft: PendingDraft = JSON.parse(draftRaw); if (draft.auth && draft.auth.length > 0) authMap[t.apiName] = draft.auth }
          } catch {}
        }
      })
      sessionStorage.setItem(`helios_groups_${syntheticId}`, JSON.stringify({ toolMap, authMap }))
      const editSource = sessionStorage.getItem("helios_edit_source") ?? ""
      if (editSource) sessionStorage.removeItem("helios_edit_source")
      const sandboxUrl = editSource
        ? `/sandbox?specId=${encodeURIComponent(editSource)}&compositeId=${syntheticId}`
        : `/sandbox?compositeId=${syntheticId}`
      router.push(sandboxUrl)
    } catch {
      setGenerateError("Could not reach the server."); setIsGenerating(false)
    }
  }

  const handleGenerate = async () => {
    if (tools.length === 0 || isGenerating || isSimplifying) return
    setGenerateError("")
    const registryTools = tools.map(t => ({
      name:         t.name,
      description:  t.description,
      input_schema: t.input_schema ?? { type: "object", properties: {} },
      handler: {
        method:             t.method ?? "GET",
        path:               t.baseUrl ? `${t.baseUrl}${t.path ?? ""}` : (t.path ?? ""),
        headers:            {},
        query_params:       t.handler?.query_params ?? [],
        fixed_query_params: (t.handler as any)?.fixed_query_params
      }
    }))

    if (simplifyPreview) {
      setIsGenerating(true)
      const filteredNames = new Set(simplifyPreview.filteredTools.map(t => t.name))
      await launchSandbox(registryTools.filter(t => filteredNames.has(t.name)))
      return
    }
    if (tools.length > MAX_TOOLS_PER_API && !intent.trim()) {
      setGenerateError(`${tools.length} tools exceeds the ${MAX_TOOLS_PER_API}-tool sandbox limit. Remove tools or describe your intent to auto-filter.`)
      return
    }
    if (!intent.trim()) { setIsGenerating(true); await launchSandbox(registryTools); return }

    setIsSimplifying(true)
    try {
      const simplifyRes = await fetch("http://localhost:8000/api/spec/simplify", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ catalog: registryTools, userIntent: intent.trim() }),
      })
      if (simplifyRes.ok) {
        const simplifyData = await simplifyRes.json()
        if (Array.isArray(simplifyData.catalog) && simplifyData.catalog.length > 0) {
          setSimplifyPreview({
            originalCount: tools.length,
            filteredTools: simplifyData.catalog.map((t: any) => ({ name: t.name, description: t.description ?? "" }))
          })
          setIsSimplifying(false)
          return
        }
      }
    } catch {}
    setIsSimplifying(false); setIsGenerating(true)
    await launchSandbox(registryTools)
  }

  const q               = searchQuery.toLowerCase()
  const addedServerIds  = new Set(tools.filter(t => t.source === "past").map(t => t.apiName))
  const filteredApis    = RECOMMENDED_APIS.filter(a => a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q))
  const filteredServers = servers.filter(s => s.id.toLowerCase().includes(q) && !addedServerIds.has(s.id))

  // Derived: groups of added tools for bottom bar chips
  const toolGroupNames: string[] = []
  const toolGroupsMap: Record<string, number> = {}
  tools.forEach(t => {
    if (!toolGroupsMap[t.apiName]) { toolGroupsMap[t.apiName] = 0; toolGroupNames.push(t.apiName) }
    toolGroupsMap[t.apiName]++
  })

  return (
    <div className={cn("min-h-screen relative flex flex-col", pageReady ? "animate-page-enter" : "opacity-0")}>

      {/* ── Page content — blurs when popup is open ────────────────────── */}
      <div className={cn("flex flex-col flex-1 transition-[filter] duration-300", popupOpen && "blur-sm brightness-90")}>

      {/* ── Nav ────────────────────────────────────────────────────────── */}
      <nav className="glass-nav flex items-center justify-between px-8 h-[62px] flex-shrink-0">
        <Link href="/">
          <Image src="/logoName.svg" alt="Helios" width={110} height={36} className="brightness-0 invert opacity-90 cursor-pointer" />
        </Link>
        <div className="flex items-center gap-4 font-[family-name:--font-cinzel] text-[16px] tracking-[0.18em]">
          <span className="step-active pb-1">Create</span>
          <span className="step-divider text-[10px]">✦</span>
          <span className="step-inactive">Sandbox</span>
          <span className="step-divider text-[10px]">✦</span>
          <span className="step-inactive">Verify</span>
          <span className="step-divider text-[10px]">✦</span>
          <span className="step-inactive">Download</span>
        </div>
        <button
          onClick={() => { sessionStorage.removeItem("helios_create_tools"); router.push("/") }}
          className="font-[family-name:--font-cinzel] text-[12px] tracking-[0.14em] glass px-5 py-2 rounded-xl
            text-white/40 hover:text-white/70 hover:bg-white/[0.10] transition-all duration-200 cursor-pointer"
        >
          Cancel
        </button>
      </nav>

      {/* ── Centered card ─────────────────────────────────────────────── */}
      <main className="flex-1 flex items-center justify-center px-6 py-3">
        <div className="glass-mid rounded-3xl w-full max-w-[1152px] h-[768px] flex flex-col overflow-hidden
          shadow-[0_40px_120px_rgba(0,0,0,0.5)] animate-fade-up">

          {/* ── Slide container ─── holds both panels side by side ───── */}
          <div className="flex-1 overflow-hidden min-h-0">
            <div
              className="flex h-full transition-transform duration-500 ease-in-out"
              style={{ width: "200%", transform: page === 0 ? "translateX(0)" : "translateX(-50%)" }}
            >

              {/* ══════════════════ PAGE 0 — CREATE ══════════════════════ */}
              <div className="flex h-full overflow-hidden" style={{ width: "50%" }}>

                {/* LEFT: API sources */}
                <div className="w-[42%] flex-shrink-0 flex flex-col overflow-hidden border-r border-white/[0.08]">

                  {/* Search bar — filters the sections below inline */}
                  <div className="relative px-5 pt-5 pb-3 flex-shrink-0">
                    <div className="flex items-center gap-2.5 glass rounded-xl px-4 py-2.5 transition-all duration-200">
                      <Search size={14} strokeWidth={1.5} className="text-white/45 flex-shrink-0" />
                      <input
                        type="text"
                        placeholder="Search servers or APIs..."
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        className="flex-1 bg-transparent font-[family-name:--font-cinzel] text-[14px] tracking-wider
                          text-white/85 placeholder:text-white/35 outline-none cursor-text"
                      />
                      {searchQuery && (
                        <button type="button" onClick={() => setSearchQuery("")}
                          className="text-white/35 hover:text-white/65 transition-colors cursor-pointer">
                          <X size={12} strokeWidth={1.5} />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* ── TOP HALF: Server sources (scrollable) ─────────────── */}
                  <div className="overflow-y-auto px-5 pb-3 min-h-0" style={{ flex: "1 1 0", scrollbarGutter: "stable" }}>

                    {/* Previous servers — 3 cols, same card style as Premade */}
                    {filteredServers.length > 0 && (
                      <div className="mb-4">
                        <p className="font-[family-name:--font-cinzel] text-[11px] tracking-[0.28em] text-white/50 uppercase mb-2.5">Previous</p>
                        <div className="grid grid-cols-3 gap-2">
                          {filteredServers.map(server => (
                            <button
                              key={server.id}
                              onClick={() => handlePastServerClick(server.id)}
                              className="glass rounded-xl p-2.5 flex flex-col items-center gap-1.5 cursor-pointer hover:bg-white/[0.10] transition-all duration-200 group"
                            >
                              <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-white/[0.08] group-hover:bg-white/[0.13] transition-colors flex-shrink-0">
                                <span className="font-[family-name:--font-cinzel] text-[13px] tracking-wider text-white/65">
                                  {server.id.slice(0, 2).toUpperCase()}
                                </span>
                              </div>
                              <span className="font-[family-name:--font-cinzel] text-[11px] tracking-wider text-white/70 truncate w-full text-center leading-tight">{server.id}</span>
                              <span className="font-[family-name:--font-cormorant] text-[13px] text-white/35">{server.toolCount} tools</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Premade APIs — 3 cols, same grid size */}
                    {filteredApis.length > 0 && (
                      <div className="mb-3">
                        <p className="font-[family-name:--font-cinzel] text-[11px] tracking-[0.28em] text-white/50 uppercase mb-2.5">Premade APIs</p>
                        <div className="grid grid-cols-3 gap-2">
                          {filteredApis.map(api => (
                            <div
                              key={api.name}
                              className="glass rounded-xl p-2.5 flex flex-col items-center gap-1.5 opacity-45 cursor-not-allowed"
                            >
                              <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                                style={{ background: api.color }}>
                                <span className="font-[family-name:--font-cinzel] text-[13px] tracking-wider text-white">{api.initials}</span>
                              </div>
                              <span className="font-[family-name:--font-cinzel] text-[11px] tracking-wider text-white/60 truncate w-full text-center">{api.name}</span>
                            </div>
                          ))}
                        </div>
                        <p className="font-[family-name:--font-cormorant] text-[15px] italic text-white/35 mt-2 text-center">Coming soon</p>
                      </div>
                    )}

                    {/* No results state */}
                    {searchQuery && filteredServers.length === 0 && filteredApis.length === 0 && (
                      <p className="font-[family-name:--font-cormorant] text-[15px] italic text-white/30 px-1">
                        No matches for &ldquo;{searchQuery}&rdquo;
                      </p>
                    )}

                  </div>

                  {/* ── Divider ───────────────────────────────────────────── */}
                  <div className="h-px bg-white/[0.09] mx-5 flex-shrink-0" />

                  {/* ── BOTTOM HALF: Added tools (scrollable) ─────────────── */}
                  <div className="overflow-y-auto px-5 pt-3 pb-3 min-h-0" style={{ flex: "1 1 0", scrollbarGutter: "stable" }}>
                    <p className="font-[family-name:--font-cinzel] text-[11px] tracking-[0.28em] text-white/50 uppercase mb-2.5">Added Tools</p>
                    {tools.length === 0 ? (
                      <p className="font-[family-name:--font-cormorant] text-[15px] italic text-white/40 px-1">
                        Add an API to see tools here.
                      </p>
                    ) : (
                      (() => {
                        const groups: { apiName: string; source: ToolItem["source"]; items: ToolItem[] }[] = []
                        tools.forEach(tool => {
                          const g = groups.find(g => g.apiName === tool.apiName)
                          if (g) g.items.push(tool)
                          else groups.push({ apiName: tool.apiName, source: tool.source, items: [tool] })
                        })
                        return (
                          <div className="glass rounded-xl overflow-hidden">
                            {groups.map((group, gi) => {
                              const isExpanded = expanded.has(group.apiName)
                              return (
                                <div key={group.apiName} className={cn(gi !== groups.length - 1 && "border-b border-white/[0.07]")}>
                                  <div
                                    className="flex items-center gap-2.5 px-4 py-3 cursor-pointer hover:bg-white/[0.05] transition-colors"
                                    onClick={() => toggleExpand(group.apiName)}
                                  >
                                    {isExpanded
                                      ? <ChevronDown  size={12} strokeWidth={1.5} className="flex-shrink-0 text-white/40" />
                                      : <ChevronRight size={12} strokeWidth={1.5} className="flex-shrink-0 text-white/40" />}
                                    <span className="font-[family-name:--font-cinzel] text-[14px] tracking-wider text-white/80 flex-1 truncate">
                                      {group.apiName}
                                    </span>
                                    <span className="font-[family-name:--font-cinzel] text-[13px] text-white/45 tracking-widest flex-shrink-0">
                                      {group.items.length}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={e => { e.stopPropagation(); group.items.forEach(t => removeTool(t.id)) }}
                                      className="flex-shrink-0 text-white/25 hover:text-white/60 transition-colors ml-1 cursor-pointer"
                                    >
                                      <X size={12} strokeWidth={1.5} />
                                    </button>
                                  </div>
                                  <div
                                    className="overflow-hidden transition-all duration-300 ease-in-out"
                                    style={{ maxHeight: isExpanded ? `${group.items.length * 48}px` : "0px" }}
                                  >
                                    <div className="border-t border-white/[0.07]">
                                      {group.items.map((tool, ti) => (
                                        <div key={tool.id} className={cn(
                                          "flex items-center gap-2.5 pl-8 pr-4 py-2 bg-black/[0.06]",
                                          ti !== group.items.length - 1 && "border-b border-white/[0.05]"
                                        )}>
                                          {tool.method && (
                                            <span className={cn(
                                              "flex-shrink-0 font-[family-name:--font-geist-mono] text-[12px] tracking-widest px-1.5 py-0.5 rounded",
                                              METHOD_STYLES[tool.method.toUpperCase()] ?? "method-get"
                                            )}>
                                              {tool.method.toUpperCase()}
                                            </span>
                                          )}
                                          <span className="font-[family-name:--font-cinzel] text-[14px] tracking-wider text-white/70 truncate flex-1">
                                            {tool.name}
                                          </span>
                                          <button type="button" onClick={() => removeTool(tool.id)}
                                            className="flex-shrink-0 text-white/25 hover:text-white/60 transition-colors cursor-pointer">
                                            <X size={11} strokeWidth={1.5} />
                                          </button>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        )
                      })()
                    )}
                  </div>

                </div>

                {/* RIGHT: Input methods */}
                <div className="flex-1 flex flex-col overflow-hidden">
                  <div className="flex-1 overflow-y-auto px-6 pt-5 pb-4">

                    {/* API Name */}
                    <div className="mb-4">
                      <h2 className="font-[family-name:--font-cinzel] text-[20px] tracking-[0.18em] text-white text-center mb-4">
                        Custom Tools
                      </h2>
                      <label className="block font-[family-name:--font-cinzel] text-[13px] tracking-[0.22em] text-white uppercase mb-2">
                        API Name
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. Stripe, GitHub, MyCustomAPI"
                        value={apiName}
                        onChange={e => setApiName(e.target.value)}
                        className="glass-input w-full rounded-xl px-4 py-3 text-[17px] font-[family-name:--font-cinzel] tracking-wider text-white"
                      />
                    </div>

                    {/* Spec URL panel */}
                    <div className="glass rounded-2xl p-4 mb-1">
                      <div className="flex items-center gap-3 mb-3">
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-white/[0.07] flex-shrink-0">
                          <Link2 size={15} strokeWidth={1.5} className="text-white/60" />
                        </div>
                        <div>
                          <p className="font-[family-name:--font-cinzel] text-[17px] tracking-[0.12em] text-white/92">Paste Spec URL</p>
                          <p className="font-[family-name:--font-cormorant] text-[17px] italic text-white/65">Link to an OpenAPI/Swagger JSON or YAML file</p>
                        </div>
                      </div>
                      {formError && <p className="font-[family-name:--font-cinzel] text-red-400 text-[14px] tracking-wider mb-3">{formError}</p>}
                      <div className="flex gap-2">
                        <input
                          type="text"
                          placeholder="https://api.example.com/openapi.json"
                          value={url}
                          onChange={e => setUrl(e.target.value)}
                          onKeyDown={e => { if (e.key === "Enter") handleCreateTool() }}
                          className="glass-input flex-1 rounded-xl px-4 py-2.5 text-[16px] font-[family-name:--font-geist-mono]"
                        />
                        <div className="relative flex-shrink-0 group/addbtn">
                          <button
                            type="button"
                            onClick={handleCreateTool}
                            disabled={isCreating || !url.trim() || !apiName.trim()}
                            className={cn(
                              "font-[family-name:--font-cinzel] text-[14px] tracking-[0.14em] px-5 py-2.5 rounded-xl transition-all duration-200",
                              isCreating || !url.trim() || !apiName.trim()
                                ? "bg-white/[0.05] text-white/25 cursor-not-allowed"
                                : "btn-gold cursor-pointer"
                            )}
                          >
                            {isCreating ? "..." : "Add"}
                          </button>
                          {!apiName.trim() && (
                            <div className="pointer-events-none absolute bottom-full right-0 mb-2 opacity-0 group-hover/addbtn:opacity-100 transition-opacity duration-150">
                              <div className="glass rounded-lg px-3 py-2 whitespace-nowrap shadow-[0_8px_24px_rgba(0,0,0,0.4)]">
                                <span className="font-[family-name:--font-cinzel] text-[12px] tracking-[0.12em] text-white/80">
                                  Enter an API name first
                                </span>
                              </div>
                              <div className="w-2 h-2 bg-white/[0.13] border-r border-b border-white/[0.20] rotate-45 ml-auto mr-3 -mt-1" />
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* OR */}
                    <div className="flex items-center gap-3 py-2.5 px-2">
                      <div className="flex-1 h-px bg-white/[0.08]" />
                      <span className="font-[family-name:--font-cormorant] text-[17px] italic text-white/30">or</span>
                      <div className="flex-1 h-px bg-white/[0.08]" />
                    </div>

                    {/* File upload panel */}
                    <div className="glass rounded-2xl p-4">
                      <div className="flex items-center gap-3 mb-3">
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-white/[0.07] flex-shrink-0">
                          <Upload size={14} strokeWidth={1.5} className="text-white/60" />
                        </div>
                        <div>
                          <p className="font-[family-name:--font-cinzel] text-[17px] tracking-[0.12em] text-white/92">Upload OpenAPI File</p>
                          <p className="font-[family-name:--font-cormorant] text-[17px] italic text-white/65">Drop a .json, .yaml, or .yml spec file</p>
                        </div>
                      </div>
                      {jsonError && <p className="font-[family-name:--font-cinzel] text-red-400 text-[14px] tracking-wider mb-3">{jsonError}</p>}
                      <div
                        className={cn(
                          "flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed py-6 transition-all duration-150 cursor-pointer",
                          isDragging
                            ? "border-[#C9A84C]/50 bg-[#C9A84C]/[0.06]"
                            : "border-white/[0.13] hover:border-white/[0.25] hover:bg-white/[0.03]"
                        )}
                        onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
                        onDragLeave={() => setIsDragging(false)}
                        onDrop={e => {
                          e.preventDefault(); setIsDragging(false)
                          const file = e.dataTransfer.files[0]
                          if (file) handleJsonFile(file)
                        }}
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <FileText size={20} strokeWidth={1} className={isDragging ? "text-[#C9A84C]/60" : "text-white/30"} />
                        <span className="font-[family-name:--font-cinzel] text-[16px] tracking-wider text-white/50">
                          {isParsing ? "Parsing..." : "Drop API spec here"}
                        </span>
                        <span className="font-[family-name:--font-cormorant] text-[17px] italic text-white/30">or click to browse</span>
                      </div>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".json,.yaml,.yml"
                        className="hidden"
                        onChange={e => {
                          const file = e.target.files?.[0]
                          if (file) handleJsonFile(file)
                          e.target.value = ""
                        }}
                      />
                    </div>

                    {/* Duplicate notice */}
                    {duplicateNotice.length > 0 && (
                      <div className="glass rounded-xl px-4 py-3 mt-3 flex items-center justify-between">
                        <span className="font-[family-name:--font-cormorant] text-[18px] italic text-white/55">
                          {duplicateNotice.length} duplicate tool{duplicateNotice.length !== 1 ? "s" : ""} skipped
                        </span>
                        <button type="button" onClick={() => setDuplicateNotice([])} className="text-white/30 hover:text-white/60 transition-colors cursor-pointer">
                          <X size={13} strokeWidth={1.5} />
                        </button>
                      </div>
                    )}

                  </div>
                </div>
              </div>
              {/* ── end PAGE 0 ── */}

              {/* ══════════════════ PAGE 1 — INTENT ══════════════════════ */}
              <div className="flex flex-col overflow-hidden" style={{ width: "50%" }}>

                {/* Intent page header with back arrow */}
                <div className="flex items-center gap-4 px-8 pt-6 pb-4 flex-shrink-0 border-b border-white/[0.07]">
                  <button
                    type="button"
                    onClick={() => { setPage(0); setSimplifyPreview(null) }}
                    className="flex items-center gap-2 text-white/45 hover:text-white/80 transition-colors duration-200 cursor-pointer group"
                  >
                    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" className="group-hover:-translate-x-0.5 transition-transform duration-200">
                      <path d="M11 4L6 9L11 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    <span className="font-[family-name:--font-cinzel] text-[14px] tracking-[0.16em]">Back</span>
                  </button>
                  <div className="flex-1" />
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-[#C9A84C]/[0.12]">
                      <Sparkles size={13} strokeWidth={1.5} className="text-[#C9A84C]/80" />
                    </div>
                    <span className="font-[family-name:--font-cinzel] text-[18px] tracking-[0.14em] text-white/90">Describe Your Intent</span>
                  </div>
                  <div className="flex-1" />
                  <span className="font-[family-name:--font-cormorant] text-[17px] italic text-white/55">Optional</span>
                </div>

                {/* Intent body */}
                <div className="flex-1 overflow-y-auto px-8 py-6 flex flex-col gap-5">
                  <p className="font-[family-name:--font-cormorant] text-[20px] italic text-white/70 leading-relaxed">
                    Tell Helios what you're trying to build. It will filter your {tools.length} tool{tools.length !== 1 ? "s" : ""} down to only the ones that match your goal — you can always review them in the sandbox.
                  </p>

                  <textarea
                    placeholder="e.g. I want to retrieve user profiles and send email notifications when their subscription expires..."
                    value={intent}
                    onChange={e => setIntent(e.target.value)}
                    rows={6}
                    className="glass-input w-full rounded-2xl px-5 py-4 text-[18px] font-[family-name:--font-cormorant] leading-relaxed resize-none"
                    autoFocus={page === 1}
                  />

                  {/* Simplify preview — shows after Helios filters */}
                  {isSimplifying && (
                    <div className="glass rounded-xl px-5 py-3 flex items-center gap-3">
                      <div className="flex gap-1.5 items-center">
                        <div className="w-1.5 h-1.5 rounded-full bg-[#C9A84C]/60 dot-1" />
                        <div className="w-1.5 h-1.5 rounded-full bg-[#C9A84C]/60 dot-2" />
                        <div className="w-1.5 h-1.5 rounded-full bg-[#C9A84C]/60 dot-3" />
                      </div>
                      <span className="font-[family-name:--font-cinzel] text-[14px] tracking-wider text-white/45">
                        Filtering tools to match your intent...
                      </span>
                    </div>
                  )}

                  {simplifyPreview && !isSimplifying && (
                    <div className="glass-mid rounded-xl px-5 py-4 flex flex-col gap-3 border border-white/[0.18]">
                      <div className="flex items-center justify-between">
                        <span className="font-[family-name:--font-cinzel] text-[14px] tracking-[0.18em] text-white/70 uppercase">
                          Intent Filter Preview
                        </span>
                        <button
                          type="button"
                          onClick={() => setSimplifyPreview(null)}
                          className="font-[family-name:--font-cinzel] text-[13px] tracking-wider text-white/50 hover:text-white/80 transition-colors cursor-pointer"
                        >
                          Change Intent
                        </button>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="font-[family-name:--font-cinzel] text-[16px] tracking-wider text-white/40 line-through">
                          {simplifyPreview.originalCount} tools
                        </span>
                        <span className="text-white/40 text-sm">→</span>
                        <span className="font-[family-name:--font-cinzel] text-[24px] tracking-wider text-white/95 font-semibold">
                          {simplifyPreview.filteredTools.length} tools
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1.5 max-h-[72px] overflow-y-auto">
                        {simplifyPreview.filteredTools.map(t => (
                          <span key={t.name}
                            className="font-[family-name:--font-cinzel] text-[12px] tracking-wider bg-white/[0.12] border border-white/[0.25] text-white/85 px-2 py-0.5 rounded">
                            {t.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {generateError && (
                    <p className="font-[family-name:--font-cinzel] text-red-400 text-[14px] tracking-wider">{generateError}</p>
                  )}
                </div>
              </div>
              {/* ── end PAGE 1 ── */}

            </div>
          </div>
          {/* ── end slide container ── */}

          {/* ── Bottom bar — inside the card ────────────────────────────── */}
          <div className="border-t border-white/[0.09] px-6 py-3.5 flex-shrink-0 flex items-center gap-3"
            style={{ background: "rgba(0,0,0,0.18)" }}>

            {page === 0 ? (
              <>
                {/* Page 0: chips + Next button */}
                <div className="flex-1 flex items-center gap-2 overflow-x-auto min-w-0">
                  {toolGroupNames.length === 0 ? (
                    <span className="font-[family-name:--font-cormorant] text-[18px] italic text-white/55 whitespace-nowrap">
                      No tools added yet — select an API above
                    </span>
                  ) : (
                    toolGroupNames.map(name => (
                      <div
                        key={name}
                        className="flex items-center gap-1.5 flex-shrink-0 glass rounded-full px-3 py-1.5 border border-white/[0.11]"
                      >
                        <span className="font-[family-name:--font-cinzel] text-[13px] tracking-wider text-white/70 whitespace-nowrap">
                          {name}
                        </span>
                        <span className="font-[family-name:--font-geist-mono] text-[12px] text-white/40">
                          {toolGroupsMap[name]}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            const idsToRemove = tools.filter(t => t.apiName === name).map(t => t.id)
                            setTools(prev => prev.filter(t => !idsToRemove.includes(t.id)))
                          }}
                          className="text-white/28 hover:text-white/65 transition-colors cursor-pointer ml-0.5"
                        >
                          <X size={10} strokeWidth={2} />
                        </button>
                      </div>
                    ))
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => { if (tools.length > 0) setPage(1) }}
                  disabled={tools.length === 0}
                  className={cn(
                    "flex-shrink-0 flex items-center gap-2 font-[family-name:--font-cinzel] text-[16px] tracking-[0.14em] px-7 py-3 rounded-xl transition-all duration-200",
                    tools.length === 0
                      ? "bg-white/[0.05] text-white/20 cursor-not-allowed border border-white/[0.07]"
                      : "btn-gold cursor-pointer"
                  )}
                >
                  Next
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M3 7H11M8 4L11 7L8 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
              </>
            ) : (
              <>
                {/* Page 1: skip hint + Launch Sandbox */}
                <span className="flex-1 font-[family-name:--font-cormorant] text-[18px] italic text-white/55">
                  Leave blank to skip intent filtering
                </span>

                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={isGenerating || isSimplifying}
                  className={cn(
                    "flex-shrink-0 font-[family-name:--font-cinzel] text-[16px] tracking-[0.14em] px-7 py-3 rounded-xl transition-all duration-200",
                    isGenerating || isSimplifying
                      ? "bg-white/[0.05] text-white/20 cursor-not-allowed border border-white/[0.07]"
                      : "btn-gold cursor-pointer"
                  )}
                >
                  {isSimplifying
                    ? "Filtering..."
                    : isGenerating
                    ? "Starting..."
                    : simplifyPreview
                    ? `Launch Sandbox · ${simplifyPreview.filteredTools.length} tool${simplifyPreview.filteredTools.length !== 1 ? "s" : ""}`
                    : `Launch Sandbox · ${tools.length} tool${tools.length !== 1 ? "s" : ""}`}
                </button>
              </>
            )}
          </div>

        </div>
      </main>

      </div>{/* end blurrable wrapper */}

      {/* ── Tool Selection Popup ───────────────────────────────────────── */}
      {popupOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center animate-fade-in">
          <div className="fixed inset-0 bg-black/50" onClick={() => !popupLoading && setPopupOpen(false)} />
          <div className="relative glass-mid rounded-3xl w-[560px] max-h-[72vh] flex flex-col
            shadow-[0_40px_100px_rgba(0,0,0,0.6)] animate-fade-up overflow-hidden">

            {/* Header */}
            <div className="flex items-center justify-between px-8 pt-7 pb-4 flex-shrink-0">
              <span className="font-[family-name:--font-cinzel] text-[22px] tracking-[0.15em] text-white/90">Select Tools</span>
              {!popupLoading && (
                <button type="button" onClick={() => setPopupOpen(false)}
                  className="text-white/30 hover:text-white/65 transition-colors cursor-pointer">
                  <X size={18} strokeWidth={1.5} />
                </button>
              )}
            </div>
            <div className="h-px bg-white/[0.09] mx-6 flex-shrink-0" />

            {popupLoading ? (
              <div className="flex flex-col items-center justify-center py-16 gap-4">
                <div className="flex gap-2 items-center">
                  <div className="w-2 h-2 rounded-full bg-[#C9A84C]/60 dot-1" />
                  <div className="w-2 h-2 rounded-full bg-[#C9A84C]/60 dot-2" />
                  <div className="w-2 h-2 rounded-full bg-[#C9A84C]/60 dot-3" />
                </div>
                <span className="font-[family-name:--font-cinzel] text-[14px] tracking-widest text-white/35">Parsing spec...</span>
              </div>
            ) : (
              <>
                <div className="px-8 py-3 flex items-center justify-between flex-shrink-0 border-b border-white/[0.07]">
                  <span className="font-[family-name:--font-cinzel] text-[13px] tracking-wider text-white/40">
                    {popupSelected.size} / {popupTools.length} selected
                  </span>
                  <button type="button" onClick={toggleSelectAll}
                    className="font-[family-name:--font-cinzel] text-[13px] tracking-wider text-white/35 hover:text-[#C9A84C]/80 transition-colors cursor-pointer">
                    {popupSelected.size === popupTools.length ? "Deselect All" : "Select All"}
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto">
                  {popupTools.map((tool, i) => {
                    const sel = popupSelected.has(tool.name)
                    return (
                      <div
                        key={tool.name}
                        onClick={() => setPopupSelected(prev => {
                          const next = new Set(prev)
                          if (sel) next.delete(tool.name)
                          else next.add(tool.name)
                          return next
                        })}
                        className={cn(
                          "flex items-start gap-4 px-8 py-3 cursor-pointer transition-colors border-b border-white/[0.05]",
                          sel ? "hover:bg-white/[0.04]" : "bg-black/[0.08] hover:bg-black/[0.04]"
                        )}
                      >
                        <div className={cn(
                          "flex-shrink-0 w-4 h-4 rounded mt-0.5 border flex items-center justify-center transition-all",
                          sel ? "border-[#C9A84C]/50 bg-[#C9A84C]/15" : "border-white/[0.18] bg-transparent"
                        )}>
                          {sel && (
                            <svg width="8" height="6" viewBox="0 0 8 6" fill="none">
                              <path d="M1 3L3 5L7 1" stroke="#C9A84C" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          )}
                        </div>
                        <div className="flex flex-col gap-0.5 min-w-0">
                          <div className="flex items-center gap-2">
                            {tool.handler?.method && (
                              <span className={cn(
                                "flex-shrink-0 font-[family-name:--font-geist-mono] text-[11px] tracking-widest px-1.5 py-0.5 rounded",
                                sel
                                  ? (METHOD_STYLES[tool.handler.method.toUpperCase()] ?? "method-get")
                                  : "bg-white/[0.04] text-white/20 border border-white/[0.07]"
                              )}>
                                {tool.handler.method.toUpperCase()}
                              </span>
                            )}
                            <span className={cn(
                              "font-[family-name:--font-cinzel] text-[14px] tracking-wider truncate",
                              sel ? "text-white/85" : "text-white/35"
                            )}>
                              {tool.name}
                            </span>
                          </div>
                          {tool.description && (
                            <span className="font-[family-name:--font-cormorant] text-[16px] text-white/30 leading-snug line-clamp-1">
                              {tool.description}
                            </span>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>

                <div className="border-t border-white/[0.09] p-5 flex-shrink-0">
                  <button
                    type="button"
                    onClick={handlePopupConfirm}
                    disabled={popupSelected.size === 0}
                    className={cn(
                      "w-full font-[family-name:--font-cinzel] py-3.5 text-[16px] tracking-[0.14em] rounded-xl transition-all duration-200",
                      popupSelected.size === 0
                        ? "bg-white/[0.05] text-white/20 cursor-not-allowed"
                        : "btn-gold cursor-pointer"
                    )}
                  >
                    Add {popupSelected.size} Tool{popupSelected.size !== 1 ? "s" : ""}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

    </div>
  )
}
