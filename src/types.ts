export type EndpointKind = "responses" | "messages"

export interface ThinkingInfo {
  adaptiveThinking: boolean
  minThinkingBudget: number | null
  maxThinkingBudget: number | null
  supportedEfforts: string[]
}

export interface NormalizedModel {
  id: string
  name: string
  vendor: string | null
  releaseDate: string | null
  limits: {
    context: number | null
    output: number | null
  }
  supportsReasoning: boolean
  capabilities: Record<string, unknown>
  endpoints: string[]
  thinking: ThinkingInfo
  raw: Record<string, unknown>
}

export interface CacheReadResult<T> {
  hit: boolean
  stale: boolean
  value: T | null
  updatedAt: number
  path: string
}

export interface Logger {
  debug(message: string, extra?: Record<string, unknown>): Promise<void>
  info(message: string, extra?: Record<string, unknown>): Promise<void>
  warn(message: string, extra?: Record<string, unknown>): Promise<void>
  error(message: string, extra?: Record<string, unknown>): Promise<void>
}

export interface CatalogClient {
  get(signal?: AbortSignal): Promise<NormalizedModel[]>
  refresh(signal?: AbortSignal): Promise<NormalizedModel[]>
}
