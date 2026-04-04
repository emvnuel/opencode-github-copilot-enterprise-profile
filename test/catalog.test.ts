import test from "node:test"
import assert from "node:assert/strict"
import { normalizeModelsPayload } from "../src/normalize.js"

test("normalizes eligibility, billing, endpoints, and metadata reasoning efforts", () => {
  const out = normalizeModelsPayload({
    data: [
      {
        id: "gpt-5",
        name: "GPT-5",
        vendor: "openai",
        model_picker_enabled: true,
        billing: { is_premium: true },
        release_date: "2026-03-10",
        limit: { context: 200000, output: 8000 },
        capabilities: {
          supports: {
            adaptive_thinking: true,
            min_thinking_budget: 512,
            max_thinking_budget: 8192,
            reasoning_effort: ["low", "medium", "high", "max"],
          },
        },
        supported_endpoints: ["/v1/messages", "/chat/completions", "/responses", "ws:/responses"],
      },
    ],
  })

  assert.equal(out.length, 1)
  assert.equal(out[0].id, "gpt-5")
  assert.equal(out[0].modelPickerEnabled, true)
  assert.equal(out[0].modelPickerCategory, null)
  assert.equal(out[0].isPremium, true)
  assert.equal(out[0].premiumMetadataKnown, true)
  assert.equal(out[0].releaseDate, "2026-03-10")
  assert.equal(out[0].supportsReasoning, true)
  assert.deepEqual(out[0].endpoints, ["messages", "responses"])
  assert.equal(out[0].thinking.adaptiveThinking, true)
  assert.deepEqual(out[0].thinking.supportedEfforts, ["low", "medium", "high", "max"])
})

test("uses created_at when release_date is missing", () => {
  const out = normalizeModelsPayload({
    data: [
      {
        id: "gpt-4.1-mini",
        created_at: "2026-01-15T00:00:00Z",
      },
    ],
  })

  assert.equal(out.length, 1)
  assert.equal(out[0].releaseDate, "2026-01-15T00:00:00Z")
  assert.equal(out[0].modelPickerEnabled, false)
  assert.equal(out[0].isPremium, false)
  assert.equal(out[0].premiumMetadataKnown, false)
})

test("detects reasoning and limits from capabilities.supports and capabilities.limits", () => {
  const out = normalizeModelsPayload({
    data: [
      {
        id: "gpt-5.3-codex",
        name: "GPT-5.3-Codex",
        model_picker_enabled: true,
        billing: { is_premium: true },
        model_picker_category: "powerful",
        release_date: "2026-02-24",
        capabilities: {
          limits: {
            max_context_window_tokens: 400000,
            max_output_tokens: 128000,
          },
          supports: {
            reasoning_effort: ["low", "medium", "high"],
          },
        },
        supported_endpoints: ["/responses"],
      },
    ],
  })

  assert.equal(out.length, 1)
  assert.equal(out[0].supportsReasoning, true)
  assert.equal(out[0].modelPickerCategory, "powerful")
  assert.deepEqual(out[0].thinking.supportedEfforts, ["low", "medium", "high"])
  assert.deepEqual(out[0].endpoints, ["responses"])
  assert.equal(out[0].limits.context, 400000)
  assert.equal(out[0].limits.output, 128000)
  assert.equal(out[0].releaseDate, "2026-02-24")
})
