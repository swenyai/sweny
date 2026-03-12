# @sweny-ai/engine

## 2.0.0

### Minor Changes

- 0a59479: Add `mcpServers` to `TriageConfig`, `ImplementConfig`, and `SharedNodeConfig`. When provided, MCP server configs are forwarded to every `codingAgent.run()` call (investigate, implement-fix, create-pr, notify), enabling the coding agent to use MCP tools throughout the full recipe execution.
- 556a53d: Add optional `provider` field to `StateDefinition` for declaring which provider category a state uses. Updates the built-in `triageDefinition` and `implementDefinition` with full `provider` annotations and rich `description` text on every state. Pure metadata — no runtime behaviour change.
- 4465923: Add deterministic idempotency to triage recipe via content fingerprinting.
  - `fingerprintEvent()` — SHA-256 content hash of stable event fields (16-char hex)
  - `inMemoryDedupStore()` — Map-backed store with configurable TTL (default 24h)
  - `TriageConfig.dedupStore` — optional; new `dedup-check` DAG step short-circuits
    to notify before any LLM or provider calls when fingerprint already seen
  - Exports `DedupStore`, `inMemoryDedupStore`, `fingerprintEvent` from engine index

- 4b4b29f: Updated triage build-context step to use renamed provider interfaces:
  `canListTriageHistory` → `canSearchIssuesByLabel`, `listTriageHistory` → `searchIssuesByLabel`.

### Patch Changes

- 130138e: Narrowed provider type hints in cross-repo-check and implement verify-access steps
  to use `RepoProvider` instead of the full `SourceControlProvider` where only remote
  API operations are needed.
- 42f6e95: Remove dead re-export shims from triage/steps. The `create-pr`, `implement-fix`, and `notify` step files were one-line re-exports pointing to `nodes/` — no architectural purpose since nothing consumed them. Tests and the recipe index now import directly from `nodes/`.
- 010b6d7: Code review fixes for MCP adapters and triage dedup step.

  **providers:**
  - `MCPClient`: clear `connectPromise` on error to prevent stuck reconnections; use local variable before `callTool` to guard against concurrent disconnect
  - `linearMCP`: throw on empty `id`/`identifier` in `toIssue()`; expose `limit` option in `searchIssuesByLabel()` (default 100)
  - `githubMCP`: validate `repo` config as `owner/repo` format; guard against PR `number=0`; validate `targetRepo` in `dispatchWorkflow`
  - `slackMCP`: clarify `channel` config must be a Slack channel ID (e.g. `C123456`), not a name
  - `LabelHistoryCapable`: add `limit?: number` to `searchIssuesByLabel` opts

  **engine:**
  - `dedup-check` step: rename outcome from `"notify"` → `"duplicate"` so routing key is distinct from target node name
  - `triage definition`: update `on: { duplicate: "notify" }` to match

- Updated dependencies [2f1a424]
- Updated dependencies [68780d5]
- Updated dependencies [207a317]
- Updated dependencies [9313ff9]
- Updated dependencies [556a53d]
- Updated dependencies [ebbb5a7]
- Updated dependencies [010b6d7]
- Updated dependencies [f33c74d]
- Updated dependencies [1df08e0]
  - @sweny-ai/providers@1.0.0

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
