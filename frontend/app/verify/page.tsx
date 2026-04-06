"use client"
import { useState, useEffect } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import Image from "next/image"
import Link from "next/link"
import { getAuthHeaders } from "@/lib/auth"

const cn = (...classes: (string | undefined | null | false)[]) => classes.filter(Boolean).join(" ")

const METHOD_STYLES: Record<string, string> = {
  GET:    "border border-gray-300 text-gray-500 bg-white",
  POST:   "bg-gray-800 text-white",
  PUT:    "bg-gray-600 text-white",
  PATCH:  "bg-gray-500 text-white",
  DELETE: "bg-black text-white",
}

const METHOD_COLORS: Record<string, string> = {
  GET:    "bg-gray-200",
  POST:   "bg-gray-700",
  PUT:    "bg-gray-500",
  PATCH:  "bg-gray-400",
  DELETE: "bg-black",
}

interface CatalogEntry {
  name: string
  description: string
  enabled: boolean
  input_schema: {
    type: string
    properties: Record<string, unknown>
    required?: string[]
  }
  handler: {
    method: string
    path: string
    headers?: Record<string, string>
    query_params: string[]
  }
}

export default function Verify() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const specId      = searchParams.get("specId")
  const compositeId = searchParams.get("compositeId")

  const [catalog, setCatalog] = useState<CatalogEntry[]>(() => {
    if (compositeId) {
      const raw = sessionStorage.getItem(`helios_session_${compositeId}`)
      if (!raw) return []
      const { tools } = JSON.parse(raw)
      return (tools ?? []).map((t: any) => ({
        name:         t.function.name,
        description:  t.function.description ?? "",
        enabled:      t.enabled ?? true,
        input_schema: t.function.parameters ?? { type: "object", properties: {} },
        handler: { method: t.handler?.method ?? "GET", path: t.handler?.path ?? "", headers: {}, query_params: [] }
      }))
    }
    if (!specId) return []
    const draft = sessionStorage.getItem(`helios_draft_${specId}`)
    const draftData = draft ? JSON.parse(draft) : null
    return draftData?.catalog ?? []
  })
  const [isLoading, setIsLoading] = useState(() => {
    if (compositeId) return false
    if (!specId) return false
    const draft = sessionStorage.getItem(`helios_draft_${specId}`)
    const draftData = draft ? JSON.parse(draft) : null
    return !draftData?.catalog
  })
  const [isSaving, setIsSaving] = useState(false)
  const [serverName, setServerName] = useState("")
  const [nameError, setNameError]   = useState("")
  const [error, setError] = useState(!specId && !compositeId ? "No spec ID provided." : "")
  const [editingSet, setEditingSet] = useState<Set<number>>(new Set())

  useEffect(() => {
    if (compositeId) return // catalog already loaded from sessionStorage in useState
    if (!specId) return
    const draft = sessionStorage.getItem(`helios_draft_${specId}`)
    const draftData = draft ? JSON.parse(draft) : null
    if (draftData?.catalog) return  // already initialized via useState

    // Existing saved server — fetch from DB, then apply any sandbox toggle overrides
    fetch(`http://localhost:8000/api/servers/${specId}/catalog`, { headers: getAuthHeaders() })
        .then(res => res.json())
        .then(data => {
          if (data.error) { setError(data.error); setIsLoading(false); return }
          let catalog = data.catalog ?? []
          const togglesRaw = sessionStorage.getItem(`helios_toggles_${specId}`)
          if (togglesRaw) {
            const toggles: Record<string, boolean> = JSON.parse(togglesRaw)
            catalog = catalog.map((item: CatalogEntry) =>
              item.name in toggles ? { ...item, enabled: toggles[item.name] } : item
            )
            sessionStorage.removeItem(`helios_toggles_${specId}`)
          }
          setCatalog(catalog)
          setIsLoading(false)
        })
        .catch(() => { setError("Failed to reach the server."); setIsLoading(false) })
  }, [specId])

  const handleNameChange = (index: number, value: string) => {
    setCatalog(prev => prev.map((entry, i) => i === index ? { ...entry, name: value } : entry))
  }

  const handleDescriptionChange = (index: number, value: string) => {
    setCatalog(prev => prev.map((entry, i) => i === index ? { ...entry, description: value } : entry))
  }

  const handleToggle = (index: number) => {
    setCatalog(prev => prev.map((entry, i) => i === index ? { ...entry, enabled: !entry.enabled } : entry))
  }

  const toggleEdit = (index: number) => {
    setEditingSet(prev => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  const handleSave = async () => {
    setIsSaving(true)
    setError("")

    try {
      if (compositeId) {
        // Composite save — server name entered on this page
        if (!serverName.trim()) { setNameError("Server name is required."); setIsSaving(false); return }
        const res = await fetch(`http://localhost:8000/api/servers/${serverName.trim()}/catalog`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...getAuthHeaders() },
          body: JSON.stringify({
            catalog,
            spec: { type: "composite" },
            baseUrl: "",
            toolCount: catalog.filter(t => t.enabled).length
          })
        })
        const data = await res.json()
        if (!res.ok) { setError(data.error || "Failed to save."); setIsSaving(false); return }
        sessionStorage.removeItem(`helios_session_${compositeId}`)
        router.push("/")
        return
      }

      if (!specId) return
      const draft = sessionStorage.getItem(`helios_draft_${specId}`)
      const draftData = draft ? JSON.parse(draft) : null

      const res = await fetch(`http://localhost:8000/api/servers/${specId}/catalog`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({
          catalog,
          ...(draftData ? { spec: draftData.spec, baseUrl: draftData.baseUrl, toolCount: draftData.toolCount } : {})
        })
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || "Failed to save."); setIsSaving(false); return }
      sessionStorage.removeItem(`helios_draft_${specId}`)
      router.push("/")
    } catch {
      setError("Failed to reach the server.")
      setIsSaving(false)
    }
  }

  // Derived stats
  const totalCount   = catalog.length
  const enabledCount = catalog.filter(e => e.enabled).length
  const disabledCount = totalCount - enabledCount

  const methodCounts: Record<string, number> = {}
  catalog.forEach(e => {
    const m = e.handler?.method?.toUpperCase() ?? "OTHER"
    methodCounts[m] = (methodCounts[m] ?? 0) + 1
  })
  const methodOrder = ["GET", "POST", "PUT", "PATCH", "DELETE"]

  const withDescription = catalog.filter(e => e.description?.trim()).length
  const withParams = catalog.filter(e => Object.keys(e.input_schema?.properties ?? {}).length > 0).length
  const totalParams = catalog.reduce((sum, e) => sum + Object.keys(e.input_schema?.properties ?? {}).length, 0)
  const avgParams = totalCount > 0 ? (totalParams / totalCount).toFixed(1) : "0"

  return (
    <div className="flex flex-col h-screen w-full bg-white">

      {/* Nav */}
      <nav className="flex items-center justify-between px-6 pl-20 flex-shrink-0">
        <Link href="/">
          <Image src="/logoName.svg" alt="Helios" width={200} height={200} className="cursor-pointer" />
        </Link>
        <div className="flex items-center gap-4 font-[family-name:--font-cinzel] text-[32px] tracking-widest">
          <span className="text-gray-400">Create</span>
          <span className="text-gray-400 text-[20px] mb-1">✦</span>
          <span className="text-gray-400">Sandbox</span>
          <span className="text-gray-400 text-[20px] mb-1">✦</span>
          <span className="flex flex-col items-center text-black">
            Verify
            <span className="block h-[2px] w-full bg-black mt-[-4px]"></span>
          </span>
          <span className="text-gray-400 text-[20px] mb-1">✦</span>
          <span className="text-gray-400">Download</span>
        </div>
        <div className="w-[220px]"></div>
      </nav>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden border-t-[2px] border-black">

        {/* Left panel — tool catalog (60%) */}
        <div className="flex flex-col flex-1 overflow-hidden border-r-[2px] border-black">

          {/* Summary bar */}
          <div className="px-6 py-4 flex items-baseline justify-between flex-shrink-0">
            <span className="font-[family-name:--font-cinzel] text-[22px] tracking-widest">Tool Catalog</span>
            {!isLoading && (
              <span className="font-[family-name:--font-cinzel] text-[14px] text-gray-400 tracking-widest">
                {totalCount} tools · {enabledCount} enabled · {disabledCount} disabled
              </span>
            )}
          </div>
          <div className="h-[2px] bg-black flex-shrink-0"></div>

          {/* Tool list */}
          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="flex items-center justify-center h-full">
                <span className="font-[family-name:--font-cinzel] text-gray-400 text-[14px] tracking-widest">Loading catalog...</span>
              </div>
            ) : error && catalog.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <span className="font-[family-name:--font-cinzel] text-red-600 text-[14px] tracking-widest">{error}</span>
              </div>
            ) : catalog.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <span className="font-[family-name:--font-cinzel] text-gray-400 text-[14px] tracking-widest">No tools found.</span>
              </div>
            ) : (
              catalog.map((entry, i) => {
                const isEditing = editingSet.has(i)
                return (
                  <div
                    key={i}
                    className={cn(
                      "transition-colors duration-150",
                      i !== catalog.length - 1 && "border-b-[1px] border-gray-200",
                      entry.enabled ? "bg-white" : "bg-gray-50"
                    )}
                  >
                    {/* Main row */}
                    <div className="flex items-center gap-4 px-6 py-4">
                      <div
                        onClick={() => handleToggle(i)}
                        className={cn(
                          "flex-shrink-0 w-5 h-5 border-[2px] flex items-center justify-center cursor-pointer transition-colors duration-150",
                          entry.enabled ? "border-black bg-black" : "border-gray-400 bg-white"
                        )}
                      >
                        {entry.enabled && (
                          <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                            <path d="M1 3.5L3.5 6.5L9 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        )}
                      </div>

                      <div className="flex flex-col gap-1 flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          {entry.handler?.method && (
                            <span className={cn(
                              "flex-shrink-0 font-[family-name:--font-geist-mono] text-[9px] tracking-widest px-1.5 py-0.5",
                              entry.enabled
                                ? (METHOD_STYLES[entry.handler.method.toUpperCase()] ?? "bg-gray-400 text-white")
                                : "border border-gray-200 text-gray-300 bg-white"
                            )}>
                              {entry.handler.method.toUpperCase()}
                            </span>
                          )}
                          <span className={cn(
                            "font-[family-name:--font-cinzel] text-[13px] tracking-wider truncate",
                            entry.enabled ? "text-black" : "text-gray-400"
                          )}>
                            {entry.name}
                          </span>
                        </div>
                        {entry.description && (
                          <span className="font-[family-name:--font-geist-sans] text-[11px] text-gray-400 leading-snug truncate">
                            {entry.description}
                          </span>
                        )}
                      </div>

                      <button
                        onClick={() => toggleEdit(i)}
                        className={cn(
                          "flex-shrink-0 font-[family-name:--font-cinzel] text-[10px] tracking-widest px-3 py-1.5 border transition-colors duration-150",
                          isEditing
                            ? "border-black bg-black text-white"
                            : "border-gray-300 text-gray-400 hover:border-black hover:text-black"
                        )}
                      >
                        {isEditing ? "DONE" : "EDIT"}
                      </button>
                    </div>

                    {/* Edit panel */}
                    {isEditing && (
                      <div className="px-6 pb-5 flex flex-col gap-4 border-t-[1px] border-gray-100 bg-gray-50">
                        <div className="flex flex-col gap-1 pt-4">
                          <label htmlFor={`tool-name-${i}`} className="font-[family-name:--font-cinzel] text-[9px] tracking-widest text-gray-400 uppercase">Tool Name</label>
                          <input
                            id={`tool-name-${i}`}
                            type="text"
                            value={entry.name}
                            onChange={e => handleNameChange(i, e.target.value)}
                            className="font-[family-name:--font-cinzel] text-[13px] tracking-wider bg-white border-[1px] border-gray-300 px-3 py-2 outline-none focus:border-black transition-colors text-black"
                          />
                        </div>
                        <div className="flex flex-col gap-1">
                          <label htmlFor={`tool-description-${i}`} className="font-[family-name:--font-cinzel] text-[9px] tracking-widest text-gray-400 uppercase">Description</label>
                          <textarea
                            id={`tool-description-${i}`}
                            value={entry.description}
                            onChange={e => {
                              handleDescriptionChange(i, e.target.value)
                              e.target.style.height = "auto"
                              e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px"
                            }}
                            rows={2}
                            className="font-[family-name:--font-geist-sans] text-[11px] text-black leading-snug bg-white border-[1px] border-gray-300 px-3 py-2 outline-none focus:border-black transition-colors resize-none"
                          />
                        </div>
                        {entry.handler?.path && (
                          <span className="font-[family-name:--font-geist-mono] text-[10px] text-gray-300">{entry.handler.path}</span>
                        )}
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>

          {/* Footer — Back + Save */}
          <div className="border-t-[2px] border-black p-6 flex-shrink-0">
            {error && catalog.length > 0 && (
              <p className="font-[family-name:--font-cinzel] text-red-600 text-[12px] tracking-wider mb-3 text-center">{error}</p>
            )}
            <div className="flex gap-4">
              <Link href={compositeId ? `/sandbox?compositeId=${compositeId}` : `/sandbox?specId=${specId}`} className="flex-1">
                <button className="font-[family-name:--font-cinzel] w-full cursor-pointer py-4 text-[16px] tracking-widest text-gray-400 border-[2px] border-gray-300 relative
                  before:absolute before:inset-[4px] before:border-[1px] before:border-gray-300 before:pointer-events-none
                  hover:border-black hover:text-black hover:before:border-black transition-colors duration-300">
                  ← Back
                </button>
              </Link>
              <button
                onClick={handleSave}
                disabled={isSaving || isLoading}
                className={cn(
                  "flex-1 font-[family-name:--font-cinzel] py-4 text-[16px] tracking-widest border-[2px] border-black relative before:absolute before:inset-[4px] before:border-[1px] before:pointer-events-none transition-colors duration-300",
                  isSaving || isLoading
                    ? "cursor-not-allowed opacity-50 before:border-black text-black"
                    : "cursor-pointer text-black before:border-black hover:bg-black hover:text-white hover:before:border-white"
                )}
              >
                {isSaving ? "Saving..." : "Confirm & Save"}
              </button>
            </div>
          </div>
        </div>

        {/* Right panel — statistics (40%) */}
        <div className="w-[40%] flex-shrink-0 flex flex-col overflow-hidden bg-white">

          {/* Header */}
          <div className="px-6 py-4 flex-shrink-0">
            <span className="font-[family-name:--font-cinzel] text-[22px] tracking-widest">Statistics</span>
          </div>
          <div className="h-[2px] bg-black flex-shrink-0"></div>

          <div className="flex-1 overflow-y-auto px-6 py-6 flex flex-col gap-8">

            {/* Server Name — composite sessions only */}
            {compositeId && (
              <div className="flex flex-col gap-3">
                <span className="font-[family-name:--font-cinzel] text-[11px] tracking-widest text-gray-400 uppercase">Server Name</span>
                <input
                  type="text"
                  value={serverName}
                  onChange={e => { setServerName(e.target.value); setNameError("") }}
                  placeholder="my-server-name"
                  className="font-[family-name:--font-cinzel] border-[1px] border-gray-300 px-4 py-3 text-[14px] tracking-wider outline-none focus:border-black transition-colors duration-200 placeholder:text-gray-400"
                />
                {nameError && <span className="font-[family-name:--font-cinzel] text-red-600 text-[11px] tracking-wider">{nameError}</span>}
              </div>
            )}

            {/* Overview */}
            <div className="flex flex-col gap-3">
              <span className="font-[family-name:--font-cinzel] text-[11px] tracking-widest text-gray-400 uppercase">Overview</span>
              <div className="flex flex-col gap-2">
                {[
                  { label: "Total Tools",   value: totalCount },
                  { label: "Enabled",       value: enabledCount },
                  { label: "Disabled",      value: disabledCount },
                ].map(({ label, value }) => (
                  <div key={label} className="flex items-center justify-between border-b-[1px] border-gray-100 pb-2">
                    <span className="font-[family-name:--font-geist-sans] text-[13px] text-gray-500">{label}</span>
                    <span className="font-[family-name:--font-cinzel] text-[16px] tracking-wider text-black">{value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Methods */}
            <div className="flex flex-col gap-3">
              <span className="font-[family-name:--font-cinzel] text-[11px] tracking-widest text-gray-400 uppercase">Methods</span>
              <div className="flex flex-col gap-2">
                {methodOrder.map(method => {
                  const count = methodCounts[method] ?? 0
                  const pct = totalCount > 0 ? Math.round((count / totalCount) * 100) : 0
                  return (
                    <div key={method} className="flex flex-col gap-1">
                      <div className="flex items-center justify-between">
                        <span className="font-[family-name:--font-geist-mono] text-[11px] tracking-widest text-gray-500">{method}</span>
                        <span className="font-[family-name:--font-cinzel] text-[13px] text-black">{count}</span>
                      </div>
                      <div className="h-[3px] bg-gray-100 w-full">
                        <div
                          className={cn("h-full transition-all duration-300", METHOD_COLORS[method] ?? "bg-gray-400")}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Coverage */}
            <div className="flex flex-col gap-3">
              <span className="font-[family-name:--font-cinzel] text-[11px] tracking-widest text-gray-400 uppercase">Coverage</span>
              <div className="flex flex-col gap-2">
                {[
                  { label: "With descriptions", value: `${withDescription} / ${totalCount}` },
                  { label: "With parameters",   value: `${withParams} / ${totalCount}` },
                  { label: "Avg params / tool",  value: avgParams },
                  { label: "Total parameters",   value: totalParams },
                ].map(({ label, value }) => (
                  <div key={label} className="flex items-center justify-between border-b-[1px] border-gray-100 pb-2">
                    <span className="font-[family-name:--font-geist-sans] text-[13px] text-gray-500">{label}</span>
                    <span className="font-[family-name:--font-cinzel] text-[16px] tracking-wider text-black">{value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Placeholders */}
            <div className="flex flex-col gap-3">
              <span className="font-[family-name:--font-cinzel] text-[11px] tracking-widest text-gray-400 uppercase">Coming Soon</span>
              <div className="flex flex-col gap-2">
                {[
                  "API coverage score",
                  "Estimated token budget",
                  "MCP server file size",
                  "Tool quality score",
                ].map(label => (
                  <div key={label} className="flex items-center justify-between border-b-[1px] border-gray-100 pb-2">
                    <span className="font-[family-name:--font-geist-sans] text-[13px] text-gray-400">{label}</span>
                    <span className="font-[family-name:--font-cinzel] text-[14px] text-gray-300">—</span>
                  </div>
                ))}
              </div>
            </div>

          </div>
        </div>

      </div>
    </div>
  )
}
