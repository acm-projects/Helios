"use client"
import { useEffect, useState, useCallback } from "react"
import Link from "next/link"
import { getAuthHeaders, isLoggedIn } from "@/lib/auth"
import { useRouter } from "next/navigation"
import { KeyRound, RefreshCw, Trash2, Check, ChevronDown, ChevronRight, Link2 } from "lucide-react"
import { InfoBubble } from "@/app/components/InfoBubble"
import { lookupProviderKeyUrl, lookupBasicAuthLabels } from "@/lib/providerKeys"

// ─── Types ───────────────────────────────────────────────────────────────────

interface Server {
  id: string
  baseUrl: string
  toolCount: number
  createdAt: string
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

const BASE = "http://localhost:8000"

// ─── Page ────────────────────────────────────────────────────────────────────

export default function KeysPage() {
  const router = useRouter()
  const [pageReady, setPageReady] = useState(false)
  const [servers, setServers] = useState<Server[]>([])
  const [serversLoading, setServersLoading] = useState(true)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [integrations, setIntegrations] = useState<Record<string, { loading: boolean; data: Integration[]; error: string | null }>>({})

  useEffect(() => {
    document.fonts.ready.then(() => requestAnimationFrame(() => setPageReady(true)))
    if (!isLoggedIn()) { router.replace("/auth"); return }
    fetchServers()
  }, [])

  async function fetchServers() {
    setServersLoading(true)
    try {
      const res = await fetch(`${BASE}/api/servers`, { headers: getAuthHeaders() })
      const data = await res.json()
      setServers(data.servers ?? [])
    } catch { /* empty */ }
    setServersLoading(false)
  }

  const loadIntegrations = useCallback(async (serverId: string) => {
    setIntegrations(prev => ({ ...prev, [serverId]: { loading: true, data: [], error: null } }))
    try {
      const res = await fetch(`${BASE}/api/servers/${encodeURIComponent(serverId)}/keys`, {
        headers: getAuthHeaders()
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Failed to load")
      setIntegrations(prev => ({ ...prev, [serverId]: { loading: false, data: data.integrations ?? [], error: null } }))
    } catch (err: any) {
      setIntegrations(prev => ({ ...prev, [serverId]: { loading: false, data: [], error: err.message } }))
    }
  }, [])

  function toggleServer(id: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
        if (!integrations[id]) loadIntegrations(id)
      }
      return next
    })
  }

  function refreshServer(integrationId: string) {
    for (const [serverId, state] of Object.entries(integrations)) {
      if (state.data.some(i => i.integrationId === integrationId)) {
        loadIntegrations(serverId)
        break
      }
    }
  }

  return (
    <div className={`min-h-screen flex flex-col ${pageReady ? "opacity-100" : "opacity-0"} transition-opacity duration-300`}>

      {/* Header */}
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
        <div className="flex items-center gap-2">
          <KeyRound size={18} strokeWidth={1.5} style={{ color: "#C9A84C" }} />
          <span className="font-[family-name:--font-cinzel] text-[18px] tracking-[0.22em] text-white/70">
            API Keys
          </span>
        </div>
        <div className="flex-1" />
      </div>

      {/* Content */}
      <main className="flex-1 px-8 py-8 max-w-[860px] mx-auto w-full">
        <p className="font-[family-name:--font-cormorant] text-[17px] italic text-white/35 mb-8">
          Manage credentials for your generated servers. Keys are injected automatically on every tool call.
        </p>

        {serversLoading && (
          <p className="font-[family-name:--font-cormorant] text-[16px] italic text-white/30 text-center py-12">
            Loading servers...
          </p>
        )}

        {!serversLoading && servers.length === 0 && (
          <div className="glass rounded-2xl px-8 py-10 text-center flex flex-col gap-3">
            <p className="font-[family-name:--font-cinzel] text-[14px] tracking-[0.14em] text-white/40">No servers yet</p>
            <p className="font-[family-name:--font-cormorant] text-[16px] italic text-white/25">Generate a server first, then come back to add credentials.</p>
            <Link href="/create" className="mt-2 self-center btn-gold rounded-xl px-6 py-2.5 font-[family-name:--font-cinzel] text-[12px] tracking-[0.14em] cursor-pointer">
              Create Server
            </Link>
          </div>
        )}

        <div className="flex flex-col gap-4">
          {servers.map(server => {
            const isOpen = expanded.has(server.id)
            const state = integrations[server.id]
            return (
              <div key={server.id} className="glass rounded-2xl overflow-hidden">
                <button
                  onClick={() => toggleServer(server.id)}
                  className="w-full flex items-center gap-4 px-6 py-4 cursor-pointer hover:bg-white/[0.04] transition-colors duration-150"
                >
                  <span className="text-white/40 flex-shrink-0">
                    {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </span>
                  <span className="font-[family-name:--font-geist-mono] text-[13px] text-[#C9A84C]/80 flex-1 text-left truncate">
                    {server.id}
                  </span>
                  <span className="font-[family-name:--font-cormorant] text-[14px] italic text-white/30 flex-shrink-0">
                    {server.toolCount} tool{server.toolCount !== 1 ? "s" : ""}
                  </span>
                  <span className="font-[family-name:--font-geist-mono] text-[11px] text-white/20 flex-shrink-0 truncate max-w-[200px]">
                    {server.baseUrl}
                  </span>
                </button>

                {isOpen && (
                  <div className="border-t border-white/[0.09] px-6 py-5 flex flex-col gap-6">
                    {state?.loading && (
                      <p className="font-[family-name:--font-cormorant] text-[15px] italic text-white/30">Loading...</p>
                    )}
                    {state?.error && (
                      <p className="font-[family-name:--font-cormorant] text-[15px] text-red-400/80">{state.error}</p>
                    )}
                    {state && !state.loading && state.data.length === 0 && !state.error && (
                      <p className="font-[family-name:--font-cormorant] text-[16px] italic text-white/30">
                        This server requires no authentication.
                      </p>
                    )}
                    {state?.data.map(integration => (
                      <IntegrationRow
                        key={integration.integrationId}
                        integration={integration}
                        onRefresh={() => refreshServer(integration.integrationId)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </main>
    </div>
  )
}

// ─── Integration Row ──────────────────────────────────────────────────────────

function IntegrationRow({ integration, onRefresh }: { integration: Integration; onRefresh: () => void }) {
  const { integrationId, authType, oauthFlow, keyPresent, tokenExpired } = integration
  const isOAuth = authType === "oauth2"
  const isBasicAuth = authType === "basic_auth"
  const isPlainKey = authType === "api_key" || authType === ("apiKey" as string) || authType === "bearer_token"

  const statusColor = !keyPresent ? "rgba(248,113,113,0.75)" : tokenExpired ? "rgba(251,191,36,0.75)" : "rgba(110,231,183,0.85)"
  const statusLabel = !keyPresent ? "Missing" : tokenExpired ? "Expired" : "Active"
  const providerUrl = lookupProviderKeyUrl(integrationId)

  const [deleting, setDeleting] = useState(false)

  async function handleDelete() {
    setDeleting(true)
    await fetch(`${BASE}/api/keys/${encodeURIComponent(integrationId)}`, {
      method: "DELETE", headers: getAuthHeaders()
    })
    setDeleting(false)
    onRefresh()
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Header row */}
      <div className="flex items-center gap-3">
        <div className="w-2 h-2 rounded-full flex-shrink-0"
          style={{ background: statusColor, boxShadow: `0 0 6px ${statusColor}` }} />
        <span className="inline-flex items-center gap-1.5 font-[family-name:--font-geist-mono] text-[13px] text-white/70">
          {integrationId}
          {providerUrl ? (
            <InfoBubble
              externalUrl={providerUrl}
              quick={`Open the ${integrationId} developer dashboard — this is where your credentials for this integration live.`}
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
        <span
          className="font-[family-name:--font-cinzel] text-[9px] tracking-[0.18em] uppercase px-2 py-0.5 rounded-md"
          style={{
            background: isOAuth ? "rgba(167,139,250,0.14)" : "rgba(201,168,76,0.12)",
            border: `1px solid ${isOAuth ? "rgba(167,139,250,0.28)" : "rgba(201,168,76,0.22)"}`,
            color: isOAuth ? "#C4B5FD" : "#C9A84C"
          }}
        >
          {isOAuth ? `OAuth2${oauthFlow ? ` · ${oauthFlow.replace("_", " ")}` : ""}` : authType.replace("_", " ")}
        </span>
        <span className="ml-auto font-[family-name:--font-cinzel] text-[9px] tracking-[0.14em] uppercase" style={{ color: statusColor }}>
          {statusLabel}
        </span>
        {keyPresent && (
          <button onClick={handleDelete} disabled={deleting}
            className="cursor-pointer p-1.5 rounded-lg hover:bg-red-500/[0.12] disabled:opacity-40 transition-colors duration-150">
            <Trash2 size={13} strokeWidth={1.5} style={{ color: "rgba(248,113,113,0.6)" }} />
          </button>
        )}
      </div>

      {/* Credential form */}
      {isPlainKey && <ApiKeyForm integrationId={integrationId} isUpdate={keyPresent} onSaved={onRefresh} />}
      {isBasicAuth && <BasicAuthForm integrationId={integrationId} isUpdate={keyPresent} onSaved={onRefresh} />}
      {isOAuth && <OAuthForm integration={integration} isUpdate={keyPresent} onConnected={onRefresh} />}
    </div>
  )
}

// ─── Plain API Key Form ───────────────────────────────────────────────────────

function ApiKeyForm({ integrationId, isUpdate, onSaved }: { integrationId: string; isUpdate: boolean; onSaved: () => void }) {
  const [value, setValue] = useState("")
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    if (!value.trim()) return
    setSaving(true); setError(null)
    try {
      const res = await fetch(`${BASE}/api/keys/${encodeURIComponent(integrationId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ key: value.trim() })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Save failed")
      setValue(""); setSaved(true)
      onSaved()
      setTimeout(() => setSaved(false), 2000)
    } catch (err: any) {
      setError(err.message)
    }
    setSaving(false)
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <input
          type="password"
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => e.key === "Enter" && handleSave()}
          placeholder={isUpdate ? "Paste new key to replace..." : "Paste your API key..."}
          className="glass-input flex-1 rounded-xl px-4 py-2.5 text-[13px] font-[family-name:--font-geist-mono]"
        />
        <button
          onClick={handleSave}
          disabled={saving || !value.trim()}
          className="btn-gold cursor-pointer rounded-xl px-5 py-2.5 font-[family-name:--font-cinzel] text-[11px] tracking-[0.14em] disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
        >
          {saving ? <RefreshCw size={12} className="animate-spin" /> : saved ? <Check size={12} /> : null}
          {saved ? "Saved" : isUpdate ? "Update" : "Save"}
        </button>
      </div>
      {error && <p className="font-[family-name:--font-cormorant] text-[14px] text-red-400/80">{error}</p>}
    </div>
  )
}

// ─── Basic Auth Form ─────────────────────────────────────────────────────────
//
// Two labeled inputs instead of a single "username:password" string. Labels
// come from providerKeys.lookupBasicAuthLabels — Twilio shows "Account SID"
// and "Auth Token", everything else falls back to "Username" / "Password".
//
// The backend still stores the credential as `${user}:${pass}` because that's
// what server.ts base64s into the Authorization header. Joining at submit time
// means zero backend changes — the wire format is unchanged.

function BasicAuthForm({ integrationId, isUpdate, onSaved }: { integrationId: string; isUpdate: boolean; onSaved: () => void }) {
  const labels = lookupBasicAuthLabels(integrationId)
  const [user, setUser] = useState("")
  const [pass, setPass] = useState("")
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    const u = user.trim()
    const p = pass.trim()
    if (!u || !p) return
    setSaving(true); setError(null)
    try {
      const res = await fetch(`${BASE}/api/keys/${encodeURIComponent(integrationId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ key: `${u}:${p}` })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Save failed")
      setUser(""); setPass(""); setSaved(true)
      onSaved()
      setTimeout(() => setSaved(false), 2000)
    } catch (err: any) {
      setError(err.message)
    }
    setSaving(false)
  }

  const canSave = user.trim().length > 0 && pass.trim().length > 0

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1.5">
          <label className="font-[family-name:--font-cinzel] text-[9px] tracking-[0.18em] text-white/35 uppercase">{labels.user}</label>
          <input
            type="text"
            value={user}
            onChange={e => setUser(e.target.value)}
            onKeyDown={e => e.key === "Enter" && canSave && handleSave()}
            placeholder={isUpdate ? `New ${labels.user}` : labels.user}
            className="glass-input rounded-xl px-3 py-2.5 text-[12px] font-[family-name:--font-geist-mono]"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="font-[family-name:--font-cinzel] text-[9px] tracking-[0.18em] text-white/35 uppercase">{labels.pass}</label>
          <input
            type="password"
            value={pass}
            onChange={e => setPass(e.target.value)}
            onKeyDown={e => e.key === "Enter" && canSave && handleSave()}
            placeholder="••••••••"
            className="glass-input rounded-xl px-3 py-2.5 text-[12px] font-[family-name:--font-geist-mono]"
          />
        </div>
      </div>

      {labels.hint && (
        <p className="font-[family-name:--font-cormorant] text-[14px] italic text-white/35">
          {labels.hint}
        </p>
      )}

      <button
        onClick={handleSave}
        disabled={saving || !canSave}
        className="self-start btn-gold cursor-pointer rounded-xl px-5 py-2.5 font-[family-name:--font-cinzel] text-[11px] tracking-[0.14em] disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
      >
        {saving ? <RefreshCw size={12} className="animate-spin" /> : saved ? <Check size={12} /> : null}
        {saved ? "Saved" : isUpdate ? "Update" : "Save"}
      </button>

      {error && <p className="font-[family-name:--font-cormorant] text-[14px] text-red-400/80">{error}</p>}
    </div>
  )
}

// ─── OAuth2 Form ──────────────────────────────────────────────────────────────

function OAuthForm({ integration, isUpdate, onConnected }: {
  integration: Integration
  isUpdate: boolean
  onConnected: () => void
}) {
  const { integrationId, oauthFlow, tokenUrl, authorizationUrl, scopes } = integration
  const isCC = oauthFlow === "client_credentials"
  // Implicit flow: no token exchange possible server-side — fall back to manual key paste
  const isImplicit = oauthFlow === "implicit"

  const [clientId, setClientId] = useState("")
  const [clientSecret, setClientSecret] = useState("")
  const [connecting, setConnecting] = useState(false)
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleConnect() {
    if (!clientId.trim() || !clientSecret.trim()) return
    setConnecting(true); setError(null)

    try {
      if (isCC) {
        // Client Credentials: direct token exchange, no popup
        const res = await fetch(`${BASE}/api/oauth2/client-credentials`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...getAuthHeaders() },
          body: JSON.stringify({ integrationId, clientId: clientId.trim(), clientSecret: clientSecret.trim(), tokenUrl })
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? "Connection failed")
        setConnected(true); onConnected()
      } else {
        // Authorization Code: open popup, let user log in
        const res = await fetch(`${BASE}/api/oauth2/authorize`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...getAuthHeaders() },
          body: JSON.stringify({ integrationId, clientId: clientId.trim(), clientSecret: clientSecret.trim(), authorizationUrl, tokenUrl, scopes })
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? "Failed to build auth URL")

        // Open popup
        const popup = window.open(data.url, "helios_oauth", "width=520,height=640,scrollbars=yes")
        if (!popup) throw new Error("Popup was blocked. Please allow popups for this page.")

        // Listen for the callback to post a message back
        await new Promise<void>((resolve, reject) => {
          const handler = (event: MessageEvent) => {
            if (!event.data?.heliosOAuth) return
            window.removeEventListener("message", handler)
            clearInterval(pollClosed)
            if (event.data.ok) resolve()
            else reject(new Error(event.data.message ?? "Authorization failed"))
          }
          window.addEventListener("message", handler)

          // Fallback: if popup closed without sending a message
          const pollClosed = setInterval(() => {
            if (popup.closed) {
              window.removeEventListener("message", handler)
              clearInterval(pollClosed)
              reject(new Error("Window closed before completing authorization"))
            }
          }, 500)
        })

        setConnected(true); onConnected()
      }
    } catch (err: any) {
      setError(err.message)
    }
    setConnecting(false)
  }

  // Implicit flow — no server-side exchange possible, show a helpful note + manual paste
  if (isImplicit) {
    return (
      <div className="flex flex-col gap-3">
        <div className="px-4 py-3 rounded-xl flex flex-col gap-1.5"
          style={{ background: "rgba(251,191,36,0.07)", border: "1px solid rgba(251,191,36,0.16)" }}>
          <p className="font-[family-name:--font-cinzel] text-[10px] tracking-[0.16em] text-amber-400/70 uppercase">Implicit Flow</p>
          <p className="font-[family-name:--font-cormorant] text-[15px] italic text-white/45">
            This API uses the legacy implicit flow — there's no refresh token.
            Log in at the API's website, copy the access token from the URL, and paste it here as a Bearer key.
            It will expire (usually in 1 hour) and you'll need to repeat this.
          </p>
        </div>
        <ApiKeyForm integrationId={integrationId} isUpdate={isUpdate} onSaved={onConnected} />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Instruction */}
      <p className="font-[family-name:--font-cormorant] text-[15px] italic text-white/35">
        {isCC
          ? "Helios will exchange these credentials for a token and auto-renew it silently."
          : "Helios will open the login page. After you approve, it stores a refresh token and handles renewals automatically."}
      </p>

      {/* Client ID + Secret */}
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1.5">
          <label className="font-[family-name:--font-cinzel] text-[9px] tracking-[0.18em] text-white/35 uppercase">Client ID</label>
          <input
            type="text"
            value={clientId}
            onChange={e => setClientId(e.target.value)}
            placeholder="your-client-id"
            className="glass-input rounded-xl px-3 py-2.5 text-[12px] font-[family-name:--font-geist-mono]"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="font-[family-name:--font-cinzel] text-[9px] tracking-[0.18em] text-white/35 uppercase">Client Secret</label>
          <input
            type="password"
            value={clientSecret}
            onChange={e => setClientSecret(e.target.value)}
            placeholder="••••••••"
            className="glass-input rounded-xl px-3 py-2.5 text-[12px] font-[family-name:--font-geist-mono]"
          />
        </div>
      </div>

      {/* Connect button */}
      <button
        onClick={handleConnect}
        disabled={connecting || !clientId.trim() || !clientSecret.trim()}
        className="self-start flex items-center gap-2 cursor-pointer rounded-xl px-5 py-2.5 font-[family-name:--font-cinzel] text-[11px] tracking-[0.14em] transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
        style={{
          background: connected ? "rgba(110,231,183,0.14)" : "rgba(167,139,250,0.14)",
          border: `1px solid ${connected ? "rgba(110,231,183,0.3)" : "rgba(167,139,250,0.3)"}`,
          color: connected ? "#6EE7B7" : "#C4B5FD"
        }}
      >
        {connecting ? <RefreshCw size={12} className="animate-spin" /> : connected ? <Check size={12} /> : <Link2 size={12} />}
        {connecting ? (isCC ? "Connecting..." : "Waiting for login...") : connected ? (isUpdate ? "Reconnected" : "Connected") : isUpdate ? "Reconnect" : "Connect"}
      </button>

      {error && <p className="font-[family-name:--font-cormorant] text-[14px] text-red-400/80">{error}</p>}

      {connected && !isCC && (
        <p className="font-[family-name:--font-cormorant] text-[14px] italic text-white/35">
          Refresh token stored. You won't need to log in again unless you revoke access.
        </p>
      )}
    </div>
  )
}
