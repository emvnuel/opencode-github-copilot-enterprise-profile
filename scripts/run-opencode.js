import { spawn } from "node:child_process"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, "..")
const rendered = process.env.OPENCODE_RENDERED_CONFIG || path.join(root, ".opencode/runtime/opencode.generated.json")

async function ensureConfig() {
  try {
    await readFile(rendered, "utf8")
  } catch {
    const proc = spawn(process.execPath, [path.join(__dirname, "render-config.js")], {
      stdio: "inherit",
      env: {
        ...process.env,
        OPENCODE_DISABLE_MODELS_FETCH: process.env.OPENCODE_DISABLE_MODELS_FETCH || "true",
      },
    })
    await new Promise((resolve, reject) => {
      proc.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`render-config failed: ${code}`))))
    })
  }
}

async function main() {
  await ensureConfig()
  const renderedContent = await readFile(rendered, "utf8")

  const args = process.argv.slice(2)
  const proc = spawn("opencode", args, {
    stdio: "inherit",
    env: {
      ...process.env,
      OPENCODE_DISABLE_MODELS_FETCH: process.env.OPENCODE_DISABLE_MODELS_FETCH || "true",
      OPENCODE_CONFIG: rendered,
      OPENCODE_CONFIG_CONTENT: renderedContent,
    },
  })

  proc.on("exit", (code) => process.exit(code ?? 0))
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
