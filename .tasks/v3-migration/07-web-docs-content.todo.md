# Task 07: Update Docs Content for v3 Terminology

## Why
The docs site has 38+ markdown files. The content already uses "Workflow"/"Step" terminology (not "Recipe"/"State"), but URL slugs still use old "recipe" naming, and the content references old package APIs (`@sweny-ai/engine`, `@sweny-ai/providers`).

## What to do

### 1. Rename file
- `packages/web/src/content/docs/studio/recipe-authoring.md` → `workflow-authoring.md`

### 2. Update astro.config.mjs sidebar slugs
- `"recipes/triage"` → `"workflows/triage"`
- `"recipes/implement"` → `"workflows/implement"`
- `"studio/recipe-authoring"` → `"studio/workflow-authoring"`

### 3. Fix 4 cross-reference links
These files link to `/studio/recipe-authoring/`:
- `getting-started/faq.md` → `/studio/workflow-authoring/`
- `getting-started/engine.md` → `/studio/workflow-authoring/`
- `cli/index.md` → `/studio/workflow-authoring/`
- `studio/index.md` → `/studio/workflow-authoring/`

### 4. Rename content directory
- `packages/web/src/content/docs/recipes/` → `packages/web/src/content/docs/workflows/`

### 5. Update API references in docs
Scan all .md/.mdx files for references to:
- `@sweny-ai/engine` → `@sweny-ai/core`
- `@sweny-ai/providers` → `@sweny-ai/core` (skills replace providers)
- `createWorkflow` → `execute`
- `WorkflowDefinition` → `Workflow`
- `StepDefinition` → `Node`
- Any code examples using old APIs

### 6. Update getting-started/engine.md and getting-started/providers.md
These describe the old packages — they need to describe the new `@sweny-ai/core` architecture (skills + DAG).

## Files to modify
- `packages/web/astro.config.mjs` (EDIT slugs)
- `packages/web/src/content/docs/studio/recipe-authoring.md` (RENAME → workflow-authoring.md)
- `packages/web/src/content/docs/recipes/` (RENAME dir → workflows/)
- 4 files with cross-reference links (EDIT)
- ~10+ files with old API references (EDIT)
- `getting-started/engine.md` (REWRITE for core)
- `getting-started/providers.md` (REWRITE for skills)

## Acceptance criteria
- No URL slugs containing "recipe"
- No markdown links to old paths
- All code examples use `@sweny-ai/core` APIs
- Docs build succeeds (`npm run build` in packages/web)
