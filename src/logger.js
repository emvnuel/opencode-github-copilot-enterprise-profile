const REDACT_KEYS = ["authorization", "token", "access", "apiKey", "prompt"]

function redactObject(value) {
  if (!value || typeof value !== "object") return value
  if (Array.isArray(value)) return value.map(redactObject)

  const out = {}
  for (const [key, val] of Object.entries(value)) {
    const lower = key.toLowerCase()
    out[key] = REDACT_KEYS.some((k) => lower.includes(k)) ? "[redacted]" : redactObject(val)
  }
  return out
}

export function createLogger(client) {
  const emit = async (level, message, extra = {}) => {
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

    const payload = { level, message, ...body.extra }
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
