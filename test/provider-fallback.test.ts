import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createCopilotProvider } from "../src/provider.js"

test("falls back to lower effort after unsupported rejection", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "copilot-provider-"))
  const authPath = path.join(dir, "auth.json")
  await writeFile(authPath, JSON.stringify({ "github-copilot": { access: "token" } }), "utf8")

  const attempts: string[] = []
  const originalFetch = global.fetch
  global.fetch = async (url: URL | RequestInfo, init?: RequestInit): Promise<Response> => {
    if (String(url).endsWith("/models")) {
      return new Response(
        JSON.stringify({
          data: [{ id: "gpt-5", supported_endpoints: ["responses"], capabilities: { reasoning_tokens: 1 } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )
    }

    const body = JSON.parse(String(init?.body || "{}")) as { reasoning?: { effort?: string } }
    attempts.push(body.reasoning?.effort || "")
    if (body.reasoning?.effort === "high") {
      return new Response("unsupported effort", { status: 400 })
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  }

  try {
    const provider = createCopilotProvider({
      baseUrl: "https://example.copilot.local",
      authFile: authPath,
      cacheFile: path.join(dir, "models-cache.json"),
    })

    const result = await provider.invoke({ modelId: "gpt-5", effort: "high", input: { input: "ping" } })
    assert.equal(result.effort, "medium")
    assert.deepEqual(attempts, ["high", "medium"])
  } finally {
    global.fetch = originalFetch
  }
})

test("prefers explicit requested effort over negotiated cached effort", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "copilot-provider-"))
  const authPath = path.join(dir, "auth.json")
  await writeFile(authPath, JSON.stringify({ "github-copilot": { access: "token" } }), "utf8")

  const attempts: string[] = []
  const originalFetch = global.fetch
  global.fetch = async (url: URL | RequestInfo, init?: RequestInit): Promise<Response> => {
    if (String(url).endsWith("/models")) {
      return new Response(
        JSON.stringify({
          data: [{ id: "gpt-5", supported_endpoints: ["responses"], capabilities: { reasoning_tokens: 1 } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )
    }

    const body = JSON.parse(String(init?.body || "{}")) as { reasoning?: { effort?: string } }
    attempts.push(body.reasoning?.effort || "")
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  }

  try {
    const provider = createCopilotProvider({
      baseUrl: "https://example.copilot.local",
      authFile: authPath,
      cacheFile: path.join(dir, "models-cache.json"),
    })

    const first = await provider.invoke({ modelId: "gpt-5", effort: "medium", input: { input: "ping 1" } })
    assert.equal(first.effort, "medium")

    const second = await provider.invoke({ modelId: "gpt-5", effort: "high", input: { input: "ping 2" } })
    assert.equal(second.effort, "high")

    assert.deepEqual(attempts, ["medium", "high"])
  } finally {
    global.fetch = originalFetch
  }
})

test("maps endpoint aliases to messages runtime endpoint", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "copilot-provider-"))
  const authPath = path.join(dir, "auth.json")
  await writeFile(authPath, JSON.stringify({ "github-copilot": { access: "token" } }), "utf8")

  const calledUrls: string[] = []
  const requestBodies: Array<Record<string, unknown>> = []
  const originalFetch = global.fetch
  global.fetch = async (url: URL | RequestInfo, init?: RequestInit): Promise<Response> => {
    if (String(url).endsWith("/models")) {
      return new Response(
        JSON.stringify({
          data: [{ id: "gpt-5", supported_endpoints: ["/v1/chat/completions"], capabilities: { reasoning_tokens: 1 } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )
    }

    calledUrls.push(String(url))
    requestBodies.push(JSON.parse(String(init?.body || "{}")) as Record<string, unknown>)
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  }

  try {
    const provider = createCopilotProvider({
      baseUrl: "https://example.copilot.local",
      authFile: authPath,
      cacheFile: path.join(dir, "models-cache.json"),
      messagesPath: "/messages",
    })

    const result = await provider.invoke({
      modelId: "gpt-5",
      effort: "high",
      input: { messages: [{ role: "user", content: "ping" }] },
    })

    assert.equal(result.endpointKind, "messages")
    assert.equal(calledUrls.length, 1)
    assert.equal(calledUrls[0].endsWith("/messages"), true)

    const body = requestBodies[0] as { adaptive_thinking?: { effort?: string }; reasoning?: { effort?: string } }
    assert.equal(body.adaptive_thinking?.effort, "high")
    assert.equal(body.reasoning, undefined)
  } finally {
    global.fetch = originalFetch
  }
})

test("maps responses aliases to responses runtime endpoint", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "copilot-provider-"))
  const authPath = path.join(dir, "auth.json")
  await writeFile(authPath, JSON.stringify({ "github-copilot": { access: "token" } }), "utf8")

  const calledUrls: string[] = []
  const requestBodies: Array<Record<string, unknown>> = []
  const originalFetch = global.fetch
  global.fetch = async (url: URL | RequestInfo, init?: RequestInit): Promise<Response> => {
    if (String(url).endsWith("/models")) {
      return new Response(
        JSON.stringify({
          data: [{ id: "gpt-5", supported_endpoints: ["/v1/responses", "ws:/responses"], capabilities: { reasoning_tokens: 1 } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )
    }

    calledUrls.push(String(url))
    requestBodies.push(JSON.parse(String(init?.body || "{}")) as Record<string, unknown>)
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  }

  try {
    const provider = createCopilotProvider({
      baseUrl: "https://example.copilot.local",
      authFile: authPath,
      cacheFile: path.join(dir, "models-cache.json"),
      responsesPath: "/responses",
    })

    const result = await provider.invoke({ modelId: "gpt-5", effort: "high", input: { input: "ping" } })

    assert.equal(result.endpointKind, "responses")
    assert.equal(calledUrls.length, 1)
    assert.equal(calledUrls[0].endsWith("/responses"), true)

    const body = requestBodies[0] as { adaptive_thinking?: { effort?: string }; reasoning?: { effort?: string } }
    assert.equal(body.reasoning?.effort, "high")
    assert.equal(body.adaptive_thinking, undefined)
  } finally {
    global.fetch = originalFetch
  }
})
