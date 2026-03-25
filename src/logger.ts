import type { Logger } from "./types.js"

const REDACT_KEYS = ["authorization", "token", "access", "apikey", "prompt"]

function redactObject(value: unknown): unknown {
  if (!value || typeof value !== "object") return value
  if (Array.isArray(value)) return value.map(redactObject)

  const out: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    const lower = key.toLowerCase()
    out[key] = REDACT_KEYS.some((k) => lower.includes(k)) ? "[redacted]" : redactObject(val)
  }
  return out
}

type OpenCodeClient = {
  app?: {
    log?: (input: { body: Record<string, unknown> }) => Promise<void>
  }
}

export function createLogger(client?: OpenCodeClient): Logger {
  const emit = async (level: string, message: string, extra: Record<string, unknown> = {}): Promise<void> => {
    const body = {
      service: "copilot-enterprise-profile",
      level,
      message,
      extra: redactObject(extra),
    }

    if (client?.app?.log) {
      await client.app.log({ body })
      return
    }

    const payload = { level, message, ...(body.extra as Record<string, unknown>) }
    if (level === "error") {
      console.error(payload)
    } else {
      console.log(payload)
    }
  }

  return {
    debug: (message, extra) => emit("debug", message, extra),
    info: (message, extra) => emit("info", message, extra),
    warn: (message, extra) => emit("warn", message, extra),
    error: (message, extra) => emit("error", message, extra),
  }
}
