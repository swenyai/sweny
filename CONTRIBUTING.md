# Contributing to SWEny

## Prerequisites

- Node.js >= 22 (`nvm use 22`)
- npm (ships with Node)

## Setup

```bash
git clone https://github.com/swenyai/sweny.git
cd sweny
npm install
```

## Build order

Packages must be built in dependency order:

```
providers → engine → cli → agent → action
```

```bash
# Build all
npm run build

# Or individually
npm run build --workspace=packages/providers
npm run build --workspace=packages/engine
npm run build --workspace=packages/cli
npm run build --workspace=packages/agent
npm run build --workspace=packages/action
```

## Testing

```bash
# All packages
npm test

# Individual
npm test --workspace=packages/engine
npm test --workspace=packages/providers
npm test --workspace=packages/agent
npm test --workspace=packages/action
```

## Running the CLI locally

The CLI auto-loads `.env` and `.sweny.yml` from your working directory:

```bash
# Create a config file (if you don't have one)
npx tsx packages/cli/src/main.ts init

# Run a dry-run triage
npx tsx packages/cli/src/main.ts triage --dry-run
```

For quick iteration, step caching replays completed steps on re-run:

```bash
# First run populates cache (~3 min for investigate)
npx tsx packages/cli/src/main.ts triage --dry-run

# Second run replays from cache (~0s)
npx tsx packages/cli/src/main.ts triage --dry-run

# Force fresh execution
npx tsx packages/cli/src/main.ts triage --dry-run --no-cache
```

## Adding a new provider

1. Create your implementation in `packages/providers/src/<category>/`:
   - Define a Zod config schema
   - Export a factory function (e.g., `export function myProvider(config: MyConfig): ProviderInterface`)
   - Follow the existing pattern — see `packages/providers/src/observability/datadog.ts` for reference
2. Re-export from the category's `index.ts`
3. Add to the root barrel export in `packages/providers/src/index.ts`
4. Add tests in `packages/providers/tests/`
5. Update `packages/providers/README.md`

## Pull requests

- Branch from `main`
- Run `npm run typecheck` and `npm test` before submitting
- Keep PRs focused — one feature or fix per PR
- Create a changeset if modifying published packages (see **Releasing changes** below)

## Releasing changes

This project uses [Changesets](https://github.com/changesets/changesets) for
automated versioning and npm publishing. When you modify a published package,
include a changeset file in your PR — CI will fail without one.

### When a changeset is required

Any PR that modifies source files in a published package:

| Package dir | npm name |
|-------------|----------|
| `packages/engine` | `@sweny-ai/engine` |
| `packages/cli` | `@sweny-ai/cli` |
| `packages/studio` | `@sweny-ai/studio` |
| `packages/providers` | `@sweny-ai/providers` |
| `packages/agent` | `@sweny-ai/agent` |

You can skip a changeset for:

- Changes to `packages/web` or `packages/action` (private, not published to npm)
- CI/workflow-only changes (`.github/`, `scripts/`)
- Root-level config, docs, or task files

### Creating a changeset

Create a file at `.changeset/<descriptive-slug>.md`:

```md
---
"@sweny-ai/engine": minor
"@sweny-ai/cli": patch
---

Brief description of what changed and why — written for package consumers.
```

Or use the interactive CLI:

```bash
npx changeset
```

### Bump levels

| Level | When to use |
|-------|-------------|
| `patch` | Bug fix, internal refactor, docs, performance improvement |
| `minor` | New feature, new export, new option (backwards compatible) |
| `major` | Breaking change — removed export, changed function signature, renamed type |

### Release flow

After your PR merges to `main`, the Changesets GitHub Action opens a
"chore: release packages" PR that shows the computed version bumps. Merging
that PR publishes all changed packages to npm automatically.
