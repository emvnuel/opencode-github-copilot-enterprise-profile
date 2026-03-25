import path from "node:path"
import { fileURLToPath } from "node:url"
import { createCatalogClient } from "../src/catalog.js"
import { buildOpenCodeConfig, writeConfigFile } from "../src/config.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, "..")
const outPath = process.env.OPENCODE_RENDERED_CONFIG || path.join(root, ".opencode/runtime/opencode.generated.json")

async function main() {
  if (process.env.OPENCODE_DISABLE_MODELS_FETCH !== "true") {
    throw new Error("OPENCODE_DISABLE_MODELS_FETCH=true is required")
  }

  const client = createCatalogClient({
    baseUrl: process.env.COPILOT_BASE_URL || "https://api.githubcopilot.com",
    authFile: process.env.COPILOT_AUTH_FILE || "~/.local/share/opencode/auth.json",
    modelsPath: process.env.COPILOT_MODELS_PATH || "/models",
    cacheFile:
      process.env.COPILOT_MODELS_CACHE ||
      "~/.cache/opencode/github-copilot-enterprise/models.json",
    logger: null,
  })

  let models
  try {
    models = await client.refresh()
  } catch (error) {
    console.warn(`Refresh failed, using cache: ${error?.message || error}`)
    models = await client.get()
  }

  const config = buildOpenCodeConfig(models)
  await writeConfigFile(outPath, config)
  process.stdout.write(`${outPath}\n`)
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
