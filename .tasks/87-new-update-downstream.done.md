# Task 87 — Update `create-sweny`, plugin skills, README, docs for `sweny new`

## Goal

Sweep all downstream references from `sweny init` → `sweny new`. End state:
- `npx create-sweny` invokes `sweny new` (not `sweny init`).
- Claude Code plugin exposes a `new` skill (not `init` + separate
  `e2e-init` + separate `workflow-create`).
- README, CLAUDE.md, and the web docs all recommend `sweny new`.
- `sweny init` docs remain ONLY in a deprecation note.

## Prerequisites

Tasks 83, 84, 85, 86 complete — `sweny new` is the canonical command, its
picker includes custom + e2e, and it's idempotent.

## Working directory

All paths relative to `/Users/nate/src/swenyai/sweny` unless absolute.

## Changes

### 1. `create-sweny` package

File: `packages/create-sweny/src/index.ts`

Current:
```typescript
#!/usr/bin/env node
import { runInit } from "@sweny-ai/core/init";

runInit();
```

Change to:
```typescript
#!/usr/bin/env node
import { runNew } from "@sweny-ai/core/new";

runNew();
```

File: `packages/create-sweny/package.json`

The description says "thin wrapper around @sweny-ai/core init". Update to
"thin wrapper around @sweny-ai/core new".

Bump the version (patch bump is fine — the behavior is unchanged for end
users, but the import changed).

### 2. Plugin skills

Directory: `packages/plugin/skills/`

Current subdirs: `check`, `e2e-init`, `e2e-run`, `implement`, `init`,
`setup`, `triage`, `workflow-create`, `workflow-diagram`, `workflow-edit`,
`workflow-run`.

**Rename `init/` → `new/`:**
```bash
git mv packages/plugin/skills/init packages/plugin/skills/new
```

Read `packages/plugin/skills/new/SKILL.md` (the renamed file) and update any
mentions of `sweny init` / "initialize" / "setup wizard" to `sweny new` /
"create a workflow" / "workflow creation wizard". Preserve the skill's
description/frontmatter format. Match the tone and length of siblings like
`triage/SKILL.md` and `check/SKILL.md`.

**Delete `e2e-init/`:**
```bash
git rm -r packages/plugin/skills/e2e-init
```
Users should reach e2e setup via the unified `new` skill now.

**Delete `workflow-create/`:**
```bash
git rm -r packages/plugin/skills/workflow-create
```
Users should reach AI workflow generation via the unified `new` skill now.

**Check `packages/plugin/.claude-plugin/plugin.json`** (or wherever the plugin
manifest is — grep for the file) and remove references to `init`,
`e2e-init`, and `workflow-create`. Add `new` if they're enumerated.

Verify with:
```bash
grep -rn "init\|e2e-init\|workflow-create" packages/plugin/
```
Only remaining matches should be in SKILL.md bodies where the old names are
mentioned in prose (update those too).

### 3. README.md

File: `/Users/nate/src/swenyai/sweny/README.md`

Grep for `sweny init`:
```bash
grep -n "sweny init\|@sweny-ai/core init" README.md
```

Replace each occurrence:
- `sweny init` → `sweny new`
- `npx @sweny-ai/core init` → `npx @sweny-ai/core new`
- `npx create-sweny` — unchanged (still works, still the recommended entry
  for new repos)

Near the quickstart, add a one-line note:
> Already have `.sweny.yml`? `sweny new` adds additional workflows
> non-destructively.

### 4. CLAUDE.md

File: `/Users/nate/src/swenyai/sweny/CLAUDE.md`

Grep and update references to `sweny init`. There's likely a table or
command list — keep formatting consistent.

### 5. Web docs

Directory: `packages/web/src/content/docs/`

Files to check (grep output from earlier analysis):
- `packages/web/src/content/docs/cli/index.md`
- `packages/web/src/content/docs/cli/commands.md`
- `packages/web/src/content/docs/advanced/mcp-plugin.md`
- `packages/web/src/content/docs/studio/embedding.md` (probably unrelated,
  just came up in grep — verify)

For each file, grep for `sweny init` and replace with `sweny new`. Update
any narrative text about initialization to describe the new semantics
(creation, not setup). If the docs have a dedicated "sweny init" command
page, rename it to "sweny new" (`git mv`) and update cross-references.

### 6. `env.example` and similar

File: `.env.example`

Grep showed it references `sweny init`. Update to `sweny new`.

Also check `CHANGELOG.md` — that's historical, so DO NOT retroactively
rewrite past entries. The next release adds a new entry via changesets —
leave old entries untouched.

### 7. MCP package README

File: `packages/mcp/README.md`

Grep for `sweny init` and update.

### 8. `.tasks/` and `tasks/` and `docs/` historical

DO NOT touch:
- `.tasks/*.done.md` — historical record
- `docs/tasks/*.done.md` — historical record
- `docs/superpowers/plans/*.md` — historical plans
- `docs/superpowers/specs/*.md` — historical specs

These are a record of past work and should stay accurate to the time they
were written.

## Verification

From the repo root:
```bash
grep -rn "sweny init" \
  --include="*.md" \
  --include="*.ts" \
  --include="*.json" \
  --exclude-dir=node_modules \
  --exclude-dir=dist \
  --exclude-dir=.tasks \
  --exclude-dir=tasks \
  --exclude-dir=docs/superpowers \
  --exclude-dir=docs/tasks \
  --exclude=CHANGELOG.md
```

Expected: matches ONLY in:
- `packages/core/src/cli/main.ts` — the deprecation alias registration
- `packages/core/src/cli/new.ts` — possibly in comments or the re-export alias
- Error messages or deprecation notices

Nothing in README.md, CLAUDE.md, web docs, or user-facing material.

```bash
cd packages/core && npm run build
cd ../create-sweny && npm run build
cd ../plugin && npm run build 2>&1 || echo "plugin may not have build step"
cd ../..
```

Test `npx create-sweny` flow:
```bash
cd /tmp && rm -rf sweny-create-test && mkdir sweny-create-test && cd sweny-create-test && git init
node /Users/nate/src/swenyai/sweny/packages/create-sweny/dist/index.js
# Should drop into the `sweny new` picker
```

## Changeset

Create `.changeset/downstream-new-rename.md`:
```markdown
---
"create-sweny": patch
"@sweny-ai/core": patch
---

Update `create-sweny` to invoke `sweny new` (was `sweny init`). Plugin skill
`init` renamed to `new`; `e2e-init` and `workflow-create` skills removed in
favor of the unified `new` skill. Docs updated.
```

## Commit

```
docs: update downstream references init → new

Sweep create-sweny, plugin skills, README, CLAUDE.md, and web docs to
recommend `sweny new`. Plugin skills `e2e-init` and `workflow-create`
removed in favor of the unified `new` skill.
```

## Non-goals

- Do NOT touch historical task files, plan docs, or CHANGELOG entries.
- Do NOT remove `sweny init` command — it's still a deprecated alias.
