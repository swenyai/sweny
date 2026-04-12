# Task 86 — Detect fresh-vs-existing repo in `sweny new`

## Goal

Make `sweny new` idempotent and non-destructive. When `.sweny.yml` already
exists in the cwd, `sweny new` should add a workflow without clobbering the
existing config. When the file doesn't exist, run the full first-time
bootstrap flow (current behavior).

Today the wizard prompts "overwrite?" on existing `.sweny.yml` — which is
destructive and wrong. Users re-running `sweny new` to add a second workflow
should never lose their existing provider config.

## Prerequisites

Tasks 83, 84, 85 complete.

## Working directory

Paths relative to `/Users/nate/src/swenyai/sweny`.

## Changes

File: `packages/core/src/cli/new.ts`

### 1. Detect at the top of `runNew()`

Around what used to be line 409 (the existing-file check), replace:

```typescript
// ── Existing file check ─────────────────────────────────────────────
const configPath = path.join(cwd, ".sweny.yml");
if (fs.existsSync(configPath)) {
  const overwrite = await p.confirm({
    message: ".sweny.yml already exists. Overwrite?",
    initialValue: false,
  });
  if (p.isCancel(overwrite)) cancel();
  if (!overwrite) {
    p.cancel("Setup cancelled — existing config preserved.");
    process.exit(0);
  }
}
```

With:

```typescript
const configPath = path.join(cwd, ".sweny.yml");
const hasExistingConfig = fs.existsSync(configPath);
```

### 2. Branch the intro

Current intro (line 402):
```typescript
p.intro("Let's set up SWEny");
```

Change to:
```typescript
p.intro(hasExistingConfig ? "Adding a new workflow" : "Let's set up SWEny");
```

### 3. Branch file-writing behavior

In the file-writing section (the block that writes `.sweny.yml`, `.env`,
and the workflow template — around what was line 486-527 of init.ts):

**`.sweny.yml`** — write only if `!hasExistingConfig`. When adding to an
existing repo, leave the config alone. (Rationale: minimal `.sweny.yml`
content is `source-control-provider` + `observability-provider` +
`issue-tracker-provider`. Most workflows share these. Overwriting is
destructive; appending is unnecessary unless a new provider is introduced,
which is rare and not worth auto-merging YAML.)

```typescript
if (!hasExistingConfig) {
  fs.writeFileSync(configPath, buildSwenyYml(sourceControl, observability, issueTracker), "utf-8");
  p.log.success("Created .sweny.yml");
} else {
  p.log.info(".sweny.yml already exists — keeping existing config");
}
```

**`.env`** — the current code already handles the "append missing keys" case
correctly (line ~494-518). That logic is good. Leave it alone but confirm
it runs for both paths.

**Workflow template** — always write. If a template file with the same name
exists, prompt:

```typescript
if (template) {
  const workflowDir = path.join(cwd, ".sweny", "workflows");
  fs.mkdirSync(workflowDir, { recursive: true });
  const templatePath = path.join(workflowDir, `${template.id}.yml`);

  if (fs.existsSync(templatePath)) {
    const overwrite = await p.confirm({
      message: `.sweny/workflows/${template.id}.yml exists. Overwrite?`,
      initialValue: false,
    });
    if (p.isCancel(overwrite)) cancel();
    if (!overwrite) {
      p.log.info("Workflow file preserved — no changes");
      p.outro("Done.");
      return;
    }
  }

  fs.writeFileSync(templatePath, template.yaml, "utf-8");
  p.log.success(`Created .sweny/workflows/${template.id}.yml`);
}
```

### 4. Branch next-steps output

Current (line ~541-551):
```typescript
const steps = ["1. Fill in your API keys in .env:", ...credUrls, "", "2. Verify connectivity:", "   sweny check"];
```

When `hasExistingConfig` is true and no NEW credentials were added to `.env`,
drop the "Fill in your API keys" block — there's nothing new to fill in.
Track this by capturing the `newKeys.length` from the `.env` branch into a
variable in the outer scope.

Minimal patch:
```typescript
let addedNewKeys = false;
// inside .env branch:
if (newKeys.length > 0) {
  // ... existing append logic
  addedNewKeys = true;
}

// later, next-steps:
const steps: string[] = [];
if (addedNewKeys || !hasExistingConfig) {
  steps.push("1. Fill in your API keys in .env:", ...credUrls, "", "2. Verify connectivity:", "   sweny check");
}
if (template) {
  steps.push("", `Run your workflow:`, `   sweny workflow run .sweny/workflows/${template.id}.yml`);
} else {
  steps.push("", "Create another workflow:", `   sweny new`);
}
p.note(steps.join("\n"), "Next steps");
```

### 5. Tests

File: `packages/core/src/cli/new.test.ts`

Add a pair of tests that cover the pure-function surface we actually expose.
The `runNew()` interactive wizard is thin glue and not unit-tested (matching
existing convention). What we CAN test:

- `buildSwenyYml` continues to produce the same output it did before (already
  covered; verify after changes).
- A new helper, if you extract one — for example,
  `shouldWriteSwenyYml(cwd: string): boolean` that returns
  `!fs.existsSync(path.join(cwd, ".sweny.yml"))`. If you extract, test it.
  Otherwise the branching logic lives inline in `runNew()` and is covered by
  manual smoke testing.

If you find yourself wanting more coverage, extract the fresh-vs-existing
decision into a small pure function and test that. Don't force it if the
refactor doesn't naturally call for it.

## Verification

```bash
cd packages/core
npm run typecheck
npm test
npm run build
```

Manual smoke tests (from a scratch dir):
```bash
# Fresh repo
cd /tmp && rm -rf sweny-fresh && mkdir sweny-fresh && cd sweny-fresh && git init
node /Users/nate/src/swenyai/sweny/packages/core/dist/cli/main.js new
# Pick a template. Verify .sweny.yml + .env + .sweny/workflows/<id>.yml all written.

# Existing repo — add second workflow
node /Users/nate/src/swenyai/sweny/packages/core/dist/cli/main.js new
# Pick a different template. Verify:
#  - .sweny.yml untouched
#  - .env unchanged (or gets appended with new creds if any)
#  - new .sweny/workflows/<id2>.yml added
#  - intro says "Adding a new workflow"

# Existing repo — duplicate workflow
node /Users/nate/src/swenyai/sweny/packages/core/dist/cli/main.js new
# Pick the SAME template again. Verify the overwrite prompt appears.
```

## Changeset

Create `.changeset/cli-new-idempotent.md`:
```markdown
---
"@sweny-ai/core": patch
---

`sweny new` is now idempotent — running it in a repo with an existing
`.sweny.yml` no longer prompts to overwrite. Existing config is preserved;
only the new workflow file is added (with per-file overwrite confirmation).
```

## Commit

```
feat(cli): make `sweny new` idempotent for existing repos

Detect .sweny.yml presence on launch. Fresh repo → full bootstrap.
Existing repo → skip .sweny.yml write, adjust intro/outro copy, prompt
per-workflow-file if it already exists. .env append-only behavior
already handled this correctly and is preserved.
```

## Non-goals

- Do NOT merge YAML fields into existing `.sweny.yml`. If a new workflow
  needs a provider that isn't in the existing config, the user edits it
  manually. We print a hint pointing this out — don't auto-modify.
- Do NOT re-ask for source-control / issue-tracker / observability on
  existing repos. They're already in `.sweny.yml`.
