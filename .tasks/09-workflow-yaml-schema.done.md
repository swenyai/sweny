# Task 09 — Workflow YAML schema: add `type` field + IDE integration

## Goal

1. Update the existing JSON Schema to include the `type` field added in task 05.
2. Rename the schema file from `recipe-definition.schema.json` to
   `workflow-definition.schema.json`.
3. Inject a `# yaml-language-server: $schema=...` comment into all YAML outputs
   so VS Code (and any yaml-language-server-aware editor) validates and
   auto-completes workflow files automatically.

## Background

**Schema file**: `packages/engine/schema/recipe-definition.schema.json`
The file exists and covers all `WorkflowDefinition` fields **except** the
`type` field on `StepDefinition` that was added in task 05.

**Engine package.json export**:
```json
"./schema": "./schema/recipe-definition.schema.json"
```
This needs to point to the renamed file.

**Where YAML is emitted**:
- CLI: `workflowExportAction()` in `packages/cli/src/main.ts` — `sweny workflow export triage|implement`
- Studio: `exportWorkflowYaml()` in `packages/studio/src/lib/export-yaml.ts` — Export YAML button

The canonical public URL for the schema (for the `$schema` comment) should be:
```
https://sweny.ai/schemas/workflow-definition.schema.json
```
(This is already the `$id` in the existing schema file.)

## What to build

### 1. Update the JSON Schema

In `packages/engine/schema/recipe-definition.schema.json`:
- Add `type` to `StepDefinition.$defs.StepDefinition.properties`:

```json
"type": {
  "type": "string",
  "description": "Built-in step type identifier (e.g. \"sweny/fetch-issue\"). When set, resolveWorkflow() wires the implementation automatically.",
  "examples": [
    "sweny/verify-access",
    "sweny/build-context",
    "sweny/investigate",
    "sweny/novelty-gate",
    "sweny/create-issue",
    "sweny/cross-repo-check",
    "sweny/dedup-check",
    "sweny/fetch-issue",
    "sweny/implement-fix",
    "sweny/create-pr",
    "sweny/notify"
  ]
}
```

### 2. Rename the schema file

```
mv packages/engine/schema/recipe-definition.schema.json \
   packages/engine/schema/workflow-definition.schema.json
```

### 3. Update package.json export

In `packages/engine/package.json`, change:
```json
"./schema": "./schema/recipe-definition.schema.json"
```
to:
```json
"./schema": "./schema/workflow-definition.schema.json"
```

### 4. Add `$schema` header to CLI YAML export

In `packages/cli/src/main.ts`, update `workflowExportAction`:

```typescript
const YAML_SCHEMA_COMMENT =
  "# yaml-language-server: $schema=https://sweny.ai/schemas/workflow-definition.schema.json\n";

export function workflowExportAction(name: string): void {
  // ... existing lookup ...
  const content = YAML_SCHEMA_COMMENT + stringify(def, { indent: 2, lineWidth: 120 });
  process.stdout.write(content);
}
```

### 5. Add `$schema` header to Studio YAML export

In `packages/studio/src/lib/export-yaml.ts`:

```typescript
import { stringify } from "yaml";
import type { WorkflowDefinition } from "@sweny-ai/engine";

const SCHEMA_COMMENT =
  "# yaml-language-server: $schema=https://sweny.ai/schemas/workflow-definition.schema.json\n";

export function exportWorkflowYaml(definition: WorkflowDefinition): string {
  return SCHEMA_COMMENT + stringify(definition, { indent: 2, lineWidth: 120 });
}
```

### 6. Update schema.test.ts

`packages/engine/src/schema.test.ts` likely imports the schema by path or
via the package export. Update any path references from
`recipe-definition.schema.json` to `workflow-definition.schema.json`.

### 7. Changeset

Create `.changeset/workflow-yaml-schema.md`:

```md
---
"@sweny-ai/engine": patch
"@sweny-ai/cli": patch
"@sweny-ai/studio": patch
---

JSON Schema for workflow YAML updated and renamed to `workflow-definition.schema.json`.
Added the `type` field for built-in step types with known values as examples.
CLI `sweny workflow export` and Studio's Export YAML button now include a
`# yaml-language-server: $schema=...` header — VS Code auto-completes and
validates workflow YAML files with no extra setup.
```

## Files to touch

- `packages/engine/schema/recipe-definition.schema.json` → rename + add `type`
- `packages/engine/package.json` — update `"./schema"` export path
- `packages/engine/src/schema.test.ts` — update path reference if any
- `packages/cli/src/main.ts` — prepend schema comment in `workflowExportAction`
- `packages/studio/src/lib/export-yaml.ts` — prepend schema comment
- `.changeset/workflow-yaml-schema.md` — new changeset

## Done criteria

- `packages/engine/schema/workflow-definition.schema.json` exists with `type` field
- `import enginePkg from "@sweny-ai/engine/schema"` resolves (package export works)
- `sweny workflow export triage` output starts with `# yaml-language-server: ...`
- Studio Export YAML output starts with `# yaml-language-server: ...`
- All tests pass; `npm run typecheck` clean
