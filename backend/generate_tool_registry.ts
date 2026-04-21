import SwaggerParser from "@apidevtools/swagger-parser";
import type { OpenAPIV3 } from "openapi-types";
import { createHash } from "crypto";

// ─── Auth Template Types ───────────────────────────────────────────────────────

export type AuthTemplate =
  | "bearer_token"        // Authorization: Bearer {token}
  | "api_key_header"      // {header_name}: {key}
  | "api_key_query"       // ?{param_name}={key}
  | "oauth2_client_creds" // Exchange CLIENT_ID+SECRET → access_token (auto-refresh)
  | "oauth2_auth_code"    // User-obtained access_token stored as bearer
  | "basic_auth"          // Authorization: Basic base64(user:pass)

export interface ToolAuthEnrichment {
  template: AuthTemplate
  /** Set by api.ts at session start — which DB record to look up. Empty string = not yet set. */
  integration_id: string
  /** api_key_header: which header to inject into */
  header_name?: string
  /** api_key_query: which query param to use */
  param_name?: string
  /** oauth2 templates: token endpoint (used by generated server for auto-exchange) */
  token_url?: string
  /** oauth2_auth_code: authorization endpoint for the popup login flow */
  authorization_url?: string
  /** Generated server only: env var name(s) for this credential */
  env_var?: string
}

export interface ToolEnrichment {
  /** null = this tool requires no auth */
  auth: ToolAuthEnrichment | null
}

// ─── Existing Core Types (unchanged) ──────────────────────────────────────────

export interface EndpointDefinition {
  name: string;
  description: string;
  input_schema: {
    type: string;
    properties: Record<string, any>;
    required: string[];
  };
  handler: {
    method: string;
    path: string;
    headers?: Record<string, string>;
    query_params: string[];
    fixed_query_params?: Record<string, string>;
    /**
     * sanitized → original lookup for any input_schema key Anthropic rejects
     * (must match ^[a-zA-Z0-9_.-]{1,64}$). Present only when ≥1 key was renamed.
     * The MCP dispatcher uses this to rebuild the outgoing request with the
     * names the target API actually expects.
     */
    param_name_map?: Record<string, string>;
    /**
     * Body serialization for non-GET requests. Comes from the OpenAPI requestBody
     * content type — Twilio + many enterprise APIs declare only form-urlencoded,
     * not JSON, and reject JSON bodies with cryptic "field required" errors.
     * Defaults to "json" when omitted (most modern APIs).
     */
    body_format?: "json" | "form" | "multipart";
    /**
     * Path placeholders the dispatcher fills from saved auth credentials —
     * the LLM never sees these.
     * Values: "auth_username" → split saved basic-auth on ":" and use the left half.
     */
    auto_path_params?: Record<string, "auth_username">;
  };
  /** Template metadata — drives sandbox auth lookup and generated server code */
  enrichment: ToolEnrichment;
}

export interface AuthConfig {
  type: "api_key" | "bearer_token" | "basic_auth" | "oauth2" | "none";
  in?: "header" | "query";
  name?: string;
  authorizationUrl?: string;
  tokenUrl?: string;
  scopes?: Record<string, string>;
  oauthFlow?: "client_credentials" | "authorization_code" | "implicit" | "password";
}

export interface ToolsFile {
  schema_version: number;
  baseUrl: string;
  tools: EndpointDefinition[];
  auth: AuthConfig[];
}

// ─── Schema Helpers (unchanged) ───────────────────────────────────────────────

// Matches placeholder defaults that spec authors write to mean "supply your own value".
// We drop these so the LLM never sees them as hints — they cause the model to pass
// literal placeholder strings as real parameter values.
const PLACEHOLDER_DEFAULT_RE = /^your_/i

// Format → description suffix for parameters that take structured markup. Without
// an explicit "use raw characters" hint, Claude HTML-encodes `<`/`>` (`&lt;`/`&gt;`)
// and the target API rejects the malformed payload.
const MARKUP_FORMAT_HINTS: Record<string, string> = {
  twiml: 'IMPORTANT: pass raw XML using literal `<` and `>` characters. Do NOT HTML-encode (no `&lt;`, no `&gt;`). Must be wrapped in a `<Response>` element. Example: `<Response><Say>your message</Say></Response>`.',
  xml: 'IMPORTANT: pass raw XML using literal `<` and `>` characters. Do NOT HTML-encode (no `&lt;`, no `&gt;`).',
  html: 'IMPORTANT: pass raw HTML using literal `<` and `>` characters. Do NOT double-encode entities.',
}

function isPlaceholderDefault(val: unknown): boolean {
  if (typeof val !== "string") return false
  if (PLACEHOLDER_DEFAULT_RE.test(val)) return true
  if (/^<.+>$/.test(val)) return true      // <your-account-sid>
  if (/^\{[A-Z_]+\}$/.test(val)) return true  // {ACCOUNT_SID}
  if (/x{4,}/i.test(val)) return true       // xxxx placeholder patterns (anywhere in string)
  return false
}

/**
 * True iff `paramName` appears in `schemeKey` at the start or right after a non-alphanumeric
 * separator (case-insensitive). Catches `accountSid_authToken ⊃ AccountSid` and
 * `cloudIdAuth ⊃ cloudId` without matching `cloud` inside `bigcloudidthing`. The 4-char
 * minimum keeps generic short names (`id`, `key`) from triggering.
 */
function schemeKeyMentions(schemeKey: string, paramName: string): boolean {
  if (paramName.length < 4) return false
  const haystack = schemeKey.toLowerCase()
  const needle = paramName.toLowerCase()
  const idx = haystack.indexOf(needle)
  if (idx === -1) return false
  if (idx === 0) return true
  const c = haystack.charCodeAt(idx - 1)
  // alphanumeric = continuation of a prior identifier, not a separator boundary
  return !((c >= 97 && c <= 122) || (c >= 48 && c <= 57))
}

function buildSchemaProp(schema: any, rootSpec: any): any {
  const resolved = resolveSchema(schema, rootSpec);
  const type = resolved.type === "array" ? "array" : resolved.type === "object" ? "object" : mapType(resolved.type);
  const prop: any = { type };
  if (type === "array") {
    const rawItems = resolved.items ? resolveSchema(resolved.items, rootSpec) : null;
    if (rawItems?.type === "object") {
      prop.items = { type: "object" };
    } else {
      prop.items = rawItems?.type ? { type: mapType(rawItems.type) } : { type: "string" };
    }
  }
  if (type === "object" && resolved.properties) {
    prop.properties = Object.fromEntries(
      Object.entries<any>(resolved.properties).map(([k, v]) => [k, buildSchemaProp(v, rootSpec)])
    );
  }
  // Emit only the allowlisted fields. Stripping `default`, `example`, `examples`,
  // `deprecated`, `readOnly`, `writeOnly`, and `x-*` prevents the LLM from treating
  // spec-author scaffolding (e.g. default: "your_account_sid") as valid values.
  if (resolved.description) prop.description = resolved.description;
  // Claude defensively HTML-encodes angle brackets in string values when the
  // description hints at markup but doesn't explicitly say "raw" — Twilio's TwiML
  // field is the canonical bite, returning error 12100. Append an explicit hint
  // for any spec format that takes structured markup as a string value.
  const fmtHint = MARKUP_FORMAT_HINTS[String(resolved.format || "").toLowerCase()];
  if (fmtHint) prop.description = (prop.description ? prop.description + " " : "") + fmtHint;
  if (resolved.enum) prop.enum = resolved.enum;
  if (resolved.format) prop.format = resolved.format;
  if (resolved.pattern) prop.pattern = resolved.pattern;
  if (resolved.minimum !== undefined) prop.minimum = resolved.minimum;
  if (resolved.maximum !== undefined) prop.maximum = resolved.maximum;
  if (Array.isArray(resolved.required)) prop.required = resolved.required;
  return prop;
}

function mapType(apiType: string | undefined): string {
  switch ((apiType || "").toLowerCase()) {
    case "string": return "string";
    case "integer": return "integer";
    case "number": return "number";
    case "boolean": return "boolean";
    case "object": return "object";
    default: return "string";
  }
}

function resolveSchema(schema: any, rootSpec: any): any {
  if (!schema) return {};
  if (schema.$ref && typeof schema.$ref === "string" && schema.$ref.startsWith("#")) {
    const parts = schema.$ref.replace(/^#\//, "").split("/");
    let current = rootSpec;
    for (const part of parts) {
      if (current[part] === undefined) return {};
      current = current[part];
    }
    return resolveSchema(current, rootSpec);
  }
  const composite = schema.oneOf || schema.anyOf || schema.allOf;
  if (Array.isArray(composite) && composite.length > 0) {
    for (const option of composite) {
      const resolved = resolveSchema(option, rootSpec);
      if (resolved.type) return resolved;
    }
    return resolveSchema(composite[0], rootSpec);
  }
  return schema;
}

// ─── New: Fixed Param Detection ────────────────────────────────────────────────

/**
 * Finds query params that have a known default and are required — these should
 * be auto-injected on every call instead of asking the AI to supply them.
 * Classic example: api-version=1.0 on BC Gov News, Azure APIs, etc.
 *
 * Returns: { paramName: defaultValue } for each param to auto-inject.
 */
function detectFixedQueryParams(parameters: any[], rootSpec: any): Record<string, string> {
  const fixed: Record<string, string> = {}
  for (const p of parameters) {
    if (p.in !== "query") continue
    const rawSchema = p.schema || (p.type ? { type: p.type, default: p.default } : {})
    const schema = resolveSchema(rawSchema, rootSpec)
    let defaultVal = schema.default ?? rawSchema.default ?? p.default
    
    // Auto-inject if: required AND has a non-empty default value (or fallback to info.version for api-version)
    if (p.required === true) {
      if (defaultVal === undefined && (p.name.toLowerCase() === "api-version" || p.name.toLowerCase() === "api_version" || p.name.toLowerCase() === "version")) {
        defaultVal = rootSpec.info?.version
      }
      if (defaultVal !== undefined && String(defaultVal).trim() !== "") {
        fixed[p.name] = String(defaultVal)
      }
    }
  }
  return fixed
}

// ─── Implicit API Key Heuristic ───────────────────────────────────────────────

const IMPLICIT_API_KEY_NAMES = new Set(["key", "api_key", "apikey", "api-key", "token", "access_token", "apitoken", "api_token"])

/**
 * Some specs (e.g. Weatherbit) never declare a securityDefinitions block —
 * they just add an API key as a plain query param on every endpoint.
 * This scans all operations and returns the param name if one of the known
 * key-like names appears on the majority (>= 50%) of endpoints.
 */
function detectImplicitApiKeyParam(spec: any): string | null {
  const paths = spec.paths || {}
  const httpMethods = ["get", "post", "put", "patch", "delete"]
  const allOps: any[] = []
  for (const pathItem of Object.values(paths) as any[]) {
    for (const m of httpMethods) {
      if (pathItem[m]) allOps.push(pathItem[m])
    }
  }
  if (allOps.length === 0) return null

  const counts: Record<string, number> = {}
  for (const op of allOps) {
    for (const p of (op.parameters || []) as any[]) {
      if (p.in === "query" && p.name && IMPLICIT_API_KEY_NAMES.has((p.name as string).toLowerCase())) {
        counts[p.name] = (counts[p.name] || 0) + 1
      }
    }
  }

  const threshold = allOps.length * 0.5
  for (const [name, count] of Object.entries(counts)) {
    if (count >= threshold) return name
  }
  return null
}

// ─── Security Resolution (OpenAPI 2.0 + 3.x + 3.1) ────────────────────────────

/**
 * Returns the scheme registry from either OpenAPI 3.x (components.securitySchemes)
 * or Swagger 2.0 (securityDefinitions). Normalized to { name → scheme }.
 */
function getSchemeRegistry(spec: any): Record<string, any> {
  return spec.components?.securitySchemes || spec.securityDefinitions || {}
}

/**
 * Walks spec.security plus every operation.security and returns the unique
 * scheme names actually referenced anywhere, in first-seen order. Ignoring
 * this is what caused the premade audit to surface auth:null on specs that
 * declared schemes but never said which scheme applies where.
 */
function collectReferencedSchemeNames(spec: any): string[] {
  const seen = new Set<string>()
  const ordered: string[] = []
  const add = (security: any) => {
    if (!Array.isArray(security)) return
    for (const req of security) {
      if (!req || typeof req !== "object") continue
      for (const name of Object.keys(req)) {
        if (!seen.has(name)) { seen.add(name); ordered.push(name) }
      }
    }
  }
  add(spec.security)
  const paths = spec.paths || {}
  const httpMethods = ["get", "post", "put", "patch", "delete", "head", "options"]
  for (const pathItem of Object.values(paths) as any[]) {
    for (const m of httpMethods) {
      if (pathItem?.[m]) add(pathItem[m].security)
    }
  }
  return ordered
}

/**
 * Per-operation security resolution. Per the OpenAPI spec the PRESENCE of
 * the security key at operation level triggers the override — `security: []`
 * means "explicitly no auth" and is NOT equivalent to the key being absent.
 *
 *   defined at op:       use op.security (including [])
 *   undefined at op:     inherit spec.security (global)
 *   undefined at both:   undefined (parser decides implicit fallback)
 */
function resolveEffectiveSecurity(operation: any, spec: any): any[] | undefined {
  if (operation && "security" in operation) return operation.security
  if (Array.isArray(spec.security)) return spec.security
  return undefined
}

/**
 * Maps one resolved scheme object → ToolAuthEnrichment. Covers oauth2 (3.x
 * flows + 2.0 flow-string), http bearer/basic, apiKey header/query, and
 * openIdConnect (mapped to oauth2_auth_code with discovery URL stashed in
 * authorization_url). Returns null for mutualTLS, apiKey:cookie, unknown
 * types — caller treats that as "no enrichment available."
 */
function schemeToEnrichment(scheme: any): ToolAuthEnrichment | null {
  if (!scheme || typeof scheme !== "object") return null

  if (scheme.type === "oauth2") {
    if (scheme.flows && typeof scheme.flows === "object") {
      const flows = scheme.flows
      if (flows.clientCredentials) {
        return { template: "oauth2_client_creds", integration_id: "", token_url: flows.clientCredentials.tokenUrl }
      }
      if (flows.authorizationCode) {
        return { template: "oauth2_auth_code", integration_id: "", token_url: flows.authorizationCode.tokenUrl, authorization_url: flows.authorizationCode.authorizationUrl }
      }
      if (flows.implicit) {
        return { template: "oauth2_auth_code", integration_id: "", authorization_url: flows.implicit.authorizationUrl }
      }
      if (flows.password) {
        return { template: "oauth2_auth_code", integration_id: "", token_url: flows.password.tokenUrl }
      }
      return null
    }
    // Swagger 2.0 flow is a string. `accessCode` and `application` are the
    // renames that most hand-written converters miss.
    const flow = scheme.flow
    if (flow === "application") return { template: "oauth2_client_creds", integration_id: "", token_url: scheme.tokenUrl }
    if (flow === "accessCode") return { template: "oauth2_auth_code", integration_id: "", token_url: scheme.tokenUrl, authorization_url: scheme.authorizationUrl }
    if (flow === "implicit") return { template: "oauth2_auth_code", integration_id: "", authorization_url: scheme.authorizationUrl }
    if (flow === "password") return { template: "oauth2_auth_code", integration_id: "", token_url: scheme.tokenUrl }
    return null
  }

  if (scheme.type === "openIdConnect") {
    // OIDC sits on OAuth2 auth-code. Real token/auth URLs live in the
    // discovery document at openIdConnectUrl — we don't fetch it at parse time.
    return { template: "oauth2_auth_code", integration_id: "", authorization_url: scheme.openIdConnectUrl }
  }

  if (scheme.type === "http") {
    if (scheme.scheme === "bearer") return { template: "bearer_token", integration_id: "" }
    if (scheme.scheme === "basic") return { template: "basic_auth", integration_id: "" }
    return null
  }

  if (scheme.type === "apiKey") {
    if (scheme.in === "header") return { template: "api_key_header", integration_id: "", header_name: scheme.name }
    if (scheme.in === "query") return { template: "api_key_query", integration_id: "", param_name: scheme.name }
    // apiKey:cookie is spec-legal (3.x) but we don't inject cookies at call time.
    return null
  }

  // mutualTLS, unknown types: cannot inject credentials at call time.
  return null
}

/**
 * Parallel converter for the top-level AuthConfig[] shape. Mirrors
 * schemeToEnrichment but emits the user-facing auth-setup entry.
 */
function schemeToAuthConfig(scheme: any): AuthConfig | null {
  if (!scheme || typeof scheme !== "object") return null

  if (scheme.type === "oauth2") {
    if (scheme.flows && typeof scheme.flows === "object") {
      const flows = scheme.flows
      if (flows.clientCredentials) {
        return { type: "oauth2", oauthFlow: "client_credentials", tokenUrl: flows.clientCredentials.tokenUrl, scopes: flows.clientCredentials.scopes || {} }
      }
      if (flows.authorizationCode) {
        return { type: "oauth2", oauthFlow: "authorization_code", authorizationUrl: flows.authorizationCode.authorizationUrl, tokenUrl: flows.authorizationCode.tokenUrl, scopes: flows.authorizationCode.scopes || {} }
      }
      if (flows.implicit) {
        return { type: "oauth2", oauthFlow: "implicit", authorizationUrl: flows.implicit.authorizationUrl, scopes: flows.implicit.scopes || {} }
      }
      if (flows.password) {
        return { type: "oauth2", oauthFlow: "password", tokenUrl: flows.password.tokenUrl, scopes: flows.password.scopes || {} }
      }
      return null
    }
    const flowMap: Record<string, AuthConfig["oauthFlow"]> = {
      application: "client_credentials", accessCode: "authorization_code", implicit: "implicit", password: "password"
    }
    return {
      type: "oauth2",
      oauthFlow: flowMap[scheme.flow] ?? "authorization_code",
      authorizationUrl: scheme.authorizationUrl,
      tokenUrl: scheme.tokenUrl,
      scopes: scheme.scopes || {}
    }
  }

  if (scheme.type === "openIdConnect") {
    // Represent OIDC via the oauth2 auth-code shape so downstream UI treats it
    // consistently. Discovery URL lives in authorizationUrl until runtime resolves it.
    return { type: "oauth2", oauthFlow: "authorization_code", authorizationUrl: scheme.openIdConnectUrl, scopes: {} }
  }

  if (scheme.type === "http") {
    if (scheme.scheme === "bearer") return { type: "bearer_token" }
    if (scheme.scheme === "basic") return { type: "basic_auth" }
    return null
  }

  if (scheme.type === "apiKey") {
    if (scheme.in === "header" || scheme.in === "query") {
      return { type: "api_key", in: scheme.in, name: scheme.name }
    }
    return null
  }

  return null
}

// ─── New: Enrichment Builder from AuthConfig[] ────────────────────────────────

/**
 * Builds a ToolEnrichment from a parsed AuthConfig[] array.
 * Used when loading saved catalog tools that may not have enrichment stored,
 * or for composite sessions where authMap drives auth type detection.
 */
export function buildEnrichmentFromAuthConfigs(authConfigs: AuthConfig[]): ToolEnrichment {
  const auth = authConfigs.find(a => a.type !== "none")
  if (!auth) return { auth: null }

  switch (auth.type) {
    case "oauth2":
      return {
        auth: {
          template: auth.oauthFlow === "client_credentials" ? "oauth2_client_creds" : "oauth2_auth_code",
          integration_id: "",
          token_url: auth.tokenUrl,
          authorization_url: auth.authorizationUrl,
        }
      }
    case "bearer_token":
      return { auth: { template: "bearer_token", integration_id: "" } }
    case "api_key":
      if (auth.in === "header") {
        return { auth: { template: "api_key_header", integration_id: "", header_name: auth.name } }
      }
      if (auth.in === "query") {
        return { auth: { template: "api_key_query", integration_id: "", param_name: auth.name } }
      }
      return { auth: null }
    case "basic_auth":
      return { auth: { template: "basic_auth", integration_id: "" } }
    default:
      return { auth: null }
  }
}

// ─── Schema Key Sanitization (Anthropic compliance) ──────────────────────────

// Anthropic's tool API rejects any input_schema property key that doesn't match
// this pattern. OpenAPI specs in the wild routinely violate it (Twilio's
// form-encoded params include `[`/`]`, deeply joined names exceed 64 chars,
// some specs use `:` in param names, etc.).
const ANTHROPIC_KEY_RE = /^[a-zA-Z0-9_.-]{1,64}$/;

/** Deterministic, regex-compliant rewrite of one property key. */
function sanitizeSchemaKey(original: string): string {
  if (ANTHROPIC_KEY_RE.test(original)) return original;
  // Collapse every disallowed char into a single underscore; safer for the eye
  // than escaping each one. Keeps `.` and `-` since the regex permits them.
  let cleaned = original.replace(/[^a-zA-Z0-9_.-]+/g, "_");
  if (cleaned.length > 64) {
    // Two long original names could collapse to the same 64-char prefix.
    // Anchor a stable 8-char hash of the *original* so renames are 1:1
    // and round-trip lookups never collide.
    const tag = createHash("sha1").update(original).digest("hex").slice(0, 8);
    cleaned = cleaned.slice(0, 55) + "_" + tag; // 55 + 1 + 8 = 64
  }
  return cleaned;
}

/**
 * Renames every key in `properties` (and the matching entries in `required`)
 * to satisfy Anthropic's regex. Returns a `param_name_map` of sanitized→original
 * **only** when at least one rename happened, so unaffected specs stay clean.
 */
function sanitizeInputSchemaKeys(
  properties: Record<string, any>,
  required: string[]
): {
  properties: Record<string, any>;
  required: string[];
  param_name_map?: Record<string, string>;
} {
  const renamed: Record<string, any> = {};
  const map: Record<string, string> = {};
  // origKey → finalSafeKey, used so `required` can re-derive the SAME key we picked
  // (including disambiguation suffixes) instead of recomputing and missing a collision.
  const keyAssignment = new Map<string, string>();
  let changed = false;
  for (const [origKey, val] of Object.entries(properties)) {
    let safeKey = sanitizeSchemaKey(origKey);
    // Two distinct original keys can collapse to the same sanitized name (e.g. Twilio's
    // `DateSent<` and `DateSent>` both → `DateSent_`). Without disambiguation, the second
    // overwrites the first and the param is silently lost. Append a stable hash suffix.
    if (renamed[safeKey] !== undefined) {
      const tag = createHash("sha1").update(origKey).digest("hex").slice(0, 6);
      const base = safeKey.length > 57 ? safeKey.slice(0, 57) : safeKey;
      safeKey = `${base}_${tag}`;
    }
    renamed[safeKey] = val;
    keyAssignment.set(origKey, safeKey);
    if (safeKey !== origKey) {
      map[safeKey] = origKey;
      changed = true;
    }
  }
  if (!changed) return { properties, required };
  const renamedRequired = required.map(k => keyAssignment.get(k) ?? sanitizeSchemaKey(k));
  return { properties: renamed, required: renamedRequired, param_name_map: map };
}

// ─── Parameter Parsing ─────────────────────────────────────────────────────────

/**
 * Converts OpenAPI parameter list and requestBody into input_schema + query_params.
 * fixedParamNames: params to skip — they're auto-injected via fixed_query_params.
 */
function buildFromOpenApiParams(
  parameters: any[] = [],
  requestBody?: any,
  rootSpec?: any,
  fixedParamNames: Set<string> = new Set()
): {
  input_schema: EndpointDefinition["input_schema"];
  query_params: string[];
  param_name_map?: Record<string, string>;
  body_format?: "json" | "form" | "multipart";
} {
  const properties: Record<string, any> = {};
  const required: string[] = [];
  const queryParams: string[] = [];

  for (const p of parameters) {
    // Skip params that are auto-injected — the AI never needs to see them
    if (fixedParamNames.has(p.name)) continue

    const name = p.name;
    const rawSchema = p.schema || (p.type ? { type: p.type, items: p.items, enum: p.enum, description: p.description } : {})
    const schema = resolveSchema(rawSchema, rootSpec);

    if (p.in === "body" && schema && schema.properties) {
      for (const [propName, propSchemaRaw] of Object.entries<any>(schema.properties)) {
        const propSchema = resolveSchema(propSchemaRaw, rootSpec);
        properties[propName] = buildSchemaProp(propSchema, rootSpec);
      }
      if (Array.isArray(schema.required)) {
        for (const req of schema.required) {
          if (!required.includes(req)) required.push(req);
        }
      }
      continue;
    }

    const schemaProp = buildSchemaProp(schema, rootSpec);
    if (p.description && !schemaProp.description) schemaProp.description = p.description;
    properties[name] = schemaProp;

    if (p.required === true || p.in === "path") {
      required.push(name);
    }
    if (p.in === "query") {
      queryParams.push(name);
    }
  }

  let bodyFormat: "json" | "form" | "multipart" | undefined
  if (requestBody && requestBody.content) {
    const contentTypes = ["application/json", "application/x-www-form-urlencoded", "multipart/form-data"];
    let bodySchema = null;
    for (const cType of contentTypes) {
      if (requestBody.content[cType]?.schema) {
        bodySchema = resolveSchema(requestBody.content[cType].schema, rootSpec);
        if (cType === "application/x-www-form-urlencoded") bodyFormat = "form"
        else if (cType === "multipart/form-data") bodyFormat = "multipart"
        else bodyFormat = "json"
        break;
      }
    }
    if (bodySchema && bodySchema.properties) {
      for (const [propName, propSchemaRaw] of Object.entries<any>(bodySchema.properties)) {
        const propSchema = resolveSchema(propSchemaRaw, rootSpec);
        properties[propName] = buildSchemaProp(propSchema, rootSpec);
      }
      if (Array.isArray(bodySchema.required)) {
        for (const req of bodySchema.required) {
          if (!required.includes(req)) required.push(req);
        }
      }
    }
  }

  const sanitized = sanitizeInputSchemaKeys(properties, required);
  return {
    input_schema: { type: "object", properties: sanitized.properties, required: sanitized.required },
    query_params: queryParams,
    param_name_map: sanitized.param_name_map,
    body_format: bodyFormat,
  };
}

function generateToolName(method: string, path: string): string {
  return (`${method}_${path}`)
    .toLowerCase()
    .replace(/\{(\w+)\}/g, "by_$1")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

// ─── Auth Config Parser ───────────────────────────────────────────────────────

/**
 * Emits the top-level auth[] array shown to the user. Prefers only schemes the
 * spec actually references via some security[] block (root or per-op) — this
 * avoids flooding the UI with five credential fields when the spec only uses
 * one. Falls back to all declared schemes for specs that declare securitySchemes
 * but never reference them (better than nothing), then to the implicit API key
 * heuristic, then to [{type: "none"}].
 */
export function parseAuthConfig(spec: any): AuthConfig[] {
  const registry = getSchemeRegistry(spec)
  const referenced = collectReferencedSchemeNames(spec)
  const sourceNames = referenced.length > 0 ? referenced : Object.keys(registry)

  const configs: AuthConfig[] = []
  const seen = new Set<string>()
  for (const name of sourceNames) {
    const scheme = registry[name]
    const cfg = schemeToAuthConfig(scheme)
    if (!cfg) continue
    // Dedupe: two schemes of the same type+identity collapse into one UI entry.
    const key = cfg.type === "api_key" ? `apiKey:${cfg.in}:${cfg.name}` :
                cfg.type === "oauth2" ? `oauth2:${cfg.oauthFlow}:${cfg.tokenUrl ?? cfg.authorizationUrl ?? ""}` :
                cfg.type
    if (seen.has(key)) continue
    seen.add(key)
    configs.push(cfg)
  }

  if (configs.length > 0) return configs

  const implicitParam = detectImplicitApiKeyParam(spec)
  if (implicitParam) return [{ type: "api_key", in: "query", name: implicitParam }]

  return [{ type: "none" }]
}

// ─── Main Parser ───────────────────────────────────────────────────────────────

export function parseOpenApiSpec(spec: any): ToolsFile {
  const tools: EndpointDefinition[] = []
  const paths: Record<string, any> = spec.paths || {}

  let baseUrl: string
  if (spec.servers && Array.isArray(spec.servers) && spec.servers.length > 0) {
    baseUrl = spec.servers[0].url
  } else if (spec.host) {
    const scheme = spec.schemes && spec.schemes.length > 0 ? spec.schemes[0] : "https"
    baseUrl = `${scheme}://${spec.host}${spec.basePath || ""}`
  } else {
    baseUrl = ""
  }

  const registry = getSchemeRegistry(spec)

  // Implicit API-key heuristic runs once. Used only as fallback when NEITHER
  // the spec nor the operation declares any security block.
  const implicitEnrichment: ToolAuthEnrichment | null = (() => {
    const implicit = detectImplicitApiKeyParam(spec)
    return implicit ? { template: "api_key_query", integration_id: "", param_name: implicit } : null
  })()

  // Within a single requirement, rank enrichments by completeness so we pick
  // the one the generated server can actually use. OAuth2 specs often declare
  // both implicit (no token_url) and authorizationCode (with token_url) in one
  // AND'd requirement — Google Calendar is the canonical example. Without this,
  // we'd pick implicit first and the code→token exchange step would break.
  const enrichmentScore = (e: ToolAuthEnrichment): number => {
    if (e.template === "oauth2_auth_code") return e.token_url ? 3 : 1
    if (e.template === "oauth2_client_creds") return e.token_url ? 3 : 1
    return 2
  }

  // Resolves the enrichment for a single operation. Implements the precedence:
  // op.security (incl. []) > spec.security > implicit fallback.
  const resolveToolAuth = (operation: any): ToolAuthEnrichment | null => {
    const security = resolveEffectiveSecurity(operation, spec)
    if (security === undefined) return implicitEnrichment
    if (security.length === 0) return null // explicit "no auth"
    // Array items are OR'd. Within each requirement, schemes are AND'd — but
    // since we can only apply one auth template per call, we pick the highest-
    // scoring resolvable scheme from the first requirement that has one.
    for (const req of security) {
      if (!req || typeof req !== "object") continue
      const candidates: ToolAuthEnrichment[] = []
      for (const schemeName of Object.keys(req)) {
        const scheme = registry[schemeName]
        if (!scheme) continue
        const enrichment = schemeToEnrichment(scheme)
        if (enrichment) candidates.push(enrichment)
      }
      if (candidates.length === 0) continue
      candidates.sort((a, b) => enrichmentScore(b) - enrichmentScore(a))
      return candidates[0]
    }
    return null
  }

  const httpMethods = ["get", "post", "put", "patch", "delete", "head", "options"] as const

  for (const [path, pathItem] of Object.entries(paths)) {
    // Path-item level parameters apply to every operation under this path.
    // Google Calendar (and many Google specs) declare shared query params like
    // maxResults, pageToken, singleEvents, orderBy, etc. here — if we only read
    // operation-level, they get silently dropped and the generated tool won't
    // accept them, so server.ts filters them out of the outgoing request.
    const pathLevelParameters = (pathItem.parameters as any[]) || []

    for (const method of httpMethods) {
      const operation: OpenAPIV3.OperationObject | undefined = pathItem[method]
      if (!operation) continue

      const opParameters = (operation.parameters as any[]) || []

      // Per OpenAPI spec: operation-level wins on (name, in) collision, otherwise merge.
      const seenKeys = new Set<string>()
      const parameters: any[] = []
      for (const p of opParameters) {
        if (p?.name && p?.in) seenKeys.add(`${p.name}:${p.in}`)
        parameters.push(p)
      }
      for (const p of pathLevelParameters) {
        if (p?.name && p?.in && !seenKeys.has(`${p.name}:${p.in}`)) {
          parameters.push(p)
        }
      }

      const requestBody = operation.requestBody as OpenAPIV3.RequestBodyObject | undefined

      const fixedQueryParams = detectFixedQueryParams(parameters, spec)
      const fixedParamNames = new Set(Object.keys(fixedQueryParams))

      const toolAuth = resolveToolAuth(operation)
      // If this op's auth is an api-key query param, hide it from the tool
      // schema — server.ts injects it on every call.
      if (toolAuth?.template === "api_key_query" && toolAuth.param_name) {
        fixedParamNames.add(toolAuth.param_name)
      }

      // Locate the security-scheme KEY (e.g. "accountSid_authToken") that produced this
      // basic_auth template. Spec authors encode the credential identity in the key name,
      // and many APIs (Twilio's accountSid_authToken, Atlassian's cloudIdAuth) embed the
      // path-param name inside it — a structural signal we use below.
      let basicAuthSchemeKey: string | null = null
      if (toolAuth?.template === "basic_auth") {
        const sec = ((operation as any).security ?? spec.security ?? []) as any[]
        outer: for (const req of sec) {
          if (!req || typeof req !== "object") continue
          for (const k of Object.keys(req)) {
            const scheme = (spec.components?.securitySchemes ?? {})[k] as any
            if (scheme && scheme.type === "http" && String(scheme.scheme).toLowerCase() === "basic") {
              basicAuthSchemeKey = k
              break outer
            }
          }
        }
      }

      // Structural rule: a path param is auto-filled from the basic-auth username when
      // (a) the operation uses basic_auth, AND EITHER (b1) the param has a spec-declared
      // placeholder default (e.g. "your_account_sid"), OR (b2) the security-scheme KEY
      // contains the param name as a leading or post-separator token. (b2) covers Twilio
      // (accountSid_authToken ⊃ AccountSid) and Atlassian (cloudIdAuth ⊃ cloudId) without
      // hard-coding any provider name.
      const autoPathParams: Record<string, "auth_username"> = {}
      if (toolAuth?.template === "basic_auth") {
        for (const p of parameters) {
          if (p.in !== "path") continue
          const rawSchema = p.schema || (p.type ? { type: p.type, default: p.default } : {})
          const resolved = resolveSchema(rawSchema, spec)
          const defaultVal = resolved.default ?? rawSchema.default ?? p.default
          const matchesDefault = defaultVal !== undefined && isPlaceholderDefault(String(defaultVal))
          const matchesSchemeKey = basicAuthSchemeKey
            ? schemeKeyMentions(basicAuthSchemeKey, String(p.name))
            : false
          if (matchesDefault || matchesSchemeKey) {
            autoPathParams[p.name] = "auth_username"
            fixedParamNames.add(p.name)
          }
        }
      }

      const { input_schema, query_params, param_name_map, body_format } = buildFromOpenApiParams(
        parameters, requestBody, spec, fixedParamNames
      )

      const name = operation.operationId
        ? operation.operationId.replace(/[^a-zA-Z0-9_]/g, "_")
        : generateToolName(method, path)

      tools.push({
        name,
        description: (operation as any).summary || (operation as any).description || "",
        input_schema,
        handler: {
          method: method.toUpperCase(),
          path,
          headers: {},
          query_params,
          fixed_query_params: fixedQueryParams,
          ...(param_name_map && { param_name_map }),
          ...(body_format && { body_format }),
          ...(Object.keys(autoPathParams).length > 0 && { auto_path_params: autoPathParams }),
        },
        enrichment: { auth: toolAuth },
      })
    }
  }

  return { schema_version: 2, baseUrl, tools, auth: parseAuthConfig(spec) }
}

export async function parseSwaggerUrl(specUrl: string): Promise<any> {
  const timeoutMs = 15_000
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Spec fetch timed out after ${timeoutMs / 1000}s`)), timeoutMs)
  })
  try {
    const spec = await Promise.race([
      SwaggerParser.dereference(specUrl),
      timeoutPromise
    ])
    return spec
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

export async function generateToolRegistry(spec: any): Promise<ToolsFile> {
  if ((spec as any).openapi || (spec as any).swagger) {
    return parseOpenApiSpec(spec);
  }
  throw new Error("Unsupported spec format: must be OpenAPI 3.x or Swagger 2.x");
}
