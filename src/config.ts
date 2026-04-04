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

interface BuildOpenCodeConfigOptions {
  lightweightSubagents?: boolean
}

interface OpenCodeAgentEntry {
  model: string
  variant?: string
}

interface OpenCodeConfig {
  $schema: string
  share: "disabled"
  disabled_providers: string[]
  enabled_providers: string[]
  provider: {
    "github-copilot": {
      models: Record<string, OpenCodeModelEntry>
      whitelist: string[]
    }
  }
  model: string
  small_model: string
  agent?: {
    general?: OpenCodeAgentEntry
    explore?: OpenCodeAgentEntry
  }
}

const WIDELY_SUPPORTED_EFFORTS = ["low", "medium", "high"]
const EXCLUDED_MODEL_FAMILIES = ["deepseek", "minimax", "glm", "mistral", "kimi", "k2p5"]

function dateAtLeast(value: string | null, min: string): boolean {
  if (!value) return false
  return value >= min
}

function numericOrZero(value: number | null | undefined): number {
  return Number.isFinite(value) ? (value as number) : 0
}

function releaseTimestamp(value: string | null): number {
  if (!value) return 0
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function isPowerfulModel(model: NormalizedModel): boolean {
  return model.modelPickerCategory === "powerful"
}

function isLightweightModel(model: NormalizedModel): boolean {
  return model.modelPickerCategory === "lightweight"
}

function normalizedEfforts(efforts: string[]): string[] {
  const normalized = efforts
    .map((effort) => String(effort || "").trim().toLowerCase())
    .filter((effort) => effort.length > 0)
  return [...new Set(normalized)]
}

function compareByNameAndId(a: NormalizedModel, b: NormalizedModel): number {
  const byName = a.name.localeCompare(b.name)
  if (byName !== 0) return byName
  return a.id.localeCompare(b.id)
}

function parseVersionedId(id: string): { family: string; suffix: string; version: number[] } | null {
  const match = id.toLowerCase().match(/^([a-z0-9]+)-(\d+(?:\.\d+)*)(.*)$/)
  if (!match) return null

  const version = match[2].split(".").map((value) => Number(value))
  if (version.some((value) => !Number.isFinite(value))) return null

  return {
    family: match[1],
    suffix: match[3] || "",
    version,
  }
}

function compareVersionVectorsDesc(a: number[], b: number[]): number {
  const max = Math.max(a.length, b.length)
  for (let i = 0; i < max; i++) {
    const av = a[i] ?? 0
    const bv = b[i] ?? 0
    if (av !== bv) return bv - av
  }
  return 0
}

function compareByVersionedIdDesc(a: NormalizedModel, b: NormalizedModel): number {
  const aParsed = parseVersionedId(a.id)
  const bParsed = parseVersionedId(b.id)
  if (!aParsed || !bParsed) return 0
  if (aParsed.family !== bParsed.family) return 0
  if (aParsed.suffix !== bParsed.suffix) return 0
  return compareVersionVectorsDesc(aParsed.version, bParsed.version)
}

function compareDefaultCandidates(a: NormalizedModel, b: NormalizedModel): number {
  if (a.supportsReasoning !== b.supportsReasoning) return a.supportsReasoning ? -1 : 1

  const byContext = numericOrZero(b.limits?.context) - numericOrZero(a.limits?.context)
  if (byContext !== 0) return byContext

  const byOutput = numericOrZero(b.limits?.output) - numericOrZero(a.limits?.output)
  if (byOutput !== 0) return byOutput

  const aEfforts = normalizedEfforts(a.thinking?.supportedEfforts || [])
  const bEfforts = normalizedEfforts(b.thinking?.supportedEfforts || [])
  if (aEfforts.length !== bEfforts.length) return bEfforts.length - aEfforts.length

  const aHasTopEffort = aEfforts.includes("xhigh") || aEfforts.includes("max")
  const bHasTopEffort = bEfforts.includes("xhigh") || bEfforts.includes("max")
  if (aHasTopEffort !== bHasTopEffort) return aHasTopEffort ? -1 : 1

  const byRelease = releaseTimestamp(b.releaseDate) - releaseTimestamp(a.releaseDate)
  if (byRelease !== 0) return byRelease

  const byVersionedId = compareByVersionedIdDesc(a, b)
  if (byVersionedId !== 0) return byVersionedId

  return compareByNameAndId(a, b)
}

function compareSmallCandidates(a: NormalizedModel, b: NormalizedModel): number {
  if (a.supportsReasoning !== b.supportsReasoning) return a.supportsReasoning ? -1 : 1

  const byContext = numericOrZero(b.limits?.context) - numericOrZero(a.limits?.context)
  if (byContext !== 0) return byContext

  const byOutput = numericOrZero(b.limits?.output) - numericOrZero(a.limits?.output)
  if (byOutput !== 0) return byOutput

  const aEfforts = normalizedEfforts(a.thinking?.supportedEfforts || [])
  const bEfforts = normalizedEfforts(b.thinking?.supportedEfforts || [])
  if (aEfforts.length !== bEfforts.length) return bEfforts.length - aEfforts.length

  const byRelease = releaseTimestamp(b.releaseDate) - releaseTimestamp(a.releaseDate)
  if (byRelease !== 0) return byRelease

  return compareByNameAndId(a, b)
}

function isPickerPolicyEnabled(model: NormalizedModel): boolean {
  const rawPolicy = (model.raw?.policy as Record<string, unknown> | undefined) || {}
  const state = typeof rawPolicy.state === "string" ? rawPolicy.state.toLowerCase() : null
  return state !== "disabled"
}

function isModelEnabledForConfig(model: NormalizedModel): boolean {
  return model.modelPickerEnabled && isPickerPolicyEnabled(model)
}

function isLikelyNonPremiumWhenUnknown(model: NormalizedModel): boolean {
  const id = model.id.toLowerCase()
  if (id === "gpt-5-mini") return true
  if (id.startsWith("gpt-4")) return true
  if (id.startsWith("gpt-3.5")) return true
  if (id.startsWith("gpt-41-")) return true
  if (id.startsWith("oswe-vscode")) return true
  return false
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

  const metadataEfforts = normalizedEfforts(model.thinking?.supportedEfforts || [])
  if (metadataEfforts.length > 0) {
    return Object.fromEntries(metadataEfforts.map((effort) => [effort, copilotEffortVariant(effort)]))
  }

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

  const powerful = models.filter((model) => isPowerfulModel(model))
  const powerfulPremium = powerful.filter((model) => model.isPremium)
  if (powerfulPremium.length > 0) {
    return [...powerfulPremium].sort(compareDefaultCandidates)[0]?.id || null
  }

  if (powerful.length > 0) {
    return [...powerful].sort(compareDefaultCandidates)[0]?.id || null
  }

  const premium = models.filter((model) => model.isPremium)
  const candidates = premium.length > 0 ? premium : models
  return [...candidates].sort(compareDefaultCandidates)[0]?.id || null
}

function pickSmallModel(models: NormalizedModel[]): string | null {
  if (!Array.isArray(models) || models.length === 0) return null

  const nonPremiumKnown = models.filter((model) => model.premiumMetadataKnown && !model.isPremium)
  if (nonPremiumKnown.length > 0) {
    const nonPremium = nonPremiumKnown.sort(compareSmallCandidates)
    if (nonPremium.length > 0) return nonPremium[0].id
    return null
  }

  const nonPremiumInferred = models.filter((model) => !model.premiumMetadataKnown && isLikelyNonPremiumWhenUnknown(model))
  if (nonPremiumInferred.length > 0) {
    const inferred = nonPremiumInferred.sort(compareSmallCandidates)
    if (inferred.length > 0) return inferred[0].id
  }

  return null
}

function pickLightweightAgentModel(models: NormalizedModel[]): NormalizedModel | null {
  const lightweight = models.filter((model) => isLightweightModel(model))
  if (lightweight.length === 0) return null
  return [...lightweight].sort(compareDefaultCandidates)[0] || null
}

function pickHighReasoningVariant(model: NormalizedModel): string | null {
  const metadataEfforts = normalizedEfforts(model.thinking?.supportedEfforts || [])
  if (metadataEfforts.length >= 2) return metadataEfforts[metadataEfforts.length - 2]
  if (metadataEfforts.length === 1) return metadataEfforts[0]

  const available = Object.keys(buildCopilotVariants(model))
  if (available.length >= 2) return available[available.length - 2]
  if (available.length === 1) return available[0]
  return null
}

export function buildOpenCodeConfig(
  models: NormalizedModel[],
  overrides?: OpenCodeConfigOverrides,
  options?: BuildOpenCodeConfigOptions,
): OpenCodeConfig {
  const enabledModels = models.filter((model) => isModelEnabledForConfig(model))
  const defaultModel = pickDefaultModel(enabledModels)
  const smallModel = pickSmallModel(enabledModels)
  const modelId = defaultModel
    ? `github-copilot/${defaultModel}`
    : "github-copilot/unknown"
  const smallModelId = smallModel
    ? `github-copilot/${smallModel}`
    : "github-copilot/unknown"
  const modelOverridesRaw = overrides?.provider?.["github-copilot"]?.models
  const enabledIds = new Set(enabledModels.map((model) => model.id))
  const modelOverrides = modelOverridesRaw
    ? Object.fromEntries(Object.entries(modelOverridesRaw).filter(([modelIdKey]) => enabledIds.has(modelIdKey)))
    : undefined

  const config: OpenCodeConfig = {
    $schema: "https://opencode.ai/config.json",
    share: "disabled",
    disabled_providers: ["opencode"],
    enabled_providers: ["github-copilot"],
    provider: {
      "github-copilot": {
        models: buildProviderModels(enabledModels, modelOverrides),
        whitelist: enabledModels.map((model) => model.id).sort((a, b) => a.localeCompare(b)),
      },
    },
    model: modelId,
    small_model: smallModelId,
  }

  if (options?.lightweightSubagents) {
    const lightweightModel = pickLightweightAgentModel(enabledModels)
    if (lightweightModel) {
      const model = `github-copilot/${lightweightModel.id}`
      const variant = pickHighReasoningVariant(lightweightModel)
      const agentEntry: OpenCodeAgentEntry = variant ? { model, variant } : { model }
      config.agent = {
        general: { ...agentEntry },
        explore: { ...agentEntry },
      }
    }
  }

  return config
}

export async function writeConfigFile(filePath: string, config: OpenCodeConfig): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(config, null, 2)}\n`, "utf8")
}
