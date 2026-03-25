import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import type { NormalizedModel } from "./types.js"

interface OpenCodeModelEntry {
  name: string
  variants: Record<string, { reasoningEffort: string }>
  limit?: { context: number; output: number }
}

interface OpenCodeConfig {
  $schema: string
  share: "disabled"
  disabled_providers: string[]
  enabled_providers: string[]
  provider: {
    "github-copilot": {
      models: Record<string, OpenCodeModelEntry>
    }
  }
  model: string
  small_model: string
}

function toVariantMap(model: NormalizedModel): Record<string, { reasoningEffort: string }> {
  if (!model.supportsReasoning) return {}

  const supported = Array.isArray(model.thinking?.supportedEfforts)
    ? model.thinking.supportedEfforts
    : []
  const out: Record<string, { reasoningEffort: string }> = {}
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

export function buildProviderModels(models: NormalizedModel[]): Record<string, OpenCodeModelEntry> {
  const entries: Record<string, OpenCodeModelEntry> = {}
  for (const model of models) {
    const entry: OpenCodeModelEntry = {
      name: model.name,
      variants: toVariantMap(model),
    }

    if (Number.isFinite(model.limits?.context) && Number.isFinite(model.limits?.output)) {
      entry.limit = {
        context: model.limits.context as number,
        output: model.limits.output as number,
      }
    }

    entries[model.id] = entry
  }
  return entries
}

export function pickDefaultModel(models: NormalizedModel[]): string | null {
  if (!Array.isArray(models) || models.length === 0) return null
  return models[0].id
}

export function buildOpenCodeConfig(models: NormalizedModel[]): OpenCodeConfig {
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

export async function writeConfigFile(filePath: string, config: OpenCodeConfig): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(config, null, 2)}\n`, "utf8")
}
