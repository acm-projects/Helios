// Create page — user assembles a tool list from multiple sources, then launches the sandbox.
// Start: cd backend → npx tsx server.ts && npx tsx api.ts | cd frontend → npm run dev
// Runs on: http://localhost:3001/create

"use client"
import Image from "next/image"
import Link from "next/link"
import { useState, useEffect, useRef, useCallback } from "react"
import { useRouter } from "next/navigation"
import { Search, X, ChevronDown, ChevronRight, Info } from "lucide-react"

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

const RECOMMENDED_APIS = [
  { name: "Stripe",      description: "Payments & billing",   color: "bg-[#635BFF]", initials: "St" },
  { name: "GitHub",      description: "Code repositories",    color: "bg-[#24292E]", initials: "GH" },
  { name: "Slack",       description: "Team messaging",       color: "bg-[#4A154B]", initials: "Sl" },
  { name: "OpenWeather", description: "Weather data",         color: "bg-[#E8421C]", initials: "OW" },
  { name: "Notion",      description: "Docs & databases",     color: "bg-black",     initials: "No" },
  { name: "Linear",      description: "Issue tracking",       color: "bg-[#5E6AD2]", initials: "Li" },
  { name: "Twilio",      description: "SMS & voice",          color: "bg-[#F22F46]", initials: "Tw" },
  { name: "Airtable",    description: "Spreadsheet database", color: "bg-[#18BFFF]", initials: "At" },
]

export default function Create() {
  const [url, setUrl]           = useState("")
  const [apiName, setApiName]   = useState("")
  const [formError, setFormError] = useState("")
  const [isCreating, setIsCreating] = useState(false)

  const [servers, setServers]   = useState<SavedServer[]>([])
  const [searchQuery, setSearchQuery] = useState("")
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [customOpen, setCustomOpen]     = useState(false)
  const [activeMethod, setActiveMethod] = useState<"url" | "json">("url")
  const [intent, setIntent]             = useState("")
  const [jsonIntent, setJsonIntent]     = useState("")
  const [isDragging, setIsDragging] = useState(false)
  const [jsonError, setJsonError]   = useState("")
  const [jsonName, setJsonName]     = useState("")
  const [isParsing, setIsParsing]   = useState(false)

  const [tools, setTools]       = useState<ToolItem[]>([])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [isGenerating, setIsGenerating] = useState(false)
  const [generateError, setGenerateError] = useState("")

  const [popupOpen, setPopupOpen]           = useState(false)
  const [popupLoading, setPopupLoading]     = useState(false)
  const [popupTools, setPopupTools]         = useState<PopupTool[]>([])
  const [popupSelected, setPopupSelected]   = useState<Set<string>>(new Set())
  const [pendingSource, setPendingSource]   = useState<"custom" | "premade" | "past">("custom")
  const [pendingApiName, setPendingApiName] = useState("")
  const [pendingDraft, setPendingDraft]     = useState<PendingDraft | null>(null)

  const router      = useRouter()
  const searchRef   = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetch("http://localhost:8000/api/servers")
      .then(res => res.json())
      .then(data => setServers(data.servers ?? []))
      .catch(() => {})
  }, [])

  // Close dropdown when clicking outside the search container
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  // Core parse logic — shared by the spec URL form and recommended API clicks
  const triggerParse = async (specUrl: string, name: string, onError: (msg: string) => void) => {
    setIsCreating(true)
    setPopupLoading(true)
    setPopupOpen(true)
    setPendingSource("custom")
    setPendingApiName(name)

    let res: Response, data: ParseSpecResponse
    try {
      res  = await fetch("http://localhost:8000/api/spec/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: specUrl, name }),
      })
      data = await res.json()
    } catch {
      onError("Could not reach the server.")
      setPopupOpen(false)
      setPopupLoading(false)
      setIsCreating(false)
      return
    }

    if (!res.ok) {
      onError(data.error ?? "Failed to parse spec.")
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

  const handleCreateTool = async () => {
    if (!url || !apiName) { setFormError("Spec URL and API Name are required."); return }
    setFormError("")
    await triggerParse(url, apiName, msg => setFormError(msg))
  }


  const handleJsonFile = useCallback(async (file: File) => {
    if (!jsonName) { setJsonError("API Name is required before uploading."); return }
    if (!file.name.endsWith(".json")) { setJsonError("Only .json files are supported."); return }
    setJsonError("")
    setIsParsing(true)
    setPopupLoading(true)
    setPopupOpen(true)
    setPendingSource("custom")
    setPendingApiName(jsonName)

    let spec: unknown
    try {
      const text = await file.text()
      spec = JSON.parse(text)
    } catch {
      setJsonError("Could not parse file — make sure it is valid JSON.")
      setPopupOpen(false)
      setPopupLoading(false)
      setIsParsing(false)
      return
    }

    let res: Response, data: ParseSpecResponse
    try {
      res  = await fetch("http://localhost:8000/api/spec/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spec, name: jsonName }),
      })
      data = await res.json()
    } catch {
      setJsonError("Could not reach the server.")
      setPopupOpen(false)
      setPopupLoading(false)
      setIsParsing(false)
      return
    }

    if (!res.ok) {
      setJsonError(data.error ?? "Failed to parse spec.")
      setPopupOpen(false)
      setPopupLoading(false)
      setIsParsing(false)
      return
    }

    const catalog: PopupTool[] = data.catalog ?? []
    setPendingDraft({ specId: data.specId, spec: data.spec, baseUrl: data.baseUrl ?? "", toolCount: data.toolCount, catalog })
    setPopupTools(catalog)
    setPopupSelected(new Set(catalog.map((t: PopupTool) => t.name)))
    setPopupLoading(false)
    setIsParsing(false)
  }, [jsonName])

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
  }

  const toggleSelectAll = () => {
    setPopupSelected(
      popupSelected.size === popupTools.length
        ? new Set()
        : new Set(popupTools.map(t => t.name))
    )
  }

  const removeTool = (id: string) => setTools(prev => prev.filter(t => t.id !== id))

  const toggleExpand = (apiName: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(apiName)) { next.delete(apiName) } else { next.add(apiName) }
      return next
    })
  }

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

  const q               = searchQuery.toLowerCase()
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
        <div className="w-[220px]" />
      </nav>

      {/* Body — centered column */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[600px] mx-auto pt-16 pb-16 px-6 flex flex-col gap-8">

          {/* Heading */}
          <div className="flex flex-col gap-1">
            <h1 className="font-[family-name:--font-cinzel] text-[28px] tracking-widest text-black">Build Your Server</h1>
            <p className="font-[family-name:--font-geist-sans] text-[13px] text-gray-400">
              Add tools from your past servers, recommended APIs, or a custom spec URL.
            </p>
          </div>

          {/* Search bar + dropdown */}
          <div ref={searchRef} className="relative">
            <div
              className={cn(
                "flex items-center gap-3 border-[2px] px-4 py-3.5 transition-colors duration-200 cursor-text",
                dropdownOpen ? "border-black" : "border-gray-300 hover:border-gray-400"
              )}
              onClick={() => setDropdownOpen(true)}
            >
              <Search size={15} strokeWidth={1.5} className="text-gray-400 flex-shrink-0" />
              <input
                type="text"
                placeholder="Search your servers or recommended APIs..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onFocus={() => setDropdownOpen(true)}
                className="flex-1 font-[family-name:--font-cinzel] text-[13px] tracking-wider outline-none placeholder:text-gray-400 bg-transparent"
              />
              {searchQuery && (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={e => { e.stopPropagation(); setSearchQuery("") }}
                  className="text-gray-400 hover:text-black transition-colors"
                >
                  <X size={13} strokeWidth={1.5} />
                </button>
              )}
            </div>

            {/* Dropdown */}
            {dropdownOpen && (
              <div className="absolute top-full left-0 right-0 border-[2px] border-t-0 border-black bg-white z-20 max-h-[380px] overflow-y-auto">

                {/* Your Servers */}
                {filteredServers.length > 0 && (
                  <>
                    <div className="px-5 pt-3 pb-2">
                      <span className="font-[family-name:--font-cinzel] text-[10px] tracking-widest text-gray-400 uppercase">Your Servers</span>
                    </div>
                    {filteredServers.map((server, i) => (
                      <div
                        key={server.id}
                        onClick={() => { handlePastServerClick(server.id); setDropdownOpen(false); setSearchQuery("") }}
                        className={cn(
                          "flex items-center justify-between px-5 py-3 cursor-pointer hover:bg-gray-50 transition-colors",
                          i !== filteredServers.length - 1 && "border-b-[1px] border-gray-100"
                        )}
                      >
                        <div className="flex flex-col min-w-0">
                          <span className="font-[family-name:--font-cinzel] text-[13px] tracking-wider text-black truncate">{server.id}</span>
                          <span className="font-[family-name:--font-geist-mono] text-[11px] text-gray-400 truncate">{server.baseUrl || "—"}</span>
                        </div>
                        <span className="font-[family-name:--font-cinzel] text-[11px] text-gray-400 flex-shrink-0 ml-4">{server.toolCount} tools</span>
                      </div>
                    ))}
                  </>
                )}

                {/* Recommended APIs */}
                {filteredApis.length > 0 && (
                  <>
                    <div className={cn("px-5 pt-3 pb-2", filteredServers.length > 0 && "border-t-[1px] border-gray-200 mt-1")}>
                      <span className="font-[family-name:--font-cinzel] text-[10px] tracking-widest text-gray-400 uppercase">Recommended</span>
                    </div>
                    {filteredApis.map((api, i) => (
                      <div
                        key={api.name}
                        className={cn(
                          "flex items-center gap-3 px-5 py-3 cursor-not-allowed opacity-50",
                          i !== filteredApis.length - 1 && "border-b-[1px] border-gray-100"
                        )}
                      >
                        <div className={cn("w-7 h-7 flex items-center justify-center flex-shrink-0", api.color)}>
                          <span className="font-[family-name:--font-cinzel] text-[9px] tracking-wider text-white">{api.initials}</span>
                        </div>
                        <div className="flex flex-col min-w-0">
                          <span className="font-[family-name:--font-cinzel] text-[13px] tracking-wider text-black truncate">{api.name}</span>
                          <span className="font-[family-name:--font-geist-sans] text-[11px] text-gray-400 truncate">{api.description}</span>
                        </div>
                        <span className="ml-auto font-[family-name:--font-cinzel] text-[10px] tracking-widest text-gray-300 flex-shrink-0">SOON</span>
                      </div>
                    ))}
                  </>
                )}

                {filteredServers.length === 0 && filteredApis.length === 0 && (
                  <div className="px-5 py-8 text-center">
                    <span className="font-[family-name:--font-cinzel] text-[13px] text-gray-400 tracking-wider">No matches.</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Custom Tools — single card, expands with tabbed form */}
          <div className="flex flex-col">
            <button
              type="button"
              onClick={() => setCustomOpen(v => !v)}
              className={cn(
                "flex items-center justify-between px-5 py-4 border-[2px] relative cursor-pointer transition-colors duration-200",
                "before:absolute before:inset-[4px] before:border-[1px] before:pointer-events-none before:transition-colors before:duration-200",
                customOpen
                  ? "border-black bg-black text-white before:border-white"
                  : "border-black text-black hover:bg-black hover:text-white before:border-black hover:before:border-white"
              )}
            >
              <div className="flex flex-col items-start gap-1">
                <span className="font-[family-name:--font-cinzel] text-[14px] tracking-widest">Custom Tools</span>
                <span className={cn(
                  "font-[family-name:--font-geist-sans] text-[11px] transition-colors duration-200",
                  customOpen ? "text-gray-300" : "text-gray-400"
                )}>
                  Add tools from a spec URL or a downloaded JSON file
                </span>
              </div>
              <ChevronDown
                size={15}
                strokeWidth={1.5}
                className={cn("flex-shrink-0 ml-4 transition-transform duration-200", customOpen ? "rotate-180" : "")}
              />
            </button>

            {customOpen && (
              <div className="border-[2px] border-t-0 border-black">
                {/* Tabs */}
                <div className="flex border-b-[1px] border-gray-200">
                  {/* Spec URL tab */}
                  <button
                    type="button"
                    onClick={() => setActiveMethod("url")}
                    className={cn(
                      "flex-1 flex items-center justify-center gap-2 py-3 font-[family-name:--font-cinzel] text-[12px] tracking-widest transition-colors duration-150",
                      activeMethod === "url" ? "text-black border-b-[2px] border-black" : "text-gray-400 hover:text-black"
                    )}
                  >
                    Spec URL
                    <div className="relative group" onClick={e => e.stopPropagation()}>
                      <Info size={13} strokeWidth={1.5} className="text-black cursor-default" />
                      <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-[260px] bg-black text-white px-4 py-3 opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-30">
                        <p className="font-[family-name:--font-geist-sans] text-[11px] leading-relaxed">
                          A Spec URL points directly to an API&apos;s OpenAPI or Swagger documentation file (usually .json or .yaml). Most public APIs publish one — check the API&apos;s developer docs and look for an &quot;OpenAPI&quot;, &quot;Swagger&quot;, or &quot;API Reference&quot; link. Example: https://petstore.swagger.io/v2/swagger.json
                        </p>
                      </div>
                    </div>
                  </button>

                  {/* JSON File tab */}
                  <button
                    type="button"
                    onClick={() => setActiveMethod("json")}
                    className={cn(
                      "flex-1 flex items-center justify-center gap-2 py-3 font-[family-name:--font-cinzel] text-[12px] tracking-widest transition-colors duration-150",
                      activeMethod === "json" ? "text-black border-b-[2px] border-black" : "text-gray-400 hover:text-black"
                    )}
                  >
                    JSON File
                    <div className="relative group" onClick={e => e.stopPropagation()}>
                      <Info size={13} strokeWidth={1.5} className="text-black cursor-default" />
                      <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-[260px] bg-black text-white px-4 py-3 opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-30">
                        <p className="font-[family-name:--font-geist-sans] text-[11px] leading-relaxed">
                          The same OpenAPI/Swagger spec, but as a downloaded file. If you navigated to the spec URL in your browser and saved the page, or someone shared the file with you, drop it here. This is the raw API specification from the provider — not a tools.json generated by Helios.
                        </p>
                      </div>
                    </div>
                  </button>
                </div>

                {/* Spec URL form */}
                {activeMethod === "url" && (
                  <div className="flex flex-col gap-3 px-5 py-5">
                    {formError && (
                      <p className="font-[family-name:--font-cinzel] text-red-600 text-[11px] tracking-wider">{formError}</p>
                    )}
                    <input
                      className="font-[family-name:--font-cinzel] border-[1px] border-gray-300 px-4 py-3 text-[13px] tracking-wider outline-none focus:border-black transition-colors duration-200 placeholder:text-gray-400"
                      type="text"
                      placeholder="Spec URL"
                      value={url}
                      onChange={e => setUrl(e.target.value)}
                    />
                    <input
                      className="font-[family-name:--font-cinzel] border-[1px] border-gray-300 px-4 py-3 text-[13px] tracking-wider outline-none focus:border-black transition-colors duration-200 placeholder:text-gray-400"
                      type="text"
                      placeholder="API Name"
                      value={apiName}
                      onChange={e => setApiName(e.target.value)}
                    />
                    <textarea
                      className="font-[family-name:--font-cinzel] border-[1px] border-gray-300 px-4 py-3 text-[13px] tracking-wider outline-none focus:border-black transition-colors duration-200 placeholder:text-gray-400 resize-none"
                      rows={2}
                      placeholder="What do you want to do with this API? (optional)"
                      value={intent}
                      onChange={e => setIntent(e.target.value)}
                    />
                    <button
                      type="button"
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
                      {isCreating ? "Parsing..." : "Add Tools"}
                    </button>
                  </div>
                )}

                {/* JSON file form */}
                {activeMethod === "json" && (
                  <div className="flex flex-col gap-3 px-5 py-5">
                    {jsonError && (
                      <p className="font-[family-name:--font-cinzel] text-red-600 text-[11px] tracking-wider">{jsonError}</p>
                    )}
                    <div
                      className={cn(
                        "flex flex-col items-center justify-center gap-2 border-[2px] border-dashed py-10 transition-colors duration-150 cursor-pointer",
                        isDragging ? "border-black bg-gray-50" : "border-gray-300 hover:border-black"
                      )}
                      onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
                      onDragLeave={() => setIsDragging(false)}
                      onDrop={e => {
                        e.preventDefault()
                        setIsDragging(false)
                        const file = e.dataTransfer.files[0]
                        if (file) handleJsonFile(file)
                      }}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <span className="font-[family-name:--font-cinzel] text-[12px] tracking-widest text-gray-400">
                        {isParsing ? "Parsing..." : "Drop API spec .json here"}
                      </span>
                      <span className="font-[family-name:--font-geist-sans] text-[11px] text-gray-300">or click to browse</span>
                    </div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".json"
                      className="hidden"
                      onChange={e => {
                        const file = e.target.files?.[0]
                        if (file) handleJsonFile(file)
                        e.target.value = ""
                      }}
                    />
                    <input
                      className="font-[family-name:--font-cinzel] border-[1px] border-gray-300 px-4 py-3 text-[13px] tracking-wider outline-none focus:border-black transition-colors duration-200 placeholder:text-gray-400"
                      type="text"
                      placeholder="API Name"
                      value={jsonName}
                      onChange={e => setJsonName(e.target.value)}
                    />
                    <textarea
                      className="font-[family-name:--font-cinzel] border-[1px] border-gray-300 px-4 py-3 text-[13px] tracking-wider outline-none focus:border-black transition-colors duration-200 placeholder:text-gray-400 resize-none"
                      rows={2}
                      placeholder="What do you want to do with this API? (optional)"
                      value={jsonIntent}
                      onChange={e => setJsonIntent(e.target.value)}
                    />
                    <button
                      type="button"
                      onClick={() => { if (fileInputRef.current?.files?.[0]) handleJsonFile(fileInputRef.current.files[0]) }}
                      disabled={isParsing}
                      className={cn(
                        "font-[family-name:--font-cinzel] w-full py-3 text-[14px] tracking-widest border-[2px] relative",
                        "before:absolute before:inset-[3px] before:border-[1px] before:pointer-events-none transition-colors duration-300",
                        isParsing
                          ? "cursor-not-allowed text-gray-400 border-gray-300 before:border-gray-300"
                          : "cursor-pointer text-black border-black before:border-black hover:bg-black hover:text-white hover:before:border-white"
                      )}
                    >
                      {isParsing ? "Parsing..." : "Add Tools"}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Tool groups */}
          {tools.length > 0 && (() => {
            const groups: { apiName: string; source: ToolItem["source"]; items: ToolItem[] }[] = []
            tools.forEach(tool => {
              const g = groups.find(g => g.apiName === tool.apiName)
              if (g) g.items.push(tool)
              else groups.push({ apiName: tool.apiName, source: tool.source, items: [tool] })
            })
            return (
              <div className="border-[1px] border-gray-200">
                {groups.map((group, gi) => {
                  const isExpanded = expanded.has(group.apiName)
                  return (
                    <div key={group.apiName} className={cn(gi !== groups.length - 1 && "border-b-[1px] border-gray-200")}>
                      <div
                        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors duration-150"
                        onClick={() => toggleExpand(group.apiName)}
                      >
                        {isExpanded
                          ? <ChevronDown  size={13} strokeWidth={1.5} className="flex-shrink-0 text-gray-400" />
                          : <ChevronRight size={13} strokeWidth={1.5} className="flex-shrink-0 text-gray-400" />
                        }
                        <span className="font-[family-name:--font-cinzel] text-[13px] tracking-wider text-black flex-1 truncate">
                          {group.apiName}
                        </span>
                        <span className="font-[family-name:--font-cinzel] text-[11px] text-gray-400 tracking-widest flex-shrink-0">
                          {group.items.length} tool{group.items.length !== 1 ? "s" : ""}
                        </span>
                        <button
                          type="button"
                          aria-label={`Remove all tools from ${group.apiName}`}
                          onClick={e => { e.stopPropagation(); group.items.forEach(t => removeTool(t.id)) }}
                          className="flex-shrink-0 text-gray-300 hover:text-black transition-colors ml-2 cursor-pointer"
                        >
                          <X size={13} strokeWidth={1.5} />
                        </button>
                      </div>
                      {isExpanded && (
                        <div className="border-t-[1px] border-gray-100">
                          {group.items.map((tool, ti) => (
                            <div
                              key={tool.id}
                              className={cn(
                                "flex items-center gap-3 pl-9 pr-4 py-2.5 bg-gray-50",
                                ti !== group.items.length - 1 && "border-b-[1px] border-gray-100"
                              )}
                            >
                              {tool.method && (
                                <span className={cn(
                                  "flex-shrink-0 font-[family-name:--font-geist-mono] text-[8px] tracking-widest px-1.5 py-0.5",
                                  METHOD_STYLES[tool.method.toUpperCase()] ?? "bg-gray-400 text-white"
                                )}>
                                  {tool.method.toUpperCase()}
                                </span>
                              )}
                              <span className="font-[family-name:--font-cinzel] text-[12px] tracking-wider text-black truncate flex-1">
                                {tool.name}
                              </span>
                              <button
                                type="button"
                                aria-label="Remove tool"
                                onClick={() => removeTool(tool.id)}
                                className="flex-shrink-0 text-gray-300 hover:text-black transition-colors cursor-pointer"
                              >
                                <X size={12} strokeWidth={1.5} />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })()}

          {/* Generate */}
          {generateError && (
            <p className="font-[family-name:--font-cinzel] text-red-600 text-[11px] tracking-wider text-center">{generateError}</p>
          )}
          <button
            type="button"
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
            {isGenerating ? "Starting..." : tools.length > 0 ? `Generate Server · ${tools.length} tool${tools.length !== 1 ? "s" : ""}` : "Generate Server"}
          </button>

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
                    type="button"
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
