// Maps a provider slug (or a fuzzy integrationId) to the canonical credential
// dashboard URL used in the Info page's "Where to Find API Keys" chapter (Ch5).
//
// When an integrationId matches (case-insensitive substring against the slug),
// UI should link the Info bubble directly to the provider's dashboard so the
// user lands exactly where they need to go. If no match, fall back to
// /info?chapter=api-keys.

export type BasicAuthLabels = {
  /** Label for the field Helios stores as the basic-auth username. */
  user: string
  /** Label for the field Helios stores as the basic-auth password. */
  pass: string
  /** Optional plain-language hint shown under the form. */
  hint?: string
}

export type ProviderKey = {
  slug: string
  name: string
  url: string
  // Extra tokens to match against — covers common aliases (e.g. "gmail" → google).
  aliases?: string[]
  // Per-provider labels for the basic-auth form. Most APIs say "Username/Password",
  // but providers like Twilio call them something else entirely. Optional — falls
  // back to generic "Username / Password" labels when omitted.
  basicAuthLabels?: BasicAuthLabels
}

export const PROVIDER_KEYS: ProviderKey[] = [
  { slug: "openai",    name: "OpenAI",       url: "https://platform.openai.com/api-keys" },
  { slug: "anthropic", name: "Anthropic",    url: "https://console.anthropic.com/settings/keys", aliases: ["claude"] },
  { slug: "google",    name: "Google Cloud", url: "https://console.cloud.google.com/apis/credentials", aliases: ["gmail", "gcal", "google_calendar", "google_maps", "gcp", "youtube", "drive"] },
  { slug: "github",    name: "GitHub",       url: "https://github.com/settings/tokens" },
  { slug: "spotify",   name: "Spotify",      url: "https://developer.spotify.com/dashboard" },
  { slug: "slack",     name: "Slack",        url: "https://api.slack.com/apps" },
  { slug: "notion",    name: "Notion",       url: "https://notion.so/my-integrations" },
  { slug: "linear",    name: "Linear",       url: "https://linear.app/settings/api" },
  { slug: "stripe",    name: "Stripe",       url: "https://dashboard.stripe.com/apikeys" },
  {
    slug: "twilio",
    name: "Twilio",
    url: "https://console.twilio.com",
    basicAuthLabels: {
      user: "Account SID",
      pass: "Auth Token",
      hint: "Both live on your Twilio Console dashboard. The Account SID starts with \"AC\".",
    },
  },
  { slug: "discord",   name: "Discord",      url: "https://discord.com/developers/applications" },
  { slug: "reddit",    name: "Reddit",       url: "https://www.reddit.com/prefs/apps" },
  { slug: "aws",       name: "AWS IAM",      url: "https://console.aws.amazon.com/iam/", aliases: ["amazon"] },
]

const DEFAULT_BASIC_AUTH_LABELS: BasicAuthLabels = { user: "Username/SID", pass: "Password/Token" }

/**
 * Returns the credential dashboard URL for an integrationId, or null if no
 * match. Matching is a lowercase substring check against slug + aliases —
 * deliberately fuzzy because the backend integrationId format isn't guaranteed
 * (could be "github", "GitHubAuth", "github_oauth", etc.).
 */
export function lookupProviderKeyUrl(integrationId: string | undefined | null): string | null {
  if (!integrationId) return null
  const needle = integrationId.toLowerCase()
  for (const p of PROVIDER_KEYS) {
    if (needle.includes(p.slug)) return p.url
    if (p.aliases?.some((a) => needle.includes(a))) return p.url
  }
  return null
}

/**
 * Returns the per-provider basic-auth field labels for a given integrationId
 * (e.g. Twilio → "Account SID" / "Auth Token"). Falls back to generic
 * "Username" / "Password" when the provider isn't recognized.
 *
 * Matching mirrors lookupProviderKeyUrl — case-insensitive substring against
 * slug + aliases — so it tolerates the same fuzziness in stored integration ids.
 */
export function lookupBasicAuthLabels(integrationId: string | undefined | null): BasicAuthLabels {
  if (!integrationId) return DEFAULT_BASIC_AUTH_LABELS
  const needle = integrationId.toLowerCase()
  for (const p of PROVIDER_KEYS) {
    if (!p.basicAuthLabels) continue
    if (needle.includes(p.slug)) return p.basicAuthLabels
    if (p.aliases?.some((a) => needle.includes(a))) return p.basicAuthLabels
  }
  return DEFAULT_BASIC_AUTH_LABELS
}
