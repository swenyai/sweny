# SWEny Cleanup & Release

**Date:** 2026-03-26
**Status:** Approved
**Goal:** Remove deprecated packages, migrate action+CLI to core, replace changesets with auto-release, ship everything.

## Context

SWEny's codebase was overhauled: `@sweny-ai/core` (skills + DAG executor powered by headless Claude Code) replaces the old `@sweny-ai/engine` + `@sweny-ai/providers` architecture — 24K lines reduced to 3K. However, the GitHub Action and CLI still import from the deprecated packages. The marketplace action is running dead code. Nothing has been released since the overhaul.

Additionally, the project uses Changesets for versioning, which adds manual overhead (creating changeset files, version PRs). The release pipeline should be fully automated with zero human intervention.

## Architecture After This Work

```
packages/
  core/             → @sweny-ai/core (npm)
    src/
      skills/         — tool definitions (github, linear, sentry, datadog, slack, betterstack, notification)
      workflows/      — DAG definitions (triage, implement)
      executor.ts     — walk DAG, run Claude at each node
      claude.ts       — headless Claude Code client
      schema.ts       — workflow validation, JSON schema export
      studio.ts       — React Flow conversion helpers (workflowToFlow, flowToWorkflow)
      testing.ts      — MockClaude, file skill for tests
      mcp.ts          — auto-inject MCP servers from config (shared by CLI + action)
    src/cli/
      main.ts         — commander setup, sweny command (init, check, triage, implement, workflow)
      config.ts       — CLI flag parsing, .sweny.yml loading
      output.ts       — terminal formatting (banners, step results, spinners)
      renderer.ts     — DAG visualization + execution animation (box-drawing, chalk)
    package.json
      bin: { "sweny": "./dist/cli/main.js" }
      exports: ".", "./browser", "./studio", "./skills", "./workflows", "./testing", "./schema"

  studio/           → @sweny-ai/studio (npm)
    — React Flow DAG visualization/editor
    — peerDependency: @sweny-ai/core

  action/           → GitHub Action (private, NCC-bundled)
    — imports from @sweny-ai/core
    — maps action.yml inputs → core execute() config
    — NCC bundles everything into dist/index.js

  web/              → docs site (private)
```

### Killed Packages

| Package | Disposition |
|---------|-------------|
| `packages/engine` | Delete from repo. Run `npm deprecate @sweny-ai/engine "Replaced by @sweny-ai/core"` on existing latest version. |
| `packages/providers` | Delete from repo. Run `npm deprecate @sweny-ai/providers "Replaced by @sweny-ai/core"` on existing latest version. |
| `packages/agent` | Delete from repo. Run `npm deprecate @sweny-ai/agent "Replaced by @sweny-ai/core"` on existing latest version. |
| `packages/cli` | Code moves to `packages/core/src/cli/`. Delete package dir. Run `npm deprecate @sweny-ai/cli "Use @sweny-ai/core instead"`. |

## Action Migration

### Before (engine + providers)

```ts
import { runWorkflow, triageWorkflow, implementWorkflow } from "@sweny-ai/engine"
import type { TriageConfig, ImplementConfig } from "@sweny-ai/engine"
import { createProviderRegistry } from "./providers"

const providers = createProviderRegistry(config)
const result = await runWorkflow(triageWorkflow, triageConfig, providers, runOptions)
```

### After (core)

```ts
import { execute, ClaudeClient, createSkillMap, isSkillConfigured } from "@sweny-ai/core"
import { triageWorkflow, implementWorkflow } from "@sweny-ai/core/workflows"
import { github, linear, sentry, datadog, slack, betterstack, notification } from "@sweny-ai/core/skills"
import { buildAutoMcpServers } from "@sweny-ai/core"

// Build skill map from configured skills
const skills = createSkillMap(
  [github, linear, sentry, datadog, slack, betterstack, notification]
    .filter(skill => isSkillConfigured(skill))
)

// Create Claude client
const claude = new ClaudeClient({ maxTurns: 50, cwd: process.cwd() })

// Execute workflow
const results = await execute(workflow, input, {
  skills,
  claude,
  config: { GITHUB_TOKEN: config.githubToken, DD_API_KEY: config.ddKey, ... },
  observer: (event) => core.setOutput(...),
})

// Extract outputs
const issue = results.get("create_issue")?.data
const pr = results.get("create_pr")?.data
```

### What changes

- `packages/action/src/providers/` (entire directory) — **delete**. Replaced by `createSkillMap()` + `isSkillConfigured()`.
- `packages/action/src/main.ts` — rewrite workflow execution to use `execute()`. The `mapToTriageConfig()` and `mapToImplementConfig()` functions (~200 lines) collapse into a single config builder.
- `packages/action/src/config.ts` — update types, remove engine/provider references.
- `packages/action/package.json` — dependency changes: remove `@sweny-ai/engine` + `@sweny-ai/providers`, add `@sweny-ai/core`.
- Action tests update imports accordingly.

### What stays the same

- `action.yml` — all inputs and outputs remain identical. No breaking change for consumers.
- Config parsing logic — still maps action inputs to a config object.
- NCC bundling — still produces `dist/index.js`.

## CLI Folding Into Core

### Source migration

The CLI source (~6K lines across 8 files) moves from `packages/cli/src/` to `packages/core/src/cli/`. File-by-file:

| File | Change |
|------|--------|
| `main.ts` | Update imports from `@sweny-ai/engine` → `../src/`. Replace `runWorkflow()` → `execute()`. Replace provider registry setup → `createSkillMap()`. |
| `config.ts` | Update types. Remove engine/provider type imports. |
| `config-file.ts` | No changes (pure YAML/env parsing). |
| `output.ts` | No changes (pure terminal formatting). |
| `check.ts` | No changes (raw fetch connectivity checks). |
| `setup.ts` | No changes (label creation). |
| `cache.ts` | Update if engine caching API changed. |
| `providers/index.ts` | **Delete**. Replaced by `createSkillMap()` + `isSkillConfigured()`. |

### New: renderer.ts — DAG terminal visualization

Subscribes to core's `ExecutionEvent` stream. Renders the workflow DAG using box-drawing characters. Animates node state transitions:

```
  ┌─────────────┐     ┌──────────────┐     ┌─────────────┐
  │ ● gather    │────▶│ ◉ investigate│────▶│ ○ create    │
  │   context   │     │              │     │   issue     │
  └─────────────┘     └──────────────┘     └──────┬──────┘
                                                  │
                                            ┌─────▼──────┐
                                            │ ○ notify   │
                                            └────────────┘
  ● completed  ◉ running  ○ pending
```

- Uses `chalk` for colors (green/yellow/gray for completed/running/pending)
- Cursor manipulation for in-place updates (no screen clearing)
- Falls back to simple list view if terminal width is too narrow
- Node boxes show: status icon, node ID, elapsed time when running, tool call count when complete

### MCP auto-injection → shared in core

The MCP auto-injection logic (~170 lines) currently duplicated between CLI and action moves to `packages/core/src/mcp.ts`:

```ts
export function buildAutoMcpServers(config: Record<string, string>): McpServerConfig[]
```

Both CLI and action call this function. Logic:
- Category A: infer from configured skills (GitHub token → GitHub MCP, Linear key → Linear MCP, Sentry token → Sentry MCP)
- Category B: workspace tools opt-in (Slack, Notion, PagerDuty)
- HTTP transport preferred, stdio fallback for official vendor MCPs
- User-provided MCP config wins on conflicts

### Package.json changes

```json
{
  "name": "@sweny-ai/core",
  "bin": {
    "sweny": "./dist/cli/main.js"
  },
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "^0.2.84",
    "zod": "^4.0.0",
    "chalk": "^5",
    "commander": "^13",
    "yaml": "^2"
  }
}
```

CLI deps (`chalk`, `commander`, `yaml`) become core dependencies. This is acceptable — they're small, well-maintained, and the CLI is a first-class entry point.

### Usage after migration

```bash
# Install globally
npm install -g @sweny-ai/core
sweny triage --datadog --linear --slack

# Or npx
npx @sweny-ai/core triage --datadog --linear --slack

# Or in a project
npx sweny triage
```

## Auto-Release Workflow

### Replace changesets entirely

Delete:
- `.changeset/` directory (config.json, README.md, all pending changeset files)
- `scripts/auto-changeset.mjs`
- All references to `npx changeset` in workflows

### New unified release.yml

```yaml
name: Release

on:
  push:
    branches: [main]

concurrency:
  group: release
  cancel-in-progress: false

jobs:
  release:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      id-token: write

    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0
          token: ${{ secrets.GH_PAT || github.token }}

      - uses: actions/setup-node@v6
        with:
          node-version: 22
          registry-url: https://registry.npmjs.org
          cache: npm

      - run: npm ci

      - name: Build
        run: |
          npm run build --workspace=packages/core
          npm run build:lib --workspace=packages/studio

      - name: Test
        run: npm run test

      - name: Configure git
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"

      - name: Detect changes and publish
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
        run: |
          LAST_TAG=$(git describe --tags --abbrev=0 --match 'release-*' 2>/dev/null || echo "")
          DIFF_BASE=${LAST_TAG:-$(git rev-list --max-parents=0 HEAD)}

          CHANGED_CORE=$(git diff --name-only "$DIFF_BASE"..HEAD -- packages/core/ | head -1)
          CHANGED_STUDIO=$(git diff --name-only "$DIFF_BASE"..HEAD -- packages/studio/ | head -1)

          PUBLISHED=false

          if [ -n "$CHANGED_CORE" ]; then
            cd packages/core
            CURRENT=$(node -p "require('./package.json').version")
            NEXT=$(echo "$CURRENT" | awk -F. '{$NF=$NF+1; print}' OFS=.)
            npm version "$NEXT" --no-git-tag-version
            npm publish
            cd ../..
            PUBLISHED=true
            echo "Published @sweny-ai/core@$NEXT"
          fi

          if [ -n "$CHANGED_STUDIO" ]; then
            cd packages/studio
            CURRENT=$(node -p "require('./package.json').version")
            NEXT=$(echo "$CURRENT" | awk -F. '{$NF=$NF+1; print}' OFS=.)
            npm version "$NEXT" --no-git-tag-version
            npm publish
            cd ../..
            PUBLISHED=true
            echo "Published @sweny-ai/studio@$NEXT"
          fi

          if [ "$PUBLISHED" = true ]; then
            git add -A
            git commit -m "chore: release packages [skip ci]"
            git push
          fi

      - name: Rebuild action dist and tag
        run: |
          npm run package --workspace=packages/action
          git add dist/
          if ! git diff --cached --quiet; then
            git commit -m "chore: rebuild action dist [skip ci]"
            git push
          fi

          # Floating v3 tag
          git tag -f v3
          git push origin v3 --force

          # Immutable version tag from core
          CORE_VERSION=$(node -p "require('./packages/core/package.json').version")
          VERSIONED_TAG="v3.${CORE_VERSION}"
          if git tag "$VERSIONED_TAG" 2>/dev/null; then
            git push origin "$VERSIONED_TAG"
            echo "Pushed $VERSIONED_TAG"
          fi

          # Release marker for next diff
          git tag -f "release-latest"
          git push origin "release-latest" --force
```

### Deleted workflows

| Workflow | Why |
|----------|-----|
| `release-engine.yml` | Engine package deleted |
| `release-providers.yml` | Providers package deleted |
| `release-agent.yml` | Agent package deleted |
| `release-cli.yml` | CLI folded into core |
| `release-action.yml` | Unified into main release.yml |

### Version bump rules

- **Patch**: automatic on every push to main that changes a published package
- **Minor/Major**: manually edit `version` in the package's `package.json` before merging. The workflow compares the local version against the last published npm version — if local is already ahead, it publishes as-is without auto-bumping.

## CI Workflow Updates

Update `ci.yml` build step:

```yaml
- name: Build packages
  run: |
    npm run build --workspace=packages/core
    npm run build:lib --workspace=packages/studio
```

Remove references to engine, providers, cli workspaces.

## Testing

- **Core tests**: already pass, no changes needed
- **CLI tests**: 10 test files migrate with the code, update imports from `@sweny-ai/engine` → relative core imports
- **Action tests**: 4 test files (157 tests) update imports, remove provider factory tests, add skill map tests
- **Studio tests**: no changes (already uses core)
- **CI matrix**: lint, format, typecheck, test on Node 20 + 22 (unchanged)

## Scope Boundaries

**In scope:**
- Delete engine, providers, agent, cli packages
- Migrate action imports to core
- Move CLI code into core with bin entry
- Add DAG terminal renderer
- Move MCP auto-injection to core
- Replace changesets with auto-release
- Update CI workflows
- Publish final deprecation versions of killed packages
- Publish first release of @sweny-ai/core

**Out of scope:**
- New skills or workflow changes
- Studio feature work
- Documentation site updates (beyond removing dead package references)
- Adding new observability providers to core
