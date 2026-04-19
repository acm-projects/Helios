import { writeFileSync, mkdirSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"
import { parseSwaggerUrl, generateToolRegistry } from "../generate_tool_registry.ts"

const SPEC_URLS: Record<string, string> = {
  twilio: "https://raw.githubusercontent.com/twilio/twilio-oai/main/spec/json/twilio_api_v2010.json",
}

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const OUTPUT_DIR = resolve(SCRIPT_DIR, "../../frontend/public/premade")

async function regen(provider: string): Promise<void> {
  const url = SPEC_URLS[provider]
  if (!url) {
    console.error(`Unknown provider "${provider}". Known: ${Object.keys(SPEC_URLS).join(", ")}`)
    process.exit(1)
  }

  console.log(`[${provider}] fetching spec: ${url}`)
  const spec = await parseSwaggerUrl(url)

  console.log(`[${provider}] generating tool registry`)
  const registry = await generateToolRegistry(spec)

  const outPath = resolve(OUTPUT_DIR, `${provider}.json`)
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, JSON.stringify(registry, null, 2))

  const toolsWithMap = registry.tools.filter(t => t.handler.param_name_map).length
  const toolsWithAuto = registry.tools.filter(t => t.handler.auto_path_params).length
  const toolsWithForm = registry.tools.filter(t => t.handler.body_format === "form").length
  const toolsWithMultipart = registry.tools.filter(t => t.handler.body_format === "multipart").length

  console.log(`[${provider}] wrote ${outPath}`)
  console.log(`  schema_version: ${registry.schema_version}`)
  console.log(`  tools: ${registry.tools.length}`)
  console.log(`  with param_name_map: ${toolsWithMap}`)
  console.log(`  with auto_path_params: ${toolsWithAuto}`)
  console.log(`  with body_format=form: ${toolsWithForm}`)
  console.log(`  with body_format=multipart: ${toolsWithMultipart}`)
  console.log(`  auth: ${JSON.stringify(registry.auth)}`)
}

const target = process.argv[2]
if (!target) {
  console.error("Usage: npx tsx scripts/regen-premade.ts <provider>")
  console.error(`Known providers: ${Object.keys(SPEC_URLS).join(", ")}`)
  process.exit(1)
}

regen(target).catch(err => {
  console.error(`Failed:`, err)
  process.exit(1)
})
