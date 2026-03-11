# Task 02 — Wire `linearMCP` into CLI and Action as selectable issue tracker

## Context

`linearMCP` is fully implemented in `packages/providers/src/issue-tracking/linear-mcp.ts`.
It satisfies `IssueTrackingProvider & PrLinkCapable & LabelHistoryCapable` — a complete
drop-in for the native `linear()` provider, using the `@linear/mcp` MCP server.

Neither the CLI nor the Action currently expose it as a selectable option. Users who want
to use Linear via MCP have no way to do so without forking.

The `linearApiKey` config field already exists in both CLI and Action configs — no new
config fields needed.

## Changes required

### 1. `packages/cli/src/providers/index.ts`

Add import:
```ts
import { linear, jira, githubIssues, fileIssueTracking, linearMCP } from "@sweny-ai/providers/issue-tracking";
```

Add case to both `createProviders` and `createImplementProviders` issue tracker switches:
```ts
case "linear-mcp":
  registry.set("issueTracker", linearMCP({ apiKey: config.linearApiKey, logger }));
  break;
```
Place it right after the `"linear"` case in both functions.

### 2. `packages/action/src/providers/index.ts`

Add import:
```ts
import { linear, jira, githubIssues, linearMCP } from "@sweny-ai/providers/issue-tracking";
```

Add case to issue tracker switch:
```ts
case "linear-mcp":
  registry.set("issueTracker", linearMCP({ apiKey: config.linearApiKey, logger: actionsLogger }));
  break;
```

### 3. `packages/action/src/config.ts` — validation

In `validateInputs`, the existing `"linear"` case checks for `linearApiKey` and `linearTeamId`.
Add `"linear-mcp"` to the same validation case (it only needs `linearApiKey`; `linearTeamId` is
for Linear-specific config fields used in recipe steps, not in the MCP adapter itself):
```ts
case "linear":
case "linear-mcp":
  if (!config.linearApiKey) errors.push("...");
  // linearTeamId is only required for "linear" (not MCP)
  if (config.issueTrackerProvider === "linear" && !config.linearTeamId) errors.push("...");
  break;
```

### 4. `packages/cli/src/config.ts` — validation

Same treatment — find where `"linear"` is validated and extend it to cover `"linear-mcp"`.
Read the file first to find the exact validation logic.

## After changes

Run typechecks and tests:
```
cd packages/providers && npm run build
cd packages/cli && npm run typecheck
cd packages/action && npm run typecheck
cd packages/action && npx vitest run
```

## Definition of done

- `issue-tracker-provider: linear-mcp` works in both CLI and Action
- `npm run typecheck` passes in both packages
- No new test failures introduced
- Create a changeset: `@sweny-ai/cli` patch, `@sweny-ai/action` is private (no changeset needed for action)
