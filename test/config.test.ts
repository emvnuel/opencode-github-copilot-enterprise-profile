import test from "node:test"
import assert from "node:assert/strict"
import { buildOpenCodeConfig, parseModelIdentifier } from "../src/config.js"
import type { NormalizedModel } from "../src/types.js"

function mkModel(partial: Partial<NormalizedModel>): NormalizedModel {
  return {
    id: partial.id || "model-1",
    name: partial.name || partial.id || "Model 1",
    vendor: partial.vendor ?? null,
    modelPickerEnabled: partial.modelPickerEnabled ?? true,
    modelPickerCategory: partial.modelPickerCategory ?? null,
    isPremium: partial.isPremium ?? false,
    premiumMetadataKnown: partial.premiumMetadataKnown ?? true,
    releaseDate: partial.releaseDate ?? null,
    limits: partial.limits || { context: null, output: null },
    supportsReasoning: partial.supportsReasoning ?? false,
    capabilities: partial.capabilities || {},
    endpoints: partial.endpoints || [],
    thinking: partial.thinking || {
      adaptiveThinking: false,
      minThinkingBudget: null,
      maxThinkingBudget: null,
      supportedEfforts: [],
    },
    raw: partial.raw || {},
  }
}

test("only includes model_picker_enabled models and enforces privacy defaults", () => {
  const cfg = buildOpenCodeConfig([
    mkModel({ id: "gpt-5", name: "GPT-5", modelPickerEnabled: true, supportsReasoning: true }),
    mkModel({ id: "hidden-model", name: "Hidden", modelPickerEnabled: false, supportsReasoning: true }),
  ])

  assert.equal(cfg.share, "disabled")
  assert.deepEqual(cfg.disabled_providers, ["opencode"])
  assert.deepEqual(cfg.enabled_providers, ["github-copilot"])
  assert.deepEqual(Object.keys(cfg.provider["github-copilot"].models), ["gpt-5"])
  assert.deepEqual(cfg.provider["github-copilot"].whitelist, ["gpt-5"])
})

test("excludes models with disabled picker policy even when model_picker_enabled is true", () => {
  const cfg = buildOpenCodeConfig([
    mkModel({
      id: "claude-opus-4.6",
      modelPickerEnabled: true,
      raw: { policy: { state: "disabled" } },
    }),
    mkModel({
      id: "gpt-5.2-codex",
      modelPickerEnabled: true,
      raw: { policy: { state: "enabled" } },
    }),
  ])

  assert.equal("claude-opus-4.6" in cfg.provider["github-copilot"].models, false)
  assert.equal("gpt-5.2-codex" in cfg.provider["github-copilot"].models, true)
})

test("default model picks premium best capability candidate deterministically", () => {
  const cfg = buildOpenCodeConfig([
    mkModel({
      id: "gpt-5-mini",
      isPremium: false,
      modelPickerCategory: "lightweight",
      supportsReasoning: true,
      limits: { context: 200000, output: 8000 },
      thinking: { adaptiveThinking: false, minThinkingBudget: null, maxThinkingBudget: null, supportedEfforts: ["low", "medium"] },
      releaseDate: "2026-01-01",
    }),
    mkModel({
      id: "gpt-5",
      isPremium: true,
      modelPickerCategory: "powerful",
      supportsReasoning: true,
      limits: { context: 300000, output: 12000 },
      thinking: { adaptiveThinking: false, minThinkingBudget: null, maxThinkingBudget: null, supportedEfforts: ["low", "medium", "high", "xhigh"] },
      releaseDate: "2026-03-01",
    }),
    mkModel({
      id: "gpt-5-candidate-b",
      isPremium: true,
      modelPickerCategory: "powerful",
      supportsReasoning: true,
      limits: { context: 300000, output: 12000 },
      thinking: { adaptiveThinking: false, minThinkingBudget: null, maxThinkingBudget: null, supportedEfforts: ["low", "medium", "high", "xhigh"] },
      releaseDate: "2026-03-01",
      name: "ZZZ",
    }),
  ])

  assert.equal(cfg.model, "github-copilot/gpt-5")
})

test("default model uses version-aware tie-break so gpt-5.3-codex beats gpt-5.2-codex", () => {
  const cfg = buildOpenCodeConfig([
    mkModel({
      id: "gpt-5.2-codex",
      name: "GPT-5.2-Codex",
      isPremium: true,
      modelPickerCategory: "powerful",
      supportsReasoning: true,
      limits: { context: 400000, output: 128000 },
      thinking: { adaptiveThinking: false, minThinkingBudget: null, maxThinkingBudget: null, supportedEfforts: ["low", "medium", "high", "xhigh"] },
      releaseDate: null,
    }),
    mkModel({
      id: "gpt-5.3-codex",
      name: "GPT-5.3-Codex",
      isPremium: true,
      modelPickerCategory: "powerful",
      supportsReasoning: true,
      limits: { context: 400000, output: 128000 },
      thinking: { adaptiveThinking: false, minThinkingBudget: null, maxThinkingBudget: null, supportedEfforts: ["low", "medium", "high", "xhigh"] },
      releaseDate: null,
    }),
  ])

  assert.equal(cfg.model, "github-copilot/gpt-5.3-codex")
})

test("default model falls back to best enabled non-premium when premium is absent", () => {
  const cfg = buildOpenCodeConfig([
    mkModel({
      id: "model-a",
      isPremium: false,
      modelPickerCategory: "versatile",
      supportsReasoning: true,
      limits: { context: 128000, output: 8000 },
      thinking: { adaptiveThinking: false, minThinkingBudget: null, maxThinkingBudget: null, supportedEfforts: ["low", "medium"] },
      releaseDate: "2026-01-01",
    }),
    mkModel({
      id: "model-b",
      isPremium: false,
      modelPickerCategory: "versatile",
      supportsReasoning: true,
      limits: { context: 256000, output: 8000 },
      thinking: { adaptiveThinking: false, minThinkingBudget: null, maxThinkingBudget: null, supportedEfforts: ["low", "medium"] },
      releaseDate: "2026-01-01",
    }),
  ])

  assert.equal(cfg.model, "github-copilot/model-b")
})

test("default model prioritizes powerful category before other categories", () => {
  const cfg = buildOpenCodeConfig([
    mkModel({
      id: "gpt-5.4-mini",
      isPremium: true,
      modelPickerCategory: "lightweight",
      supportsReasoning: true,
      limits: { context: 400000, output: 128000 },
      thinking: { adaptiveThinking: false, minThinkingBudget: null, maxThinkingBudget: null, supportedEfforts: ["low", "medium", "high", "xhigh"] },
    }),
    mkModel({
      id: "gpt-5.2-codex",
      isPremium: true,
      modelPickerCategory: "powerful",
      supportsReasoning: true,
      limits: { context: 400000, output: 128000 },
      thinking: { adaptiveThinking: false, minThinkingBudget: null, maxThinkingBudget: null, supportedEfforts: ["low", "medium", "high", "xhigh"] },
    }),
  ])

  assert.equal(cfg.model, "github-copilot/gpt-5.2-codex")
})

test("default model falls back to non-powerful categories when powerful is unavailable", () => {
  const cfg = buildOpenCodeConfig([
    mkModel({
      id: "gpt-4.1",
      isPremium: false,
      modelPickerCategory: "versatile",
      supportsReasoning: false,
      limits: { context: 128000, output: 16384 },
    }),
    mkModel({
      id: "gpt-5-mini",
      isPremium: false,
      modelPickerCategory: "lightweight",
      supportsReasoning: true,
      limits: { context: 264000, output: 64000 },
      thinking: { adaptiveThinking: false, minThinkingBudget: null, maxThinkingBudget: null, supportedEfforts: ["low", "medium", "high"] },
    }),
  ])

  assert.equal(cfg.model, "github-copilot/gpt-5-mini")
})

test("small model falls back to recency when capability signals tie", () => {
  const cfg = buildOpenCodeConfig([
    mkModel({ id: "gpt-5", isPremium: true, supportsReasoning: true, modelPickerEnabled: true }),
    mkModel({ id: "gpt-4.1-mini", isPremium: false, releaseDate: "2026-01-01", modelPickerEnabled: true }),
    mkModel({ id: "gpt-5-mini", isPremium: false, releaseDate: "2026-03-01", modelPickerEnabled: true }),
  ])

  assert.equal(cfg.small_model, "github-copilot/gpt-5-mini")
})

test("small model can be any non-premium model with stronger capabilities", () => {
  const cfg = buildOpenCodeConfig([
    mkModel({ id: "gemini-3.1-pro-preview", isPremium: false, releaseDate: "2026-04-01", modelPickerEnabled: true }),
    mkModel({ id: "gpt-5-mini", isPremium: false, releaseDate: "2026-03-01", modelPickerEnabled: true }),
    mkModel({ id: "gpt-5", isPremium: true, modelPickerEnabled: true }),
  ])

  assert.equal(cfg.small_model, "github-copilot/gemini-3.1-pro-preview")
})

test("small model fallback chain works when non-premium mini is missing", () => {
  const cfgNonPremium = buildOpenCodeConfig([
    mkModel({ id: "gpt-5", isPremium: true, modelPickerEnabled: true }),
    mkModel({ id: "gpt-4.1", isPremium: false, releaseDate: "2026-02-01", modelPickerEnabled: true }),
  ])
  assert.equal(cfgNonPremium.small_model, "github-copilot/gpt-4.1")

  const cfgMiniAny = buildOpenCodeConfig([
    mkModel({ id: "gpt-5", isPremium: true, supportsReasoning: true, modelPickerEnabled: true, premiumMetadataKnown: true }),
    mkModel({ id: "gpt-5-mini", isPremium: true, modelPickerEnabled: true, premiumMetadataKnown: true }),
  ])
  assert.equal(cfgMiniAny.small_model, "github-copilot/unknown")

  const cfgDefault = buildOpenCodeConfig([
    mkModel({ id: "gpt-5", isPremium: true, supportsReasoning: true, modelPickerEnabled: true, premiumMetadataKnown: true }),
    mkModel({ id: "gpt-5-lite", isPremium: true, modelPickerEnabled: true, premiumMetadataKnown: true }),
  ])
  assert.equal(cfgDefault.small_model, "github-copilot/unknown")

  const cfgUnknown = buildOpenCodeConfig([
    mkModel({ id: "disabled", modelPickerEnabled: false, isPremium: false }),
  ])
  assert.equal(cfgUnknown.small_model, "github-copilot/unknown")
})

test("small model prefers strongest non-premium capabilities over recency", () => {
  const cfg = buildOpenCodeConfig([
    mkModel({ id: "gpt-4.1-mini", isPremium: false, releaseDate: "2026-01-01", limits: { context: 128000, output: 8192 }, supportsReasoning: false, modelPickerEnabled: true }),
    mkModel({ id: "gpt-5-mini", isPremium: false, releaseDate: "2025-01-01", limits: { context: 264000, output: 64000 }, supportsReasoning: true, modelPickerEnabled: true, thinking: { adaptiveThinking: false, minThinkingBudget: null, maxThinkingBudget: null, supportedEfforts: ["low", "medium", "high"] } }),
    mkModel({ id: "gpt-5.4-mini", isPremium: true, releaseDate: "2026-04-01", limits: { context: 400000, output: 128000 }, supportsReasoning: true, modelPickerEnabled: true }),
  ])

  assert.equal(cfg.small_model, "github-copilot/gpt-5-mini")
})

test("small model ignores entries with unknown premium metadata", () => {
  const cfg = buildOpenCodeConfig([
    mkModel({ id: "unknown-pricing", premiumMetadataKnown: false, isPremium: false, modelPickerEnabled: true }),
    mkModel({ id: "known-non-premium", premiumMetadataKnown: true, isPremium: false, modelPickerEnabled: true }),
  ])

  assert.equal(cfg.small_model, "github-copilot/known-non-premium")
})

test("small model infers non-premium fallback from known free model ids when metadata is missing", () => {
  const cfg = buildOpenCodeConfig([
    mkModel({ id: "gpt-5.4-mini", premiumMetadataKnown: false, isPremium: false, modelPickerEnabled: true, supportsReasoning: true, limits: { context: 400000, output: 128000 } }),
    mkModel({ id: "gpt-5-mini", premiumMetadataKnown: false, isPremium: false, modelPickerEnabled: true, supportsReasoning: true, limits: { context: 264000, output: 64000 } }),
    mkModel({ id: "gpt-4.1", premiumMetadataKnown: false, isPremium: false, modelPickerEnabled: true, supportsReasoning: false, limits: { context: 128000, output: 16384 } }),
  ])

  assert.equal(cfg.small_model, "github-copilot/gpt-5-mini")
})

test("uses metadata-first reasoning variants when supported efforts exist", () => {
  const cfg = buildOpenCodeConfig([
    mkModel({
      id: "gpt-5.3-codex",
      supportsReasoning: true,
      modelPickerEnabled: true,
      thinking: {
        adaptiveThinking: false,
        minThinkingBudget: null,
        maxThinkingBudget: null,
        supportedEfforts: ["low", "medium", "high", "xhigh", "max"],
      },
    }),
  ])

  assert.deepEqual(Object.keys(cfg.provider["github-copilot"].models["gpt-5.3-codex"].variants), [
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
  ])
  assert.deepEqual(cfg.provider["github-copilot"].models["gpt-5.3-codex"].variants.max, {
    reasoningEffort: "max",
    reasoningSummary: "auto",
    include: ["reasoning.encrypted_content"],
  })
})

test("uses fallback variant rules only when metadata efforts are absent", () => {
  const cfg = buildOpenCodeConfig([
    mkModel({
      id: "gpt-5.3-codex",
      supportsReasoning: true,
      modelPickerEnabled: true,
      thinking: {
        adaptiveThinking: false,
        minThinkingBudget: null,
        maxThinkingBudget: null,
        supportedEfforts: [],
      },
    }),
  ])

  assert.deepEqual(Object.keys(cfg.provider["github-copilot"].models["gpt-5.3-codex"].variants), [
    "low",
    "medium",
    "high",
    "xhigh",
  ])
})

test("returns empty variants for non-reasoning models", () => {
  const cfg = buildOpenCodeConfig([mkModel({ id: "gpt-4.1", supportsReasoning: false, modelPickerEnabled: true })])
  assert.deepEqual(cfg.provider["github-copilot"].models["gpt-4.1"].variants, {})
})

test("returns empty variants for excluded model families when no metadata efforts", () => {
  const ids = ["deepseek-r1", "minimax-m1", "glm-4", "mistral-large", "kimi-k2", "k2p5-fast"]
  const cfg = buildOpenCodeConfig(ids.map((id) => mkModel({ id, supportsReasoning: true, modelPickerEnabled: true })))
  for (const id of ids) {
    assert.deepEqual(cfg.provider["github-copilot"].models[id].variants, {})
  }
})

test("returns empty variants for gemini models when no metadata efforts", () => {
  const cfg = buildOpenCodeConfig([
    mkModel({ id: "gemini-3-pro-preview", supportsReasoning: true, modelPickerEnabled: true }),
  ])
  assert.deepEqual(cfg.provider["github-copilot"].models["gemini-3-pro-preview"].variants, {})
})

test("returns thinking variant for claude models when no metadata efforts", () => {
  const cfg = buildOpenCodeConfig([
    mkModel({ id: "claude-sonnet-4.6", supportsReasoning: true, modelPickerEnabled: true }),
  ])
  assert.deepEqual(cfg.provider["github-copilot"].models["claude-sonnet-4.6"].variants, {
    thinking: { thinking_budget: 4000 },
  })
})

test("merges variant overrides and strips disabled key", () => {
  const cfg = buildOpenCodeConfig(
    [mkModel({ id: "gpt-5.3-codex", supportsReasoning: true, modelPickerEnabled: true })],
    {
      provider: {
        "github-copilot": {
          models: {
            "gpt-5.3-codex": {
              variants: {
                xhigh: { disabled: true },
                high: { disabled: false, reasoningEffort: "high" },
                custom: { disabled: false, reasoningEffort: "medium", include: ["x"] },
              },
            },
          },
        },
      },
    },
  )

  const variants = cfg.provider["github-copilot"].models["gpt-5.3-codex"].variants
  assert.equal("xhigh" in variants, false)
  assert.deepEqual((variants.high as Record<string, unknown>).disabled, undefined)
  assert.deepEqual(variants.custom, { reasoningEffort: "medium", include: ["x"] })
})

test("does not include overrides for disabled catalog models", () => {
  const cfg = buildOpenCodeConfig(
    [mkModel({ id: "gpt-5", modelPickerEnabled: true }), mkModel({ id: "hidden-model", modelPickerEnabled: false })],
    {
      provider: {
        "github-copilot": {
          models: {
            "hidden-model": {
              name: "Hidden Override",
            },
          },
        },
      },
    },
  )

  assert.equal("hidden-model" in cfg.provider["github-copilot"].models, false)
})

test("supports provider/model/variant parsing", () => {
  assert.deepEqual(parseModelIdentifier("github-copilot/gpt-5.3-codex/xhigh", ["xhigh"]), {
    provider: "github-copilot",
    model: "gpt-5.3-codex",
    variant: "xhigh",
  })
  assert.deepEqual(parseModelIdentifier("github-copilot/gpt-5.3-codex:xhigh", ["xhigh"]), {
    provider: "github-copilot",
    model: "gpt-5.3-codex",
    variant: "xhigh",
  })
  assert.deepEqual(parseModelIdentifier("github-copilot/gpt-5.3-codex", ["xhigh"]), {
    provider: "github-copilot",
    model: "gpt-5.3-codex",
    variant: null,
  })
})

test("optionally assigns lightweight high-reasoning model to general and explore agents", () => {
  const cfg = buildOpenCodeConfig(
    [
      mkModel({
        id: "gpt-5-mini",
        modelPickerEnabled: true,
        modelPickerCategory: "lightweight",
        supportsReasoning: true,
        limits: { context: 264000, output: 64000 },
        thinking: {
          adaptiveThinking: false,
          minThinkingBudget: null,
          maxThinkingBudget: null,
          supportedEfforts: ["low", "medium", "high"],
        },
      }),
      mkModel({
        id: "gpt-5.4-mini",
        modelPickerEnabled: true,
        modelPickerCategory: "lightweight",
        supportsReasoning: true,
        limits: { context: 400000, output: 128000 },
        thinking: {
          adaptiveThinking: false,
          minThinkingBudget: null,
          maxThinkingBudget: null,
          supportedEfforts: ["none", "low", "medium", "high", "xhigh"],
        },
      }),
    ],
    undefined,
    { lightweightSubagents: true },
  )

  assert.deepEqual(cfg.agent?.general, {
    model: "github-copilot/gpt-5.4-mini",
    variant: "high",
  })
  assert.deepEqual(cfg.agent?.explore, {
    model: "github-copilot/gpt-5.4-mini",
    variant: "high",
  })
})

test("uses second-highest reasoning effort from metadata order", () => {
  const cfg = buildOpenCodeConfig(
    [
      mkModel({
        id: "weird-effort-model",
        modelPickerEnabled: true,
        modelPickerCategory: "lightweight",
        supportsReasoning: true,
        limits: { context: 1000, output: 1000 },
        thinking: {
          adaptiveThinking: false,
          minThinkingBudget: null,
          maxThinkingBudget: null,
          supportedEfforts: ["banana", "cebola", "ultrayasmingostosa"],
        },
      }),
    ],
    undefined,
    { lightweightSubagents: true },
  )

  assert.deepEqual(cfg.agent?.general, {
    model: "github-copilot/weird-effort-model",
    variant: "cebola",
  })
})

test("does not set agent override when lightweight subagents option is off", () => {
  const cfg = buildOpenCodeConfig([
    mkModel({
      id: "gpt-5-mini",
      modelPickerEnabled: true,
      modelPickerCategory: "lightweight",
      supportsReasoning: true,
    }),
  ])

  assert.equal(cfg.agent, undefined)
})
