import { readFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

function expandHome(inputPath: string): string {
  if (inputPath === "~") return os.homedir()
  if (inputPath.startsWith("~/")) return path.join(os.homedir(), inputPath.slice(2))
  return inputPath
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "AuthError"
  }
}

export async function readCopilotAccessToken(
  authFile = "~/.local/share/opencode/auth.json",
): Promise<{ token: string; authPath: string }> {
  const resolved = expandHome(authFile)
  let text: string
  try {
    text = await readFile(resolved, "utf8")
  } catch {
    throw new AuthError(`Missing auth file: ${resolved}`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new AuthError(`Invalid JSON in auth file: ${resolved}`)
  }

  const token =
    typeof parsed === "object" && parsed !== null
      ? (parsed as { "github-copilot"?: { access?: unknown } })["github-copilot"]?.access
      : null

  if (!token || typeof token !== "string") {
    throw new AuthError(`Missing token key github-copilot.access in auth file: ${resolved}`)
  }

  return { token, authPath: resolved }
}

export function buildCopilotHeaders(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    accept: "application/json",
    "content-type": "application/json",
  }
}

export function resolvePath(inputPath: string): string {
  return expandHome(inputPath)
}
