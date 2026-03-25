import { createCatalogClient } from "./catalog.js"
import { createLogger } from "./logger.js"
import { compareSemver } from "./version.js"

const MIN_RECOMMENDED_VERSION = "1.1.36"

function readConfig(): {
  baseUrl: string
  authFile: string
  modelsPath: string
  cacheFile: string
} {
  return {
    baseUrl: process.env.COPILOT_BASE_URL || "https://api.githubcopilot.com",
    authFile: process.env.COPILOT_AUTH_FILE || "~/.local/share/opencode/auth.json",
    modelsPath: process.env.COPILOT_MODELS_PATH || "/models",
    cacheFile:
      process.env.COPILOT_MODELS_CACHE ||
      "~/.cache/opencode/github-copilot-enterprise/models.json",
  }
}

type PluginClient = {
  app?: {
    log?: (input: { body: Record<string, unknown> }) => Promise<void>
  }
}

type ShellOutput = {
  env?: Record<string, string>
}

export const CopilotEnterpriseProfilePlugin = async ({ client }: { client: PluginClient }) => {
  const logger = createLogger(client)
  const cfg = readConfig()
  const catalog = createCatalogClient({ ...cfg, logger })

  return {
    "shell.env": async (_input: unknown, output: ShellOutput) => {
      output.env = output.env || {}
      output.env.OPENCODE_DISABLE_MODELS_FETCH =
        output.env.OPENCODE_DISABLE_MODELS_FETCH || "true"
      output.env.OPENAI_API_KEY = output.env.OPENAI_API_KEY || ""
      output.env.OPENAI_BASE_URL = output.env.OPENAI_BASE_URL || ""

      if (process.env.OPENCODE_PROFILE_OFFLINE === "true") {
        output.env.OPENCODE_DISABLE_DEFAULT_PLUGINS =
          output.env.OPENCODE_DISABLE_DEFAULT_PLUGINS || "true"
      }
    },

    "server.connected": async () => {
      const version = process.env.OPENCODE_VERSION
      if (version && compareSemver(version, MIN_RECOMMENDED_VERSION) < 0) {
        await logger.warn("OpenCode version below recommended minimum", {
          version,
          minRecommended: MIN_RECOMMENDED_VERSION,
        })
      }

      try {
        await catalog.get()
      } catch (error) {
        await logger.error("Unable to warm Copilot catalog", { error: String((error as Error)?.message || error) })
      }
    },
  }
}
