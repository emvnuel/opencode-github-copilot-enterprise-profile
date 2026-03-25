import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

function toVariantMap(model) {
  if (!model.supportsReasoning) return {}

  const supported = Array.isArray(model.thinking?.supportedEfforts)
    ? model.thinking.supportedEfforts
    : []
  const out = {}
  for (const effort of ["low", "medium", "high", "max", "xhigh"]) {
    if (!supported.includes(effort)) continue
    out[effort] = { reasoningEffort: effort }
  }

  if (Object.keys(out).length > 0) return out

  return {
    low: { reasoningEffort: "low" },
    medium: { reasoningEffort: "medium" },
    high: { reasoningEffort: "high" },
  }
}

export function buildProviderModels(models) {
  const entries = {}
  for (const model of models) {
    const entry = {
      name: model.name,
      variants: toVariantMap(model),
    }

    if (Number.isFinite(model.limits?.context) && Number.isFinite(model.limits?.output)) {
      entry.limit = {
        context: model.limits.context,
        output: model.limits.output,
      }
    }

    entries[model.id] = entry
  }
  return entries
}

export function pickDefaultModel(models) {
  if (!Array.isArray(models) || models.length === 0) return null
  return models[0].id
}

export function buildOpenCodeConfig(models) {
  const defaultModel = pickDefaultModel(models)
  const modelId = defaultModel
    ? `github-copilot/${defaultModel}`
    : "github-copilot/unknown"

  return {
    $schema: "https://opencode.ai/config.json",
    share: "disabled",
    disabled_providers: ["opencode"],
    enabled_providers: ["github-copilot"],
    provider: {
      "github-copilot": {
        models: buildProviderModels(models),
      },
    },
    model: modelId,
    small_model: modelId,
  }
}

export async function writeConfigFile(filePath, config) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(config, null, 2)}\n`, "utf8")
}
