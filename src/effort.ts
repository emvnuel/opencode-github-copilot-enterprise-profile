import type { EndpointKind } from "./types.js"

const RESPONSES_ORDER = ["none", "minimal", "low", "medium", "high", "xhigh"] as const
const MESSAGES_ORDER = ["low", "medium", "high", "max"] as const

function normalizedOrder(endpointKind: EndpointKind): readonly string[] {
  return endpointKind === "messages" ? MESSAGES_ORDER : RESPONSES_ORDER
}

function normalizeAlias(value: string, endpointKind: EndpointKind): string {
  const lower = String(value || "").toLowerCase()
  if (endpointKind === "messages") {
    if (["none", "minimal"].includes(lower)) return "low"
    if (lower === "xhigh") return "max"
    return lower
  }

  if (lower === "max") return "xhigh"
  return lower
}

function budgetFiltered(order: readonly string[], minThinkingBudget: number | null, maxThinkingBudget: number | null): string[] {
  if (!Number.isFinite(maxThinkingBudget) || (maxThinkingBudget ?? 0) <= 0) return [...order]
  if (!Number.isFinite(minThinkingBudget) || (minThinkingBudget ?? 0) <= 0) return [...order]

  const ratio = Math.min(1, Math.max(0, (minThinkingBudget as number) / (maxThinkingBudget as number)))
  const disallow = new Set<string>()

  if (order === RESPONSES_ORDER) {
    if (ratio > 0) disallow.add("none")
    if (ratio > 0.15) disallow.add("minimal")
    if (ratio > 0.35) disallow.add("low")
    if (ratio > 0.6) disallow.add("medium")
    if (ratio > 0.85) disallow.add("high")
  } else {
    if (ratio > 0.35) disallow.add("low")
    if (ratio > 0.6) disallow.add("medium")
    if (ratio > 0.85) disallow.add("high")
  }

  const filtered = order.filter((effort) => !disallow.has(effort))
  return filtered.length > 0 ? filtered : [order.at(-1) as string]
}

export function inferSupportedEfforts({
  endpointKind = "responses",
  adaptiveThinking = false,
  minThinkingBudget = null,
  maxThinkingBudget = null,
  advertisedEfforts = [],
}: {
  endpointKind?: EndpointKind
  adaptiveThinking?: boolean
  minThinkingBudget?: number | null
  maxThinkingBudget?: number | null
  advertisedEfforts?: string[]
}): string[] {
  const order = normalizedOrder(endpointKind)
  const explicit = Array.isArray(advertisedEfforts)
    ? advertisedEfforts.map((value) => normalizeAlias(value, endpointKind)).filter((value) => order.includes(value))
    : []

  const uniqueExplicit = [...new Set(explicit)]
  const base = uniqueExplicit.length > 0 ? order.filter((effort) => uniqueExplicit.includes(effort)) : order
  const budgetAware = budgetFiltered(base, minThinkingBudget, maxThinkingBudget)

  if (!adaptiveThinking && endpointKind === "messages") {
    return budgetAware.filter((effort) => ["low", "medium", "high"].includes(effort))
  }

  return budgetAware
}

export function clampEffort(
  requested: string | undefined,
  endpointKind: EndpointKind = "responses",
  supportedEfforts: string[] | null = null,
): string {
  const order = normalizedOrder(endpointKind)
  const allowed = Array.isArray(supportedEfforts) && supportedEfforts.length > 0
    ? order.filter((effort) => supportedEfforts.includes(effort))
    : [...order]

  const candidate = requested
    ? normalizeAlias(requested, endpointKind)
    : (allowed.includes("medium") ? "medium" : allowed[0])

  if (allowed.includes(candidate)) return candidate

  const idx = Math.max(0, order.indexOf(candidate))
  for (let i = idx; i >= 0; i -= 1) {
    if (allowed.includes(order[i])) return order[i]
  }

  for (let i = idx + 1; i < order.length; i += 1) {
    if (allowed.includes(order[i])) return order[i]
  }

  return allowed[0]
}

export function downgradeEffort(
  current: string,
  endpointKind: EndpointKind = "responses",
  supportedEfforts: string[] | null = null,
): string {
  const order = normalizedOrder(endpointKind)
  const allowed = Array.isArray(supportedEfforts) && supportedEfforts.length > 0
    ? order.filter((effort) => supportedEfforts.includes(effort))
    : [...order]
  const currentClamped = clampEffort(current, endpointKind, allowed)
  const idx = Math.max(0, allowed.indexOf(currentClamped))
  return idx > 0 ? allowed[idx - 1] : allowed[0]
}

export function effortChain(
  initial: string,
  endpointKind: EndpointKind = "responses",
  supportedEfforts: string[] | null = null,
): string[] {
  const first = clampEffort(initial, endpointKind, supportedEfforts)
  const chain = [first]
  let current = first

  while (true) {
    const next = downgradeEffort(current, endpointKind, supportedEfforts)
    if (next === current) break
    chain.push(next)
    current = next
  }

  return chain
}
