# Task: Add --review-mode flag to the CLI

## Prerequisite

Task `01-reviewmode-engine.todo.md` must be committed first — `reviewMode` must exist in
`TriageConfig` before the CLI can pass it. Pull latest main before starting.

```bash
cd /Users/nate/src/swenyai/sweny && git pull origin main
```

---

## Goal

Expose `--review-mode <mode>` as a CLI flag for `sweny triage` and thread it to
the recipe config.

---

## Step 1: Find the triage command registration

**File: `packages/cli/src/main.ts`**

Search for `registerTriageCommand` — it likely lives in a separate file. Find where
the commander options are defined and add:

```ts
.option("--review-mode <mode>", "PR merge behavior: auto | review | notify", "review")
```

Place it near `--dry-run` since it's a behavior flag.

---

## Step 2: Add reviewMode to CliConfig

Find the `CliConfig` type (likely in `packages/cli/src/config.ts` or similar).

Add:
```ts
reviewMode?: "auto" | "review" | "notify";
```

In the config parsing/defaults section, add:
```ts
reviewMode: (options.reviewMode || fileConfig["review-mode"] || "review") as "auto" | "review" | "notify",
```

This allows `review-mode: auto` in a `.sweny.yml` / config file too, not just as a flag.

---

## Step 3: Map in mapToTriageConfig

**File: `packages/cli/src/main.ts`**

In `mapToTriageConfig`, add:
```ts
reviewMode: config.reviewMode,
```

---

## Step 4: Tests

**File: `packages/cli/tests/main.test.ts`** or wherever CLI tests live.

Read the existing test file to understand how commands are tested.

Add a test that verifies:
- `--review-mode auto` maps to `reviewMode: "auto"` in the triage config
- When not specified, defaults to `"review"`

Run:
```bash
npm test --workspace=packages/cli -- --reporter=verbose 2>&1 | tail -30
```

---

## Step 5: Commit

```
feat(cli): add --review-mode flag (auto | review | notify)
```

Then rename `03-cli-reviewmode.todo.md` → `03-cli-reviewmode.done.md` and commit:
```
chore: mark task 03 done
```

---

## Context

- Repo: `/Users/nate/src/swenyai/sweny`
- CLI is `packages/cli/` — uses commander.js
- Config also reads from `.sweny.yml` file — add `review-mode` key support there too
- TypeScript monorepo with ESM (`"type": "module"`)
