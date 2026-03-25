import test from "node:test"
import assert from "node:assert/strict"
import { buildOpenCodeConfig } from "../src/config.js"

test("enforces privacy config requirements", () => {
  const cfg = buildOpenCodeConfig([
    {
      id: "gpt-5",
      name: "GPT-5",
      vendor: null,
      limits: { context: null, output: null },
      supportsReasoning: true,
      capabilities: {},
      endpoints: [],
      thinking: {
        adaptiveThinking: false,
        minThinkingBudget: null,
        maxThinkingBudget: null,
        supportedEfforts: ["low", "medium", "high"],
      },
      raw: {},
    },
  ])
  assert.equal(cfg.share, "disabled")
  assert.deepEqual(cfg.disabled_providers, ["opencode"])
  assert.deepEqual(
    Object.keys(cfg.provider["github-copilot"].models["gpt-5"].variants),
    ["low", "medium", "high"],
  )
})
