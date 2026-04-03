import test from "node:test"
import assert from "node:assert/strict"
import { buildOpenCodeConfig, parseModelIdentifier } from "../src/config.js"
import type { NormalizedModel } from "../src/types.js"

function mkModel(partial: Partial<NormalizedModel>): NormalizedModel {
  return {
    id: partial.id || "model-1",
    name: partial.name || partial.id || "Model 1",
    vendor: partial.vendor ?? null,
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

test("enforces privacy config requirements", () => {
  const cfg = buildOpenCodeConfig([
    mkModel({
      id: "gpt-5",
      name: "GPT-5",
      supportsReasoning: true,
      thinking: {
        adaptiveThinking: false,
        minThinkingBudget: null,
        maxThinkingBudget: null,
        supportedEfforts: ["low", "medium", "high"],
      },
    }),
  ])
  assert.equal(cfg.share, "disabled")
  assert.deepEqual(cfg.disabled_providers, ["opencode"])
  assert.deepEqual(cfg.enabled_providers, ["github-copilot"])
  assert.equal(cfg.small_model, "github-copilot/gpt-5-mini")
  assert.deepEqual(
    Object.keys(cfg.provider["github-copilot"].models["gpt-5"].variants),
    ["low", "medium", "high"],
  )
})

test("returns empty variants for non-reasoning models", () => {
  const cfg = buildOpenCodeConfig([mkModel({ id: "gpt-4.1", supportsReasoning: false })])
  assert.deepEqual(cfg.provider["github-copilot"].models["gpt-4.1"].variants, {})
})

test("returns empty variants for excluded model families", () => {
  const ids = ["deepseek-r1", "minimax-m1", "glm-4", "mistral-large", "kimi-k2", "k2p5-fast"]
  const cfg = buildOpenCodeConfig(ids.map((id) => mkModel({ id, supportsReasoning: true })))
  for (const id of ids) {
    assert.deepEqual(cfg.provider["github-copilot"].models[id].variants, {})
  }
})

test("returns empty variants for gemini models", () => {
  const cfg = buildOpenCodeConfig([mkModel({ id: "gemini-3-pro-preview", supportsReasoning: true })])
  assert.deepEqual(cfg.provider["github-copilot"].models["gemini-3-pro-preview"].variants, {})
})

test("returns thinking variant for claude models", () => {
  const cfg = buildOpenCodeConfig([mkModel({ id: "claude-sonnet-4.6", supportsReasoning: true })])
  assert.deepEqual(cfg.provider["github-copilot"].models["claude-sonnet-4.6"].variants, {
    thinking: { thinking_budget: 4000 },
  })
})

test("includes xhigh for gpt-5.3-codex", () => {
  const cfg = buildOpenCodeConfig([mkModel({ id: "gpt-5.3-codex", supportsReasoning: true })])
  assert.deepEqual(Object.keys(cfg.provider["github-copilot"].models["gpt-5.3-codex"].variants), [
    "low",
    "medium",
    "high",
    "xhigh",
  ])
})

test("gates xhigh on release date for gpt-5", () => {
  const oldCfg = buildOpenCodeConfig([
    mkModel({ id: "gpt-5", supportsReasoning: true, releaseDate: "2025-08-07" }),
  ])
  assert.deepEqual(Object.keys(oldCfg.provider["github-copilot"].models["gpt-5"].variants), [
    "low",
    "medium",
    "high",
  ])

  const newCfg = buildOpenCodeConfig([
    mkModel({ id: "gpt-5", supportsReasoning: true, releaseDate: "2025-12-04" }),
  ])
  assert.deepEqual(Object.keys(newCfg.provider["github-copilot"].models["gpt-5"].variants), [
    "low",
    "medium",
    "high",
    "xhigh",
  ])
})

test("merges variant overrides and strips disabled key", () => {
  const cfg = buildOpenCodeConfig(
    [mkModel({ id: "gpt-5.3-codex", supportsReasoning: true })],
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
