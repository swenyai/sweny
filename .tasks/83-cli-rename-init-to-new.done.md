# Task 83 — Rename CLI `init` → `new` + deprecate `init`

## Goal

Replace `sweny init` with `sweny new` as the canonical command for creating a
SWEny workflow. Keep `sweny init` as a deprecated alias (one release of
back-compat) that prints a warning and delegates to the new implementation.

The semantic rationale (from the design discussion): `init` implies one-time
bootstrap; `new` implies repeatable creation of workflows. A user will run
the creation command many times over a repo's life (one per workflow), so
`new` is the honest verb.

## Working directory

All paths are relative to `/Users/nate/src/swenyai/sweny` unless absolute.

## Changes

### 1. Rename source file

- `git mv packages/core/src/cli/init.ts packages/core/src/cli/new.ts`
- Inside the file, rename the exported function `runInit` → `runNew`.
- Keep `runInit` as a named re-export for backward compatibility:
  ```typescript
  /** @deprecated Use runNew instead. */
  export const runInit = runNew;
  ```
- Update the file's top-of-file doc comment from "sweny init — Interactive
  setup wizard" to "sweny new — Interactive workflow creation wizard".
- All other exports (`buildSwenyYml`, `buildEnvTemplate`, `buildActionWorkflow`,
  `collectCredentials`, `collectCredentialsForSkills`, `extractSkillsFromYaml`,
  `detectGitRemote`, `SKILL_CREDENTIALS`, `PROVIDER_CREDENTIALS`, types) stay
  untouched.

### 2. Rename test file

- `git mv packages/core/src/cli/init.test.ts packages/core/src/cli/new.test.ts`
- Update the single import line to `from "./new.js"` (was `./init.js`).
- Nothing else in the test needs to change — all existing assertions remain
  valid because the pure functions kept their names.

### 3. Update CLI command registration

File: `packages/core/src/cli/main.ts`

Current state (around line 35):
```typescript
import { runInit } from "./init.js";
```

Change to:
```typescript
import { runNew, runInit } from "./new.js";
```

Current state (around line 166-172):
```typescript
// ── sweny init ────────────────────────────────────────────────────────
program
  .command("init")
  .description("Interactive setup wizard — creates .sweny.yml, .env template, and optional GitHub Action")
  .action(async () => {
    await runInit();
  });
```

Replace with:
```typescript
// ── sweny new ─────────────────────────────────────────────────────────
program
  .command("new")
  .description("Create a new workflow — interactive picker or direct template")
  .action(async () => {
    await runNew();
  });

// ── sweny init (deprecated alias) ─────────────────────────────────────
program
  .command("init", { hidden: true })
  .description("[DEPRECATED] Use `sweny new` instead")
  .action(async () => {
    console.warn(
      "\x1B[33m  ⚠  `sweny init` is deprecated. Use `sweny new` instead.\x1B[0m\n",
    );
    await runNew();
  });
```

The `{ hidden: true }` keeps `init` working but hides it from `sweny --help`.

### 4. Update package exports

File: `packages/core/package.json`

In the `exports` block, add the `./new` path alongside the existing `./init`:
```json
"exports": {
  ...
  "./init": "./dist/cli/init.js",
  "./new": "./dist/cli/new.js"
}
```

Wait — the file was renamed from `init.ts` to `new.ts`, so `./dist/cli/init.js`
no longer exists. Update both entries:
- Change `./init` to point to `./dist/cli/new.js` (back-compat path, same file).
- Add `./new` pointing to `./dist/cli/new.js`.

Also update `typesVersions`:
```json
"typesVersions": {
  "*": {
    ...
    "init": ["dist/cli/new.d.ts"],
    "new": ["dist/cli/new.d.ts"]
  }
}
```

## Verification

From `packages/core/`:
```bash
npm run typecheck
npm test -- new.test.ts
```

Both must pass. The rename test file should find `new.ts` and all existing
assertions should continue to pass (they test pure functions that kept their
names).

From the repo root:
```bash
cd packages/core && npm run build
cd ../..
node packages/core/dist/cli/main.js --help
```

The help output should list `new` but NOT list `init` (because it's hidden).

```bash
node packages/core/dist/cli/main.js init --help
```

Should still work — shows the deprecation message and `new`'s description.

## Changeset

Create `.changeset/cli-new-command.md`:
```markdown
---
"@sweny-ai/core": minor
---

Add `sweny new` as the canonical workflow creation command. `sweny init` is
deprecated and will be removed in the next major — it currently prints a
warning and delegates to `sweny new`.
```

## Commit

```
refactor(cli): rename `sweny init` → `sweny new`

`init` implies one-time bootstrap; `new` fits the repeatable nature of
adding workflows to a repo. `sweny init` remains as a hidden deprecated
alias that prints a warning and delegates to `runNew`.

- Rename src/cli/init.ts → new.ts
- Rename src/cli/init.test.ts → new.test.ts
- Export runNew (keep runInit as deprecated alias)
- Register `sweny new` command; hide `sweny init`
- Update package.json exports: add ./new, repoint ./init
```

## Non-goals

- Do NOT change the picker options in this task (templates + blank stay). Task
  84 adds the custom option; Task 85 adds the e2e option.
- Do NOT change `sweny e2e init` or `sweny workflow create` yet — those are
  handled in Tasks 84 and 85.
- Do NOT touch `create-sweny` or plugin skills — Task 87 handles those.
- Do NOT edit README.md or docs — Task 87.
