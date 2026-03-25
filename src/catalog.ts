import { buildCopilotHeaders, readCopilotAccessToken } from "./auth.js"
import { normalizeModelsPayload } from "./normalize.js"
import { readJsonCache, writeJsonCache } from "./cache.js"
import type { CatalogClient, Logger, NormalizedModel } from "./types.js"

const DEFAULT_CACHE_MS = 10 * 60 * 1000

function withPath(baseUrl: string, p: string): string {
  const base = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl
  const segment = p.startsWith("/") ? p : `/${p}`
  return `${base}${segment}`
}

function assertHttps(baseUrl: string): void {
  const url = new URL(baseUrl)
  if (url.protocol !== "https:") {
    throw new Error(`Copilot base URL must be https: ${baseUrl}`)
  }
}

export async function fetchUpstreamModels({
  baseUrl,
  authFile,
  modelsPath = "/models",
  signal,
}: {
  baseUrl: string
  authFile: string
  modelsPath?: string
  signal?: AbortSignal
}): Promise<NormalizedModel[]> {
  assertHttps(baseUrl)
  const { token } = await readCopilotAccessToken(authFile)
  const url = withPath(baseUrl, modelsPath)
  const response = await fetch(url, {
    method: "GET",
    headers: buildCopilotHeaders(token),
    signal,
  })

  if (!response.ok) {
    const body = await response.text().catch(() => "")
    throw new Error(`Upstream /models request failed (${response.status}): ${body.slice(0, 200)}`)
  }

  const json = await response.json()
  return normalizeModelsPayload(json)
}

export function createCatalogClient({
  baseUrl,
  authFile,
  modelsPath,
  cacheFile = "~/.cache/opencode/github-copilot-enterprise/models.json",
  cacheMs = DEFAULT_CACHE_MS,
  logger,
}: {
  baseUrl: string
  authFile: string
  modelsPath?: string
  cacheFile?: string
  cacheMs?: number
  logger?: Logger | null
}): CatalogClient {
  let memory: NormalizedModel[] | null = null
  let memoryUpdatedAt = 0

  async function refresh(signal?: AbortSignal): Promise<NormalizedModel[]> {
    const models = await fetchUpstreamModels({ baseUrl, authFile, modelsPath, signal })
    memory = models
    memoryUpdatedAt = Date.now()
    await writeJsonCache(cacheFile, models)
    if (logger) await logger.info("Refreshed Copilot model catalog", { modelCount: models.length })
    return models
  }

  async function get(signal?: AbortSignal): Promise<NormalizedModel[]> {
    const memoryAge = Date.now() - memoryUpdatedAt
    if (memory && memoryAge <= cacheMs) return memory

    const disk = await readJsonCache<NormalizedModel[]>(cacheFile, cacheMs)
    if (disk.hit && Array.isArray(disk.value)) {
      memory = disk.value
      memoryUpdatedAt = disk.updatedAt
      void refresh(signal).catch(() => {})
      return disk.value
    }

    if (disk.stale && Array.isArray(disk.value)) {
      memory = disk.value
      memoryUpdatedAt = disk.updatedAt
      void refresh(signal).catch(() => {})
      return disk.value
    }

    return refresh(signal)
  }

  return { get, refresh }
}
