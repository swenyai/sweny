# docs-05: Rewrite "Recipe Authoring" page

## Goal
`packages/web/src/content/docs/studio/recipe-authoring.md` currently reads like an internal monorepo developer guide — it references file paths inside `packages/engine/src/`, explains internal TypeScript interfaces (`WorkflowContext`, `StepResult`), and shows test code with `vi.mock("node:child_process", ...)`. Rewrite it from the perspective of someone installing `@sweny-ai/engine` from npm who wants to build a custom recipe.

## Context
Recipe Authoring is an advanced topic — it's for developers who want to build their own recipes beyond Triage and Implement. The page content is correct but written for someone working inside the SWEny monorepo, not an external consumer.

Key things to fix:
1. File paths like `packages/engine/src/recipes/my-recipe/definition.ts` → use standalone project paths (`src/my-recipe/definition.ts`)
2. Comments like `// packages/engine/src/nodes/my-node.ts` → remove or change to `// src/nodes/my-node.ts`
3. The "Testing" section uses `vi.mock("node:child_process")` to work around the monorepo's git repo — external users don't need this hack
4. The `WorkflowContext` import `from "../types.js"` and `StepResult` from the same — these should show published package imports (`from "@sweny-ai/engine"`)
5. The "Wiring the recipe" section imports from `"../../nodes/do-work.js"` (monorepo relative) — should show the user's own module path

## File to edit
`packages/web/src/content/docs/studio/recipe-authoring.md`

## Changes by section

### Opening paragraph
Change:
> Built-in recipes (`triage`, `implement`) live in `packages/engine/src/recipes/`. The full specification is in [`packages/engine/SPEC.md`](...)

To something like:
> Built-in recipes (`triage`, `implement`) are pre-wired for common use cases. To create your own, install `@sweny-ai/engine` and define a `RecipeDefinition` + `StateImplementations`. The full DAG spec is in the [engine README](https://github.com/swenyai/sweny/blob/main/packages/engine/SPEC.md).

### Core types section
Keep the TypeScript interfaces — they're useful. But fix the import comments to show published package usage:
- Add at the top: `import type { RecipeDefinition, StateDefinition, Recipe, StateImplementations } from "@sweny-ai/engine";`

### Writing a state section
Fix the file path comment: change `// packages/engine/src/nodes/my-node.ts` → `// src/recipes/my-recipe/steps/my-node.ts`

Fix the import: change `from "../types.js"` → `from "@sweny-ai/engine"`
Same for `WorkflowContext` and `StepResult` types — show them imported from `"@sweny-ai/engine"`.

Change the `providers.get<IssueTrackingProvider>("issueTracker")` line — add the import: `import type { IssueTrackingProvider } from "@sweny-ai/providers/issue-tracking";` as a comment or inline note.

### Writing a definition section
Fix the file path comment: `// packages/engine/src/recipes/my-recipe/definition.ts` → `// src/recipes/my-recipe/definition.ts`
Fix import: `from "../../types.js"` → `from "@sweny-ai/engine"`

### Wiring the recipe section
Fix the file path comment: `// packages/engine/src/recipes/my-recipe/index.ts` → `// src/recipes/my-recipe/index.ts`
Fix imports:
- `from "@sweny-ai/engine"` (already correct)
- `from "./definition.js"` (correct)
- `from "./steps/verify-setup.js"` (correct)
- Remove `from "../../nodes/do-work.js"` — change to `from "./steps/do-work.js"` (internal, not from shared nodes)
- Remove `from "../../nodes/notify.js"` — change to `from "./steps/notify.js"`
- Fix the import of `MyRecipeConfig` to `from "./types.js"` (already correct)

### Testing section
Completely rewrite this section. The current version:
- Uses `vi.mock("node:child_process")` to work around the monorepo git repo — external users don't need this
- References `fileIssueTracking` as a test utility but doesn't explain where it comes from clearly

New testing section should:
1. Show a simple test using file providers (they're designed exactly for this)
2. No `vi.mock` hacks needed
3. Show the import: `import { fileIssueTracking } from "@sweny-ai/providers/issue-tracking";`
4. Explain: "File providers write outputs to disk and don't require real credentials — perfect for testing."

Example rewrite:
```ts
import { describe, it, expect } from "vitest";
import { runRecipe, createProviderRegistry } from "@sweny-ai/engine";
import { fileIssueTracking } from "@sweny-ai/providers/issue-tracking";
import { myRecipe } from "./index.js";

describe("myRecipe", () => {
  it("runs to completion with file providers", async () => {
    const tmpDir = "/tmp/sweny-test";
    const tracker = fileIssueTracking({ outputDir: tmpDir });
    await tracker.verifyAccess(); // initialises output directories

    const issue = await tracker.createIssue({ title: "Test issue", projectId: "LOCAL" });

    const registry = createProviderRegistry();
    registry.set("issueTracker", tracker);

    const result = await runRecipe(
      myRecipe,
      { issueIdentifier: issue.identifier, repository: "my-org/my-repo" },
      registry,
    );

    expect(result.status).toBe("completed");
  });
});
```

Remove the note "Mock `node:child_process` so the file source control doesn't detect the monorepo's git repo" — not applicable to external users.

## No changeset needed
`packages/web` is private. No `.changeset/` file needed.

## Acceptance criteria
- No references to `packages/engine/src/` paths
- No `vi.mock("node:child_process")` in the testing section
- All TypeScript imports show `from "@sweny-ai/engine"` not relative monorepo paths for the engine types
- File path comments reference `src/recipes/...` not `packages/engine/src/recipes/...`
- Page passes `npm run build --workspace=packages/web` with no errors
