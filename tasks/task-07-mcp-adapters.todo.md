# Task 07: Build Correct MCP Adapters

## Context

The proof-of-concept MCP files (deleted in Task 01) used the wrong pattern: they tried
to REPLACE providers with MCP. The correct pattern is: MCP servers are one possible
BACKEND for a provider adapter that still satisfies the existing interfaces.

The `MCPClient` in `packages/providers/src/mcp/client.ts` is correct — keep it.
This task builds three adapter factories on top of it that satisfy the clean interfaces
from Tasks 02-03.

## What to Build

### `packages/providers/src/issue-tracking/linear-mcp.ts` (rebuilt)

Satisfies: `IssueTrackingProvider & PrLinkCapable & LabelHistoryCapable`

MCP server: `@linear/mcp` (npx)
Auth: `LINEAR_API_KEY` env var

```typescript
export interface LinearMCPConfig {
  apiKey: string;
  toolMap?: { ... };  // Override tool names if server version changes
}

export function linearMCP(config: LinearMCPConfig): IssueTrackingProvider & PrLinkCapable & LabelHistoryCapable
```

Gaps to document in file:
- `searchIssuesByLabel` with date filtering: Linear MCP `search_issues` may not support `createdAfter`
  → fallback: fetch more results and filter client-side by createdAt
- `branchName`: derive from identifier if not in MCP response
- Tool names: defaulted from `@linear/mcp`, configurable via `toolMap`

### `packages/providers/src/notification/slack-mcp.ts` (rebuilt)

Satisfies: `NotificationProvider`

MCP server: `@modelcontextprotocol/server-slack` (npx)
Auth: `SLACK_BOT_TOKEN` + `SLACK_TEAM_ID` env vars

Gap to document: Auth model change (webhook URL → OAuth bot token). Rich Block Kit
formatting degrades to plain markdown. Document this clearly.

### `packages/providers/src/source-control/github-mcp.ts` (rebuilt)

Satisfies: `RepoProvider` ONLY (not `GitProvider` — local git cannot come from MCP)

MCP server: `@modelcontextprotocol/server-github` (npx)
Auth: `GITHUB_PERSONAL_ACCESS_TOKEN` env var

This is the KEY LESSON from the exploration: only the `RepoProvider` half can be
satisfied by MCP. The `GitProvider` half requires a local process. This should be
crystal clear in the file and in the exported types.

```typescript
export function githubMCP(config: GitHubMCPConfig): RepoProvider
// NOT SourceControlProvider — this intentionally cannot satisfy GitProvider
```

## What NOT to Build

No `MCPGitProvider` — local git operations cannot be served from a remote MCP server.
This boundary should be explicit.

## Mcp/index.ts

Create `packages/providers/src/mcp/index.ts` to export the client:
```typescript
export { MCPClient, type MCPServerConfig } from "./client.js";
```

Update `packages/providers/package.json` exports to add `"./mcp": "./dist/mcp/index.js"`.

## Verification

```bash
cd packages/providers
npm run typecheck   # must pass
npm test            # existing tests still pass; new MCP adapters need unit tests
```

Write at least one test per adapter that:
- Verifies the adapter satisfies the interface (TypeScript structural check)
- Mocks MCPClient.call() and verifies the method-to-tool mapping

## Changeset

Create `.changeset/mcp-adapters.md`:
```md
---
"@sweny-ai/providers": minor
---

Add MCP-backed provider adapters: `linearMCP`, `slackMCP`, `githubMCP`.
These wrap `@modelcontextprotocol/sdk` MCP servers and satisfy the standard
provider interfaces. Note: `githubMCP` satisfies `RepoProvider` only —
local git operations (`GitProvider`) cannot be served from a remote MCP server.
```

## Commit Message
```
feat(providers): add correct MCP provider adapters

linearMCP → IssueTrackingProvider & PrLinkCapable & LabelHistoryCapable
slackMCP  → NotificationProvider
githubMCP → RepoProvider (not SourceControlProvider — GitProvider requires local git)
```
