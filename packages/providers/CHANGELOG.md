# @sweny-ai/providers

## 1.1.2

### Patch Changes

- 3f87cc3: - fix(ci): resolve format and lint failures on main
- a625f3c: Fix Prettier formatting violations in coding-agent and source-control provider files. No behavioral changes — formatting only.

## 1.1.1

### Patch Changes

- a7ab63e: Add missing npm package metadata: keywords, bugs URL, and description improvements across all published packages. Fix engine description to say "Workflow" (not "Recipe"). Align Node.js engine requirement for cli and agent to >=22.0.0 to match providers (which uses global fetch).

## 1.1.0

### Minor Changes

- c0119dc: Migrate `@sweny-ai/agent` to `@anthropic-ai/claude-agent-sdk` (Anthropic split the programmatic SDK from the CLI binary).

  **Breaking in `@sweny-ai/agent`**: `customSystemPrompt` option renamed to `systemPrompt`.

  **New in `@sweny-ai/providers`**: File observability provider — use a local JSON log file as the observability source. Useful for CI exports and offline triage.

- 1204f4f: Providers now expose `configSchema` — a declarative list of required env vars.
  `runWorkflow()` runs pre-flight validation before step 1 and throws `WorkflowConfigError`
  listing all missing env vars grouped by step. Built-in workflows now declare `uses` on each step.

## 1.0.1

### Patch Changes

- d692176: Fix auto-injected MCP server configuration and S3 client initialization
  - Fix GitHub MCP server env var: use `GITHUB_PERSONAL_ACCESS_TOKEN` (required by `@modelcontextprotocol/server-github`) instead of `GITHUB_TOKEN`
  - Remove Datadog MCP auto-injection (endpoint was at an unstable `/unstable` path)
  - Fix S3 client lazy-init race condition: use a shared `_clientPromise` instead of `_client` so concurrent calls before the first init share one promise instead of creating multiple clients
  - Add smoke test coverage verifying that method calls (not just constructors) trigger lazy peer dep imports

## 1.0.0

### Major Changes

- 2f1a424: Rename triage-specific issue tracking interfaces to generic equivalents:
  - `TriageHistoryCapable` → `LabelHistoryCapable`
  - `TriageHistoryEntry` → `IssueHistoryEntry`
  - `listTriageHistory()` → `searchIssuesByLabel()` (signature: `(projectId, labelId, opts?: { days? })`)
  - `canListTriageHistory()` → `canSearchIssuesByLabel()`
  - Remove `FingerprintCapable` interface and `canSearchByFingerprint()` (dead code — never called from engine)
  - Make `Issue.branchName` optional (Linear returns real names; Jira/GitHub Issues synthesize them)
- ebbb5a7: Remove wrong-pattern MCP adapter providers (breaking change).

  `linearMCP`, `githubMCP`, and `slackMCP` have been removed. These adapters called MCP servers from recipe steps — the wrong architectural layer. MCP servers are agent tools accessed during reasoning, not recipe-step backends.

  **Migration:** Configure these MCP servers via `mcpServers` in `CodingAgentRunOptions` (now supported in all three coding agents). The agent gets access to Linear, GitHub, and Slack MCP tools during its reasoning session with zero custom provider code.

  Also removed: `slack-mcp` notification provider option from CLI and GitHub Action (previously required `SLACK_BOT_TOKEN`, `SLACK_TEAM_ID`, `SLACK_CHANNEL`). Use the `slack` webhook notification provider or configure the Slack MCP server for the agent directly.

### Minor Changes

- 9313ff9: Add `mcpServers` injection to coding agent providers.

  `CodingAgentRunOptions` now accepts `mcpServers?: Record<string, MCPServerConfig>`. When provided, all three coding agents (Claude Code, OpenAI Codex, Gemini) serialize the config to a temp JSON file and pass `--mcp-config <path>` to the agent CLI. The agent receives all configured MCP tools during its reasoning session. Temp file is cleaned up after the agent exits.

  `MCPServerConfig` extended to support both transports:
  - `type: "stdio"` — local pre-installed binary (`command`, `args`, `env`)
  - `type: "http"` — remote Streamable HTTP server (`url`, `headers`)

  Type defaults to `"http"` when `url` is set, `"stdio"` when `command` is set.

- 556a53d: Add browser-safe `PROVIDER_CATALOG` — a structured list of all available provider implementations with display names, categories, env var specs (key, description, required, secret, example), and import paths. Exported as `PROVIDER_CATALOG`, `getProvidersForCategory()`, and `getProviderById()` from the main package entry.
- f33c74d: Add `GitProvider` (local git operations) and `RepoProvider` (remote API operations) interfaces.
  `SourceControlProvider` is now a type alias for `GitProvider & RepoProvider` — fully backward compatible.
  Enables partial implementations for contexts without a local checkout (cloud workers, MCP servers).
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

### Patch Changes

- 68780d5: Fix `ERR_MODULE_NOT_FOUND` crash on import when optional peer deps are not installed. S3 storage classes (`S3SessionStore`, `S3MemoryStore`, `S3WorkspaceStore`) and `MCPClient` now lazy-load their peer dependencies (`@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `@modelcontextprotocol/sdk`) on first use rather than at module load time. Also fixes a retry bug in `MCPClient` where a failed `connect()` would leave a stale client reference that blocked subsequent reconnect attempts.
- 207a317: Add index signature to `ToolResult` to satisfy updated `@anthropic-ai/claude-agent-sdk` tool callback type constraints.
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

## 0.3.1

### Patch Changes

- 9940c68: Harden coding agent providers and fix Claude stream-json event parsing.
  - Extract `spawnLines()` to `shared.ts` — removes duplicated spawn code across Claude, Gemini, Codex
  - stderr now forwarded to logger in event mode (was silently discarded)
  - Event handler errors logged instead of swallowed
  - Process killed by signal resolves with -1 and logs signal name
  - `timeoutMs` added to `CodingAgentRunOptions` and `ExecOptions`
  - Stateful Claude event parser (`makeClaudeEventParser`) — maintains tool_use_id→name map
    so tool_result events carry human-readable tool names, not opaque IDs
  - Add `--verbose` flag required by Claude Code CLI for `--output-format stream-json`
  - Mock agent propagates `onEvent` errors so tests surface real failures

## 0.3.0

### Minor Changes

- 5053263: Add optional `onEvent` streaming callback to coding agent provider configs.
  - `ClaudeCodeConfig`, `GoogleGeminiConfig`, `OpenAICodexConfig`, `MockCodingAgentConfig`
    all accept `onEvent?: AgentEventHandler`
  - Claude provider uses `--output-format stream-json` for structured events (tool calls,
    tool results, text deltas, thinking blocks)
  - Gemini and Codex providers emit text lines as `{ type: "text" }` events
  - New `AgentEvent` and `AgentEventHandler` types exported from `@sweny-ai/providers/coding-agent`
  - No breaking changes — `onEvent` is optional; omitting it preserves existing behaviour exactly

- 474589e: New observability providers: Prometheus and PagerDuty.

### Patch Changes

- 6a71f2a: Harden coding agent providers: stderr capture, timeout support, error logging.
  - Extract `spawnLines()` helper to `shared.ts` — eliminates duplicate spawn code across
    Claude, Gemini, and Codex providers
  - `spawnLines` captures stderr and forwards each line to the logger (previously discarded)
  - Event handler errors are logged via the logger instead of silently swallowed
  - Process killed by signal resolves with exit code -1 and logs the signal name
  - Add `timeoutMs` to `CodingAgentRunOptions` — passed through to both event and non-event paths
  - Add `timeoutMs` to `execCommand` for non-event mode too
  - Mock agent now lets `onEvent` handler errors propagate (aids test debugging)

## 0.2.2

### Patch Changes

- d552edb: Add `description` field to the `Issue` interface. This field was used internally by the engine but missing from the type definition, causing TypeScript errors when accessing `issue.description`.
