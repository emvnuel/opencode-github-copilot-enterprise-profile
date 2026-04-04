import { spawn } from "node:child_process"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const workspaceRootCandidate = path.join(__dirname, "..")
const workspaceRoot = path.basename(workspaceRootCandidate) === "dist"
  ? path.join(workspaceRootCandidate, "..")
  : workspaceRootCandidate
const rendered = process.env.OPENCODE_RENDERED_CONFIG || path.join(workspaceRoot, ".opencode/runtime/opencode.generated.json")

async function ensureConfig(extraEnv: Record<string, string>, forceRender = false): Promise<void> {
  try {
    if (forceRender) throw new Error("forced render")
    await readFile(rendered, "utf8")
  } catch {
    const proc = spawn(process.execPath, [path.join(__dirname, "render-config.js")], {
      stdio: "inherit",
      env: {
        ...process.env,
        ...extraEnv,
        OPENCODE_DISABLE_MODELS_FETCH: process.env.OPENCODE_DISABLE_MODELS_FETCH || "true",
      },
    })
    await new Promise<void>((resolve, reject) => {
      proc.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`render-config failed: ${code}`))))
    })
  }
}

async function main(): Promise<void> {
  const includeLightweightSubagents = process.argv.slice(2).includes("--lightweight-subagents")
  const envOverrides: Record<string, string> = includeLightweightSubagents
    ? { OPENCODE_LIGHTWEIGHT_SUBAGENTS: "true" }
    : {}

  await ensureConfig(envOverrides, includeLightweightSubagents)
  const renderedContent = await readFile(rendered, "utf8")

  const args = process.argv.slice(2).filter((arg) => arg !== "--lightweight-subagents")
  const proc = spawn("opencode", args, {
    stdio: "inherit",
    env: {
      ...process.env,
      OPENCODE_DISABLE_MODELS_FETCH: process.env.OPENCODE_DISABLE_MODELS_FETCH || "true",
      ...envOverrides,
      OPENCODE_CONFIG: rendered,
      OPENCODE_CONFIG_CONTENT: renderedContent,
    },
  })

  proc.on("exit", (code) => process.exit(code ?? 0))
}

main().catch((error: unknown) => {
  console.error((error as Error).message)
  process.exit(1)
})
