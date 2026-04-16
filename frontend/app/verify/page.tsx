"use client"
import { Suspense, useState, useEffect } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import Link from "next/link"
import { getAuthHeaders } from "@/lib/auth"

const cn = (...classes: (string | undefined | null | false)[]) => classes.filter(Boolean).join(" ")

const METHOD_STYLES: Record<string, string> = {
  GET:    "method-get",
  POST:   "method-post",
  PUT:    "method-put",
  PATCH:  "method-patch",
  DELETE: "method-delete",
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

function VerifyContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const specId      = searchParams.get("specId")
  const compositeId = searchParams.get("compositeId")

  const [pageReady, setPageReady] = useState(false)
  useEffect(() => {
    document.fonts.ready.then(() => requestAnimationFrame(() => setPageReady(true)))
  }, [])

  const [catalog, setCatalog] = useState<CatalogEntry[]>(() => {
    if (compositeId) {
      const raw = sessionStorage.getItem(`helios_session_${compositeId}`)
      if (!raw) return []
      const { tools } = JSON.parse(raw)
      return (tools ?? []).map((t: CatalogEntry & { function?: { name: string; description?: string; parameters?: CatalogEntry["input_schema"] }; enabled?: boolean }) => ({
        name:         t.function?.name ?? t.name,
        description:  t.function?.description ?? t.description ?? "",
        enabled:      t.enabled ?? true,
        input_schema: t.function?.parameters ?? t.input_schema ?? { type: "object", properties: {} },
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
  // Any time specId is known we're modifying an existing server
  const isExistingServer = !!specId
  const isEditMode = !!(compositeId && specId)  // compositeId flow after Edit button
  const [isSaving, setIsSaving] = useState(false)
  const [serverName, setServerName] = useState(specId ?? "")
  const [nameError, setNameError]   = useState("")

  // Sync name if specId arrives after hydration (e.g. SSR/Suspense timing)
  useEffect(() => {
    if (specId && !serverName) setServerName(specId)
  }, [specId])
  const [error, setError] = useState(!specId && !compositeId ? "No spec ID provided." : "")
  const [editingSet, setEditingSet] = useState<Set<number>>(new Set())
  const [existingServerIds, setExistingServerIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    fetch("http://localhost:8000/api/servers", { headers: getAuthHeaders() })
      .then(res => res.json())
      .then(data => {
        const ids = new Set<string>((data.servers ?? []).map((s: { id: string }) => s.id))
        setExistingServerIds(ids)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (compositeId) return
    if (!specId) return
    const draft = sessionStorage.getItem(`helios_draft_${specId}`)
    const draftData = draft ? JSON.parse(draft) : null
    if (draftData?.catalog) return

    fetch(`http://localhost:8000/api/servers/${specId}/catalog`, { headers: getAuthHeaders() })
      .then(res => res.json())
      .then(data => {
        if (data.error) { setError(data.error); setIsLoading(false); return }
        let fetchedCatalog = data.catalog ?? []
        const togglesRaw = sessionStorage.getItem(`helios_toggles_${specId}`)
        if (togglesRaw) {
          const toggles: Record<string, boolean> = JSON.parse(togglesRaw)
          fetchedCatalog = fetchedCatalog.map((item: CatalogEntry) =>
            item.name in toggles ? { ...item, enabled: toggles[item.name] } : item
          )
          sessionStorage.removeItem(`helios_toggles_${specId}`)
        }
        setCatalog(fetchedCatalog)
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
    setIsSaving(true); setError("")
    try {
      if (compositeId) {
        if (!serverName.trim()) { setNameError("Server name is required."); setIsSaving(false); return }
        let groupMap: Record<string, string> = {}
        let authMap: Record<string, unknown[]> = {}
        try {
          const raw = sessionStorage.getItem(`helios_groups_${compositeId}`)
          if (raw) { const parsed = JSON.parse(raw); groupMap = parsed.toolMap ?? parsed; authMap = parsed.authMap ?? {} }
        } catch { /* ignore */ }
        const res = await fetch(`http://localhost:8000/api/servers/${serverName.trim()}/catalog`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...getAuthHeaders() },
          body: JSON.stringify({ catalog, spec: { type: "composite", groupMap, authMap }, baseUrl: "", toolCount: catalog.filter(t => t.enabled).length })
        })
        const data = await res.json()
        if (!res.ok) { setError(data.error || "Failed to save."); setIsSaving(false); return }
        sessionStorage.removeItem(`helios_session_${compositeId}`)
        sessionStorage.removeItem("helios_create_tools")
        router.push(`/download?specId=${serverName.trim()}`)
        return
      }
      if (!specId) return
      const targetId = serverName.trim() || specId
      if (!targetId) { setNameError("Server name is required."); setIsSaving(false); return }
      const draft = sessionStorage.getItem(`helios_draft_${specId}`)
      const draftData = draft ? JSON.parse(draft) : null
      const res = await fetch(`http://localhost:8000/api/servers/${encodeURIComponent(targetId)}/catalog`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ catalog, ...(draftData ? { spec: draftData.spec, baseUrl: draftData.baseUrl, toolCount: draftData.toolCount } : {}) })
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || "Failed to save."); setIsSaving(false); return }
      sessionStorage.removeItem(`helios_draft_${specId}`)
      router.push(`/download?specId=${encodeURIComponent(targetId)}`)
    } catch {
      setError("Failed to reach the server.")
      setIsSaving(false)
    }
  }

  // Warn if the typed name already belongs to a different server
  const nameTakenWarning =
    serverName.trim().length > 0 &&
    existingServerIds.has(serverName.trim()) &&
    serverName.trim() !== specId  // allow keeping the same name when editing

  const totalCount    = catalog.length
  const enabledCount  = catalog.filter(e => e.enabled).length
  const disabledCount = totalCount - enabledCount

  const methodCounts: Record<string, number> = {}
  catalog.forEach(e => {
    const m = e.handler?.method?.toUpperCase() ?? "OTHER"
    methodCounts[m] = (methodCounts[m] ?? 0) + 1
  })
  const methodOrder = ["GET", "POST", "PUT", "PATCH", "DELETE"]

  const methodStatsStr = methodOrder
    .filter(m => methodCounts[m])
    .map(m => `${methodCounts[m]} ${m}`)
    .join(" · ")

  const backHref = compositeId
    ? isEditMode
      ? `/sandbox?compositeId=${compositeId}&specId=${encodeURIComponent(specId ?? "")}`
      : `/sandbox?compositeId=${compositeId}`
    : `/sandbox?specId=${specId}`

  return (
    <div className={cn("flex flex-col h-screen w-full relative overflow-hidden", pageReady ? "animate-page-enter" : "opacity-0")}>

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
          <Link href={backHref} className="step-inactive cursor-pointer">Sandbox</Link>
          <span className="step-divider text-[10px]">✦</span>
          <span className="step-active pb-1">Verify</span>
          <span className="step-divider text-[10px]">✦</span>
          <span className="step-inactive">Download</span>
        </div>
        <div className="flex-1" />
      </div>

      {/* ── Main ──────────────────────────────────────────────────────── */}
      <main className="flex-1 flex items-center justify-center px-4 py-4 min-h-0">
        <div
          className="glass-mid rounded-3xl w-full max-w-[900px] flex flex-col overflow-hidden shadow-[0_40px_100px_rgba(0,0,0,0.4)] animate-fade-up relative z-[0]"
          style={{ maxHeight: "calc(100vh - 100px)", minHeight: "500px" }}
        >
          <div aria-hidden="true" className="absolute pointer-events-none" style={{ inset: '-50px', backgroundImage: "var(--page-bg, url('/Background-Midday(4).svg'))", backgroundSize: 'cover', backgroundPosition: 'center', backgroundAttachment: 'fixed', filter: 'blur(8px) saturate(1.2) brightness(0.72)', zIndex: -1 }} />

          {/* ── Panel header ────────────────────────────────────────── */}
          <div className="px-8 py-5 flex items-center justify-between flex-shrink-0">
            <h1 className="font-[family-name:--font-cinzel] text-[20px] tracking-wide text-white/90">
              Tool Catalog
            </h1>
            {!isLoading && totalCount > 0 && (
              <span className="font-[family-name:--font-geist-mono] text-[11px] text-white/70 tracking-wide">
                {totalCount} tools&nbsp;·&nbsp;{enabledCount} enabled&nbsp;·&nbsp;{disabledCount} disabled
                {methodStatsStr ? <>&nbsp;·&nbsp;{methodStatsStr}</> : null}
              </span>
            )}
          </div>

          {/* Server name input — always shown when specId is known or for new composite */}
          {(compositeId || isExistingServer) && (
            <div className="px-8 pb-4 flex-shrink-0 flex flex-col gap-1.5">
              <label className="font-[family-name:--font-cinzel] text-[9px] tracking-[0.2em] text-white/60 uppercase">
                {isExistingServer ? "Server Name — editing existing" : "Server Name"}
              </label>
              <input
                type="text"
                value={serverName}
                onChange={e => { setServerName(e.target.value); setNameError("") }}
                placeholder="my-server-name"
                className="glass-input rounded-xl px-4 py-2.5 text-[13px] font-[family-name:--font-cinzel] tracking-wider"
              />
              <span className="h-[14px] font-[family-name:--font-cinzel] text-[11px] tracking-wider">
                {nameError
                  ? <span className="text-red-400">{nameError}</span>
                  : nameTakenWarning
                  ? <span className="text-amber-400/80">A server named &ldquo;{serverName.trim()}&rdquo; already exists.</span>
                  : null}
              </span>
            </div>
          )}

          {/* ── Divider ─────────────────────────────────────────────── */}
          <div className="h-px bg-white/[0.09] flex-shrink-0 mx-0" />

          {/* ── Scrollable tool list ─────────────────────────────────── */}
          <div className="flex-1 overflow-y-auto min-h-0">
            {isLoading ? (
              <div className="flex items-center justify-center h-40">
                <span className="font-[family-name:--font-cinzel] text-white/55 text-[13px] tracking-widest">Loading catalog...</span>
              </div>
            ) : error && catalog.length === 0 ? (
              <div className="flex items-center justify-center h-40">
                <span className="font-[family-name:--font-cinzel] text-red-400 text-[13px] tracking-widest">{error}</span>
              </div>
            ) : catalog.length === 0 ? (
              <div className="flex items-center justify-center h-40">
                <span className="font-[family-name:--font-cinzel] text-white/55 text-[13px] tracking-widest">No tools found.</span>
              </div>
            ) : (
              catalog.map((entry, i) => {
                const isEditing = editingSet.has(i)
                return (
                  <div
                    key={i}
                    className={cn(
                      "border-b border-white/[0.06]",
                      entry.enabled ? "bg-transparent" : "bg-black/[0.10]",
                      !isEditing && "hover:bg-white/[0.04]"
                    )}
                  >
                    {/* Tool row */}
                    <div className="flex items-center gap-3 pl-8 pr-6 py-5">

                      {/* Toggle checkbox */}
                      <div
                        onClick={() => handleToggle(i)}
                        className={cn(
                          "flex-shrink-0 w-5 h-5 rounded flex items-center justify-center cursor-pointer border",
                          entry.enabled
                            ? "border-[#C9A84C]/60 bg-[#C9A84C]/20"
                            : "border-white/[0.18] bg-transparent"
                        )}
                      >
                        {entry.enabled && (
                          <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
                            <path d="M1 3L3.5 5.5L8 1" stroke="#C9A84C" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        )}
                      </div>

                      {/* Method badge */}
                      {entry.handler?.method && (
                        <span className={cn(
                          "flex-shrink-0 font-[family-name:--font-geist-mono] text-[9px] tracking-widest px-1.5 py-0.5 rounded",
                          entry.enabled
                            ? (METHOD_STYLES[entry.handler.method.toUpperCase()] ?? "method-get")
                            : "bg-white/[0.04] text-white/20 border border-white/[0.07]"
                        )}>
                          {entry.handler.method.toUpperCase()}
                        </span>
                      )}

                      {/* Name + description */}
                      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                        <span className={cn(
                          "font-[family-name:--font-cinzel] text-[14px] tracking-wider truncate",
                          entry.enabled ? "text-white/85" : "text-white/30"
                        )}>
                          {entry.name}
                        </span>
                        {entry.description && (
                          <span className="font-[family-name:--font-cormorant] text-[14px] text-white/60 leading-snug truncate">
                            {entry.description}
                          </span>
                        )}
                      </div>

                      {/* Edit / Done button */}
                      <button
                        onClick={() => toggleEdit(i)}
                        className={cn(
                          "flex-shrink-0 font-[family-name:--font-cinzel] text-[9px] tracking-[0.18em] uppercase px-3 py-1.5 rounded-lg border cursor-pointer",
                          isEditing
                            ? "border-[#C9A84C]/50 bg-[#C9A84C]/15 text-[#C9A84C]"
                            : "border-white/[0.12] text-white/55 hover:border-white/25 hover:text-white/65"
                        )}
                      >
                        {isEditing ? "Done" : "Edit"}
                      </button>
                    </div>

                    {/* Edit expand */}
                    {isEditing && (
                      <div className="px-6 pb-5 pt-1 flex flex-col gap-3 bg-white/[0.025]">
                        <div className="flex flex-col gap-1">
                          <label className="font-[family-name:--font-cinzel] text-[9px] tracking-[0.2em] text-white/55 uppercase">Tool Name</label>
                          <input
                            type="text"
                            value={entry.name}
                            onChange={e => handleNameChange(i, e.target.value)}
                            className="glass-input rounded-lg px-3 py-2 text-[12px] font-[family-name:--font-cinzel] tracking-wider"
                          />
                        </div>
                        <div className="flex flex-col gap-1">
                          <label className="font-[family-name:--font-cinzel] text-[9px] tracking-[0.2em] text-white/55 uppercase">Description</label>
                          <textarea
                            value={entry.description}
                            onChange={e => {
                              handleDescriptionChange(i, e.target.value)
                              e.target.style.height = "auto"
                              e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px"
                            }}
                            rows={2}
                            className="glass-input rounded-lg px-3 py-2 text-[13px] font-[family-name:--font-cormorant] leading-snug resize-none"
                          />
                        </div>
                        {entry.handler?.path && (
                          <span className="font-[family-name:--font-geist-mono] text-[10px] text-white/45">{entry.handler.path}</span>
                        )}
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>

          {/* ── Footer ──────────────────────────────────────────────── */}
          <div className="border-t border-white/[0.09] px-6 py-4 flex-shrink-0 flex flex-col gap-3">
            {error && catalog.length > 0 && (
              <p className="font-[family-name:--font-cinzel] text-red-400 text-[11px] tracking-wider text-center">{error}</p>
            )}
            <div className="flex gap-3">
              <Link href={backHref} className="flex-1">
                <button className="font-[family-name:--font-cinzel] w-full cursor-pointer py-3.5 text-[13px] tracking-[0.15em]
                  glass rounded-xl text-white/65 hover:text-white/75 hover:bg-white/[0.10]">
                  ← Back
                </button>
              </Link>
              <button
                onClick={handleSave}
                disabled={isSaving || isLoading || nameTakenWarning || (!serverName.trim() && !!compositeId)}
                className={cn(
                  "flex-1 font-[family-name:--font-cinzel] py-3.5 text-[13px] tracking-[0.15em] rounded-xl",
                  isSaving || isLoading || nameTakenWarning || (!serverName.trim() && !!compositeId)
                    ? "cursor-not-allowed bg-white/[0.06] border border-white/[0.12] text-white/25"
                    : "btn-gold cursor-pointer"
                )}
              >
                {isSaving ? "Saving..." : isExistingServer ? "Save Changes" : "Confirm & Save"}
              </button>
            </div>
          </div>

        </div>
      </main>
    </div>
  )
}

export default function Verify() {
  return (
    <Suspense>
      <VerifyContent />
    </Suspense>
  )
}
