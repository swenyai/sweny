# Task: Document File Observability, OpenAI Codex, and Google Gemini Providers

## Why

Three providers were added to the codebase but are not yet documented on the docs site:

| Provider | Source file | Doc status |
|----------|------------|------------|
| File observability | `packages/providers/src/observability/file.ts` | **Missing** |
| OpenAI Codex | `packages/providers/src/coding-agent/openai-codex.ts` | **Missing** |
| Google Gemini | `packages/providers/src/coding-agent/google-gemini.ts` | **Missing** |

The docs site is an Astro/Starlight site at `packages/web/`. Provider reference pages
live in `packages/web/src/content/docs/providers/`. The sidebar is configured in
`packages/web/astro.config.mjs` (Provider Reference section uses `autogenerate`, so new
`.md` files in the `providers/` directory appear automatically).

Deployment is via GitHub Pages on push to `main` (`.github/workflows/deploy-web.yml`).

---

## Files to edit

1. `packages/web/src/content/docs/providers/observability.md` — add File section
2. `packages/web/src/content/docs/providers/coding-agent.md` — add Codex and Gemini sections

---

## Step 1 — `observability.md`: Add File provider section

Open `packages/web/src/content/docs/providers/observability.md` and add a new section
for the File provider. Place it at the end of the file, after the last existing
provider section.

### Section to add

````markdown
## File

Reads log entries from a local JSON file. Useful for:
- CI workflows that export logs to disk before running triage
- Testing triage against captured production log snapshots
- Offline or air-gapped environments

```typescript
const provider = file({ path: "./logs/errors.json" });
```

### Log file format

The file must contain either a JSON array of entries or a `{ "logs": [...] }` wrapper:

```json
[
  {
    "timestamp": "2024-01-15T10:30:00Z",
    "service": "api",
    "level": "error",
    "message": "NullPointerException in WebhookHandler.process()",
    "attributes": { "trace_id": "abc123" }
  }
]
```

Required fields per entry: `timestamp`, `service`, `level`, `message`.
`attributes` is optional.

### GitHub Action usage

```yaml
- name: Export recent errors
  run: ./scripts/export-logs.sh > /tmp/logs.json

- uses: swenyai/sweny@main
  with:
    observability-provider: file
    log-file-path: /tmp/logs.json
```

### CLI usage

```yaml
# .sweny.yml
observability-provider: file
log-file: ./logs/errors.json
```

```bash
sweny triage --observability-provider file --log-file ./logs/errors.json
```
````

---

## Step 2 — `coding-agent.md`: Add OpenAI Codex section

Open `packages/web/src/content/docs/providers/coding-agent.md`. Check whether an
OpenAI Codex section already exists. If not, add it after the Claude section.

### Section to add

````markdown
## OpenAI Codex

Uses [OpenAI Codex CLI](https://github.com/openai/codex) to implement fixes. Requires
an OpenAI API key.

```typescript
const agent = openaiCodex({ logger: myLogger });
```

The factory accepts `{ logger? }`. The `OPENAI_API_KEY` environment variable must be
set in the agent's environment.

### GitHub Action

```yaml
- uses: swenyai/sweny@main
  with:
    coding-agent-provider: codex
    openai-api-key: ${{ secrets.OPENAI_API_KEY }}
    observability-provider: datadog
    dd-api-key: ${{ secrets.DD_API_KEY }}
    dd-app-key: ${{ secrets.DD_APP_KEY }}
```

### CLI

```yaml
# .sweny.yml
coding-agent-provider: codex
```

```bash
OPENAI_API_KEY=sk-... sweny triage
```

### Installation

The Codex CLI is installed automatically on first run via `agent.install()`. No
pre-installation is required.
````

---

## Step 3 — `coding-agent.md`: Add Google Gemini section

Add a Gemini section after the OpenAI Codex section.

### Section to add

````markdown
## Google Gemini

Uses [Gemini CLI](https://github.com/google-gemini/gemini-cli) to implement fixes.
Requires a Gemini API key.

```typescript
const agent = googleGemini({ logger: myLogger });
```

The factory accepts `{ logger? }`. The `GEMINI_API_KEY` environment variable must be
set in the agent's environment.

### GitHub Action

```yaml
- uses: swenyai/sweny@main
  with:
    coding-agent-provider: gemini
    gemini-api-key: ${{ secrets.GEMINI_API_KEY }}
    observability-provider: datadog
    dd-api-key: ${{ secrets.DD_API_KEY }}
    dd-app-key: ${{ secrets.DD_APP_KEY }}
```

### CLI

```yaml
# .sweny.yml
coding-agent-provider: gemini
```

```bash
GEMINI_API_KEY=... sweny triage
```

### Installation

The Gemini CLI is installed automatically on first run via `agent.install()`. No
pre-installation is required.
````

---

## Step 4 — Verify import examples use correct scope

Both files should use `@sweny-ai/providers/...` (not the old `@swenyai/...`). Grep for
`@swenyai` in the two files and fix any occurrences:

```bash
grep '@swenyai' packages/web/src/content/docs/providers/observability.md
grep '@swenyai' packages/web/src/content/docs/providers/coding-agent.md
```

The correct import in code examples:
```typescript
import { file } from "@sweny-ai/providers/observability";
import { openaiCodex, googleGemini } from "@sweny-ai/providers/coding-agent";
```

---

## Step 5 — Update `action/inputs.md` if needed

Check `packages/web/src/content/docs/action/inputs.md` for the observability provider
list and the coding agent section. If `file` is not listed as a valid
`observability-provider` value, add it. If `codex` and `gemini` are not listed as
valid `coding-agent-provider` values, add them.

After the two action tasks (`.tasks/action-coding-agent-provider.todo.md` and
`.tasks/action-file-observability.todo.md`) are completed, `action/inputs.md` should
reflect the new inputs (`coding-agent-provider`, `openai-api-key`, `gemini-api-key`,
`log-file-path`).

---

## How to preview changes locally

```bash
cd packages/web
npm run dev
```

Then open `http://localhost:4321` in a browser. Navigate to Provider Reference →
Observability and Provider Reference → Coding Agent to verify the new sections render
correctly.

---

## How changes deploy

On merge to `main`, GitHub Actions runs `.github/workflows/deploy-web.yml`, which:
1. Runs `npm run build --workspace=packages/web`
2. Uploads `packages/web/dist` as a Pages artifact
3. Deploys to GitHub Pages

No manual deploy step is needed.

---

## Reference: existing provider section format

Look at any existing section in `observability.md` (e.g., the Datadog section) to
match the heading level, code block style, and content structure. All sections use
`##` for the provider name and include: factory call, config options, and a usage
example.
