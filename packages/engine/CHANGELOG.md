# @sweny-ai/engine

## 1.0.0

### Minor Changes

- 474589e: DAG spec v2, ExecutionEvent observer protocol, and browser-safe exports.
  - `createRecipe()` factory — validates definition completeness at construction time
  - `runRecipe()` state machine runner — replaces `runWorkflow()`; explicit `on:` outcome routing with wildcard and `"end"` target support
  - `ExecutionEvent` union (`recipe:start`, `state:enter`, `state:exit`, `recipe:end`) with `CollectingObserver`, `CallbackObserver`, and `composeObservers`
  - `validateDefinition()` — browser-safe definition validator
  - `triageDefinition` and `implementDefinition` exported from `@sweny-ai/engine/browser`
  - Risk-gated auto-merge: `reviewMode: "auto" | "review"`, `assessRisk()` with `LARGE_CHANGE_THRESHOLD`
  - `enableAutoMerge?()` optional method on `SourceControlProvider`; GitLab no-op with warning
  - JSON Schema for `RecipeDefinition` with ajv validation
  - Removed `"notify"` variant from `reviewMode` — only `"auto"` and `"review"` are valid

### Patch Changes

- Updated dependencies [5053263]
- Updated dependencies [6a71f2a]
- Updated dependencies [474589e]
  - @sweny-ai/providers@0.3.0
