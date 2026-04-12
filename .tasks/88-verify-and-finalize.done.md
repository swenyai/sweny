# Task 88 — Verify and finalize the `init → new` migration

## Goal

Run the full verification matrix, fix any remaining issues, and produce a
final state ready to ship.

## Prerequisites

Tasks 83-87 complete.

## Working directory

`/Users/nate/src/swenyai/sweny`

## Steps

### 1. Typecheck everything

```bash
cd packages/core && npm run typecheck
cd ../create-sweny && npx tsc --noEmit 2>&1 || true
cd ../..
```

Fix any type errors before continuing.

### 2. Run full test suites

```bash
cd packages/core && npm test
cd ../..
```

All tests must pass. If anything fails, investigate root cause — don't skip
or mark as expected-fail.

### 3. Build all affected packages

```bash
cd packages/core && npm run build
cd ../create-sweny && npm run build
cd ../..
```

### 4. End-to-end smoke tests

Run these in sequence in a scratch directory:

```bash
export SWENY_BIN=/Users/nate/src/swenyai/sweny/packages/core/dist/cli/main.js
export CREATE_SWENY_BIN=/Users/nate/src/swenyai/sweny/packages/create-sweny/dist/index.js

cd /tmp && rm -rf sweny-verify && mkdir sweny-verify && cd sweny-verify
git init

# 1. sweny new --help shows the new command
node "$SWENY_BIN" --help | grep -q "new" || echo "FAIL: new not in --help"
node "$SWENY_BIN" --help | grep -q "init" && echo "FAIL: init should be hidden" || true

# 2. sweny init is hidden but still works with deprecation
node "$SWENY_BIN" init --help 2>&1 | grep -q "DEPRECATED" || echo "FAIL: init missing DEPRECATED marker"

# 3. sweny workflow create prints deprecation
node "$SWENY_BIN" workflow create "test" 2>&1 | head -5 | grep -q "deprecated" || echo "FAIL: workflow create missing deprecation"

# 4. sweny e2e init prints deprecation
echo "" | node "$SWENY_BIN" e2e init 2>&1 | head -5 | grep -qi "deprecated" || echo "FAIL: e2e init missing deprecation"

# 5. create-sweny delegates properly — visual check
# (interactive, so eyeball it)
# node "$CREATE_SWENY_BIN"

# 6. Full new flow on fresh repo
# (interactive — run manually and pick a template)
```

### 5. Grep for stragglers

```bash
cd /Users/nate/src/swenyai/sweny
grep -rn "sweny init" \
  --include="*.md" \
  --include="*.ts" \
  --include="*.tsx" \
  --include="*.json" \
  --exclude-dir=node_modules \
  --exclude-dir=dist \
  --exclude-dir=.tasks \
  --exclude-dir=docs/tasks \
  --exclude-dir=docs/superpowers \
  --exclude=CHANGELOG.md \
  --exclude=package-lock.json
```

Expected matches (whitelist — these are FINE):
- `packages/core/src/cli/main.ts` — the deprecation alias registration
- `packages/core/src/cli/new.ts` — `runInit` deprecated re-export
- deprecation warning strings
- Error/warning messages that mention the old name as a breadcrumb

Anything else → go back and fix.

```bash
grep -rn "runInit" \
  --include="*.ts" \
  --exclude-dir=node_modules \
  --exclude-dir=dist
```

Expected: only `new.ts` (the re-export) and possibly one call site inside
`main.ts`'s deprecation handler. Everything else should be `runNew`.

### 6. Verify plugin manifest

```bash
cat packages/plugin/.claude-plugin/plugin.json 2>/dev/null | grep -i "init\|workflow-create\|e2e-init"
```

Should return nothing. If it does, go update the manifest.

### 7. Run the consolidated changeset check

If changesets live in `.changeset/`:
```bash
ls .changeset/*.md
```

Expected new entries from Tasks 83-87:
- `cli-new-command.md` (core minor)
- `cli-new-custom-option.md` (core minor)
- `cli-new-e2e-option.md` (core minor)
- `cli-new-idempotent.md` (core patch)
- `downstream-new-rename.md` (core patch, create-sweny patch)

Consolidate if multiple entries exist for the same package — OR leave them
as separate changesets, which is fine and preserves granular history.

### 8. Final commit

Everything up to this point is committed per-task. Task 88's only artifact
is this verification pass plus any bugfixes surfaced.

If any fixes were needed during verification, commit them with a message
like:
```
chore: post-migration cleanup for init → new rename

Address issues surfaced during verification of Tasks 83-87.
```

If no fixes needed, no final commit — rename `88-verify-and-finalize.todo.md`
to `.done.md` and we're shipped.

## Done criteria

- [ ] All tests pass (`npm test` in `packages/core`)
- [ ] Full build passes (`npm run build` in `packages/core` and `create-sweny`)
- [ ] `sweny new --help` works and shows the command
- [ ] `sweny init` still works with deprecation warning
- [ ] `sweny workflow create` still works with deprecation warning
- [ ] `sweny e2e init` still works with deprecation warning
- [ ] `npx create-sweny` drops into the new picker
- [ ] Grep for `sweny init` returns only whitelisted locations
- [ ] Grep for `runInit` returns only the deprecated re-export
- [ ] Plugin manifest has no orphan references to removed skills
- [ ] All changeset files present and valid
