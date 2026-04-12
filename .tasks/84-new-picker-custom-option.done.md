# Task 84 — Add "Custom AI-generated workflow" option to `sweny new` picker

## Goal

Give users a path from the `sweny new` picker directly into AI-generated
workflow creation. Today that lives in `sweny workflow create <description>`
as a separate command; after this task it's also reachable as a picker option
inside `sweny new`, and `sweny workflow create` becomes a deprecated alias.

## Prerequisite

Task 83 must be complete — this task edits `packages/core/src/cli/new.ts` (not
`init.ts`).

## Working directory

Paths relative to `/Users/nate/src/swenyai/sweny`.

## Changes

### 1. Add picker option

File: `packages/core/src/cli/new.ts`, inside `runNew()`, at the `p.select`
that currently reads (around what was line 424-434 of init.ts):

```typescript
const templateChoice = await p.select({
  message: "What do you want to do?",
  options: [
    ...WORKFLOW_TEMPLATES.map((t) => ({
      value: t.id,
      label: t.name,
      hint: t.description,
    })),
    { value: "__blank", label: "Start blank", hint: "just set up config, I'll create workflows later" },
  ],
});
```

Extend the options array to include a `__custom` entry BEFORE `__blank`:

```typescript
{ value: "__custom", label: "Describe your own", hint: "AI-generated from your description" },
```

### 2. Handle the `__custom` branch

After the user picks an option, the current code does:
```typescript
const template = WORKFLOW_TEMPLATES.find((t) => t.id === templateChoice);
const workflowSkills = template ? extractSkillsFromYaml(template.yaml) : [];
```

Add a branch above this for `__custom`. When selected:

1. Prompt with `p.text` for a description (validate non-empty).
2. Call `buildWorkflow(description, { claude, skills, logger })` — import from
   `../workflow-builder.js`. The reference implementation already exists in
   `main.ts` around line 1019-1066; replicate its structure here.
3. Present the generated workflow (use `DagRenderer` from `./renderer.js`) and
   offer: accept / reject / refine. On refine, call `refineWorkflow` in a
   loop until accepted or rejected.
4. On accept, save to `.sweny/workflows/<workflow.id>.yml` using
   `stringifyYaml` from `yaml` package.
5. Collect credentials based on the generated workflow's skills: call
   `extractSkillsFromYaml` on the serialized YAML, then
   `collectCredentialsForSkills`. Proceed into the existing file-writing flow
   for `.sweny.yml` + `.env` updates.

**Pull this into a helper** — extract the custom flow into a separate function
`runCustomWorkflow(cwd, hasExistingConfig: boolean): Promise<{ workflowPath:
string; skills: string[] } | null>` at the bottom of `new.ts`. Returns null on
cancel. This keeps `runNew()` readable.

### 3. Skill import setup

At the top of `new.ts`, add the imports needed for custom-gen:

```typescript
import { stringify as stringifyYaml } from "yaml";
import { buildWorkflow, refineWorkflow } from "../workflow-builder.js";
import { ClaudeClient } from "../claude.js";
import { configuredSkills } from "./config.js";  // or wherever it lives — grep to confirm
import { consoleLogger } from "./output.js";     // grep to confirm
import { DagRenderer } from "./renderer.js";
```

Verify each import by `grep -n "export" packages/core/src/cli/<file>.ts` before
writing — don't assume, check.

### 4. Deprecate `sweny workflow create`

File: `packages/core/src/cli/main.ts`, around line 1015-1071 (the
`workflowCmd.command("create <description>")` block).

Wrap the action in a deprecation warning:
```typescript
workflowCmd
  .command("create <description>")
  .description("[DEPRECATED] Use `sweny new` and pick 'Describe your own' — or pass description directly to sweny new")
  .option("--json", "Output workflow JSON to stdout (no interactive prompt)")
  .action(async (description: string, options: { json?: boolean }) => {
    console.warn(
      "\x1B[33m  ⚠  `sweny workflow create` is deprecated. Use `sweny new` instead.\x1B[0m\n",
    );
    // ... existing logic unchanged
  });
```

Do NOT delete the command — it still works, just prints a warning. Removal
happens in a future major version.

### 5. Tests

File: `packages/core/src/cli/new.test.ts`

Add a unit test that verifies the picker option list includes `__custom`. This
is a simple check against an exported constant if you factor out the options
array, or you can skip if the picker is tightly coupled to the wizard. Keep
the test lean — the interactive flow is not unit-tested today and we're not
changing that convention.

If you extract `runCustomWorkflow`, add a test that verifies it returns null
on cancel and that it calls `buildWorkflow` with the user's description when
mocked. Use the existing `vi.mock` patterns from the repo.

## Verification

```bash
cd packages/core
npm run typecheck
npm test
```

Manual smoke test:
```bash
npm run build
cd /tmp && mkdir sweny-new-test && cd sweny-new-test && git init
node /Users/nate/src/swenyai/sweny/packages/core/dist/cli/main.js new
# Pick "Describe your own"
# Enter "review Python PRs for security issues"
# Verify a workflow file gets written
```

Also verify the deprecation:
```bash
node /Users/nate/src/swenyai/sweny/packages/core/dist/cli/main.js workflow create "test"
# Must show the yellow deprecation warning
```

## Changeset

Create `.changeset/cli-new-custom-option.md`:
```markdown
---
"@sweny-ai/core": minor
---

`sweny new` now offers "Describe your own" as a picker option — AI-generated
workflow creation directly from the unified command. `sweny workflow create`
is deprecated in favor of `sweny new`.
```

## Commit

```
feat(cli): add AI-generated workflow option to `sweny new` picker

Users can now go from `sweny new` directly into natural-language
workflow generation without needing the separate `sweny workflow create`
command. `sweny workflow create` is deprecated as an alias.
```

## Non-goals

- Do NOT add the e2e option here — that's Task 85.
- Do NOT change fresh-vs-existing repo detection — that's Task 86.
