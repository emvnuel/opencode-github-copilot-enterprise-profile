import { buildCopilotHeaders, readCopilotAccessToken } from "./auth.js"
import { createCatalogClient } from "./catalog.js"
import { effortChain } from "./effort.js"
import type { EndpointKind, Logger } from "./types.js"

function withPath(baseUrl: string, p: string): string {
  const base = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl
  const segment = p.startsWith("/") ? p : `/${p}`
  return `${base}${segment}`
}

function isUnsupportedError(status: number, bodyText: string): boolean {
  if (status < 400 || status >= 500) return false
  const text = String(bodyText || "").toLowerCase()
  return text.includes("unsupported") || text.includes("not supported") || text.includes("invalid")
}

function endpointForModel(model: { endpoints?: string[] }): EndpointKind {
  const endpoints = model.endpoints || []
  if (endpoints.includes("responses")) return "responses"
  if (endpoints.includes("messages")) return "messages"
  return "responses"
}

function buildBody({
  modelId,
  endpointKind,
  effort,
  input,
}: {
  modelId: string
  endpointKind: EndpointKind
  effort: string
  input: { input?: string; prompt?: string; messages?: unknown[] }
}): Record<string, unknown> {
  if (endpointKind === "messages") {
    return {
      model: modelId,
      messages: input?.messages || [{ role: "user", content: input?.prompt || "" }],
      adaptive_thinking: { effort },
    }
  }

  return {
    model: modelId,
    input: input?.input || input?.prompt || "",
    reasoning: { effort },
  }
}

export function createCopilotProvider({
  baseUrl,
  authFile = "~/.local/share/opencode/auth.json",
  modelsPath = "/models",
  responsesPath = "/responses",
  messagesPath = "/messages",
  cacheFile,
  logger,
}: {
  baseUrl: string
  authFile?: string
  modelsPath?: string
  responsesPath?: string
  messagesPath?: string
  cacheFile?: string
  logger?: Logger | null
}) {
  const catalog = createCatalogClient({ baseUrl, authFile, modelsPath, cacheFile, logger })
  const negotiated = new Map<string, { endpointKind: EndpointKind; effort: string }>()

  async function invoke({
    modelId,
    effort = "medium",
    input,
    signal,
  }: {
    modelId: string
    effort?: string
    input: { input?: string; prompt?: string; messages?: unknown[] }
    signal?: AbortSignal
  }): Promise<{ endpointKind: EndpointKind; effort: string; payload: unknown }> {
    const models = await catalog.get(signal)
    const model = models.find((m) => m.id === modelId)
    if (!model) throw new Error(`Model not found in upstream catalog: ${modelId}`)

    const { token } = await readCopilotAccessToken(authFile)
    const headers = buildCopilotHeaders(token)
    const endpointKind = negotiated.get(modelId)?.endpointKind || endpointForModel(model)
    const supportedEfforts = Array.isArray(model.thinking?.supportedEfforts)
      ? model.thinking.supportedEfforts
      : null

    const efforts = negotiated.get(modelId)?.effort
      ? [negotiated.get(modelId)?.effort as string]
      : effortChain(effort, endpointKind, supportedEfforts)
    const requestPath = endpointKind === "messages" ? messagesPath : responsesPath

    let lastError: Error | null = null
    for (const candidate of efforts) {
      const body = buildBody({ modelId, endpointKind, effort: candidate, input })
      const response = await fetch(withPath(baseUrl, requestPath), {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal,
      })

      if (response.ok) {
        negotiated.set(modelId, { endpointKind, effort: candidate })
        const payload = await response.json().catch(() => ({}))
        if (logger) await logger.info("Copilot request accepted", { modelId, endpointKind, effort: candidate })
        return { endpointKind, effort: candidate, payload }
      }

      const errorText = await response.text().catch(() => "")
      if (!isUnsupportedError(response.status, errorText)) {
        throw new Error(`Copilot request failed (${response.status}): ${errorText.slice(0, 200)}`)
      }

      lastError = new Error(`Rejected effort ${candidate} (${response.status})`)
      if (logger) await logger.warn("Copilot request rejected, trying fallback", { modelId, endpointKind, effort: candidate })
    }

    throw lastError || new Error("Unable to negotiate supported effort")
  }

  return { invoke, catalog }
}
