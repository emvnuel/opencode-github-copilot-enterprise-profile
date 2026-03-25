import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { readCopilotAccessToken, buildCopilotHeaders } from "../src/auth.js"

test("reads github-copilot.access token", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "copilot-auth-"))
  const authPath = path.join(dir, "auth.json")
  await writeFile(authPath, JSON.stringify({ "github-copilot": { access: "abc123" } }))

  const result = await readCopilotAccessToken(authPath)
  assert.equal(result.token, "abc123")
  assert.equal(result.authPath, authPath)
})

test("builds bearer headers", () => {
  const headers = buildCopilotHeaders("secret")
  assert.equal(headers.authorization, "Bearer secret")
})
