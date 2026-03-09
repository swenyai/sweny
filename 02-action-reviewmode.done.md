# Task: Wire review-mode through the GitHub Action

## Prerequisite

Task `01-reviewmode-engine.todo.md` must be committed first — this task reads `reviewMode`
from `TriageConfig` which is defined there. Pull latest main before starting.

```bash
cd /Users/nate/src/swenyai/sweny && git pull origin main
```

---

## Goal

Expose `review-mode` as an action input and thread it through to the recipe config.

---

## Step 1: Add input to action.yml

**File: `/Users/nate/src/swenyai/sweny/action.yml`**

In the `# Behavior` section (after `dry-run`), add:
```yaml
  review-mode:
    description: "PR merge behavior: 'auto' (merge when CI passes), 'review' (human approves), 'notify' (same as review)"
    required: false
    default: "review"
```

---

## Step 2: Add reviewMode to ActionConfig

**File: `packages/action/src/config.ts`** (find the ActionConfig type/interface/schema)

Read the file first to understand the shape. Add:
```ts
reviewMode: "auto" | "review" | "notify";
```

Also add the parsing from action input — look at how `dryRun` is parsed
(`core.getInput("dry-run") === "true"`) and follow the same pattern for:
```ts
reviewMode: (core.getInput("review-mode") || "review") as "auto" | "review" | "notify",
```

---

## Step 3: Map in mapToTriageConfig

**File: `packages/action/src/main.ts`**

In `mapToTriageConfig`, add:
```ts
reviewMode: config.reviewMode,
```

In `mapToImplementConfig` (if it exists), add:
```ts
reviewMode: config.reviewMode,
```

---

## Step 4: Rebuild action dist

The action bundles everything to `dist/index.js` using ncc.

```bash
cd /Users/nate/src/swenyai/sweny
npm run build --workspace=packages/providers
npm run package --workspace=packages/action
```

Check that `dist/index.js` was updated (size should change).

---

## Step 5: Tests

**File: `packages/action/tests/main.test.ts`** (or wherever action tests live — check `packages/action/tests/`)

Find the test that exercises `mapToTriageConfig`. Add a case verifying:
- When `review-mode` input is `"auto"`, `triageConfig.reviewMode === "auto"`
- When `review-mode` input is not set, `triageConfig.reviewMode === "review"` (default)

Run:
```bash
npm test --workspace=packages/action -- --reporter=verbose 2>&1 | tail -30
```

---

## Step 6: Commit

```
feat(action): add review-mode input (auto | review | notify)
```

Then rename `02-action-reviewmode.todo.md` → `02-action-reviewmode.done.md` and commit:
```
chore: mark task 02 done
```

---

## Context

- `packages/action/src/config.ts` — ActionConfig type and input parsing
- `packages/action/src/main.ts` — mapToTriageConfig and mapToImplementConfig
- `action.yml` — at repo root (`/Users/nate/src/swenyai/sweny/action.yml`)
- The `dist/index.js` is committed to the repo (ncc bundle)
