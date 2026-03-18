# @sweny-ai/engine

## 3.2.6

### Patch Changes

- 7b92353: Clear stale fix-declined.md before each implement-fix run

  A `fix-declined.md` left over from a prior triage run would cause the current
  run's implement-fix step to be skipped even when the new agent succeeded. The
  file is now deleted before the coding agent starts, so only a freshly-written
  decline signals a skip.

## 3.2.5

### Patch Changes

- b2eb6e7: Prevent coding agent from creating PRs directly during implement-fix step

  The implement prompt now explicitly instructs the agent not to run `gh pr create`
  or push the branch — both are handled by subsequent workflow steps. Previously the
  agent would sometimes open a PR itself, bypassing the `create-pr` step that appends
  the `Closes #N` keyword and links the PR to the issue tracker.

- b3e16fd: Fix multiple correctness and security issues found in code review

  **@sweny-ai/providers**
  - `file.ts`: Replace `execSync` string interpolation with `execFileSync` + args array,
    eliminating command injection risk from branch names, commit messages, and file paths
  - `github.ts`, `gitlab.ts`: Escape `searchTerm` before use in `new RegExp()` to prevent
    incorrect matching or ReDoS on identifiers containing regex metacharacters
  - `github-issues.ts`: Return issue `number` (not internal node `id`) from `createIssue`,
    `searchIssues`, and `getIssue` — all GitHub REST API endpoints that accept an issue
    reference expect the issue number, not the internal 9-digit node ID
  - `linear.ts`: Fix multi-label filter to use `{ some: { id: { in: labels } } }` instead
    of `{ id: { eq: labels[0] } }` which silently dropped all but the first label
  - `jira.ts`: Escape user-supplied values before embedding in JQL strings to prevent
    injection via `projectId`, `query`, `labels`, and `states` parameters

  **@sweny-ai/engine**
  - `implement-fix.ts`: Remove unreachable dead code — the `issueOverride` + non-open PR
    branch was nulled out before the check that used it; logic now correctly lets issue
    override bypass the duplicate-PR skip
  - `risk-assessor.ts`: Fix lockfile/`package.json` patterns to match nested paths
    (e.g. `packages/engine/package.json`) — anchored `^...$` patterns only matched
    root-level files
  - `cross-repo-check.ts`: Report `dispatched: false` when `dispatchWorkflow` throws
    instead of returning `{ dispatched: true }` on a failed dispatch

  **@sweny-ai/studio**
  - `WorkflowViewer.tsx`: Memoize `validateWorkflow` result via `useMemo` — was called
    4× per definition change (once per effect × two helper functions); now computed once
  - `App.tsx`: Guard global keyboard shortcuts so they don't fire while the user is
    typing in an `<input>`, `<textarea>`, or `contentEditable` element

- Updated dependencies [b3e16fd]
  - @sweny-ai/providers@1.1.4

## 3.2.4

### Patch Changes

- d83a3d3: Fix PR body always including issue closing keyword — don't rely on Claude to write it

  When `issue-tracker-provider` is `github-issues`, the PR body now always ends with
  `Closes #N`, which causes GitHub to auto-close the issue when the PR merges and
  creates the "Development" sidebar link. Previously the closing keyword was part of
  the prompt template Claude was asked to reproduce, but Claude would often omit it.

  The same footer fix applies to Linear and Jira (linked reference), and for the
  fallback body path (no `pr-description.md` generated).

## 3.2.3

### Patch Changes

- 3f87cc3: - fix(ci): resolve format and lint failures on main
- Updated dependencies [3f87cc3]
- Updated dependencies [a625f3c]
  - @sweny-ai/providers@1.1.2

## 3.2.2

### Patch Changes

- a7ab63e: Add missing npm package metadata: keywords, bugs URL, and description improvements across all published packages. Fix engine description to say "Workflow" (not "Recipe"). Align Node.js engine requirement for cli and agent to >=22.0.0 to match providers (which uses global fetch).
- Updated dependencies [a7ab63e]
  - @sweny-ai/providers@1.1.1

## 3.2.1

### Patch Changes

- 2deee05: - fix: review fixes — stderr, shape guard, parse helper, PropertiesPanel IIFE

## 3.2.0

### Minor Changes

- 46d6e86: Steps now support a `timeout` field (milliseconds). When set, the step is forcibly failed if it does not complete within the allotted time — preventing hung workflows. Works in both the Node.js runner and the browser-safe runner.

## 3.1.0

### Minor Changes

- 9325572: `validateWorkflow()` now detects unreachable steps (error code `UNREACHABLE_STEP`).
  Steps with no execution path from `initial` are reported as validation errors,
  helping catch dead code in workflow definitions early.

### Patch Changes

- 2af077b: Add `"UNREACHABLE_STEP"` to the `WorkflowDefinitionError.code` union — this code was emitted by `validateWorkflow()` but missing from the type, causing a TypeScript error in consuming code.

## 3.0.3

### Patch Changes

- caf64a7: `WORKFLOW_YAML_SCHEMA_HEADER` is now exported from `@sweny-ai/engine/browser`
  (the browser-safe entry). Studio's `export-yaml` now imports from the browser
  entry, ensuring the export YAML path pulls zero Node.js transitive dependencies.

## 3.0.2

### Patch Changes

- c4d709a: Fix schema publication, semver validation, and shared schema header constant.
  - `schema/` directory now included in engine package `files` so `@sweny-ai/engine/schema`
    actually ships to npm consumers (was silently missing before)
  - JSON Schema semver regex now anchored with `$` — previously allowed trailing
    garbage like `"1.0.0-junk!!!"` to pass validation
  - `WORKFLOW_YAML_SCHEMA_HEADER` exported from `@sweny-ai/engine` so CLI and Studio
    import a single source of truth instead of duplicating the URL string
  - Added schema tests: pre-release labels, build metadata, `type` field acceptance,
    unknown extra property rejection, end-anchor semver check

## 3.0.1

### Patch Changes

- dc62460: Add `listStepTypes()` to engine for introspecting the built-in step registry.
  Add `sweny workflow list` CLI command to print all registered step types
  (human-readable by default, `--json` for machine-readable output).
- 7f284ff: JSON Schema for workflow YAML updated and renamed to `workflow-definition.schema.json`.
  Added the `type` field for built-in step types with known values as examples.
  CLI `sweny workflow export` and Studio's Export YAML button now include a
  `# yaml-language-server: $schema=...` header — VS Code auto-completes and
  validates workflow YAML files with no extra setup.

## 3.0.0

### Minor Changes

- 1204f4f: Providers now expose `configSchema` — a declarative list of required env vars.
  `runWorkflow()` runs pre-flight validation before step 1 and throws `WorkflowConfigError`
  listing all missing env vars grouped by step. Built-in workflows now declare `uses` on each step.
- 93e7710: Add declarative YAML workflow support.
  - New `StepDefinition.type` field for referencing built-in step implementations
  - New `resolveWorkflow(definition)` — resolves a WorkflowDefinition to a runnable Workflow using the built-in step registry
  - New `builtinStepRegistry` and `registerStepType` exports for extending the registry
  - New `@sweny-ai/engine/builtin-steps` subpath — import to register all built-in step types
  - New CLI command: `sweny workflow run <file.yaml>` — run any workflow from a YAML or JSON file
  - New CLI command: `sweny workflow export triage|implement` — print built-in workflow as YAML for forking

### Patch Changes

- Updated dependencies [c0119dc]
- Updated dependencies [1204f4f]
  - @sweny-ai/providers@1.1.0

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
