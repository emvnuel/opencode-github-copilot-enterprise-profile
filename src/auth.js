import { readFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

function expandHome(inputPath) {
  if (!inputPath) return inputPath
  if (inputPath === "~") return os.homedir()
  if (inputPath.startsWith("~/")) return path.join(os.homedir(), inputPath.slice(2))
  return inputPath
}

export class AuthError extends Error {
  constructor(message) {
    super(message)
    this.name = "AuthError"
  }
}

export async function readCopilotAccessToken(authFile = "~/.local/share/opencode/auth.json") {
  const resolved = expandHome(authFile)
  let text
  try {
    text = await readFile(resolved, "utf8")
  } catch (error) {
    throw new AuthError(`Missing auth file: ${resolved}`)
  }

  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new AuthError(`Invalid JSON in auth file: ${resolved}`)
  }

  const token = parsed?.["github-copilot"]?.access
  if (!token || typeof token !== "string") {
    throw new AuthError(`Missing token key github-copilot.access in auth file: ${resolved}`)
  }

  return { token, authPath: resolved }
}

export function buildCopilotHeaders(token) {
  return {
    authorization: `Bearer ${token}`,
    accept: "application/json",
    "content-type": "application/json",
  }
}

export function resolvePath(inputPath) {
  return expandHome(inputPath)
}
