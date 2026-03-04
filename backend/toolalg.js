function mapType(apiType) {
  switch ((apiType || "").toLowerCase()) {
    case "string":
      return "string";
    case "integer":
      return "integer";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    default:
      return "string";
  }
}

function buildInputSchema(parameters = {}) {
  const properties = {};
  const required = [];

  const groups = ["path", "query"]; // extend with "header", "body", etc. if needed

  for (const group of groups) {
    const groupParams = parameters[group] || {};
    for (const [name, p] of Object.entries(groupParams)) {
      const schemaProp = {
        type: mapType(p.type),
      };
      if (p.description) schemaProp.description = p.description;
      if (p.default !== undefined) schemaProp.default = p.default;

      properties[name] = schemaProp;

      const isRequired = p.required === true || group === "path"; // path params usually always required
      if (isRequired) required.push(name);
    }
  }

  const inputSchema = {
    type: "object",
    properties,
  };
  if (required.length > 0) {
    inputSchema.required = required;
  }
  return inputSchema;
}

function apiToTool(api, source = "exapi.json") {
  return {
    name: api.name,
    description: api.description || "",
    input_schema: buildInputSchema(api.parameters),
    metadata: {
      http_method: api.method,
      http_path: api.path,
      source,
    },
  };
}

function generateToolRegistry(apiJson, source = "exapi.json") {
  const apis = Array.isArray(apiJson) ? apiJson : [apiJson];
  const tools = apis.map((api) => apiToTool(api, source));
  return { tools };
}

module.exports = {
  mapType,
  buildInputSchema,
  apiToTool,
  generateToolRegistry,
};

if (require.main === module) {
  const fs = require("fs");
  const path = process.argv[2] || "exapi.json";

  const apiJson = JSON.parse(fs.readFileSync(path, "utf8"));
  const { generateToolRegistry } = require("./generate_tool_registry");

  const registry = generateToolRegistry(apiJson, path);
  console.log(JSON.stringify(registry, null, 2));
}