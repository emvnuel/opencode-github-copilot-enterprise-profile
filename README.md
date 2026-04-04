# GitHub Copilot Enterprise OpenCode Profile

Privacy-first OpenCode plugin and config renderer for enterprise Copilot environments.

## Guarantees in this profile

- OpenCode share is disabled in generated config.
- `disabled_providers` contains only `opencode`.
- Models are sourced from upstream Copilot `GET /models` (authoritative metadata source).
- Only models with `model_picker_enabled: true` and non-disabled picker policy are included in generated provider config.
- Generated config also sets `provider.github-copilot.whitelist` to the same filtered model IDs, so picker/listing is restricted to allowed models.
- Default `model` is selected from enabled `model_picker_category: "powerful"` models first (premium + capability-first ranking), then falls back deterministically.
- Default `small_model` is the strongest enabled non-premium model by capability-first ranking; when premium metadata is missing in upstream payloads, conservative non-premium ID heuristics are applied.
- `OPENCODE_DISABLE_MODELS_FETCH=true` is treated as mandatory for startup scripts.
- Thinking variants are metadata-first from `capabilities.supports.reasoning_effort` when available.

## Why this exists

In corporate/proxy environments, `models.dev` is often unavailable. This profile avoids dependency on it and derives model metadata from Copilot upstream API directly.

From issue #10416 discussion, this profile also incorporates practical hardening:

- Keep `disabled_providers: ["opencode"]` explicit.
- Require OpenCode `>=1.1.36` for more reliable behavior around models fetch disable logic.
- Support `OPENCODE_MODELS_URL` if your environment requires a local models index override.
- Optionally set `OPENCODE_DISABLE_DEFAULT_PLUGINS=true` for tighter offline startup control.

## Files

- Generated runtime config: `.opencode/runtime/opencode.generated.json`
- Global plugin loader (installed): `~/.config/opencode/plugins/copilot-enterprise-profile.js`
- Runtime config renderer source: `scripts/render-config.ts`
- OpenCode launcher wrapper source: `scripts/run-opencode.ts`
- Compiled runtime entrypoints: `dist/scripts/*.js`

## Requirements

- Node 20+
- OpenCode installed
- Auth file present at `~/.local/share/opencode/auth.json` with key:

```json
{
  "github-copilot": {
    "access": "<token>"
  }
}
```

## Global install (simple)

One command installs plugin + global config overrides:

```bash
npm run install:global
```

Or install directly from npm (after publish):

```bash
npx opencode-github-copilot-enterprise-profile
```

Alternative executable alias:

```bash
npx opencode-copilot-enterprise-install
```

This will:
- render models from Copilot `/models`
- install plugin loader in `~/.config/opencode/plugins/copilot-enterprise-profile.js`
- update `~/.config/opencode/opencode.json` with:
  - `share: "disabled"`
  - `disabled_providers: ["opencode"]`
  - `enabled_providers: ["github-copilot"]`
  - `provider.github-copilot.models` overrides
  - `model` and `small_model` derived from upstream model metadata
- persist `OPENCODE_DISABLE_MODELS_FETCH=true` in shell profiles

No extra manual config steps are needed after this.

Shell compatibility:
- macOS/Linux: writes to `~/.zshrc` and `~/.bashrc`
- Windows: writes PowerShell profile entries and attempts `setx OPENCODE_DISABLE_MODELS_FETCH true`

Windows note:
- Preferred runtime is WSL per OpenCode docs; run installer from your target environment (WSL vs native Windows) so config paths are correct.

## Usage

1. Render generated config from Copilot `/models`:

```bash
OPENCODE_DISABLE_MODELS_FETCH=true COPILOT_BASE_URL=https://api.githubcopilot.com npm run render-config
```

The generated config uses provider key `github-copilot` and only overrides `provider.github-copilot.models`.

2. Run OpenCode using generated config:

```bash
OPENCODE_DISABLE_MODELS_FETCH=true npm run run -- models
```

This wrapper injects generated config via `OPENCODE_CONFIG` and `OPENCODE_CONFIG_CONTENT` to ensure runtime overrides apply.

Optional strict/offline-ish flags:

```bash
OPENCODE_PROFILE_OFFLINE=true OPENCODE_DISABLE_DEFAULT_PLUGINS=true OPENCODE_DISABLE_MODELS_FETCH=true npm run run -- models
```

If needed in enterprise packaging:

```bash
OPENCODE_MODELS_URL=<local models index path or URL>
```

## Security behavior

- Token/auth redaction in logs.
- HTTPS-only upstream validation for model catalog fetch.
- Atomic cache writes with restricted permissions.
- No use of OpenAI-compatible `/v1/models` for full capability decisions.

## Thinking variant behavior

- The runtime inspects model capabilities from upstream `/models`.
- Variants are generated metadata-first from `capabilities.supports.reasoning_effort` (normalized to endpoint-compatible effort aliases).
- When metadata efforts are absent, compatibility fallbacks remain:
  - non-reasoning models -> no variants
  - `gemini*` -> no variants
  - `claude*` -> `thinking` variant (`thinking_budget: 4000`)
  - `gpt-5.1-codex-max`, `gpt-5.2*`, `gpt-5.3*` -> `low|medium|high|xhigh`
  - other `gpt-5*` reasoning models -> `low|medium|high`, plus `xhigh` when `release_date >= 2025-12-04`
- Effort variants use `reasoningEffort`, `reasoningSummary: "auto"`, and `include: ["reasoning.encrypted_content"]`.
- Variant overrides can disable specific variants with `disabled: true`; disabled variants are removed and the `disabled` key is stripped from final config payload.
- At request time, unsupported effort values are downgraded automatically.

## Tests

```bash
npm test
```

## TypeScript

- Source is fully TypeScript in `src/**/*.ts`, `scripts/**/*.ts`, and `test/**/*.ts`.
- Build output is emitted to `dist/` via `npm run build`.

## Release automation

- CI workflow: `.github/workflows/ci.yml` runs tests on push/PR.
- Release workflow: `.github/workflows/release.yml` publishes to npm on `v*` git tags.
