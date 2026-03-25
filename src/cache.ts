import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { CacheReadResult } from "./types.js"

function expandHome(inputPath: string): string {
  if (inputPath === "~") return os.homedir()
  if (inputPath.startsWith("~/")) return path.join(os.homedir(), inputPath.slice(2))
  return inputPath
}

function nowMs(): number {
  return Date.now()
}

export async function readJsonCache<T>(filePath: string, maxAgeMs: number): Promise<CacheReadResult<T>> {
  const resolved = expandHome(filePath)
  try {
    const text = await readFile(resolved, "utf8")
    const parsed = JSON.parse(text) as { updatedAt?: unknown; value?: T }
    const updatedAt = Number(parsed?.updatedAt || 0)
    const age = nowMs() - updatedAt
    return {
      hit: age >= 0 && age <= maxAgeMs,
      stale: age > maxAgeMs,
      value: parsed?.value ?? null,
      updatedAt,
      path: resolved,
    }
  } catch {
    return { hit: false, stale: false, value: null, updatedAt: 0, path: resolved }
  }
}

export async function writeJsonCache<T>(filePath: string, value: T): Promise<string> {
  const resolved = expandHome(filePath)
  const dir = path.dirname(resolved)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const tmp = `${resolved}.tmp-${process.pid}-${Date.now()}`
  const payload = JSON.stringify({ updatedAt: nowMs(), value }, null, 2)
  await writeFile(tmp, payload, { mode: 0o600 })
  await rename(tmp, resolved)
  return resolved
}
