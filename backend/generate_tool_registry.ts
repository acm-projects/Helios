import SwaggerParser from "@apidevtools/swagger-parser";
import * as readline from "readline";
import { writeFileSync } from "fs";
import type { OpenAPIV3 } from "openapi-types";

// Types

export interface EndpointDefinition {
  type?: string;
  function?: string;
  name: string;
  description: string;
  input_schema: {
    type: string;
    properties: Record<string, { type: string; description?: string; default?: any; minimum?: number; maximum?: number }>;
    required: string[];
  };
  handler: {
    method: string;
    path: string;
    headers?: Record<string, string>;
    query_params: string[];
  };
}

export interface ToolsFile {
  baseUrl: string;
  tools: EndpointDefinition[];
}


// Maps OpenAPI types to our schema types
function mapType(apiType: string | undefined): string {
  switch ((apiType || "").toLowerCase()) {
    case "string": return "string";
    case "integer": return "integer";
    case "number": return "number";
    case "boolean": return "boolean";
    default: return "string";
  }
}

// Helper to resolve $ref. E.g. "#/definitions/Pet" -> spec.definitions.Pet
function resolveSchema(schema: any, rootSpec: any): any {
  if (!schema) return {};
  if (schema.$ref && typeof schema.$ref === "string" && schema.$ref.startsWith("#")) {
    const parts = schema.$ref.replace(/^#\//, "").split("/");
    let current = rootSpec;
    for (const part of parts) {
      if (current[part] === undefined) return {};
      current = current[part];
    }
    return current;
  }
  return schema;
}

// Converts OpenAPI parameter list and requestBody into input_schema + query_params
function buildFromOpenApiParams(
  parameters: any[] = [],
  requestBody?: any,
  rootSpec?: any
): { input_schema: EndpointDefinition["input_schema"], query_params: string[] } {
  const properties: Record<string, any> = {};
  const required: string[] = [];
  const queryParams: string[] = [];

  // Parse path and query parameters
  for (const p of parameters) {
    const name = p.name;
    const schema = resolveSchema(p.schema || {}, rootSpec);

    // Special case for Swagger 2.0: 'body' params that point to a whole object
    if (p.in === "body" && schema && schema.properties) {
      for (const [propName, propSchemaRaw] of Object.entries<any>(schema.properties)) {
        const propSchema = resolveSchema(propSchemaRaw, rootSpec);
        const schemaProp: any = { type: propSchema.type === "array" ? "array" : mapType(propSchema.type) };
        if (propSchema.description) schemaProp.description = propSchema.description;
        if (propSchema.default !== undefined) schemaProp.default = propSchema.default;

        properties[propName] = schemaProp;
      }

      if (Array.isArray(schema.required)) {
        for (const req of schema.required) {
          if (!required.includes(req)) required.push(req);
        }
      }
      continue;
    }

    const schemaProp: any = {
      type: schema.type === "array" ? "array" : mapType(schema.type),
    };

    if (p.description) schemaProp.description = p.description;
    if (schema.default !== undefined) schemaProp.default = schema.default;
    if (schema.minimum !== undefined) schemaProp.minimum = schema.minimum;
    if (schema.maximum !== undefined) schemaProp.maximum = schema.maximum;

    properties[name] = schemaProp;

    // path params are always required; query params use their required flag
    if (p.required === true || p.in === "path") {
      required.push(name);
    }

    if (p.in === "query") {
      queryParams.push(name);
    }
  }

  // Parse request body properties (e.g. for POST, PUT)
  if (requestBody && requestBody.content) {
    const contentTypes = ["application/json", "application/x-www-form-urlencoded"];
    let bodySchema = null;

    for (const cType of contentTypes) {
      if (requestBody.content[cType] && requestBody.content[cType].schema) {
        bodySchema = resolveSchema(requestBody.content[cType].schema, rootSpec);
        break;
      }
    }

    if (bodySchema && bodySchema.properties) {
      for (const [propName, propSchemaRaw] of Object.entries<any>(bodySchema.properties)) {
        const propSchema = resolveSchema(propSchemaRaw, rootSpec);
        const schemaProp: any = { type: propSchema.type === "array" ? "array" : mapType(propSchema.type) };

        if (propSchema.description) schemaProp.description = propSchema.description;
        if (propSchema.default !== undefined) schemaProp.default = propSchema.default;

        properties[propName] = schemaProp;
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

// Generates a clean tool name from method + path e.g. GET /breeds/{id} -> get_breeds_by_id
function generateToolName(method: string, path: string): string {
  return (`${method}_${path}`)
    .toLowerCase()
    .replace(/\{(\w+)\}/g, "by_$1")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

// Parses a full OpenAPI 3.x spec into the tool registry format
export function parseOpenApiSpec(spec: any): ToolsFile {
  const tools: EndpointDefinition[] = [];
  const paths: Record<string, any> = spec.paths || {};

  // Extract baseUrl from OpenAPI spec
  let baseUrl: string;
  if (spec.servers && Array.isArray(spec.servers) && spec.servers.length > 0) {
    baseUrl = spec.servers[0].url;
  } else if (spec.host) {

    // Swagger 2.x
    const scheme = spec.schemes && spec.schemes.length > 0 ? spec.schemes[0] : "https";
    baseUrl = `${scheme}://${spec.host}${spec.basePath || ""}`;
  } else {
    baseUrl = " ";
  }

  const httpMethods = ["get", "post", "put", "patch", "delete", "head", "options"] as const;

  for (const [path, pathItem] of Object.entries(paths)) {
    for (const method of httpMethods) {
      const operation: OpenAPIV3.OperationObject | undefined = pathItem[method];
      if (!operation) continue;

      const parameters = (operation.parameters as OpenAPIV3.ParameterObject[]) || [];
      const requestBody = operation.requestBody as OpenAPIV3.RequestBodyObject | undefined;
      const { input_schema, query_params } = buildFromOpenApiParams(parameters, requestBody, spec);

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
        },
      });
    }
  }

  return { baseUrl, tools };
}
export async function parseSwaggerUrl(specUrl: string): Promise<any> {
  const spec = await SwaggerParser.validate(specUrl);
  return spec;
}

// Fetch spec and detect format using swagger-parser
export async function generateToolRegistry(spec: string): Promise<ToolsFile> {


  // OpenAPI 3.x or Swagger 2.x
  if ((spec as any).openapi || (spec as any).swagger) {
    return parseOpenApiSpec(spec);
  }

  // Formatting non-openai/swagger spec
  const apis = Array.isArray(spec) ? spec : [spec];
  return {
    baseUrl: "help me",
    tools: apis.map((api: any) => {
      const queryParams: string[] = Object.keys(api.parameters?.query || {});
      return {
        name: api.name,
        description: api.description || "",
        input_schema: {
          type: "object" as const,
          properties: {},
          required: [],
        },
        handler: {
          method: api.method,
          path: api.path,
          headers: {},
          query_params: queryParams,
        },
      };
    }),
  };
}



// Prompt user for API spec URL
export async function promptForApiUrl(): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question("What is your API spec URL? ", (answer: string) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ESM-compatible entry point guard
/*
async function main() {
  const specPathOrUrl = process.argv[2] || (await promptForApiUrl());

  if (!specPathOrUrl) {
    console.error("Error: No API spec path or URL provided.");
    process.exit(1);
  }

  try {
    const registry = await generateToolRegistry(specPathOrUrl);
    writeFileSync("tools.json", JSON.stringify(registry, null, 2));
  } catch (err: any) {
    console.error(`Failed to fetch or parse API spec from: ${specPathOrUrl}`);
    console.error(err.message);
    process.exit(1);
  }
}
*/
//main();
