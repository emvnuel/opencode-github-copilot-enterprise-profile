import { inferSupportedEfforts } from "./effort.js"
import type { EndpointKind, NormalizedModel } from "./types.js"

type JsonRecord = Record<string, unknown>

function safeNumber(value: unknown, fallback: number | null = null): number | null {
  return Number.isFinite(value) ? (value as number) : fallback
}

function toNumber(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function toBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value
  if (typeof value === "number") return value !== 0
  if (typeof value === "string") {
    const lower = value.trim().toLowerCase()
    if (lower === "true" || lower === "1" || lower === "yes") return true
    if (lower === "false" || lower === "0" || lower === "no") return false
  }
  return fallback
}

function parseThinkingCapabilities(model: JsonRecord): {
  adaptiveThinking: boolean
  minThinkingBudget: number | null
  maxThinkingBudget: number | null
  advertisedEfforts: string[]
} {
  const capabilities = (model.capabilities as JsonRecord | undefined) || {}
  const supports = (capabilities.supports as JsonRecord | undefined) || {}

  const adaptiveRaw = supports.adaptive_thinking ?? capabilities.adaptive_thinking
  const adaptiveThinking = adaptiveRaw === true || adaptiveRaw === "true" || adaptiveRaw === 1

  const minThinkingBudget = toNumber(supports.min_thinking_budget ?? capabilities.min_thinking_budget)
  const maxThinkingBudget = toNumber(
    supports.max_thinking_budget ?? capabilities.max_thinking_budget ?? capabilities.thinking_tokens ?? capabilities.reasoning_tokens,
  )

  const advertisedEfforts = Array.isArray(supports.reasoning_effort)
    ? supports.reasoning_effort
    : Array.isArray(capabilities.reasoning_effort)
      ? capabilities.reasoning_effort
      : Array.isArray(capabilities.reasoning_effort_levels)
        ? capabilities.reasoning_effort_levels
        : []

  return {
    adaptiveThinking,
    minThinkingBudget,
    maxThinkingBudget,
    advertisedEfforts: advertisedEfforts.map((x) => String(x)),
  }
}

function extractLimits(raw: JsonRecord): { context: number | null; output: number | null } {
  const capabilities = (raw.capabilities as JsonRecord | undefined) || {}
  const nestedLimits = (capabilities.limits as JsonRecord | undefined) || {}
  const limit = (raw.limit as JsonRecord | undefined) || {}
  return {
    context: safeNumber(limit.context ?? raw.context_window ?? nestedLimits.max_context_window_tokens),
    output: safeNumber(limit.output ?? raw.max_output_tokens ?? nestedLimits.max_output_tokens),
  }
}

function detectReasoningSupport(model: JsonRecord): boolean {
  const capabilities = (model.capabilities as JsonRecord | undefined) || {}
  const supports = (capabilities.supports as JsonRecord | undefined) || {}
  const thinking = parseThinkingCapabilities(model)
  const tokens = capabilities.reasoning_tokens ?? capabilities.thinking_tokens ?? null
  const effort =
    capabilities.reasoning_effort ??
    supports.reasoning_effort ??
    capabilities.adaptive_thinking ??
    supports.adaptive_thinking ??
    null
  return Boolean(tokens || effort || thinking.adaptiveThinking || thinking.maxThinkingBudget)
}

function normalizeEndpoints(model: JsonRecord): string[] {
  const endpointsSources = [model.supported_endpoints, model.endpoints]
  const combined = endpointsSources.flatMap((raw) => (Array.isArray(raw) ? raw : []))

  const normalized = combined
    .map((value) => {
      const endpoint = String(value || "").toLowerCase().trim().split("?")[0].split("#")[0]
      const withoutScheme = endpoint
        .replace(/^https?:\/\/[^/]+/, "")
        .replace(/^wss?:\/\/[^/]+/, "")
      const withoutLeadingSlash = withoutScheme.replace(/^\/+/, "")
      const key = withoutLeadingSlash.replace(/^wss?:\//, "")

      if (key === "responses" || key === "v1/responses") return "responses"
      if (
        key === "messages" ||
        key === "v1/messages" ||
        key === "chat/completions" ||
        key === "v1/chat/completions"
      ) {
        return "messages"
      }

      return key
    })
    .filter((endpoint) => endpoint.length > 0)

  return [...new Set(normalized)]
}

export function normalizeModel(raw: JsonRecord): NormalizedModel {
  const capabilities = (raw.capabilities as JsonRecord | undefined) || {}
  const billing = (raw.billing as JsonRecord | undefined) || {}
  const hasPremiumFlag = typeof billing.is_premium === "boolean"
  const billingMultiplier = toNumber(billing.multiplier)
  const hasMultiplier = billingMultiplier !== null

  const premiumMetadataKnown = hasPremiumFlag || hasMultiplier
  const isPremium = hasPremiumFlag
    ? toBoolean(billing.is_premium, false)
    : hasMultiplier
      ? (billingMultiplier as number) > 0
      : false

  const thinking = parseThinkingCapabilities(raw)
  const endpoints = normalizeEndpoints(raw)
  const endpointKind: EndpointKind = thinking.adaptiveThinking && endpoints.includes("messages")
    ? "messages"
    : "responses"
  const supportedEfforts = inferSupportedEfforts({
    endpointKind,
    adaptiveThinking: thinking.adaptiveThinking,
    minThinkingBudget: thinking.minThinkingBudget,
    maxThinkingBudget: thinking.maxThinkingBudget,
    advertisedEfforts: thinking.advertisedEfforts,
  })

  return {
    id: String(raw.id || ""),
    name: String(raw.name || raw.id || ""),
    vendor: raw.vendor ? String(raw.vendor) : null,
    modelPickerEnabled: toBoolean(raw.model_picker_enabled, false),
    modelPickerCategory: raw.model_picker_category ? String(raw.model_picker_category).toLowerCase() : null,
    isPremium,
    premiumMetadataKnown,
    releaseDate: raw.release_date ? String(raw.release_date) : raw.created_at ? String(raw.created_at) : null,
    limits: extractLimits(raw),
    supportsReasoning: detectReasoningSupport(raw),
    capabilities,
    endpoints,
    thinking: {
      adaptiveThinking: thinking.adaptiveThinking,
      minThinkingBudget: thinking.minThinkingBudget,
      maxThinkingBudget: thinking.maxThinkingBudget,
      supportedEfforts,
    },
    raw,
  }
}

export function normalizeModelsPayload(payload: unknown): NormalizedModel[] {
  const asRecord = (payload as JsonRecord | null) || {}
  const source = Array.isArray(asRecord.data)
    ? asRecord.data
    : Array.isArray(asRecord.models)
      ? asRecord.models
      : Array.isArray(payload)
        ? payload
        : []

  return source
    .map((model) => normalizeModel((model as JsonRecord | null) || {}))
    .filter((model) => model.id)
}
