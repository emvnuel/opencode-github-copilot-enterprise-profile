import test from "node:test"
import assert from "node:assert/strict"
import { normalizeModelsPayload } from "../src/normalize.js"

test("normalizes upstream /models payload", () => {
  const out = normalizeModelsPayload({
    data: [
      {
        id: "gpt-5",
        name: "GPT-5",
        vendor: "openai",
        limit: { context: 200000, output: 8000 },
        capabilities: {
          supports: {
            adaptive_thinking: true,
            min_thinking_budget: 512,
            max_thinking_budget: 8192,
            reasoning_effort: ["low", "medium", "high", "max"],
          },
        },
        supported_endpoints: ["responses", "messages"],
      },
    ],
  })

  assert.equal(out.length, 1)
  assert.equal(out[0].id, "gpt-5")
  assert.equal(out[0].supportsReasoning, true)
  assert.deepEqual(out[0].endpoints, ["responses", "messages"])
  assert.equal(out[0].thinking.adaptiveThinking, true)
  assert.deepEqual(out[0].thinking.supportedEfforts, ["low", "medium", "high", "max"])
})

test("detects reasoning and limits from capabilities.supports and capabilities.limits", () => {
  const out = normalizeModelsPayload({
    data: [
      {
        id: "gpt-5.3-codex",
        name: "GPT-5.3-Codex",
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
  assert.deepEqual(out[0].thinking.supportedEfforts, ["low", "medium", "high"])
  assert.deepEqual(out[0].endpoints, ["responses"])
  assert.equal(out[0].limits.context, 400000)
  assert.equal(out[0].limits.output, 128000)
})
