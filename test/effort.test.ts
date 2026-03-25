import test from "node:test"
import assert from "node:assert/strict"
import { clampEffort, effortChain, inferSupportedEfforts } from "../src/effort.js"

test("maps max to xhigh on responses", () => {
  assert.equal(clampEffort("max", "responses"), "xhigh")
})

test("maps minimal to low on messages", () => {
  assert.equal(clampEffort("minimal", "messages"), "low")
})

test("builds descending fallback chain", () => {
  assert.deepEqual(effortChain("high", "responses"), ["high", "medium", "low", "minimal", "none"])
})

test("honors explicit advertised efforts for messages", () => {
  const supported = inferSupportedEfforts({
    endpointKind: "messages",
    adaptiveThinking: true,
    advertisedEfforts: ["low", "high", "max"],
  })
  assert.deepEqual(supported, ["low", "high", "max"])
})

test("clamps requested effort to nearest supported option", () => {
  const supported = ["low", "high", "max"]
  assert.equal(clampEffort("medium", "messages", supported), "low")
})
