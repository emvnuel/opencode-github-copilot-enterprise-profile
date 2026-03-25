import test from "node:test"
import assert from "node:assert/strict"
import { buildOpenCodeConfig } from "../src/config.js"

test("enforces privacy config requirements", () => {
  const cfg = buildOpenCodeConfig([
    {
      id: "gpt-5",
      name: "GPT-5",
      limits: {},
      supportsReasoning: true,
      thinking: { supportedEfforts: ["low", "medium", "high"] },
    },
  ])
  assert.equal(cfg.share, "disabled")
  assert.deepEqual(cfg.disabled_providers, ["opencode"])
  assert.deepEqual(
    Object.keys(cfg.provider["github-copilot"].models["gpt-5"].variants),
    ["low", "medium", "high"],
  )
})
