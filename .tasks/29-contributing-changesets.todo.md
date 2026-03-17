# Task 29 — CONTRIBUTING.md: document the changesets release workflow

## Goal

`CONTRIBUTING.md` tells contributors how to set up, build, test, and submit PRs
— but it says nothing about changesets. Any contributor who modifies a published
package and submits a PR will get a CI failure because no changeset was created.
They'll have no idea why.

Add a "Releasing changes" section to `CONTRIBUTING.md` that explains:
- What changesets are and why we use them
- When a changeset is required
- How to create one (copy-paste commands + example file)
- Bump level rules (patch/minor/major)

## Context

### What changesets are (for your reference)

Changesets is a versioning tool. Instead of manually bumping `package.json`
versions, contributors add small markdown "changeset" files describing their
change. A GitHub Action then reads these files, bumps versions, and publishes
to npm automatically.

### Published packages (these require a changeset when modified)

| Package dir | npm package |
|-------------|-------------|
| `packages/engine` | `@sweny-ai/engine` |
| `packages/cli` | `@sweny-ai/cli` |
| `packages/studio` | `@sweny-ai/studio` |
| `packages/providers` | `@sweny-ai/providers` |
| `packages/agent` | `@sweny-ai/agent` |

**Private packages (no changeset needed):**
- `packages/web` — docs site, not published
- `packages/action` — GitHub Action, not published to npm

### How to create a changeset

```bash
# From the repo root, create the file manually:
cat > .changeset/my-feature-name.md << 'EOF'
---
"@sweny-ai/engine": minor
---

Brief description of what changed and why — written for package consumers.
EOF
```

Or use the CLI:
```bash
npx changeset
```

### Bump level rules

- `patch` — bug fix, internal refactor, docs, performance improvement
- `minor` — new feature, new export, new option (backwards compatible)
- `major` — breaking change (removed export, changed function signature, renamed type)

### When you can omit a changeset

- Changes only to `packages/web` or `packages/action`
- CI/workflow-only changes (`.github/`, `scripts/`)
- Root-level config/doc changes
- Changesets CI auto-generates a fallback for any published package with unreleased
  commits but no pending changeset — but the description will be generic,
  so prefer writing your own

### Example changeset file

```md
---
"@sweny-ai/engine": minor
"@sweny-ai/cli": patch
---

Add `timeout` option to step definitions. Update CLI to pass timeout through
to the engine runner. Existing workflows without a timeout are unaffected.
```

### Where to insert in CONTRIBUTING.md

Read `CONTRIBUTING.md` first. The file currently ends with a "Pull requests"
section. Add the new "Releasing changes" section **after** "Pull requests" and
**before** the end of the file. If there's already a CHANGELOG mention in
"Pull requests", that sentence can be updated to reference changesets instead.

The current "Pull requests" section ends with:
> - Update the CHANGELOG if modifying published packages

Change that line to:
> - Create a changeset file if modifying published packages (see **Releasing changes** below)

## What to write

Add to `CONTRIBUTING.md` (after the Pull requests section):

```markdown
## Releasing changes

This project uses [Changesets](https://github.com/changesets/changesets) for
automated versioning and npm publishing. When you modify a published package,
you must include a changeset file in your PR.

### When a changeset is required

Any PR that modifies source files in a published package:
`packages/engine`, `packages/cli`, `packages/studio`, `packages/providers`, `packages/agent`.

You can skip a changeset for:
- Changes to `packages/web` or `packages/action` (private, not published)
- CI/workflow-only changes (`.github/`, `scripts/`)
- Root-level config or doc changes

### Creating a changeset

Create a file at `.changeset/<descriptive-slug>.md`:

\`\`\`md
---
"@sweny-ai/engine": minor
"@sweny-ai/cli": patch
---

Brief description of what changed and why — written for package consumers.
\`\`\`

Or run `npx changeset` for an interactive prompt.

### Bump levels

| Level | When to use |
|-------|-------------|
| `patch` | Bug fix, internal refactor, docs, perf improvement |
| `minor` | New feature, new export, new option (backwards compatible) |
| `major` | Breaking change — removed export, changed function signature, renamed type |

### Release flow

After your PR merges to `main`, the Changesets GitHub Action opens a
"chore: release packages" PR that shows the computed version bumps.
Merging that PR publishes to npm automatically.
```

## Done when

- [ ] "Releasing changes" section added to `CONTRIBUTING.md` after "Pull requests"
- [ ] Bullet in "Pull requests" section updated to reference changesets
- [ ] Section covers: when required, how to create, bump levels, release flow
- [ ] Copy-paste example changeset file is included in the section
- [ ] No changeset needed for this PR (CONTRIBUTING.md is not a published package)
