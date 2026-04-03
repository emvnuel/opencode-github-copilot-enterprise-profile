import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import type { NormalizedModel } from "./types.js"

type VariantOptions = Record<string, unknown>

interface OpenCodeModelEntry {
  name: string
  variants: Record<string, VariantOptions>
  limit?: { context: number; output: number }
}

interface VariantOverride extends Record<string, unknown> {
  disabled?: boolean
}

interface ModelEntryOverride {
  name?: string
  variants?: Record<string, VariantOverride>
  limit?: { context?: number; output?: number }
}

interface OpenCodeConfigOverrides {
  provider?: {
    "github-copilot"?: {
      models?: Record<string, ModelEntryOverride>
    }
  }
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

const WIDELY_SUPPORTED_EFFORTS = ["low", "medium", "high"]
const EXCLUDED_MODEL_FAMILIES = ["deepseek", "minimax", "glm", "mistral", "kimi", "k2p5"]

function dateAtLeast(value: string | null, min: string): boolean {
  if (!value) return false
  return value >= min
}

function copilotEffortVariant(effort: string): VariantOptions {
  return {
    reasoningEffort: effort,
    reasoningSummary: "auto",
    include: ["reasoning.encrypted_content"],
  }
}

function buildCopilotVariants(model: NormalizedModel): Record<string, VariantOptions> {
  if (!model.supportsReasoning) return {}

  const id = model.id.toLowerCase()
  if (EXCLUDED_MODEL_FAMILIES.some((entry) => id.includes(entry))) return {}
  if (id.includes("gemini")) return {}
  if (id.includes("claude")) {
    return {
      thinking: { thinking_budget: 4000 },
    }
  }

  const efforts = (() => {
    if (id.includes("5.1-codex-max") || id.includes("5.2") || id.includes("5.3")) {
      return [...WIDELY_SUPPORTED_EFFORTS, "xhigh"]
    }

    const out = [...WIDELY_SUPPORTED_EFFORTS]
    if (id.includes("gpt-5") && dateAtLeast(model.releaseDate, "2025-12-04")) {
      out.push("xhigh")
    }
    return out
  })()

  return Object.fromEntries(efforts.map((effort) => [effort, copilotEffortVariant(effort)]))
}

function stripDisabled(v: VariantOverride | VariantOptions): VariantOptions {
  if (v && typeof v === "object" && "disabled" in v) {
    const { disabled: _ignored, ...rest } = v as VariantOverride
    return rest
  }
  return v
}

function applyVariantOverrides(
  generated: Record<string, VariantOptions>,
  overrides: Record<string, VariantOverride> | undefined,
): Record<string, VariantOptions> {
  if (!overrides) return generated

  const merged: Record<string, VariantOptions> = { ...generated }
  for (const [key, value] of Object.entries(overrides)) {
    if (!value || typeof value !== "object") continue
    if (value.disabled) {
      delete merged[key]
      continue
    }
    merged[key] = {
      ...(merged[key] || {}),
      ...stripDisabled(value),
    }
  }

  return Object.fromEntries(Object.entries(merged).map(([key, value]) => [key, stripDisabled(value)]))
}

export function parseModelIdentifier(
  value: string,
  knownVariants: string[] = [],
): { provider: string | null; model: string; variant: string | null } {
  const first = value.indexOf("/")
  if (first < 0) return { provider: null, model: value, variant: null }

  const provider = value.slice(0, first)
  const remainder = value.slice(first + 1)

  const colon = remainder.lastIndexOf(":")
  if (colon > 0) {
    const model = remainder.slice(0, colon)
    const variant = remainder.slice(colon + 1)
    if (variant && (knownVariants.length === 0 || knownVariants.includes(variant))) {
      return { provider, model, variant }
    }
  }

  const slash = remainder.lastIndexOf("/")
  if (slash > 0) {
    const model = remainder.slice(0, slash)
    const variant = remainder.slice(slash + 1)
    if (variant && (knownVariants.length === 0 || knownVariants.includes(variant))) {
      return { provider, model, variant }
    }
  }

  return { provider, model: remainder, variant: null }
}

export function buildProviderModels(
  models: NormalizedModel[],
  overrides?: Record<string, ModelEntryOverride>,
): Record<string, OpenCodeModelEntry> {
  const entries: Record<string, OpenCodeModelEntry> = {}
  for (const model of models) {
    const override = overrides?.[model.id]
    const entry: OpenCodeModelEntry = {
      name: override?.name || model.name,
      variants: applyVariantOverrides(buildCopilotVariants(model), override?.variants),
    }

    const context = override?.limit?.context ?? model.limits?.context
    const output = override?.limit?.output ?? model.limits?.output
    if (Number.isFinite(context) && Number.isFinite(output)) {
      entry.limit = { context: context as number, output: output as number }
    }

    entries[model.id] = entry
  }

  if (overrides) {
    for (const [modelId, override] of Object.entries(overrides)) {
      if (entries[modelId]) continue
      const variants = applyVariantOverrides({}, override.variants)
      const name = override.name || modelId
      const entry: OpenCodeModelEntry = { name, variants }
      const context = override.limit?.context
      const output = override.limit?.output
      if (Number.isFinite(context) && Number.isFinite(output)) {
        entry.limit = { context: context as number, output: output as number }
      }
      entries[modelId] = entry
    }
  }

  return entries
}

export function pickDefaultModel(models: NormalizedModel[]): string | null {
  if (!Array.isArray(models) || models.length === 0) return null
  return models[0].id
}

export function buildOpenCodeConfig(models: NormalizedModel[], overrides?: OpenCodeConfigOverrides): OpenCodeConfig {
  const defaultModel = pickDefaultModel(models)
  const modelId = defaultModel
    ? `github-copilot/${defaultModel}`
    : "github-copilot/unknown"
  const smallModelId = "github-copilot/gpt-5-mini"
  const modelOverrides = overrides?.provider?.["github-copilot"]?.models

  return {
    $schema: "https://opencode.ai/config.json",
    share: "disabled",
    disabled_providers: ["opencode"],
    enabled_providers: ["github-copilot"],
    provider: {
      "github-copilot": {
        models: buildProviderModels(models, modelOverrides),
      },
    },
    model: modelId,
    small_model: smallModelId,
  }
}

export async function writeConfigFile(filePath: string, config: OpenCodeConfig): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(config, null, 2)}\n`, "utf8")
}
