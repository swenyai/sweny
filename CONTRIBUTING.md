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

## Build

`npm run build` builds every workspace; npm resolves the dependency order.

```bash
# Build everything
npm run build

# Or a single package
npm run build --workspace=packages/core
```

## Testing

```bash
# All packages
npm test

# A single package
npm test --workspace=packages/core
npm test --workspace=packages/studio

# A single test file
npx vitest run packages/core/src/skills/linear.test.ts
```

## Running the CLI locally

The CLI auto-loads `.env` and `.sweny.yml` from your working directory:

```bash
# Create a config file (if you don't have one)
npx tsx packages/core/src/cli/main.ts init

# Run a dry-run triage
npx tsx packages/core/src/cli/main.ts triage --dry-run
```

For quick iteration, step caching replays completed steps on re-run:

```bash
# First run populates cache (~3 min for investigate)
npx tsx packages/core/src/cli/main.ts triage --dry-run

# Second run replays from cache (~0s)
npx tsx packages/core/src/cli/main.ts triage --dry-run

# Force fresh execution
npx tsx packages/core/src/cli/main.ts triage --dry-run --no-cache
```

## Adding a new skill

Built-in skills live in `packages/core/src/skills/`.

1. Create `packages/core/src/skills/<name>.ts`. Export a `Skill` object with
   `id`, `name`, `description`, `category`, `config`, and `tools`. Follow an
   existing skill; `packages/core/src/skills/linear.ts` is a good reference.
2. Register it in `packages/core/src/skills/index.ts`: add the import, append
   it to the `builtinSkills` array, and add it to the `export { ... }` line.
3. Add a co-located test: `packages/core/src/skills/<name>.test.ts`.

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
| `packages/core` | `@sweny-ai/core` |
| `packages/studio` | `@sweny-ai/studio` |
| `packages/mcp` | `@sweny-ai/mcp` |
| `packages/create-sweny` | `create-sweny` |

You can skip a changeset for:

- Changes to `packages/web`, `packages/action`, or `packages/plugin` (not published to npm)
- CI/workflow-only changes (`.github/`, `scripts/`)
- Root-level config, docs, or task files

### Creating a changeset

Create a file at `.changeset/<descriptive-slug>.md`:

```md
---
"@sweny-ai/core": minor
---

Brief description of what changed and why, written for package consumers.
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
