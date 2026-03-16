# @sweny-ai/cli

## 1.5.0

### Minor Changes

- 4a98abb: Add `sweny workflow validate <file>` command. Validates a workflow YAML or JSON
  file structurally (initial step exists, all transition targets are valid) and
  exits 0 if valid, 1 with human-readable errors if not. Use `--json` for
  machine-readable output suitable for CI pipelines.

### Patch Changes

- Updated dependencies [caf64a7]
  - @sweny-ai/engine@3.0.3

## 1.4.1

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

- Updated dependencies [c4d709a]
  - @sweny-ai/engine@3.0.2

## 1.4.0

### Minor Changes

- 1df7b8f: `sweny workflow run` now accepts `--steps <path>` to load a custom step type
  module before resolving the workflow. Teams can register their own step
  implementations and reference them in YAML workflows alongside built-in types.

### Patch Changes

- dc62460: Add `listStepTypes()` to engine for introspecting the built-in step registry.
  Add `sweny workflow list` CLI command to print all registered step types
  (human-readable by default, `--json` for machine-readable output).
- 7f284ff: JSON Schema for workflow YAML updated and renamed to `workflow-definition.schema.json`.
  Added the `type` field for built-in step types with known values as examples.
  CLI `sweny workflow export` and Studio's Export YAML button now include a
  `# yaml-language-server: $schema=...` header — VS Code auto-completes and
  validates workflow YAML files with no extra setup.
- Updated dependencies [dc62460]
- Updated dependencies [7f284ff]
  - @sweny-ai/engine@3.0.1

## 1.3.0

### Minor Changes

- 054d1f4: Add `--agent <provider>` flag to `sweny triage` and `sweny implement`.

  Supported values: `claude` (default), `codex`, `gemini`.
  `--agent` takes priority over the longer `--coding-agent-provider` flag.
  Also supported via `.sweny.yml`: `coding-agent-provider: codex`.

- 93e7710: Add declarative YAML workflow support.
  - New `StepDefinition.type` field for referencing built-in step implementations
  - New `resolveWorkflow(definition)` — resolves a WorkflowDefinition to a runnable Workflow using the built-in step registry
  - New `builtinStepRegistry` and `registerStepType` exports for extending the registry
  - New `@sweny-ai/engine/builtin-steps` subpath — import to register all built-in step types
  - New CLI command: `sweny workflow run <file.yaml>` — run any workflow from a YAML or JSON file
  - New CLI command: `sweny workflow export triage|implement` — print built-in workflow as YAML for forking

### Patch Changes

- 815d361: **Breaking**: Studio public exports renamed to workflow terminology.
  - `RecipeViewer` → `WorkflowViewer`
  - `RecipeViewerProps` → `WorkflowViewerProps`
  - Studio now listens for `workflow:start`, `step:enter`, `step:exit`, `workflow:end` events (matching engine v2)
  - Internal store fields: `currentStepId`, `completedSteps`, `updateWorkflowMeta`

  CLI: updated to use `runWorkflow`, `triageWorkflow`, `implementWorkflow` from engine (no user-facing change).

- Updated dependencies [c0119dc]
- Updated dependencies [1204f4f]
- Updated dependencies [93e7710]
  - @sweny-ai/providers@1.1.0
  - @sweny-ai/engine@3.0.0

## 1.2.0

### Minor Changes

- c24656a: Expand MCP auto-injection with four additional providers: GitLab, Sentry, Slack, and Notion.

  **New Category A injections** (triggered by existing provider config, zero new credentials required):
  - `source-control-provider: gitlab` → auto-injects `@modelcontextprotocol/server-gitlab` with `GITLAB_PERSONAL_ACCESS_TOKEN`; self-hosted instances get `GITLAB_API_URL` set automatically
  - `observability-provider: sentry` → auto-injects `@sentry/mcp-server` with `SENTRY_AUTH_TOKEN`; self-hosted Sentry gets `SENTRY_HOST` extracted from `sentry-base-url`

  **New Category B injections** (triggered by env var presence, no provider config change needed):
  - `SLACK_BOT_TOKEN` → auto-injects `@modelcontextprotocol/server-slack`, giving the agent full bidirectional Slack API access (separate from the one-way notification webhook)
  - `NOTION_API_KEY` → auto-injects `@notionhq/notion-mcp-server`, giving the agent access to runbooks, on-call docs, and incident templates

  Total auto-injected MCP servers: GitHub, GitLab, Linear, Datadog, Sentry, Slack, Notion (7).

  User-supplied `mcp-servers` config always wins on key conflict.

## 1.1.1

### Patch Changes

- d692176: Fix auto-injected MCP server configuration and S3 client initialization
  - Fix GitHub MCP server env var: use `GITHUB_PERSONAL_ACCESS_TOKEN` (required by `@modelcontextprotocol/server-github`) instead of `GITHUB_TOKEN`
  - Remove Datadog MCP auto-injection (endpoint was at an unstable `/unstable` path)
  - Fix S3 client lazy-init race condition: use a shared `_clientPromise` instead of `_client` so concurrent calls before the first init share one promise instead of creating multiple clients
  - Add smoke test coverage verifying that method calls (not just constructors) trigger lazy peer dep imports

- Updated dependencies [d692176]
  - @sweny-ai/providers@1.0.1

## 1.1.0

### Minor Changes

- ad1a352: Auto-inject MCP servers for configured providers — no user-facing MCP configuration required.

  When you configure `source-control-provider: github`, `issue-tracker-provider: linear`, or `observability-provider: datadog`, SWEny now automatically injects the corresponding MCP server into the coding agent's tool set. Linear and Datadog use HTTP transport (no local installation). GitHub uses the official `@modelcontextprotocol/server-github` package. User-supplied `mcp-servers` override auto-injected entries.

  Also extends GitHub MCP injection to `issue-tracker-provider: github-issues`.

### Patch Changes

- 4bc0500: CLI banner now reads version dynamically from package.json instead of a hardcoded string.

## 1.0.0

### Major Changes

- ebbb5a7: Remove wrong-pattern MCP adapter providers (breaking change).

  `linearMCP`, `githubMCP`, and `slackMCP` have been removed. These adapters called MCP servers from recipe steps — the wrong architectural layer. MCP servers are agent tools accessed during reasoning, not recipe-step backends.

  **Migration:** Configure these MCP servers via `mcpServers` in `CodingAgentRunOptions` (now supported in all three coding agents). The agent gets access to Linear, GitHub, and Slack MCP tools during its reasoning session with zero custom provider code.

  Also removed: `slack-mcp` notification provider option from CLI and GitHub Action (previously required `SLACK_BOT_TOKEN`, `SLACK_TEAM_ID`, `SLACK_CHANNEL`). Use the `slack` webhook notification provider or configure the Slack MCP server for the agent directly.

### Patch Changes

- 1df08e0: Task 03/04/05: wire slackMCP, add file providers to Action, shared factories.

  **providers (minor — new exports):**
  - `createObservabilityProvider(name, credentials, logger)` — shared factory for all 8 observability providers
  - `createCodingAgentProvider(name, logger, opts)` — shared factory for all 3 coding agents

  **cli (patch):**
  - `notification-provider: slack-mcp` now supported via `slackMCP()`
  - CLI and Action provider switches for observability and coding agent replaced with shared factory calls

  **action (patch):**
  - `issue-tracker-provider: file`, `source-control-provider: file`, `notification-provider: file` now supported
  - `slack-mcp` notification provider added
  - New `output-dir` input (default `.github/sweny-output`) for file-based providers
  - `slack-bot-token`, `slack-team-id`, `slack-channel` inputs added to `action.yml`

- Updated dependencies [2f1a424]
- Updated dependencies [0a59479]
- Updated dependencies [556a53d]
- Updated dependencies [68780d5]
- Updated dependencies [207a317]
- Updated dependencies [4465923]
- Updated dependencies [9313ff9]
- Updated dependencies [130138e]
- Updated dependencies [556a53d]
- Updated dependencies [ebbb5a7]
- Updated dependencies [42f6e95]
- Updated dependencies [010b6d7]
- Updated dependencies [f33c74d]
- Updated dependencies [1df08e0]
- Updated dependencies [4b4b29f]
  - @sweny-ai/providers@1.0.0
  - @sweny-ai/engine@2.0.0

## 0.3.0

### Minor Changes

- 474589e: Add `--review-mode` flag to `sweny implement`.
  - `--review-mode auto` enables GitHub auto-merge when CI passes (suppressed automatically for high-risk changes: migrations, auth files, lockfiles, or >20 changed files)
  - `--review-mode review` (default) opens a PR and waits for human approval

### Patch Changes

- Updated dependencies [5053263]
- Updated dependencies [474589e]
- Updated dependencies [6a71f2a]
- Updated dependencies [474589e]
  - @sweny-ai/providers@0.3.0
  - @sweny-ai/engine@1.0.0
