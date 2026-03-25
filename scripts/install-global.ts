#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { spawn } from "node:child_process"
import { fileURLToPath, pathToFileURL } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const workspaceRootCandidate = path.join(__dirname, "..")
const root = path.basename(workspaceRootCandidate) === "dist"
  ? path.join(workspaceRootCandidate, "..")
  : workspaceRootCandidate
const generatedPath = path.join(root, ".opencode", "runtime", "opencode.generated.json")
const pluginEntryPath = path.join(root, "dist", "src", "plugin.js")

function resolveHome(inputPath: string): string {
  if (inputPath === "~") return os.homedir()
  if (inputPath.startsWith("~/")) return path.join(os.homedir(), inputPath.slice(2))
  return inputPath
}

function detectGlobalConfigDir(): string {
  if (process.env.OPENCODE_CONFIG_DIR) {
    return resolveHome(process.env.OPENCODE_CONFIG_DIR)
  }

  const unixStyle = path.join(os.homedir(), ".config", "opencode")
  if (process.platform !== "win32") return unixStyle

  if (process.env.APPDATA) {
    return path.join(process.env.APPDATA, "opencode")
  }

  return unixStyle
}

const globalConfigDir = detectGlobalConfigDir()
const globalPluginsDir = path.join(globalConfigDir, "plugins")
const globalConfigFile = path.join(globalConfigDir, "opencode.json")

const pluginLoader = `import { CopilotEnterpriseProfilePlugin } from "${pathToFileURL(pluginEntryPath).href}"

export const Plugin = CopilotEnterpriseProfilePlugin
`

function deepMerge(a: unknown, b: unknown): unknown {
  if (Array.isArray(a) || Array.isArray(b)) return b
  if (!a || typeof a !== "object") return b
  if (!b || typeof b !== "object") return a

  const out: Record<string, unknown> = { ...(a as Record<string, unknown>) }
  for (const [key, value] of Object.entries(b as Record<string, unknown>)) {
    out[key] = key in out ? deepMerge(out[key], value) : value
  }
  return out
}

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const text = await readFile(filePath, "utf8")
    return JSON.parse(text) as T
  } catch {
    return fallback
  }
}

async function runRenderConfig(): Promise<void> {
  const proc = spawn(process.execPath, [path.join(__dirname, "render-config.js")], {
    stdio: "inherit",
    env: {
      ...process.env,
      OPENCODE_DISABLE_MODELS_FETCH: process.env.OPENCODE_DISABLE_MODELS_FETCH || "true",
    },
  })

  await new Promise<void>((resolve, reject) => {
    proc.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`render-config failed: ${code}`))))
  })
}

async function installPluginLoader(): Promise<void> {
  await mkdir(globalPluginsDir, { recursive: true })
  await writeFile(path.join(globalPluginsDir, "copilot-enterprise-profile.js"), pluginLoader, "utf8")
}

async function installGlobalConfig(): Promise<void> {
  const generated = await readJson<Record<string, unknown> | null>(generatedPath, null)
  if (!generated) throw new Error(`Missing generated config at ${generatedPath}`)

  const existing = await readJson<Record<string, unknown>>(globalConfigFile, {})
  const models =
    ((generated.provider as Record<string, unknown> | undefined)?.["github-copilot"] as Record<string, unknown> | undefined)?.models || {}
  const merged = deepMerge(existing, {
    share: "disabled",
    disabled_providers: ["opencode"],
    enabled_providers: ["github-copilot"],
    provider: {
      "github-copilot": {
        models,
      },
    },
    model: generated.model,
    small_model: generated.small_model,
  }) as Record<string, unknown>

  await mkdir(globalConfigDir, { recursive: true })
  await writeFile(globalConfigFile, `${JSON.stringify(merged, null, 2)}\n`, "utf8")
}

async function ensureUnixShellEnv(): Promise<void> {
  const line = "export OPENCODE_DISABLE_MODELS_FETCH=true"
  const shellProfiles = [".zshrc", ".bashrc"]

  for (const profileName of shellProfiles) {
    const profilePath = path.join(os.homedir(), profileName)
    const text = await readFile(profilePath, "utf8").catch(() => "")
    if (text.includes(line)) continue
    const prefix = text.trimEnd()
    const next = prefix ? `${prefix}\n${line}\n` : `${line}\n`
    await writeFile(profilePath, next, "utf8")
  }
}

async function ensureWindowsShellEnv(): Promise<void> {
  const userProfile = process.env.USERPROFILE || os.homedir()
  const line = "$env:OPENCODE_DISABLE_MODELS_FETCH = \"true\""
  const powershellProfiles = [
    path.join(userProfile, "Documents", "WindowsPowerShell", "Microsoft.PowerShell_profile.ps1"),
    path.join(userProfile, "Documents", "PowerShell", "Microsoft.PowerShell_profile.ps1"),
  ]

  for (const profilePath of powershellProfiles) {
    const current = await readFile(profilePath, "utf8").catch(() => "")
    if (current.includes(line)) continue
    await mkdir(path.dirname(profilePath), { recursive: true })
    const prefix = current.trimEnd()
    const next = prefix ? `${prefix}\n${line}\n` : `${line}\n`
    await writeFile(profilePath, next, "utf8")
  }

  await new Promise<void>((resolve) => {
    const proc = spawn("cmd", ["/c", "setx OPENCODE_DISABLE_MODELS_FETCH true"], { stdio: "ignore" })
    proc.on("exit", () => resolve())
    proc.on("error", () => resolve())
  })
}

async function ensurePersistentEnv(): Promise<void> {
  if (process.platform === "win32") {
    await ensureWindowsShellEnv()
    return
  }

  await ensureUnixShellEnv()
}

async function main(): Promise<void> {
  await runRenderConfig()
  await installPluginLoader()
  await installGlobalConfig()
  await ensurePersistentEnv()
  process.stdout.write(
    `Installed globally:\n- ${globalConfigFile}\n- ${path.join(globalPluginsDir, "copilot-enterprise-profile.js")}\n- OPENCODE_DISABLE_MODELS_FETCH persistence updated\n`,
  )
}

main().catch((error: unknown) => {
  console.error((error as Error).message)
  process.exit(1)
})
