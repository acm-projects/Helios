// Condensed summaries shown in the InfoBubble dropdown popover.
// These are intentionally short — the full chapter lives on /info and is
// one click away via the "Read full chapter" link at the bottom of each.

export type InfoSummaryLink = { label: string; href: string; external?: boolean }

export type InfoSummary = {
  title: string
  intro: string
  points: string[]
  links?: InfoSummaryLink[]
}

export const INFO_SUMMARIES: Record<string, InfoSummary> = {
  "api-specs": {
    title: "Where to Find API Specs",
    intro:
      "An OpenAPI spec is the blueprint Helios reads to build your custom tools. Most public APIs already publish one — you just have to know where to look.",
    points: [
      "APIs.guru catalogs 4,000+ public OpenAPI specs (Google, AWS, Stripe, Twilio).",
      "On GitHub, search with the path filter: path:openapi.yaml or path:openapi.json.",
      "If the API has no published spec, record your traffic with Apidog or Swagger Inspector to generate one.",
    ],
    links: [
      { label: "APIs.guru", href: "https://apis.guru/", external: true },
      { label: "GitHub path:openapi.yaml", href: "https://github.com/search?q=path%3Aopenapi.yaml&type=code", external: true },
    ],
  },

  premade: {
    title: "Pre-Made Servers",
    intro:
      "Skip the custom-tool setup. Helios ships curated, ready-to-run servers for the APIs people actually want — pick one and go.",
    points: [
      "Over 40 templates: Gmail, Google Calendar, Slack, GitHub, Notion, Spotify, Stripe, and more.",
      "Each template is backed by a canonical repo with a maintained tool catalog.",
      "Pre-made servers still need your own API keys — see the Keys section after picking one.",
    ],
  },

  "how-it-works": {
    title: "How an MCP Server Works",
    intro:
      "MCP is a thin JSON-RPC protocol that lets any AI agent call the tools your server exposes — no bespoke integration code per model.",
    points: [
      "The agent opens a session with initialize, then asks tools/list to discover what's available.",
      "When the agent decides to use a tool, it sends tools/call with the tool name and arguments.",
      "Your MCP server maps that call to a real HTTP request against the target API and returns the result.",
    ],
  },

  "api-keys": {
    title: "Where to Find API Keys",
    intro:
      "Every provider hides credentials in a different dashboard, and the auth headers they expect vary. The full chapter covers the thirteen most-requested providers in detail.",
    points: [
      "OpenAI: platform.openai.com/api-keys — sent as Authorization: Bearer sk-…",
      "Anthropic: console.anthropic.com/settings/keys — sent as x-api-key (no Bearer prefix).",
      "Google Cloud: needs both an OAuth scope AND a matching IAM role — enable the API first.",
    ],
  },
}

export function getInfoSummary(chapter: string | undefined | null): InfoSummary | null {
  if (!chapter) return null
  return INFO_SUMMARIES[chapter] ?? null
}
