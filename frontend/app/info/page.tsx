"use client"
import Link from "next/link"
import { Suspense, useState, useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { isLoggedIn, logout } from "@/lib/auth"
import {
  BookOpen, Cpu, Sparkles, FileJson2, KeyRound, Beaker, Server, Lock,
  ArrowUp, ArrowRight, ExternalLink, ChevronRight
} from "lucide-react"

const cn = (...classes: (string | undefined | null | false)[]) => classes.filter(Boolean).join(" ")

// ─────────────────────────────────────────────────────────────────────────────
//  Chapter index — drives the TOC and section anchors
// ─────────────────────────────────────────────────────────────────────────────

const CHAPTERS = [
  { id: "what-is-mcp",     num: "01", icon: BookOpen,  title: "What an MCP Server Is",           sub: "The open standard behind agent-ready tools." },
  { id: "how-it-works",    num: "02", icon: Cpu,       title: "How an MCP Server Works",         sub: "The JSON-RPC flow from initialize to tool call." },
  { id: "examples",        num: "03", icon: Sparkles,  title: "Examples of What They Can Do",    sub: "Ten real integrations and what they unlock." },
  { id: "api-specs",       num: "04", icon: FileJson2, title: "Where to Find API Specs",         sub: "Directories, fallbacks, and spec generation." },
  { id: "api-keys",        num: "05", icon: KeyRound,  title: "Where to Find API Keys",          sub: "Dashboards and quirks for every major provider." },
  { id: "playgrounds",     num: "06", icon: Beaker,    title: "Dev Playgrounds & Sandboxes",     sub: "Test before you paste credentials into Helios." },
  { id: "premade",         num: "07", icon: Server,    title: "Pre-Made Server Reference",       sub: "Canonical repos for every template Helios ships." },
  { id: "auth-setup",      num: "08", icon: Lock,      title: "Keys & OAuth — Setup Reference",  sub: "Scopes, redirect URIs, and env vars per server." },
] as const

// ─────────────────────────────────────────────────────────────────────────────
//  Resource link data
// ─────────────────────────────────────────────────────────────────────────────

const SPEC_SOURCES = [
  { name: "APIs.guru",                  url: "https://apis.guru/",                                 note: "4,000+ open-source OpenAPI specs from Google, AWS, Stripe, Twilio. Free and unauthenticated." },
  { name: "Postman Public API Network", url: "https://www.postman.com/explore",                    note: "Browse the APIs tab on any workspace — export any collection as OpenAPI via Generate Specification." },
  { name: "RapidAPI Hub",               url: "https://rapidapi.com/hub",                           note: "Thousands of APIs, most with a Download API Spec button on their endpoint page." },
  { name: "SwaggerHub",                 url: "https://app.swaggerhub.com/search",                  note: "Professional registry used by many enterprise APIs. Export as JSON or YAML." },
  { name: "GitHub Code Search",         url: "https://github.com/search?q=path%3Aopenapi.yaml&type=code", note: "Use path:openapi.yaml or path:**/openapi.json. Add org:stripe to scope to a vendor. Must be type=code — not repositories." },
  { name: "OpenAPI Directory (GitHub)", url: "https://github.com/APIs-guru/openapi-directory",     note: "Raw specs organized by provider under the APIs/ folder." },
]

const URL_PATTERNS = [
  "/openapi.json", "/openapi.yaml", "/swagger.json", "/api-docs", "/docs",
  "/swagger-ui", "/v1/openapi.json", "/v2/api-docs", "/swagger/v1/swagger.json",
  "/.well-known/openapi.json",
]

const SPEC_GENERATORS = [
  { name: "Apidog",           url: "https://apidog.com",               note: "Import a HAR file recorded from browser DevTools and it generates a structured spec." },
  { name: "Optic",            url: "https://www.useoptic.com",         note: "Run as a local proxy during API testing — learns structure from live traffic." },
  { name: "Swagger Inspector",url: "https://inspector.swagger.io",     note: "Fire requests at any API; records shapes and generates a basic OpenAPI definition." },
  { name: "Speakeasy",        url: "https://speakeasyapi.dev",         note: "Best for code-to-spec — generates from FastAPI, Go, and other frameworks." },
  { name: "Swagger Editor",   url: "https://editor.swagger.io",        note: "Hand-write with real-time validation and linting." },
]

const API_KEY_PROVIDERS = [
  {
    name: "OpenAI", type: "API Key",
    url: "https://platform.openai.com/api-keys",
    notes: [
      "Bearer token — Authorization: Bearer sk-…",
      "Restricted Keys can be scoped per endpoint (e.g. embeddings only).",
      "For production use Service Accounts — keys persist if the creator leaves.",
    ]
  },
  {
    name: "Anthropic", type: "API Key",
    url: "https://console.anthropic.com/settings/keys",
    notes: [
      "Custom header — x-api-key: your-key (no \"Bearer\" prefix).",
      "Requires anthropic-version: 2023-06-01 on every request.",
      "Often inactive until $5 credit is loaded.",
    ]
  },
  {
    name: "Google Cloud", type: "OAuth2 / Service Account / Key",
    url: "https://console.cloud.google.com/apis/credentials",
    notes: [
      "Permissions = intersection of OAuth scope ∩ IAM role.",
      "Enable each API (Calendar, Drive…) in the API Library before creating credentials.",
      "Sensitive scopes trigger a verification warning until Google reviews the app.",
    ]
  },
  {
    name: "GitHub", type: "PAT / App Token",
    url: "https://github.com/settings/tokens",
    notes: [
      "Fine-grained PATs scope to specific repos with mandatory expiration (≤1 year).",
      "App install tokens must use username x-access-token for Git CLI.",
      "Keys prefixed with ghp_ / github_pat_ are scanned on public repos.",
    ]
  },
  {
    name: "Spotify", type: "OAuth2",
    url: "https://developer.spotify.com/dashboard",
    notes: [
      "Redirect URI must be 127.0.0.1 — localhost is rejected.",
      "Spotify Premium required for Developer Mode.",
      "Dev apps capped at 5 whitelisted test users by email.",
    ]
  },
  {
    name: "Slack", type: "OAuth2 (Bot / User)",
    url: "https://api.slack.com/apps",
    notes: [
      "Bot tokens start with xoxb-; user tokens with xoxp-.",
      "Slack returns HTTP 200 on errors — always check \"ok\": true.",
      "Event Subscriptions need your server to echo the challenge during verification.",
    ]
  },
  {
    name: "Notion", type: "Integration Token / OAuth2",
    url: "https://notion.so/my-integrations",
    notes: [
      "Internal integrations see zero pages until invited via ⋯ → Connections on each page.",
      "OAuth redirect URIs must be real HTTPS domains — not raw IPs.",
      "Search indexing can lag 1–5 min behind the UI.",
    ]
  },
  {
    name: "Linear", type: "Personal Key / OAuth2",
    url: "https://linear.app/settings/api",
    notes: [
      "Header: Authorization: <KEY> for personal keys (no Bearer prefix).",
      "OAuth: Authorization: Bearer <TOKEN> + actor=application so the bot appears as author.",
    ]
  },
  {
    name: "Stripe", type: "Secret Key / Restricted Key",
    url: "https://dashboard.stripe.com/apikeys",
    notes: [
      "Dashboard triggers Sudo Mode re-auth when accessing keys.",
      "Test keys: sk_test_ / rk_test_; live: sk_live_ / rk_live_.",
      "Pre-fill restricted key params via URL (?permissions[charges]=read).",
    ]
  },
  {
    name: "Twilio", type: "Account SID + Token / API Key",
    url: "https://console.twilio.com",
    notes: [
      "Primary Auth Token cannot be scoped — create an API Key for granular access.",
      "Regional endpoints: api.au1.twilio.com for AU data residency, etc.",
      "Test credentials use magic phone numbers to simulate success and errors.",
    ]
  },
  {
    name: "Discord", type: "OAuth2 / Bot Token",
    url: "https://discord.com/developers/applications",
    notes: [
      "/oauth2/token only accepts application/x-www-form-urlencoded.",
      "Privileged Intents (Message Content, Members) must be toggled manually.",
      "integration_type=1 for server-less \"User Install\" apps.",
    ]
  },
  {
    name: "Reddit", type: "OAuth2",
    url: "https://www.reddit.com/prefs/apps",
    notes: [
      "Generic User-Agents are blocked — use <platform>:<app_id>:<version> (by /u/<user>).",
      "Script apps still need a redirect URI — http://localhost:8080 works.",
      "Password grant issues no refresh token; re-auth every 60 min.",
    ]
  },
  {
    name: "AWS IAM", type: "Access Key / STS",
    url: "https://console.aws.amazon.com/iam/",
    notes: [
      "Secret is shown once at creation — unrecoverable if lost.",
      "Prefer IAM roles + STS temporary credentials over long-lived keys.",
      "Signing region for IAM itself is always us-east-1.",
    ]
  },
]

const PLAYGROUNDS = [
  { name: "Google OAuth 2.0 Playground", url: "https://developers.google.com/oauthplayground", note: "Walks the full 3-stage OAuth flow. Shows raw HTTP at every step — the gold standard for debugging scope and token issues." },
  { name: "Spotify Web API Reference",   url: "https://developer.spotify.com/documentation/web-api/reference", note: "Every endpoint has an inline \"Try it\" console that handles auth automatically once you log in." },
  { name: "GitHub GraphQL Explorer",     url: "https://docs.github.com/en/graphql/overview/explorer", note: "Live GraphQL IDE against your real GitHub data. Full autocomplete + schema introspection." },
  { name: "Postman",                     url: "https://www.postman.com/downloads", note: "The universal playground. Collections, environment variables, test scripts, pre-request signatures." },
  { name: "Swagger Editor",              url: "https://editor.swagger.io", note: "Paste any spec to get a live \"Try it out\" UI and validation. Useful for sanity-checking before import." },
  { name: "Anthropic Workbench",         url: "https://console.anthropic.com/workbench", note: "Prompt iteration against Claude with variables, Generate Prompt, and one-click SDK export." },
  { name: "OpenAI Playground",           url: "https://platform.openai.com/playground", note: "Model comparison, temperature sliders, Assistants with Code Interpreter / File Search." },
  { name: "Stripe CLI + Test Mode",      url: "https://stripe.com/docs/stripe-cli", note: "stripe listen forwards webhooks locally; stripe trigger fires named events without real transactions." },
  { name: "Slack Block Kit Builder",     url: "https://app.slack.com/block-kit-builder", note: "Drag-and-drop Slack message composer. Preview on desktop + mobile and copy the JSON payload." },
]

const PREMADE_SERVERS = [
  { name: "Filesystem",      status: "Official",          url: "https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem",             desc: "Secure file read / write / list with configurable directory allow-listing." },
  { name: "Fetch",           status: "Official",          url: "https://github.com/modelcontextprotocol/servers/tree/main/src/fetch",                  desc: "Fetches public URLs and converts content to LLM-friendly Markdown." },
  { name: "Memory",          status: "Official",          url: "https://github.com/modelcontextprotocol/servers/tree/main/src/memory",                 desc: "Knowledge-graph persistent memory store for AI agents." },
  { name: "Brave Search",    status: "Official",          url: "https://github.com/modelcontextprotocol/servers/tree/main/src/brave-search",           desc: "Web and local search via the Brave Search API." },
  { name: "GitHub",          status: "Archived Reference",url: "https://github.com/modelcontextprotocol/servers-archived/tree/main/src/github",        desc: "Repos, issues, pull requests, and file operations via the GitHub API." },
  { name: "Google Drive",    status: "Archived Reference",url: "https://github.com/modelcontextprotocol/servers-archived/tree/main/src/gdrive",        desc: "File access and search across Drive documents and folders." },
  { name: "Slack",           status: "Archived Reference",url: "https://github.com/modelcontextprotocol/servers-archived/tree/main/src/slack",         desc: "Messaging and channel management for Slack workspaces." },
  { name: "Postgres",        status: "Archived Reference",url: "https://github.com/modelcontextprotocol/servers-archived/tree/main/src/postgres",      desc: "Read-only database access with schema inspection + SQL execution." },
  { name: "SQLite",          status: "Archived Reference",url: "https://github.com/modelcontextprotocol/servers-archived/tree/main/src/sqlite",        desc: "Read / write access to local SQLite databases." },
  { name: "Puppeteer",       status: "Archived Reference",url: "https://github.com/modelcontextprotocol/servers-archived/tree/main/src/puppeteer",     desc: "Headless browser automation, scraping, and screenshots." },
  { name: "Google Calendar", status: "Community",         url: "https://github.com/nspady/google-calendar-mcp",                                        desc: "List, create, and manage Google Calendar events with OAuth2." },
  { name: "Spotify",         status: "Community",         url: "https://github.com/varunneal/spotify-mcp",                                             desc: "Playback control, catalog search, and playlist management." },
  { name: "Notion",          status: "Official (Notion)", url: "https://github.com/makenotion/notion-mcp-server",                                      desc: "Search, read, and edit Notion pages with official OAuth." },
  { name: "Linear",          status: "Community",         url: "https://github.com/tacticlaunch/mcp-linear",                                           desc: "Issue and project management via the Linear GraphQL API." },
]

const AUTH_SETUP = [
  {
    name: "Filesystem / Fetch / Memory / Puppeteer",
    auth: "None",
    summary: "No credentials. Filesystem takes a directory allow-list as a CLI arg; the rest require no configuration.",
  },
  {
    name: "Brave Search",
    auth: "API Key",
    summary: "Register at api.search.brave.com/app/dashboard. Set BRAVE_API_KEY. Free tier covers basic search.",
  },
  {
    name: "Postgres / SQLite",
    auth: "Connection string / file path",
    summary: "Postgres: POSTGRES_URL or DATABASE_URL. SQLite: --db-path /absolute/path/to/db.sqlite.",
  },
  {
    name: "GitHub",
    auth: "Personal Access Token (Fine-grained recommended)",
    summary: "Create at github.com/settings/tokens. Scope per-repo with Contents: read/write, Issues: read/write, PRs: read/write, Metadata: read. Set GITHUB_PERSONAL_ACCESS_TOKEN. For Enterprise, also set GITHUB_ENDPOINT to https://your-server/api/v3.",
  },
  {
    name: "Google Drive",
    auth: "OAuth2 (Desktop App)",
    summary: "In GCP create credentials of type Desktop app (not Web app). Scopes: .../auth/drive.readonly or .../auth/drive. Redirect URI is localhost — no config needed. First run triggers browser consent and writes token.json.",
  },
  {
    name: "Google Calendar",
    auth: "OAuth2 (Desktop App)",
    summary: "Same credential setup as Drive. Scopes: .../auth/calendar and .../auth/calendar.events (or .../auth/calendar.readonly for read-only). Point GOOGLE_OAUTH_CREDENTIALS at your credentials.json.",
  },
  {
    name: "Slack",
    auth: "OAuth2 Bot Token",
    summary: "Create app at api.slack.com/apps. Bot scopes for common use: channels:history, channels:read, chat:write, users:read, reactions:write. Install to workspace → copy the xoxb- token into SLACK_BOT_TOKEN. SLACK_TEAM_ID comes from your workspace URL (TXXXXXXXX).",
  },
  {
    name: "Spotify",
    auth: "OAuth2 + PKCE",
    summary: "Register at developer.spotify.com/dashboard. Redirect URI MUST be http://127.0.0.1:PORT/callback. Typical scopes: user-library-read, user-read-playback-state, user-modify-playback-state, playlist-read-private. Set SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, SPOTIFY_REDIRECT_URI. Premium required; dev apps capped at 5 whitelisted users.",
  },
  {
    name: "Notion",
    auth: "Internal Integration Token",
    summary: "Create at notion.so/my-integrations. Copy the Internal Integration Secret into NOTION_TOKEN. CRITICAL: for each page or database the agent needs, open it in Notion → ⋯ → Connections → add the integration. This is per-page and manual.",
  },
  {
    name: "Linear",
    auth: "Personal API Key",
    summary: "Generate at linear.app/settings/api. Set LINEAR_API_KEY. Header format: Authorization: <KEY> (no Bearer prefix for personal keys).",
  },
]

// ─────────────────────────────────────────────────────────────────────────────
//  Small building blocks
// ─────────────────────────────────────────────────────────────────────────────

function ChapterHeader({ chapter }: { chapter: typeof CHAPTERS[number] }) {
  const Icon = chapter.icon
  return (
    <div className="flex items-end gap-5 border-b border-white/[0.12] pb-5 mb-10">
      <span className="font-[family-name:--font-cinzel] text-[14px] tracking-[0.35em] text-[#C9A84C]/85 pb-1">
        {chapter.num}
      </span>
      <div className="flex-1 flex items-center gap-3">
        <Icon size={22} strokeWidth={1.4} className="text-white/55 flex-shrink-0" />
        <h2 className="font-[family-name:--font-cinzel] text-[26px] tracking-[0.14em] text-white/92 leading-none">
          {chapter.title}
        </h2>
      </div>
    </div>
  )
}

function P({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-[family-name:--font-cormorant] text-[18px] leading-[1.7] text-white/72 max-w-[68ch]">
      {children}
    </p>
  )
}

function Lead({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-[family-name:--font-cormorant] italic text-[21px] leading-[1.55] text-white/80 max-w-[60ch]">
      {children}
    </p>
  )
}

function KTerm({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-[family-name:--font-cinzel] text-[13px] tracking-[0.2em] text-[#C9A84C]/90 uppercase">
      {children}
    </span>
  )
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="font-[family-name:--font-geist-mono] text-[13px] text-white/85 bg-white/[0.06] border border-white/[0.1] rounded-md px-1.5 py-0.5">
      {children}
    </code>
  )
}

function CodeBlock({ children, label }: { children: string; label?: string }) {
  return (
    <div className="my-2 relative">
      {label && (
        <div className="font-[family-name:--font-cinzel] text-[10px] tracking-[0.25em] text-white/40 uppercase mb-2">
          {label}
        </div>
      )}
      <pre className="glass rounded-xl px-5 py-4 font-[family-name:--font-geist-mono] text-[12.5px] leading-[1.55] text-white/80">
        <code>{children}</code>
      </pre>
    </div>
  )
}

function LinkCard({ href, title, note, tag }: { href: string; title: string; note: string; tag?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      data-no-transition="true"
      className="glass rounded-xl px-5 py-4 flex flex-col gap-1.5 hover:-translate-y-[2px] hover:border-white/[0.28] hover:bg-white/[0.05] transition-all duration-200 group"
    >
      <div className="flex items-center gap-2">
        <span className="font-[family-name:--font-cinzel] text-[13px] tracking-[0.18em] text-white/90 flex-1">
          {title}
        </span>
        {tag && (
          <span className="font-[family-name:--font-cinzel] text-[9px] tracking-[0.18em] uppercase px-2 py-0.5 rounded-md text-[#C9A84C]/90"
            style={{ background: "rgba(201,168,76,0.10)", border: "1px solid rgba(201,168,76,0.25)" }}>
            {tag}
          </span>
        )}
        <ExternalLink size={12} strokeWidth={1.6} className="text-white/30 group-hover:text-[#C9A84C]/80 transition-colors" />
      </div>
      <span className="font-[family-name:--font-cormorant] text-[15px] italic text-white/55 leading-snug">
        {note}
      </span>
    </a>
  )
}

function ProviderCard({ p }: { p: typeof API_KEY_PROVIDERS[number] }) {
  return (
    <div className="glass rounded-xl px-5 py-4 flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <span className="font-[family-name:--font-cinzel] text-[15px] tracking-[0.16em] text-white/92 flex-1">
          {p.name}
        </span>
        <span className="font-[family-name:--font-cinzel] text-[9px] tracking-[0.18em] uppercase px-2 py-0.5 rounded-md"
          style={{ background: "rgba(167,139,250,0.10)", border: "1px solid rgba(167,139,250,0.25)", color: "#C4B5FD" }}>
          {p.type}
        </span>
      </div>
      <a
        href={p.url}
        target="_blank"
        rel="noopener noreferrer"
        data-no-transition="true"
        className="flex items-center gap-1.5 font-[family-name:--font-geist-mono] text-[11.5px] text-[#C9A84C]/85 hover:text-[#E8C46A] transition-colors break-all"
      >
        <ExternalLink size={11} strokeWidth={1.6} className="flex-shrink-0" />
        <span className="truncate">{p.url}</span>
      </a>
      <ul className="flex flex-col gap-1 pt-1">
        {p.notes.map((n, i) => (
          <li key={i} className="font-[family-name:--font-cormorant] text-[15px] italic text-white/55 leading-snug flex gap-2">
            <span className="text-[#C9A84C]/50 mt-1 flex-shrink-0">·</span>
            <span>{n}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  Page
// ─────────────────────────────────────────────────────────────────────────────

function InfoContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const from = searchParams.get("from")
  const chapterParam = searchParams.get("chapter")
  const focused = !!from && !!chapterParam

  const [pageReady, setPageReady] = useState(false)
  const [showTop, setShowTop] = useState(false)
  const [activeChapter, setActiveChapter] = useState<string>(CHAPTERS[0].id)

  useEffect(() => {
    document.fonts.ready.then(() => requestAnimationFrame(() => setPageReady(true)))
  }, [])

  useEffect(() => {
    const onScroll = () => setShowTop(window.scrollY > 600)
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]
        if (visible?.target?.id) setActiveChapter(visible.target.id)
      },
      { rootMargin: "-30% 0px -55% 0px", threshold: [0, 0.25, 0.5, 1] }
    )
    CHAPTERS.forEach((c) => {
      const el = document.getElementById(c.id)
      if (el) io.observe(el)
    })
    return () => io.disconnect()
  }, [])

  // Focused mode: auto-scroll to the requested chapter on mount. Two frames so
  // fonts and glass panels settle before we measure offsets.
  useEffect(() => {
    if (!focused || !chapterParam) return
    const id = chapterParam
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = document.getElementById(id)
        if (!el) return
        const top = el.getBoundingClientRect().top + window.scrollY - 32
        window.scrollTo({ top, behavior: "auto" })
      })
    })
  }, [focused, chapterParam])

  const scrollToChapter = (id: string) => {
    const el = document.getElementById(id)
    if (!el) return
    const top = el.getBoundingClientRect().top + window.scrollY - 100
    window.scrollTo({ top, behavior: "smooth" })
  }

  return (
    <>

      {/* ── Focused-mode back button — rendered outside the pageReady ──
          opacity wrapper so it shows the instant the user lands here.
          Inline `position: fixed` + explicit top/right beats `.glass` which
          otherwise sets position: relative via globals.css. */}
      {focused && (
        <Link
          href={from ?? "/"}
          className="group glass rounded-full pl-5 pr-3.5 py-2.5 flex items-center gap-2.5 hover:-translate-y-[1px] hover:bg-white/[0.07] transition-all duration-200"
          style={{
            position: "fixed",
            top: "24px",
            right: "24px",
            zIndex: 60,
            boxShadow: "0 14px 40px rgba(0,0,0,0.45)",
          }}
          aria-label="Back to previous page"
        >
          <span className="font-[family-name:--font-cinzel] text-[11px] tracking-[0.25em] uppercase text-white/75 group-hover:text-white transition-colors">
            Back
          </span>
          <ArrowRight size={15} strokeWidth={1.6} className="text-white/75 group-hover:text-white transition-colors group-hover:translate-x-0.5 transition-transform" />
        </Link>
      )}

    <div className={cn("min-h-screen transition-opacity duration-500", pageReady ? "opacity-100" : "opacity-0")}>

      {/* ── Sticky nav (hidden in focused mode) ─────────────────────────── */}
      {!focused && (
      <div className="sticky top-0 z-30 flex items-center px-8 h-[80px] glass-nav">
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

        <div className="flex items-center justify-end gap-1">
          <span className="font-[family-name:--font-cinzel] text-[15px] tracking-[0.15em] px-5 py-2.5 text-white relative">
            Info
            <span className="absolute bottom-1 left-5 right-5 h-[1px] bg-white/70" />
          </span>
          <Link href="/keys" className="group relative font-[family-name:--font-cinzel] text-[15px] tracking-[0.15em] px-5 py-2.5 text-white/60 hover:text-white transition-all duration-200 cursor-pointer hover:-translate-y-[1px]">
            Keys
            <span className="absolute bottom-1 left-5 right-5 h-[1px] bg-white/70 scale-x-0 group-hover:scale-x-100 transition-transform duration-200 origin-left" />
          </Link>
          {isLoggedIn() ? (
            <button
              onClick={() => { logout(); router.refresh(); router.push("/auth") }}
              className="group relative font-[family-name:--font-cinzel] text-[15px] tracking-[0.15em] px-5 py-2.5 text-white/60 hover:text-white transition-all duration-200 cursor-pointer hover:-translate-y-[1px]"
            >
              Sign Out
              <span className="absolute bottom-1 left-5 right-5 h-[1px] bg-white/70 scale-x-0 group-hover:scale-x-100 transition-transform duration-200 origin-left" />
            </button>
          ) : (
            <Link href="/auth" className="group relative font-[family-name:--font-cinzel] text-[15px] tracking-[0.15em] px-5 py-2.5 text-white/60 hover:text-white transition-all duration-200 cursor-pointer hover:-translate-y-[1px]">
              Sign In
              <span className="absolute bottom-1 left-5 right-5 h-[1px] bg-white/70 scale-x-0 group-hover:scale-x-100 transition-transform duration-200 origin-left" />
            </Link>
          )}
        </div>
      </div>
      )}

      {/* ── Hero (hidden in focused mode) ──────────────────────────────── */}
      {!focused && (
      <section className="px-8 pt-24 pb-12 max-w-[920px] mx-auto">
        <div className="flex flex-col gap-5 animate-fade-up">
          <p className="font-[family-name:--font-cinzel] text-[11px] tracking-[0.45em] uppercase text-[#C9A84C]/85">
            Helios Reference
          </p>
          <h1 className="font-[family-name:--font-cinzel] text-[clamp(40px,6vw,64px)] tracking-[0.08em] text-white leading-[1.05]">
            Everything You Need<br/>to Ship an MCP Server
          </h1>
          <p className="font-[family-name:--font-cormorant] italic text-[20px] leading-[1.5] text-white/65 max-w-[58ch]">
            From the protocol itself to where real API specs live, where to grab keys for every major provider,
            and how to wire OAuth for each pre-made template.
          </p>
        </div>
      </section>
      )}

      {/* ── Table of contents (hidden in focused mode) ─────────────────── */}
      {!focused && (
      <section className="px-8 pb-20 max-w-[920px] mx-auto">
        <div className="flex items-center gap-4 mb-8 w-full">
          <div className="flex-1 h-[2px] bg-white/[0.22]" />
          <h2 className="font-[family-name:--font-cinzel] text-[13px] tracking-[0.32em] text-white/55 uppercase">
            Contents
          </h2>
          <div className="flex-1 h-[2px] bg-white/[0.22]" />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {CHAPTERS.map((c) => {
            const Icon = c.icon
            const active = activeChapter === c.id
            return (
              <button
                key={c.id}
                onClick={() => scrollToChapter(c.id)}
                className={cn(
                  "glass rounded-xl px-5 py-4 flex items-center gap-4 text-left group cursor-pointer",
                  "hover:-translate-y-[2px] hover:bg-white/[0.06] hover:border-white/[0.28] transition-all duration-200",
                  active && "border-[#C9A84C]/40"
                )}
              >
                <span className={cn(
                  "font-[family-name:--font-cinzel] text-[11px] tracking-[0.32em] w-10",
                  active ? "text-[#E8C46A]" : "text-[#C9A84C]/75"
                )}>
                  {c.num}
                </span>
                <Icon size={18} strokeWidth={1.4} className={cn("flex-shrink-0", active ? "text-white/90" : "text-white/50")} />
                <div className="flex-1 flex flex-col gap-0.5">
                  <span className={cn(
                    "font-[family-name:--font-cinzel] text-[13px] tracking-[0.14em]",
                    active ? "text-white" : "text-white/85 group-hover:text-white"
                  )}>
                    {c.title}
                  </span>
                  <span className="font-[family-name:--font-cormorant] italic text-[14px] text-white/45 leading-snug">
                    {c.sub}
                  </span>
                </div>
                <ChevronRight size={14} strokeWidth={1.5} className="text-white/25 group-hover:text-[#C9A84C]/80 group-hover:translate-x-0.5 transition-all" />
              </button>
            )
          })}
        </div>
      </section>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          CHAPTER 01 — What an MCP Server Is
      ══════════════════════════════════════════════════════════════════════ */}
      <section id="what-is-mcp" className={cn("px-8 pb-24 max-w-[920px] mx-auto scroll-mt-24", focused && "pt-24")}>
        <ChapterHeader chapter={CHAPTERS[0]} />

        <div className="flex flex-col gap-6">
          <Lead>
            The Model Context Protocol is an open standard created by Anthropic that defines how AI
            applications talk to external tools and data sources. Think of it as USB-C for AI — one plug,
            any model, any tool.
          </Lead>

          <P>
            Before MCP, every AI-to-tool integration was custom glue. OpenAI, Anthropic, LangChain, and
            others all had proprietary tool-calling formats. A tool built for one host didn't work with
            another. MCP collapses that M×N integration problem to M+N: build one server for your tool,
            and every MCP-compatible host can use it.
          </P>

          <div className="grid gap-4 sm:grid-cols-3 pt-2">
            <div className="glass rounded-xl px-5 py-4 flex flex-col gap-2">
              <KTerm>Host</KTerm>
              <P>The user-facing app running the AI session — Claude Desktop, VS Code, Helios itself.</P>
            </div>
            <div className="glass rounded-xl px-5 py-4 flex flex-col gap-2">
              <KTerm>Client</KTerm>
              <P>A component inside the Host that speaks the MCP wire protocol to one or more servers.</P>
            </div>
            <div className="glass rounded-xl px-5 py-4 flex flex-col gap-2">
              <KTerm>Server</KTerm>
              <P>A focused process that exposes tools, resources, or prompts — and holds its own credentials.</P>
            </div>
          </div>

          <div className="pt-4 flex flex-col gap-3">
            <KTerm>Transport Modes</KTerm>
            <P>
              <strong className="text-white/85">stdio</strong> — server runs as a local child process, talking over <Code>stdin</Code>/<Code>stdout</Code>.
              Used for Filesystem, SQLite, and most locally-installed servers.
            </P>
            <P>
              <strong className="text-white/85">SSE</strong> — for remote cloud servers. Persistent HTTP connection for server→client messages,
              standard POST for client→server.
            </P>
            <P>
              <strong className="text-white/85">Streamable HTTP</strong> — newer transport for bidirectional streaming in browser and high-concurrency environments.
              This is what Helios-generated servers use.
            </P>
          </div>

          <div className="pt-3 flex flex-wrap gap-3">
            <LinkCard href="https://modelcontextprotocol.io" title="Official MCP Spec" note="The canonical protocol documentation and specification." />
            <LinkCard href="https://www.anthropic.com/news/model-context-protocol" title="Anthropic Announcement" note="The November 2024 post introducing MCP and its rationale." />
            <LinkCard href="https://github.com/modelcontextprotocol" title="modelcontextprotocol (GitHub)" note="The org hosting the spec, SDKs, and reference servers." />
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════
          CHAPTER 02 — How an MCP Server Works
      ══════════════════════════════════════════════════════════════════════ */}
      <section id="how-it-works" className="px-8 pb-24 max-w-[920px] mx-auto scroll-mt-24">
        <ChapterHeader chapter={CHAPTERS[1]} />

        <div className="flex flex-col gap-6">
          <Lead>
            Every session follows the same JSON-RPC 2.0 dance: initialize, list tools, call tools. Three
            phases, no drift.
          </Lead>

          <div className="flex flex-col gap-4">
            <KTerm>1 · Initialize</KTerm>
            <P>
              The Client opens by declaring its protocol version and capabilities. The Server responds with
              its own identity and capability list. The Client fires a <Code>notifications/initialized</Code> confirmation
              and the handshake is done.
            </P>
          </div>

          <div className="flex flex-col gap-4">
            <KTerm>2 · Tools / List</KTerm>
            <P>
              The Client asks the Server what's available. The Server returns a typed catalog — name, description,
              and a JSON Schema describing inputs for every tool. This catalog is what the LLM sees.
            </P>
            <CodeBlock label="Response">{`{
  "jsonrpc": "2.0",
  "id": "1",
  "result": {
    "tools": [{
      "name": "get_weather",
      "description": "Get current weather for a city",
      "inputSchema": {
        "type": "object",
        "properties": { "city": { "type": "string" } },
        "required": ["city"]
      }
    }]
  }
}`}</CodeBlock>
          </div>

          <div className="flex flex-col gap-4">
            <KTerm>3 · Tools / Call</KTerm>
            <P>
              The AI picks a tool. The Client sends <Code>tools/call</Code>. The Server executes —
              looks up the handler, constructs a URL, fires the HTTP request, formats the result, returns it.
              The target API never learns MCP exists.
            </P>
            <CodeBlock label="Request">{`{
  "jsonrpc": "2.0",
  "id": "2",
  "method": "tools/call",
  "params": {
    "name": "get_weather",
    "arguments": { "city": "Dallas" }
  }
}`}</CodeBlock>
          </div>

          <div className="grid gap-4 sm:grid-cols-3 pt-2">
            <div className="glass rounded-xl px-5 py-4 flex flex-col gap-2">
              <KTerm>Tools</KTerm>
              <P>Executable functions the LLM invokes. Typed arguments, typed results. The primary primitive Helios generates.</P>
            </div>
            <div className="glass rounded-xl px-5 py-4 flex flex-col gap-2">
              <KTerm>Resources</KTerm>
              <P>Passive data sources identified by URI. Read-only context the AI can inspect.</P>
            </div>
            <div className="glass rounded-xl px-5 py-4 flex flex-col gap-2">
              <KTerm>Prompts</KTerm>
              <P>Pre-defined prompt templates the server exposes to standardize how the AI should approach a task.</P>
            </div>
          </div>

          <div className="pt-4 flex flex-col gap-3">
            <KTerm>The Division of Responsibility</KTerm>
            <P>
              <strong className="text-white/85">The AI decides</strong> which tool to call, what arguments to pass, and how to interpret the result.
            </P>
            <P>
              <strong className="text-white/85">The MCP server executes</strong> — authentication, parameter validation, URL construction, HTTP dispatch, result formatting.
              It contains zero intelligence. It is a typed dispatch layer. The brain is the AI; the hands are the server.
            </P>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════
          CHAPTER 03 — Examples
      ══════════════════════════════════════════════════════════════════════ */}
      <section id="examples" className="px-8 pb-24 max-w-[920px] mx-auto scroll-mt-24">
        <ChapterHeader chapter={CHAPTERS[2]} />

        <div className="flex flex-col gap-5">
          <Lead>What "give the agent this tool" actually looks like in practice.</Lead>

          <div className="grid gap-3 sm:grid-cols-2">
            {[
              { name: "GitHub",          does: "Repo, issue, PR, and file operations via the GitHub API.",          can: "Search open issues for a keyword, locate the source file, open a PR with a proposed fix — all in one conversation." },
              { name: "Google Drive",    does: "List, search, read, and export documents and folders.",             can: "Find a quarterly report spreadsheet, read it, and summarize it into a structured briefing." },
              { name: "Slack",           does: "Send messages, read channel history, search conversations.",       can: "Scan the last 100 messages in #prod-alerts and produce a root-cause summary of a recurring error." },
              { name: "Postgres",        does: "Execute SQL, inspect schemas, read row-level data.",                can: "JOIN subscriptions + activity to identify users who haven't logged in for 30 days." },
              { name: "Puppeteer",       does: "Controls a headless Chromium browser — navigate, click, scrape.",   can: "Navigate to a competitor's pricing page, click through a multi-step modal, return a screenshot." },
              { name: "Filesystem",      does: "Read, write, create, delete — with directory allow-listing.",       can: "Recursively scan a codebase, find every call to a deprecated function, rewrite each file." },
              { name: "Notion",          does: "Manage pages, databases, and blocks via the Notion API.",           can: "Turn a meeting transcript into a new Meeting Notes entry with Action Items auto-populated." },
              { name: "Linear",          does: "Issues, projects, cycles, teams via the Linear GraphQL API.",       can: "Find all High Priority issues in the sprint with no description, auto-draft technical requirements." },
              { name: "Spotify",         does: "Playback control, catalog search, playlists, queues.",              can: "Search deep-work playlists, filter by BPM, start playback on your active device." },
              { name: "Google Calendar", does: "List events, check availability, create and update entries.",       can: "Find the first 30-min window where three teammates are all free and create an event with an agenda." },
            ].map((ex) => (
              <div key={ex.name} className="glass rounded-xl px-5 py-4 flex flex-col gap-2">
                <span className="font-[family-name:--font-cinzel] text-[15px] tracking-[0.14em] text-white/90">{ex.name}</span>
                <p className="font-[family-name:--font-cormorant] text-[16px] text-white/60 leading-snug">{ex.does}</p>
                <p className="font-[family-name:--font-cormorant] italic text-[15px] text-[#C9A84C]/75 leading-snug">
                  An agent can now {ex.can}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════
          CHAPTER 04 — Where to Find API Specs
      ══════════════════════════════════════════════════════════════════════ */}
      <section id="api-specs" className="px-8 pb-24 max-w-[920px] mx-auto scroll-mt-24">
        <ChapterHeader chapter={CHAPTERS[3]} />

        <div className="flex flex-col gap-8">
          <Lead>
            Helios takes an OpenAPI (Swagger) spec as input. Here's where to find one for virtually any API —
            and how to generate your own when no spec exists.
          </Lead>

          <div className="flex flex-col gap-4">
            <KTerm>Directories</KTerm>
            <div className="grid gap-3 sm:grid-cols-2">
              {SPEC_SOURCES.map((s) => (
                <LinkCard key={s.name} href={s.url} title={s.name} note={s.note} />
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <KTerm>Common URL patterns</KTerm>
            <P>
              Many backends publish a spec at a predictable path. Try appending these to the API's base URL
              before assuming nothing is there:
            </P>
            <div className="flex flex-wrap gap-2">
              {URL_PATTERNS.map((p) => (
                <span key={p} className="font-[family-name:--font-geist-mono] text-[12px] text-white/70 bg-white/[0.04] border border-white/[0.1] rounded-md px-2.5 py-1">
                  {p}
                </span>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <KTerm>When no spec exists — generate one</KTerm>
            <div className="grid gap-3 sm:grid-cols-2">
              {SPEC_GENERATORS.map((g) => (
                <LinkCard key={g.name} href={g.url} title={g.name} note={g.note} />
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════
          CHAPTER 05 — Where to Find API Keys
      ══════════════════════════════════════════════════════════════════════ */}
      <section id="api-keys" className="px-8 pb-24 max-w-[920px] mx-auto scroll-mt-24">
        <ChapterHeader chapter={CHAPTERS[4]} />

        <div className="flex flex-col gap-5">
          <Lead>
            One dashboard per provider. One row per quirk. For OAuth-based services this is where to get the
            client ID and client secret; for key-based services, the raw key lives here too.
          </Lead>

          <div className="grid gap-4 sm:grid-cols-2">
            {API_KEY_PROVIDERS.map((p) => (
              <ProviderCard key={p.name} p={p} />
            ))}
          </div>

          {/* Not Listed — how to find credentials for any provider */}
          <div className="glass rounded-xl px-5 py-4 flex flex-col gap-3 mt-4">
            <KTerm>Not Listed</KTerm>
            <P>
              For anything outside the providers above, the same three moves almost always work.
              Dev dashboards are deliberately findable — every vendor wants you to build against them.
            </P>

            <div className="flex flex-col gap-2 pt-1">
              <span className="font-[family-name:--font-cinzel] text-[11px] tracking-[0.22em] uppercase text-white/50">
                1 · Search for the dashboard
              </span>
              <div className="flex flex-wrap gap-2">
                {[
                  `"<service> developer dashboard"`,
                  `"<service> API keys"`,
                  `"<service> OAuth app"`,
                  `"<service> developer portal"`,
                ].map((q) => (
                  <span key={q} className="font-[family-name:--font-geist-mono] text-[12px] text-white/72 bg-white/[0.04] border border-white/[0.1] rounded-md px-2.5 py-1">
                    {q}
                  </span>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-2 pt-1">
              <span className="font-[family-name:--font-cinzel] text-[11px] tracking-[0.22em] uppercase text-white/50">
                2 · Try the URL directly
              </span>
              <div className="flex flex-wrap gap-2">
                {[
                  "developer.<service>.com",
                  "developers.<service>.com",
                  "<service>.com/developers",
                  "dashboard.<service>.com",
                  "<service>.com/settings/api",
                  "<service>.com/settings/tokens",
                ].map((u) => (
                  <span key={u} className="font-[family-name:--font-geist-mono] text-[12px] text-white/72 bg-white/[0.04] border border-white/[0.1] rounded-md px-2.5 py-1">
                    {u}
                  </span>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-2 pt-1">
              <span className="font-[family-name:--font-cinzel] text-[11px] tracking-[0.22em] uppercase text-white/50">
                3 · Go to the docs
              </span>
              <P>
                In the API's own documentation, open <Code>Getting Started</Code>, <Code>Authentication</Code>,
                or <Code>Quickstart</Code>. One of those three pages will link directly to the exact dashboard
                where you create your key or OAuth app — no guessing required.
              </P>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════
          CHAPTER 06 — Dev Playgrounds & Sandboxes
      ══════════════════════════════════════════════════════════════════════ */}
      <section id="playgrounds" className="px-8 pb-24 max-w-[920px] mx-auto scroll-mt-24">
        <ChapterHeader chapter={CHAPTERS[5]} />

        <div className="flex flex-col gap-5">
          <Lead>
            Before you paste credentials into Helios, prove the keys work. Every major provider ships an
            interactive console where you can fire real calls against your own data.
          </Lead>

          <div className="grid gap-3 sm:grid-cols-2">
            {PLAYGROUNDS.map((p) => (
              <LinkCard key={p.name} href={p.url} title={p.name} note={p.note} />
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════
          CHAPTER 07 — Pre-Made Server Reference
      ══════════════════════════════════════════════════════════════════════ */}
      <section id="premade" className="px-8 pb-24 max-w-[920px] mx-auto scroll-mt-24">
        <ChapterHeader chapter={CHAPTERS[6]} />

        <div className="flex flex-col gap-5">
          <Lead>
            The canonical source for every server Helios templates against. Official entries live in
            Anthropic's MCP org; Community entries are the most-maintained third-party implementations.
          </Lead>

          <div className="grid gap-3 sm:grid-cols-2">
            {PREMADE_SERVERS.map((s) => {
              const isOfficial = s.status.startsWith("Official")
              const isArchived = s.status.includes("Archived")
              return (
                <LinkCard
                  key={s.name}
                  href={s.url}
                  title={s.name}
                  note={s.desc}
                  tag={isOfficial ? (isArchived ? "Archived" : "Official") : "Community"}
                />
              )
            })}
          </div>

          <div className="glass rounded-xl px-5 py-4 flex flex-col gap-2 mt-4">
            <KTerm>A note on Archived servers</KTerm>
            <P>
              The <Code>modelcontextprotocol/servers-archived</Code> repo holds reference implementations
              that were in the original monorepo. They're functional and well-documented — they just receive
              less active maintenance than the currently-featured servers. They remain the canonical starting
              point for understanding how each integration works under the hood.
            </P>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════
          CHAPTER 08 — Keys & OAuth Setup (the dedicated section)
      ══════════════════════════════════════════════════════════════════════ */}
      <section id="auth-setup" className="px-8 pb-32 max-w-[920px] mx-auto scroll-mt-24">
        <ChapterHeader chapter={CHAPTERS[7]} />

        <div className="flex flex-col gap-6">
          <Lead>
            A single page — exactly what to configure for every pre-made server Helios ships. Scopes,
            redirect URIs, environment variables, and the gotchas that will otherwise burn an afternoon.
          </Lead>

          <P>
            Rule of thumb: <strong className="text-white/85">API-key servers</strong> need one secret pasted into Helios.
            <strong className="text-white/85"> OAuth2 servers</strong> need a client ID + secret from the provider's dashboard,
            plus a one-time browser consent the first time they run. Helios handles refresh-token renewal from then on.
          </P>

          <div className="flex flex-col gap-3 pt-2">
            {AUTH_SETUP.map((a) => (
              <div key={a.name} className="glass rounded-xl px-5 py-4 flex flex-col gap-2">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="font-[family-name:--font-cinzel] text-[15px] tracking-[0.14em] text-white/92">
                    {a.name}
                  </span>
                  <span className="font-[family-name:--font-cinzel] text-[9px] tracking-[0.18em] uppercase px-2 py-0.5 rounded-md"
                    style={{ background: "rgba(201,168,76,0.10)", border: "1px solid rgba(201,168,76,0.25)", color: "#C9A84C" }}>
                    {a.auth}
                  </span>
                </div>
                <p className="font-[family-name:--font-cormorant] text-[16px] text-white/62 leading-[1.6]">
                  {a.summary}
                </p>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-4 pt-4">
            <KTerm>Redirect URI gotchas</KTerm>
            <P>
              <strong className="text-white/85">Spotify:</strong> localhost is rejected — use <Code>http://127.0.0.1:PORT/callback</Code>.
            </P>
            <P>
              <strong className="text-white/85">Notion OAuth:</strong> redirect URIs must be real HTTPS domains, not raw IP addresses.
            </P>
            <P>
              <strong className="text-white/85">Google Desktop App flow:</strong> redirect URI is handled locally — no configuration needed in GCP.
            </P>
            <P>
              <strong className="text-white/85">Discord:</strong> the <Code>/oauth2/token</Code> endpoint only accepts <Code>application/x-www-form-urlencoded</Code> — JSON bodies fail silently.
            </P>
          </div>

          <div className="mt-6 flex items-center gap-4">
            <div className="flex-1 h-[1px] bg-white/[0.15]" />
            <Link
              href="/keys"
              className="group relative inline-flex items-center gap-2 font-[family-name:--font-cinzel] text-[13px] tracking-[0.18em] text-white/75 hover:text-white transition-all duration-200 cursor-pointer"
            >
              <KeyRound size={14} strokeWidth={1.5} className="text-[#C9A84C]/85" />
              Manage your credentials
              <ChevronRight size={14} strokeWidth={1.5} className="group-hover:translate-x-0.5 transition-transform" />
            </Link>
            <div className="flex-1 h-[1px] bg-white/[0.15]" />
          </div>
        </div>
      </section>

      {/* ── Back to top ─────────────────────────────────────────────────── */}
      <button
        onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        aria-label="Back to top"
        className={cn(
          "fixed bottom-8 right-8 z-40 w-11 h-11 rounded-full flex items-center justify-center",
          "glass cursor-pointer hover:-translate-y-0.5 transition-all duration-200",
          showTop ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        )}
        style={{ boxShadow: "0 10px 30px rgba(0,0,0,0.4)" }}
      >
        <ArrowUp size={16} strokeWidth={1.6} className="text-white/85" />
      </button>
    </div>
    </>
  )
}

export default function InfoPage() {
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <InfoContent />
    </Suspense>
  )
}
