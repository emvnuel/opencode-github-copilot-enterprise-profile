import { inferSupportedEfforts } from "./effort.js"

function safeNumber(value, fallback = null) {
  return Number.isFinite(value) ? value : fallback
}

function toNumber(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function parseThinkingCapabilities(model) {
  const capabilities = model.capabilities || {}
  const supports = capabilities.supports && typeof capabilities.supports === "object" ? capabilities.supports : {}

  const adaptiveRaw = supports.adaptive_thinking ?? capabilities.adaptive_thinking
  const adaptiveThinking = adaptiveRaw === true || adaptiveRaw === "true" || adaptiveRaw === 1

  const minThinkingBudget = toNumber(
    supports.min_thinking_budget ?? capabilities.min_thinking_budget,
  )
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
    advertisedEfforts,
  }
}

function extractLimits(raw) {
  const capabilities = raw.capabilities || {}
  const nestedLimits = capabilities.limits || {}
  return {
    context: safeNumber(raw.limit?.context ?? raw.context_window ?? nestedLimits.max_context_window_tokens),
    output: safeNumber(raw.limit?.output ?? raw.max_output_tokens ?? nestedLimits.max_output_tokens),
  }
}

function detectReasoningSupport(model) {
  const capabilities = model.capabilities || {}
  const supports = capabilities.supports && typeof capabilities.supports === "object" ? capabilities.supports : {}
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

function normalizeEndpoints(model) {
  const endpoints = model.supported_endpoints || model.endpoints || []
  if (!Array.isArray(endpoints)) return []
  return endpoints.map((x) => String(x).toLowerCase().replace(/^\//, ""))
}

export function normalizeModel(raw) {
  const capabilities = raw.capabilities || {}
  const thinking = parseThinkingCapabilities(raw)
  const endpoints = normalizeEndpoints(raw)
  const endpointKind =
    thinking.adaptiveThinking && endpoints.includes("messages")
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

export function normalizeModelsPayload(payload) {
  const source = Array.isArray(payload?.data)
    ? payload.data
    : Array.isArray(payload?.models)
      ? payload.models
      : Array.isArray(payload)
        ? payload
        : []

  return source.map(normalizeModel).filter((m) => m.id)
}
