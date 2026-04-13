import SwaggerParser from "@apidevtools/swagger-parser";
import type { OpenAPIV3 } from "openapi-types";

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
  baseUrl: string;
  tools: EndpointDefinition[];
  auth: AuthConfig[];
}

// ─── Schema Helpers (unchanged) ───────────────────────────────────────────────

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
  if (resolved.description) prop.description = resolved.description;
  if (resolved.default !== undefined) prop.default = resolved.default;
  if (resolved.minimum !== undefined) prop.minimum = resolved.minimum;
  if (resolved.maximum !== undefined) prop.maximum = resolved.maximum;
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

// ─── New: Auth Template Detection ─────────────────────────────────────────────

/**
 * Reads the spec's security schemes and returns the auth enrichment that applies
 * to all tools in this spec. Falls back to implicit API key heuristic if no
 * formal scheme is declared. integration_id is left empty — api.ts sets it.
 */
function detectAuthTemplate(spec: any): ToolAuthEnrichment | null {
  const schemes = spec.components?.securitySchemes || spec.securityDefinitions || {}

  for (const [, scheme] of Object.entries(schemes) as [string, any][]) {
    if (scheme.type === "oauth2") {
      // OpenAPI 3.x: scheme.flows is an object
      if (scheme.flows) {
        const flows = scheme.flows
        if (flows.clientCredentials) {
          return {
            template: "oauth2_client_creds",
            integration_id: "",
            token_url: flows.clientCredentials.tokenUrl,
          }
        }
        const flow = flows.authorizationCode || flows.implicit || flows.password || {}
        return {
          template: "oauth2_auth_code",
          integration_id: "",
          token_url: flow.tokenUrl,
        }
      }
      // Swagger 2.x: scheme.flow is a string
      if (scheme.flow === "application") {
        return { template: "oauth2_client_creds", integration_id: "", token_url: scheme.tokenUrl }
      }
      return { template: "oauth2_auth_code", integration_id: "", token_url: scheme.tokenUrl }
    }

    if (scheme.type === "http" && scheme.scheme === "bearer") {
      return { template: "bearer_token", integration_id: "" }
    }

    if (scheme.type === "apiKey") {
      if (scheme.in === "header") {
        return { template: "api_key_header", integration_id: "", header_name: scheme.name }
      }
      if (scheme.in === "query") {
        return { template: "api_key_query", integration_id: "", param_name: scheme.name }
      }
    }

    if (scheme.type === "http" && scheme.scheme === "basic") {
      return { template: "basic_auth", integration_id: "" }
    }
  }

  // Fallback: no formal security scheme — scan endpoint params for implicit API key
  const implicitParam = detectImplicitApiKeyParam(spec)
  if (implicitParam) {
    return { template: "api_key_query", integration_id: "", param_name: implicitParam }
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
): { input_schema: EndpointDefinition["input_schema"], query_params: string[] } {
  const properties: Record<string, any> = {};
  const required: string[] = [];
  const queryParams: string[] = [];

  for (const p of parameters) {
    // Skip params that are auto-injected — the AI never needs to see them
    if (fixedParamNames.has(p.name)) continue

    console.log(`[param] name=${p.name} in=${p.in} type=${p.type} hasSchema=${!!p.schema}`)
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

  if (requestBody && requestBody.content) {
    const contentTypes = ["application/json", "application/x-www-form-urlencoded"];
    let bodySchema = null;
    for (const cType of contentTypes) {
      if (requestBody.content[cType]?.schema) {
        bodySchema = resolveSchema(requestBody.content[cType].schema, rootSpec);
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

  return {
    input_schema: { type: "object", properties, required },
    query_params: queryParams,
  };
}

function generateToolName(method: string, path: string): string {
  return (`${method}_${path}`)
    .toLowerCase()
    .replace(/\{(\w+)\}/g, "by_$1")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

// ─── Auth Config Parser (unchanged) ───────────────────────────────────────────

export function parseAuthConfig(spec: any): AuthConfig[] {
  const schemes = spec.components?.securitySchemes || spec.securityDefinitions || {};
  const authConfigs: AuthConfig[] = [];

  for (const [, scheme] of Object.entries(schemes) as [string, any][]) {
    if (scheme.type === "oauth2") {
      if (scheme.flows) {
        const flows = scheme.flows;
        if (flows.clientCredentials) {
          authConfigs.push({ type: "oauth2", oauthFlow: "client_credentials", tokenUrl: flows.clientCredentials.tokenUrl, scopes: flows.clientCredentials.scopes || {} });
        } else if (flows.authorizationCode) {
          authConfigs.push({ type: "oauth2", oauthFlow: "authorization_code", authorizationUrl: flows.authorizationCode.authorizationUrl, tokenUrl: flows.authorizationCode.tokenUrl, scopes: flows.authorizationCode.scopes || {} });
        } else if (flows.implicit) {
          authConfigs.push({ type: "oauth2", oauthFlow: "implicit", authorizationUrl: flows.implicit.authorizationUrl, scopes: flows.implicit.scopes || {} });
        } else if (flows.password) {
          authConfigs.push({ type: "oauth2", oauthFlow: "password", tokenUrl: flows.password.tokenUrl, scopes: flows.password.scopes || {} });
        }
      } else {
        // Swagger 2.x: scheme.flow is a string
        const flowMap: Record<string, AuthConfig["oauthFlow"]> = { application: "client_credentials", accessCode: "authorization_code", implicit: "implicit", password: "password" };
        authConfigs.push({ type: "oauth2", oauthFlow: flowMap[scheme.flow] ?? "authorization_code", authorizationUrl: scheme.authorizationUrl, tokenUrl: scheme.tokenUrl, scopes: scheme.scopes || {} });
      }
    } else if (scheme.type === "http" && scheme.scheme === "bearer") {
      authConfigs.push({ type: "bearer_token" });
    } else if (scheme.type === "apiKey") {
      authConfigs.push({ type: "api_key", in: scheme.in, name: scheme.name });
    } else if (scheme.type === "http" && scheme.scheme === "basic") {
      authConfigs.push({ type: "basic_auth" });
    }
  }

  if (authConfigs.length) return authConfigs

  // Fallback: implicit API key param heuristic
  const implicitParam = detectImplicitApiKeyParam(spec)
  if (implicitParam) return [{ type: "api_key", in: "query", name: implicitParam }]

  return [{ type: "none" }];
}

// ─── Main Parser ───────────────────────────────────────────────────────────────

export function parseOpenApiSpec(spec: any): ToolsFile {
  const tools: EndpointDefinition[] = [];
  const paths: Record<string, any> = spec.paths || {};

  let baseUrl: string;
  if (spec.servers && Array.isArray(spec.servers) && spec.servers.length > 0) {
    baseUrl = spec.servers[0].url;
  } else if (spec.host) {
    const scheme = spec.schemes && spec.schemes.length > 0 ? spec.schemes[0] : "https";
    baseUrl = `${scheme}://${spec.host}${spec.basePath || ""}`;
  } else {
    baseUrl = "";
  }

  // Detect auth template once — applies to all tools in this spec
  const authEnrichment = detectAuthTemplate(spec)

  // If auth is injected via query param, exclude it from tool schemas so the AI never sees it
  const authQueryParamName = authEnrichment?.template === "api_key_query" ? authEnrichment.param_name : undefined

  const httpMethods = ["get", "post", "put", "patch", "delete", "head", "options"] as const;

  for (const [path, pathItem] of Object.entries(paths)) {
    for (const method of httpMethods) {
      const operation: OpenAPIV3.OperationObject | undefined = pathItem[method];
      if (!operation) continue;

      const parameters = (operation.parameters as any[]) || [];
      const requestBody = operation.requestBody as OpenAPIV3.RequestBodyObject | undefined;

      // Detect params that should be auto-injected (not shown to AI)
      const fixedQueryParams = detectFixedQueryParams(parameters, spec)
      const fixedParamNames = new Set(Object.keys(fixedQueryParams))

      // Also exclude the auth key param — injected by server.ts, not the AI
      if (authQueryParamName) fixedParamNames.add(authQueryParamName)

      const { input_schema, query_params } = buildFromOpenApiParams(
        parameters, requestBody, spec, fixedParamNames
      );

      const name = operation.operationId
        ? operation.operationId.replace(/[^a-zA-Z0-9_]/g, "_")
        : generateToolName(method, path);

      tools.push({
        name,
        description: (operation as any).summary || (operation as any).description || "",
        input_schema,
        handler: {
          method: method.toUpperCase(),
          path,
          headers: {},
          query_params,
          fixed_query_params: fixedQueryParams,   // auto-injected on every call
        },
        enrichment: {
          auth: authEnrichment,   // integration_id filled in by api.ts at session start
        },
      });
    }
  }

  return { baseUrl, tools, auth: parseAuthConfig(spec) };
}

export async function parseSwaggerUrl(specUrl: string): Promise<any> {
  const spec = await SwaggerParser.dereference(specUrl);
  return spec;
}

export async function generateToolRegistry(spec: string): Promise<ToolsFile> {
  if ((spec as any).openapi || (spec as any).swagger) {
    return parseOpenApiSpec(spec);
  }
  throw new Error("Unsupported spec format: must be OpenAPI 3.x or Swagger 2.x");
}
