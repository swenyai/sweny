# Task 85 — Add "End-to-end browser testing" option to `sweny new` picker

## Goal

Make e2e test setup reachable from the unified `sweny new` picker. Today it's
only available via the separate `sweny e2e init` command. After this task,
`sweny new` → "End-to-end browser testing" runs the same wizard, and
`sweny e2e init` becomes a deprecated alias.

## Prerequisites

Tasks 83 and 84 must be complete.

## Working directory

Paths relative to `/Users/nate/src/swenyai/sweny`.

## Changes

### 1. Make `runE2eInit` re-entrant (skip intro when called from `new`)

File: `packages/core/src/cli/e2e.ts`

Current signature (line 727):
```typescript
export async function runE2eInit(): Promise<void>
```

Change to accept an options bag:
```typescript
export interface E2eInitOptions {
  /** Skip the `p.intro()` call — used when invoked from inside another wizard. */
  skipIntro?: boolean;
}

export async function runE2eInit(options: E2eInitOptions = {}): Promise<void>
```

Inside the function, the current line ~731:
```typescript
p.intro("Let's set up end-to-end testing for your app");
```

Becomes:
```typescript
if (!options.skipIntro) {
  p.intro("Let's set up end-to-end testing for your app");
} else {
  p.log.step("Setting up end-to-end browser testing");
}
```

Similarly audit the `p.outro` / `p.cancel` calls at the end of the function —
keep them as-is (outro is fine even when re-entered; we want a clear
termination).

### 2. Add picker option in `new.ts`

File: `packages/core/src/cli/new.ts`, in the same `p.select` options array
touched by Task 84.

Add the e2e option after the template list and before `__custom` / `__blank`:
```typescript
{ value: "__e2e", label: "End-to-end browser testing", hint: "Automated browser tests for your app" },
```

Full options order (for reference):
```typescript
options: [
  ...WORKFLOW_TEMPLATES.map((t) => ({ value: t.id, label: t.name, hint: t.description })),
  { value: "__e2e", label: "End-to-end browser testing", hint: "Automated browser tests for your app" },
  { value: "__custom", label: "Describe your own", hint: "AI-generated from your description" },
  { value: "__blank", label: "Start blank", hint: "just set up config, I'll create workflows later" },
],
```

### 3. Handle the `__e2e` branch

In the same block where you added `__custom` handling (Task 84), add a branch
for `__e2e`:

```typescript
if (templateChoice === "__e2e") {
  const { runE2eInit } = await import("./e2e.js");
  await runE2eInit({ skipIntro: true });
  p.outro("E2E testing set up!");
  return;
}
```

The `await import()` (dynamic import) keeps the e2e module out of the startup
path for the common triage-ish use case. If the whole-file static import is
already pulling e2e stuff in, a regular top-of-file import is fine — check
bundle impact with your judgment.

### 4. Deprecate `sweny e2e init`

File: `packages/core/src/cli/main.ts`, around line 177-182:

```typescript
e2eCmd
  .command("init")
  .description("[DEPRECATED] Use `sweny new` and pick 'End-to-end browser testing'")
  .action(async () => {
    console.warn(
      "\x1B[33m  ⚠  `sweny e2e init` is deprecated. Use `sweny new` instead.\x1B[0m\n",
    );
    await runE2eInit();
  });
```

Keep it working — just print the warning. `sweny e2e run` stays unchanged.

### 5. Tests

File: `packages/core/src/cli/e2e.test.ts`

Add a test case for the `skipIntro` option — verify that when `skipIntro: true`
is passed, `p.intro` is not called. Use the existing `vi.mock("@clack/prompts"
...)` pattern from the file if one exists; if not, mock it at the top:

```typescript
vi.mock("@clack/prompts", async () => {
  const actual = await vi.importActual<typeof import("@clack/prompts")>("@clack/prompts");
  return { ...actual, intro: vi.fn(), log: { step: vi.fn(), info: vi.fn(), success: vi.fn(), warn: vi.fn() }, cancel: vi.fn(), outro: vi.fn() };
});
```

Then assert `intro` is called 0 times when `skipIntro: true`, and 1 time when
omitted. Keep it tight — this is a single behavioral guard.

## Verification

```bash
cd packages/core
npm run typecheck
npm test
```

Manual smoke test:
```bash
npm run build
cd /tmp/sweny-new-test
node /Users/nate/src/swenyai/sweny/packages/core/dist/cli/main.js new
# Pick "End-to-end browser testing"
# Walk through the wizard, confirm .sweny/e2e/ files get created
```

Deprecation check:
```bash
node /Users/nate/src/swenyai/sweny/packages/core/dist/cli/main.js e2e init
# Must show yellow warning
```

## Changeset

Create `.changeset/cli-new-e2e-option.md`:
```markdown
---
"@sweny-ai/core": minor
---

`sweny new` now offers "End-to-end browser testing" as a picker option.
`sweny e2e init` is deprecated in favor of `sweny new`.
```

## Commit

```
feat(cli): add e2e testing option to `sweny new` picker

`sweny new` now unifies all workflow creation paths: templates, AI-gen,
and e2e. `sweny e2e init` is deprecated as an alias.

Also refactor `runE2eInit` to accept `{ skipIntro }` so it can be called
cleanly from inside the `new` wizard without double intros.
```

## Non-goals

- Do NOT change `sweny e2e run` — stays as-is.
- Do NOT change fresh-vs-existing detection — that's Task 86.
