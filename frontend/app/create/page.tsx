// Create page — user assembles a tool list from multiple sources, then launches the sandbox.
// Start: cd backend → npx tsx server.ts && npx tsx api.ts | cd frontend → npm run dev
// Runs on: http://localhost:3001/create

"use client"
import Image from "next/image"
import Link from "next/link"
import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Search, ChevronDown, ChevronRight, X } from "lucide-react"

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

interface PendingDraft {
  specId?: string
  spec?: unknown
  baseUrl: string
  toolCount?: number
  catalog?: PopupTool[]
}

interface ParseSpecResponse {
  error?: string
  specId?: string
  spec?: unknown
  baseUrl?: string
  toolCount?: number
  catalog?: PopupTool[]
}

const METHOD_STYLES: Record<string, string> = {
  GET:    "border border-gray-300 text-gray-500 bg-white",
  POST:   "bg-gray-800 text-white",
  PUT:    "bg-gray-600 text-white",
  PATCH:  "bg-gray-500 text-white",
  DELETE: "bg-black text-white",
}

const SOURCE_LABEL: Record<string, string> = {
  custom:  "CUSTOM",
  premade: "API",
  past:    "PAST",
}

const SOURCE_STYLE: Record<string, string> = {
  custom:  "bg-black text-white",
  premade: "bg-gray-600 text-white",
  past:    "bg-gray-200 text-gray-600",
}

const RECOMMENDED_APIS = [
  { name: "Stripe",       description: "Payments & billing",   color: "bg-[#635BFF]", initials: "St" },
  { name: "GitHub",       description: "Code repositories",    color: "bg-[#24292E]", initials: "GH" },
  { name: "Slack",        description: "Team messaging",       color: "bg-[#4A154B]", initials: "Sl" },
  { name: "OpenWeather",  description: "Weather data",         color: "bg-[#E8421C]", initials: "OW" },
  { name: "Notion",       description: "Docs & databases",     color: "bg-black",     initials: "No" },
  { name: "Linear",       description: "Issue tracking",       color: "bg-[#5E6AD2]", initials: "Li" },
  { name: "Twilio",       description: "SMS & voice",          color: "bg-[#F22F46]", initials: "Tw" },
  { name: "Airtable",     description: "Spreadsheet database", color: "bg-[#18BFFF]", initials: "At" },
]

export default function Create() {
  // Right panel — custom tool form
  const [url, setUrl]       = useState("")
  const [apiName, setApiName] = useState("")
  const [intent, setIntent] = useState("")
  const [formError, setFormError] = useState("")
  const [isCreating, setIsCreating] = useState(false)

  // Right panel — browse
  const [servers, setServers]       = useState<SavedServer[]>([])
  const [searchQuery, setSearchQuery] = useState("")

  // Left panel — tool list
  const [tools, setTools]           = useState<ToolItem[]>([])
  const [expanded, setExpanded]     = useState<Set<string>>(new Set())
  const [isGenerating, setIsGenerating] = useState(false)
  const [generateError, setGenerateError] = useState("")

  // Popup
  const [popupOpen, setPopupOpen]       = useState(false)
  const [popupLoading, setPopupLoading] = useState(false)
  const [popupTools, setPopupTools]     = useState<PopupTool[]>([])
  const [popupSelected, setPopupSelected] = useState<Set<string>>(new Set())
  const [pendingSource, setPendingSource] = useState<"custom" | "premade" | "past">("custom")
  const [pendingApiName, setPendingApiName] = useState("")
  const [pendingDraft, setPendingDraft]   = useState<PendingDraft | null>(null)

  const router = useRouter()

  useEffect(() => {
    fetch("http://localhost:8000/api/servers")
      .then(res => res.json())
      .then(data => setServers(data.servers ?? []))
      .catch(() => {})
  }, [])

  // Parses the spec URL, opens the popup immediately in loading state, then populates it when the response arrives.
  const handleCreateTool = async () => {
    if (!url || !apiName) { setFormError("Spec URL and API Name are required."); return }
    setFormError("")
    setIsCreating(true)
    setPopupLoading(true)
    setPopupOpen(true)
    setPendingSource("custom")
    setPendingApiName(apiName)

    let res: Response, data: ParseSpecResponse
    try {
      res  = await fetch("http://localhost:8000/api/spec/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, name: apiName }),
      })
      data = await res.json()
    } catch {
      setFormError("Could not reach the server.")
      setPopupOpen(false)
      setPopupLoading(false)
      setIsCreating(false)
      return
    }

    if (!res.ok) {
      setFormError(data.error ?? "")
      setPopupOpen(false)
      setPopupLoading(false)
      setIsCreating(false)
      return
    }

    const catalog: PopupTool[] = data.catalog ?? []
    setPendingDraft({ specId: data.specId, spec: data.spec, baseUrl: data.baseUrl ?? "", toolCount: data.toolCount, catalog })
    setPopupTools(catalog)
    setPopupSelected(new Set(catalog.map((t: PopupTool) => t.name)))
    setPopupLoading(false)
    setIsCreating(false)
  }

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
    setTools(prev => [...prev, ...newTools])
    if (pendingDraft?.specId) {
      sessionStorage.setItem(`helios_draft_${pendingDraft.specId}`, JSON.stringify(pendingDraft))
    }
    setPopupOpen(false)
    setUrl("")
    setApiName("")
    setIntent("")
  }

  const toggleSelectAll = () => {
    setPopupSelected(
      popupSelected.size === popupTools.length
        ? new Set()
        : new Set(popupTools.map(t => t.name))
    )
  }

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) { next.delete(id) } else { next.add(id) }
      return next
    })
  }

  const removeTool = (id: string) => setTools(prev => prev.filter(t => t.id !== id))

  const handlePastServerClick = async (serverId: string) => {
    setPopupLoading(true)
    setPopupOpen(true)
    setPendingSource("past")
    setPendingApiName(serverId)
    setPendingDraft(null)

    const res  = await fetch(`http://localhost:8000/api/servers/${serverId}/catalog`)
    const data = await res.json()

    if (!res.ok || data.error) {
      setPopupOpen(false)
      setPopupLoading(false)
      return
    }

    const catalog: PopupTool[] = (data.catalog ?? []).filter((t: PopupTool) => t.enabled !== false)
    setPendingDraft({ baseUrl: data.baseUrl ?? "" })
    setPopupTools(catalog)
    setPopupSelected(new Set(catalog.map((t: PopupTool) => t.name)))
    setPopupLoading(false)
  }

  const handleGenerate = async () => {
    if (tools.length === 0 || isGenerating) return
    setIsGenerating(true)
    setGenerateError("")

    // Multi-API tools can't share a single baseUrl, so baseUrl is set to ""
    // and each tool's full URL is embedded directly into handler.path.
    const registryTools = tools.map(t => ({
      name:         t.name,
      description:  t.description,
      input_schema: t.input_schema ?? { type: "object", properties: {} },
      handler: {
        method:       t.method ?? "GET",
        path:         t.baseUrl ? `${t.baseUrl}${t.path ?? ""}` : (t.path ?? ""),
        headers:      {},
        query_params: t.handler?.query_params ?? []
      }
    }))

    try {
      const res  = await fetch("http://localhost:8000/api/sandbox/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toolsRegistry: { baseUrl: "", tools: registryTools } })
      })
      const data = await res.json()
      if (!res.ok) {
        setGenerateError(data.error ?? "Failed to start sandbox.")
        setIsGenerating(false)
        return
      }
      // Store the active session in sessionStorage so the sandbox page can pick it up
      // without making another /sandbox/start call.
      const syntheticId = `_composite_${Date.now()}`
      sessionStorage.setItem(`helios_session_${syntheticId}`, JSON.stringify({
        sessionId: data.sessionId,
        tools:     data.tools
      }))
      router.push(`/sandbox?compositeId=${syntheticId}`)
    } catch {
      setGenerateError("Could not reach the server.")
      setIsGenerating(false)
    }
  }

  const q = searchQuery.toLowerCase()
  const filteredApis    = RECOMMENDED_APIS.filter(a => a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q))
  const filteredServers = servers.filter(s => s.id.toLowerCase().includes(q))

  return (
    <div className="flex flex-col h-screen w-full bg-white">

      {/* Nav */}
      <nav className="flex items-center justify-between px-6 pl-20 flex-shrink-0">
        <Link href="/">
          <Image src="/logoName.svg" alt="Helios" width={200} height={200} className="cursor-pointer" />
        </Link>
        <div className="flex items-center gap-4 font-[family-name:--font-cinzel] text-[32px] tracking-widest">
          <span className="flex flex-col items-center text-black">
            Create
            <span className="block h-[2px] w-full bg-black mt-[-4px]"></span>
          </span>
          <span className="text-gray-400 text-[20px] mb-1">✦</span>
          <span className="text-gray-400">Sandbox</span>
          <span className="text-gray-400 text-[20px] mb-1">✦</span>
          <span className="text-gray-400">Verify</span>
          <span className="text-gray-400 text-[20px] mb-1">✦</span>
          <span className="text-gray-400">Download</span>
        </div>
        <div className="w-[220px]"></div>
      </nav>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden border-t-[2px] border-black">

        {/* ── LEFT — Tool List ─────────────────────────────────── */}
        <div className="flex flex-col w-[400px] flex-shrink-0 border-r-[2px] border-black">

          {/* Header */}
          <div className="px-6 py-4 flex items-baseline justify-between flex-shrink-0">
            <span className="font-[family-name:--font-cinzel] text-[22px] tracking-widest">Tool List</span>
            {tools.length > 0 && (
              <span className="font-[family-name:--font-cinzel] text-[14px] text-gray-400 tracking-widest">
                {tools.length} tool{tools.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>
          <div className="h-[2px] bg-black flex-shrink-0"></div>

          {/* Tools — grouped by API name */}
          <div className="flex-1 overflow-y-auto">
            {tools.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <span className="font-[family-name:--font-cinzel] text-gray-400 text-[13px] tracking-widest text-center px-10">
                  No tools yet —<br />add from the right.
                </span>
              </div>
            ) : (() => {
                // Group tools by apiName
                const groups: { apiName: string; source: ToolItem["source"]; items: ToolItem[] }[] = []
                tools.forEach(tool => {
                  const g = groups.find(g => g.apiName === tool.apiName)
                  if (g) g.items.push(tool)
                  else groups.push({ apiName: tool.apiName, source: tool.source, items: [tool] })
                })
                return groups.map((group, gi) => {
                  const isExpanded = expanded.has(group.apiName)
                  return (
                    <div key={group.apiName} className={cn(gi !== groups.length - 1 && "border-b-[1px] border-gray-200")}>
                      {/* Group row */}
                      <div
                        className="flex items-center gap-3 px-5 py-3 cursor-pointer hover:bg-gray-50 transition-colors duration-150"
                        onClick={() => toggleExpand(group.apiName)}
                      >
                        {isExpanded
                          ? <ChevronDown  size={13} strokeWidth={1.5} className="flex-shrink-0 text-gray-400" />
                          : <ChevronRight size={13} strokeWidth={1.5} className="flex-shrink-0 text-gray-400" />
                        }
                        <span className={cn("flex-shrink-0 font-[family-name:--font-cinzel] text-[8px] tracking-widest px-1.5 py-0.5", SOURCE_STYLE[group.source])}>
                          {SOURCE_LABEL[group.source]}
                        </span>
                        <span className="font-[family-name:--font-cinzel] text-[13px] tracking-wider text-black truncate flex-1">
                          {group.apiName}
                        </span>
                        <span className="font-[family-name:--font-cinzel] text-[11px] text-gray-400 tracking-widest flex-shrink-0">
                          {group.items.length}
                        </span>
                      </div>

                      {/* Individual tools */}
                      {isExpanded && (
                        <div className="border-t-[1px] border-gray-100">
                          {group.items.map((tool, ti) => (
                            <div
                              key={tool.id}
                              className={cn(
                                "flex items-center gap-3 pl-10 pr-5 py-2.5 bg-gray-50",
                                ti !== group.items.length - 1 && "border-b-[1px] border-gray-100"
                              )}
                            >
                              {tool.method && (
                                <span className={cn(
                                  "flex-shrink-0 font-[family-name:--font-geist-mono] text-[9px] tracking-widest px-1.5 py-0.5",
                                  METHOD_STYLES[tool.method.toUpperCase()] ?? "bg-gray-400 text-white"
                                )}>
                                  {tool.method.toUpperCase()}
                                </span>
                              )}
                              <span className="font-[family-name:--font-cinzel] text-[12px] tracking-wider text-black truncate flex-1">
                                {tool.name}
                              </span>
                              <button
                                aria-label="Remove tool"
                                onClick={() => removeTool(tool.id)}
                                className="flex-shrink-0 text-gray-300 hover:text-black transition-colors duration-150 cursor-pointer"
                              >
                                <X size={13} strokeWidth={1.5} />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })
              })()
            }
          </div>

          {/* Generate Server */}
          <div className="border-t-[2px] border-black p-6 flex-shrink-0">
            {generateError && (
              <p className="font-[family-name:--font-cinzel] text-red-600 text-[11px] tracking-wider mb-3 text-center">{generateError}</p>
            )}
            <button
              onClick={handleGenerate}
              disabled={tools.length === 0 || isGenerating}
              className={cn(
                "font-[family-name:--font-cinzel] w-full py-4 text-[16px] tracking-widest border-[2px] relative",
                "before:absolute before:inset-[4px] before:border-[1px] before:pointer-events-none transition-colors duration-300",
                tools.length === 0 || isGenerating
                  ? "cursor-not-allowed text-gray-300 border-gray-200 before:border-gray-200"
                  : "cursor-pointer text-black border-black before:border-black hover:bg-black hover:text-white hover:before:border-white"
              )}
            >
              {isGenerating ? "Starting..." : "Generate Server"}
            </button>
          </div>
        </div>

        {/* ── RIGHT — Add Tools ────────────────────────────────── */}
        <div className="flex flex-col flex-1 overflow-hidden">

          {/* Search — fixed at top */}
          <div className="flex-shrink-0 px-8 pt-5 pb-4 border-b-[1px] border-gray-200">
            <div className="flex items-center gap-3 border-[1px] border-gray-300 px-4 py-3 focus-within:border-black transition-colors duration-200">
              <Search size={15} strokeWidth={1.5} className="text-gray-400 flex-shrink-0" />
              <input
                type="text"
                placeholder="Search APIs or your servers..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="flex-1 font-[family-name:--font-cinzel] text-[13px] tracking-wider outline-none placeholder:text-gray-400 bg-transparent"
              />
            </div>
          </div>

          {/* Scrollable — Browse then Custom Tool */}
          <div className="flex-1 overflow-y-auto">
            <div className="px-8 py-6 flex flex-col gap-8">

              {/* Recommended */}
              <div className="flex flex-col gap-3">
                <span className="font-[family-name:--font-cinzel] text-[11px] tracking-widest text-gray-400 uppercase">Recommended</span>
                {filteredApis.length === 0 ? (
                  <span className="font-[family-name:--font-cinzel] text-[13px] text-gray-400 tracking-wider">No matches.</span>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    {filteredApis.map(api => (
                      <div
                        key={api.name}
                        className="flex items-center gap-3 border-[1px] border-gray-200 px-4 py-3 cursor-pointer hover:border-black transition-colors duration-200"
                      >
                        <div className={cn("flex-shrink-0 w-8 h-8 flex items-center justify-center", api.color)}>
                          <span className="font-[family-name:--font-cinzel] text-[10px] tracking-wider text-white">{api.initials}</span>
                        </div>
                        <div className="flex flex-col min-w-0">
                          <span className="font-[family-name:--font-cinzel] text-[13px] tracking-wider text-black truncate">{api.name}</span>
                          <span className="font-[family-name:--font-geist-sans] text-[11px] text-gray-400 truncate">{api.description}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Your Servers */}
              <div className="flex flex-col gap-3">
                <span className="font-[family-name:--font-cinzel] text-[11px] tracking-widest text-gray-400 uppercase">Your Servers</span>
                {filteredServers.length === 0 ? (
                  <span className="font-[family-name:--font-cinzel] text-[13px] text-gray-400 tracking-wider">
                    {searchQuery ? "No matches." : "No servers yet."}
                  </span>
                ) : (
                  <div className="flex flex-col gap-2">
                    {filteredServers.map(server => (
                      <div
                        key={server.id}
                        onClick={() => handlePastServerClick(server.id)}
                        className="flex items-center justify-between border-[1px] border-gray-200 px-5 py-3 cursor-pointer hover:border-black transition-colors duration-200"
                      >
                        <div className="flex flex-col min-w-0">
                          <span className="font-[family-name:--font-cinzel] text-[13px] tracking-wider text-black truncate">{server.id}</span>
                          <span className="font-[family-name:--font-geist-mono] text-[11px] text-gray-400 truncate">{server.baseUrl || "—"}</span>
                        </div>
                        <span className="font-[family-name:--font-cinzel] text-[12px] tracking-wider text-gray-400 flex-shrink-0 ml-4">
                          {server.toolCount} tools
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Custom Tool — hard separated from browse */}
          <div className="flex-shrink-0 border-t-[2px] border-black px-8 py-6 flex flex-col gap-3">
            <span className="font-[family-name:--font-cinzel] text-[11px] tracking-widest text-gray-400 uppercase">Custom Tool</span>

            {formError && (
              <p className="font-[family-name:--font-cinzel] text-red-600 text-[12px] tracking-wider">{formError}</p>
            )}

            <input
              className="font-[family-name:--font-cinzel] border-[1px] border-gray-300 px-4 py-3 text-[14px] tracking-wider outline-none focus:border-black transition-colors duration-200 placeholder:text-gray-400"
              type="text"
              placeholder="Spec URL"
              value={url}
              onChange={e => setUrl(e.target.value)}
            />
            <input
              className="font-[family-name:--font-cinzel] border-[1px] border-gray-300 px-4 py-3 text-[14px] tracking-wider outline-none focus:border-black transition-colors duration-200 placeholder:text-gray-400"
              type="text"
              placeholder="API Name"
              value={apiName}
              onChange={e => setApiName(e.target.value)}
            />
            <textarea
              className="font-[family-name:--font-cinzel] border-[1px] border-gray-300 px-4 py-3 text-[14px] tracking-wider outline-none focus:border-black transition-colors duration-200 placeholder:text-gray-400 resize-none"
              rows={2}
              placeholder="What do you want this tool to do? (optional)"
              value={intent}
              onChange={e => setIntent(e.target.value)}
            />
            <button
              onClick={handleCreateTool}
              disabled={isCreating}
              className={cn(
                "font-[family-name:--font-cinzel] w-full py-3 text-[14px] tracking-widest border-[2px] relative",
                "before:absolute before:inset-[3px] before:border-[1px] before:pointer-events-none transition-colors duration-300",
                isCreating
                  ? "cursor-not-allowed text-gray-400 border-gray-300 before:border-gray-300"
                  : "cursor-pointer text-black border-black before:border-black hover:bg-black hover:text-white hover:before:border-white"
              )}
            >
              {isCreating ? "Parsing..." : "Create Tool"}
            </button>
          </div>

          {/* Back */}
          <div className="border-t-[1px] border-gray-200 px-8 py-4 flex-shrink-0">
            <Link href="/" className="font-[family-name:--font-cinzel] text-[12px] tracking-widest text-gray-400 hover:text-black transition-colors duration-200">
              ← Back
            </Link>
          </div>
        </div>
      </div>

      {/* ── Tool Selection Popup ──────────────────────────────── */}
      {popupOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={() => !popupLoading && setPopupOpen(false)} />
          <div className="relative bg-white border-[2px] border-black w-[560px] max-h-[70vh] flex flex-col
            before:absolute before:inset-[6px] before:border-[1px] before:border-black before:pointer-events-none">

            {/* Header */}
            <div className="flex items-center justify-between px-8 pt-7 pb-4 flex-shrink-0">
              <span className="font-[family-name:--font-cinzel] text-[20px] tracking-widest">Select Tools</span>
              {!popupLoading && (
                <button type="button" aria-label="Close" onClick={() => setPopupOpen(false)} className="text-gray-400 hover:text-black transition-colors cursor-pointer">
                  <X size={18} strokeWidth={1.5} />
                </button>
              )}
            </div>
            <div className="h-[1px] bg-gray-200 mx-8 flex-shrink-0"></div>

            {popupLoading ? (
              <div className="flex items-center justify-center py-16">
                <span className="font-[family-name:--font-cinzel] text-[13px] tracking-widest text-gray-400">
                  Parsing spec...
                </span>
              </div>
            ) : (
              <>
                {/* Select all bar */}
                <div className="px-8 py-3 flex items-center justify-between flex-shrink-0 border-b-[1px] border-gray-100">
                  <span className="font-[family-name:--font-cinzel] text-[12px] tracking-widest text-gray-400">
                    {popupSelected.size} / {popupTools.length} selected
                  </span>
                  <button
                    type="button"
                    onClick={toggleSelectAll}
                    className="font-[family-name:--font-cinzel] text-[11px] tracking-widest text-gray-400 hover:text-black transition-colors cursor-pointer"
                  >
                    {popupSelected.size === popupTools.length ? "Deselect All" : "Select All"}
                  </button>
                </div>

                {/* Tool list */}
                <div className="flex-1 overflow-y-auto">
                  {popupTools.map((tool, i) => {
                    const sel = popupSelected.has(tool.name)
                    return (
                      <div
                        key={tool.name}
                        onClick={() => setPopupSelected(prev => {
                          const next = new Set(prev)
                          if (sel) { next.delete(tool.name) } else { next.add(tool.name) }
                          return next
                        })}
                        className={cn(
                          "flex items-start gap-4 px-8 py-3 cursor-pointer transition-colors duration-150",
                          i !== popupTools.length - 1 && "border-b-[1px] border-gray-100",
                          sel ? "bg-white hover:bg-gray-50" : "bg-gray-50 hover:bg-gray-100"
                        )}
                      >
                        <div className={cn(
                          "flex-shrink-0 w-4 h-4 border-[2px] mt-0.5 flex items-center justify-center transition-colors duration-150",
                          sel ? "border-black bg-black" : "border-gray-300 bg-white"
                        )}>
                          {sel && (
                            <svg width="8" height="6" viewBox="0 0 8 6" fill="none">
                              <path d="M1 2.5L3 5L7 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          )}
                        </div>
                        <div className="flex flex-col gap-1 min-w-0">
                          <div className="flex items-center gap-2">
                            {tool.handler?.method && (
                              <span className={cn(
                                "flex-shrink-0 font-[family-name:--font-geist-mono] text-[9px] tracking-widest px-1.5 py-0.5",
                                sel ? (METHOD_STYLES[tool.handler.method.toUpperCase()] ?? "bg-gray-400 text-white") : "border border-gray-200 text-gray-300"
                              )}>
                                {tool.handler.method.toUpperCase()}
                              </span>
                            )}
                            <span className={cn(
                              "font-[family-name:--font-cinzel] text-[12px] tracking-wider truncate",
                              sel ? "text-black" : "text-gray-400"
                            )}>
                              {tool.name}
                            </span>
                          </div>
                          {tool.description && (
                            <span className="font-[family-name:--font-geist-sans] text-[11px] text-gray-400 leading-snug">
                              {tool.description}
                            </span>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* Confirm */}
                <div className="px-8 pb-7 pt-4 flex-shrink-0 border-t-[1px] border-gray-100">
                  <button
                    onClick={handlePopupConfirm}
                    disabled={popupSelected.size === 0}
                    className={cn(
                      "font-[family-name:--font-cinzel] w-full py-4 text-[15px] tracking-widest border-[2px] relative",
                      "before:absolute before:inset-[4px] before:border-[1px] before:pointer-events-none transition-colors duration-300",
                      popupSelected.size === 0
                        ? "cursor-not-allowed text-gray-300 border-gray-200 before:border-gray-200"
                        : "cursor-pointer text-black border-black before:border-black hover:bg-black hover:text-white hover:before:border-white"
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
