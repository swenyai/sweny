# Task 14 — Engine: browser.ts export cleanup

## Goal

Two things are currently exported only from `index.ts` (Node.js entry) but are
pure data / pure functions that belong in `browser.ts` too:

1. **`WORKFLOW_YAML_SCHEMA_HEADER`** — a string constant. No Node.js deps.
   Studio's `export-yaml.ts` imports it from `"@sweny-ai/engine"` (Node entry).
   It should be importable from `"@sweny-ai/engine/browser"` instead.

2. **`triageDefinition` and `implementDefinition`** — pure serializable objects.
   No Node.js deps. Studio's `App.tsx` imports them from `"@sweny-ai/engine"`.
   These are static data safe for the browser.

Exporting these from `browser.ts` means any downstream code embedding the Studio
viewer/editor can use the browser-safe entry exclusively without pulling in
Node.js-specific provider transitive deps.

## Background

**`browser.ts`**: `packages/engine/src/browser.ts` — the browser-safe entry.
Currently exports: pure types, `CollectingObserver`/`CallbackObserver`/`composeObservers`,
`validateWorkflow`, `createWorkflow`, `runWorkflow` (browser-safe runner).

**Engine package.json exports**:
```json
"./browser": "./dist/browser.js"
```

**`WORKFLOW_YAML_SCHEMA_HEADER`**: defined in `index.ts`. Pure string, no deps.

**`triageDefinition` / `implementDefinition`**: defined in
`./recipes/triage/index.ts` and `./recipes/implement/index.ts`. These are plain
JS objects (`WorkflowDefinition`). They import step implementations (which have
Node.js deps), BUT only the definition export is needed — not the workflow
implementation objects.

## What to build

### 1. Export `WORKFLOW_YAML_SCHEMA_HEADER` from `browser.ts`

In `packages/engine/src/browser.ts`, add:

```typescript
// Schema header constant — pure string, safe for browser use
export const WORKFLOW_YAML_SCHEMA_HEADER =
  "# yaml-language-server: $schema=https://sweny.ai/schemas/workflow-definition.schema.json\n";
```

Do NOT import it from `index.ts` — that would create a circular path. Define
it directly here (it's a one-liner; duplication is acceptable for a string).

### 2. Export definition objects from `browser.ts`

The recipe files (`recipes/triage/index.ts`) export both `triageDefinition` (pure
data) and `triageWorkflow` (includes implementations with Node deps). To safely
export only the data, check if the definition can be imported directly without
pulling in the implementations.

Look at `packages/engine/src/recipes/triage/index.ts` and
`packages/engine/src/recipes/implement/index.ts` to see if there are separate
`definition.ts` files or if definition and implementation are in the same file.

**If there are separate definition files** (e.g., `recipes/triage/definition.ts`):
```typescript
// browser.ts
export { triageDefinition } from "./recipes/triage/definition.js";
export { implementDefinition } from "./recipes/implement/definition.js";
```

**If not**, add `export { triageDefinition, implementDefinition }` only if the
import chain is Node-dep-free. If the definition file imports Node deps
transitively, SKIP this item and document why in a comment in browser.ts.

### 3. Update `Studio export-yaml.ts` to import from browser entry

In `packages/studio/src/lib/export-yaml.ts`:
```typescript
import { WORKFLOW_YAML_SCHEMA_HEADER } from "@sweny-ai/engine/browser";
```

### 4. Verify no circular imports

After the changes, run `npm run build --workspace packages/engine` and check
that `dist/browser.js` has no `require("node:...")` calls or transitive imports
from `@sweny-ai/providers`. Quick check:
```bash
grep -n "node:" packages/engine/dist/browser.js | head -5
grep -n "@sweny-ai/providers" packages/engine/dist/browser.js | head -5
```
Both should return nothing.

### 5. Changeset

`.changeset/engine-browser-export-cleanup.md`:
```md
---
"@sweny-ai/engine": patch
"@sweny-ai/studio": patch
---

`WORKFLOW_YAML_SCHEMA_HEADER` is now exported from `@sweny-ai/engine/browser`
(the browser-safe entry) in addition to the main entry. Studio's `export-yaml`
now imports it from the browser entry. If `triageDefinition`/`implementDefinition`
are importable without Node.js transitive deps, they are also exported from the
browser entry.
```

## Files to touch

- `packages/engine/src/browser.ts` — add `WORKFLOW_YAML_SCHEMA_HEADER` export (+ definitions if safe)
- `packages/studio/src/lib/export-yaml.ts` — change import to `@sweny-ai/engine/browser`
- `.changeset/engine-browser-export-cleanup.md` — new changeset

## Done criteria

- `import { WORKFLOW_YAML_SCHEMA_HEADER } from "@sweny-ai/engine/browser"` works
- `dist/browser.js` has no `node:` imports or `@sweny-ai/providers` references
- `npm run build --workspace packages/engine` succeeds
- `npm run typecheck --workspace packages/studio` clean
- All existing tests still pass
