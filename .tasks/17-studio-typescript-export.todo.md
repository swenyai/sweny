# Task 17 — Studio: TypeScript export in Toolbar

## Goal

Expose the existing `exportAsTypescript()` function in the Studio toolbar so
users can download a `.ts` file containing a fully-typed workflow definition
and implementation stubs ready for use in a Node.js project.

## Context

- **export-typescript.ts** already exists at
  `packages/studio/src/lib/export-typescript.ts` — exports
  `exportAsTypescript(definition: WorkflowDefinition): string`.
  It generates: imports, `const myWorkflowDefinition: WorkflowDefinition = {...}`,
  per-step async stub functions, and a `createWorkflow()` call. Zero dependencies.

- **Toolbar.tsx**: `packages/studio/src/components/Toolbar.tsx`
  Currently has an export dropdown (line ~74) that downloads YAML via:
  ```typescript
  const content = exportWorkflowYaml(def);
  const blob = new Blob([content], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${def.id}.yaml`;
  a.click();
  URL.revokeObjectURL(url);
  ```
  Add a second option "Export TypeScript" that does the same but with:
  - `content = exportAsTypescript(def)`
  - `type: "text/typescript"` (or `"text/plain"`)
  - `a.download = \`${def.id}.ts\``

## UI changes

The current toolbar has a single "Export YAML" button or dropdown. Convert it
to a split button / dropdown with two options:
1. Export YAML (existing, `.yaml`)
2. Export TypeScript (new, `.ts`)

Keep it simple — a `<select>` or a button + small dropdown chevron works fine.
The Studio uses Tailwind; match the existing button style.

Read the full Toolbar.tsx before making changes — understand the existing export
button structure, the `open` state pattern for the import dropdown, and apply
the same pattern consistently.

## Changeset

Create `.changeset/studio-typescript-export.md`:
```md
---
"@sweny-ai/studio": minor
---
The Studio toolbar now offers an "Export TypeScript" option. Downloads a `.ts`
file with the workflow definition and per-step implementation stubs, ready to
use with `@sweny-ai/engine`.
```

## Tests

No unit tests required for the toolbar UI. Ensure `npx tsc --noEmit` passes.

## Done when

- [ ] `exportAsTypescript` imported in Toolbar.tsx
- [ ] Export dropdown (or split button) with "Export YAML" and "Export TypeScript" options
- [ ] `.ts` download uses `def.id + ".ts"` as filename
- [ ] Changeset created
- [ ] `npx tsc --noEmit` passes in `packages/studio`
