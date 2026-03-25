# GitHub Copilot Enterprise OpenCode Profile

Privacy-first OpenCode plugin and config renderer for enterprise Copilot environments.

## Guarantees in this profile

- OpenCode share is disabled in generated config.
- `disabled_providers` contains only `opencode`.
- Models are sourced from upstream Copilot `GET /models` (authoritative metadata source).
- `OPENCODE_DISABLE_MODELS_FETCH=true` is treated as mandatory for startup scripts.
- Thinking variants are derived from Copilot capabilities, prioritizing:
  - `capabilities.supports.max_thinking_budget`
  - `capabilities.supports.min_thinking_budget`
  - `capabilities.supports.adaptive_thinking`

## Why this exists

In corporate/proxy environments, `models.dev` is often unavailable. This profile avoids dependency on it and derives model metadata from Copilot upstream API directly.

From issue #10416 discussion, this profile also incorporates practical hardening:

- Keep `disabled_providers: ["opencode"]` explicit.
- Require OpenCode `>=1.1.36` for more reliable behavior around models fetch disable logic.
- Support `OPENCODE_MODELS_URL` if your environment requires a local models index override.
- Optionally set `OPENCODE_DISABLE_DEFAULT_PLUGINS=true` for tighter offline startup control.

## Files

- Generated runtime config: `.opencode/runtime/opencode.generated.json`
- Local plugin loader: `.opencode/plugins/copilot-enterprise.js`
- Runtime config renderer: `scripts/render-config.js`
- OpenCode launcher wrapper: `scripts/run-opencode.js`

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

This will:
- render models from Copilot `/models`
- install plugin loader in `~/.config/opencode/plugins/copilot-enterprise-profile.js`
- update `~/.config/opencode/opencode.json` with:
  - `share: "disabled"`
  - `disabled_providers: ["opencode"]`
  - `enabled_providers: ["github-copilot"]`
  - `provider.github-copilot.models` overrides
  - `model` and `small_model`
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
OPENCODE_DISABLE_MODELS_FETCH=true COPILOT_BASE_URL=https://api.githubcopilot.com node scripts/render-config.js
```

The generated config uses provider key `github-copilot` and only overrides `provider.github-copilot.models`.

2. Run OpenCode using generated config:

```bash
OPENCODE_DISABLE_MODELS_FETCH=true node scripts/run-opencode.js
```

This wrapper injects generated config via `OPENCODE_CONFIG` and `OPENCODE_CONFIG_CONTENT` to ensure runtime overrides apply.

Optional strict/offline-ish flags:

```bash
OPENCODE_PROFILE_OFFLINE=true OPENCODE_DISABLE_DEFAULT_PLUGINS=true OPENCODE_DISABLE_MODELS_FETCH=true node scripts/run-opencode.js
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
- If `capabilities.supports.adaptive_thinking` is present, messages-style effort (`low|medium|high|max`) is preferred.
- If min/max thinking budgets are present, generated variants are budget-aware.
- If explicit effort levels are exposed by upstream metadata, those are used directly.
- At request time, unsupported effort values are downgraded automatically.

## Tests

```bash
npm test
```

## Release automation

- CI workflow: `.github/workflows/ci.yml` runs tests on push/PR.
- Release workflow: `.github/workflows/release.yml` publishes to npm on `v*` git tags.
