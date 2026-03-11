# Task 01: Remove Wrong-Pattern MCP POC Files

## Context
During an architectural exploration session, three MCP provider files were created as
proof-of-concept to test whether native providers could be replaced by MCP servers.
The conclusion was that they cannot — MCP is a tool source, not a provider replacement.

The client wrapper (`mcp/client.ts`) is correct and will be used in Task 09.
The three provider files use the wrong pattern and must be removed before they cause
confusion or get built upon.

## What to Delete

```
packages/providers/src/issue-tracking/linear-mcp.ts   ← DELETE
packages/providers/src/notification/slack-mcp.ts       ← DELETE
packages/providers/src/source-control/github-mcp.ts    ← DELETE
```

## What to Keep

```
packages/providers/src/mcp/client.ts   ← KEEP (used in Task 09)
```

## Also Check

The `@modelcontextprotocol/sdk` was added as a devDependency and peerDependency during
the exploration. Verify it's still in `package.json` and correct — it should be:
- `devDependencies`: `"@modelcontextprotocol/sdk": "^1.0"`
- `peerDependencies`: `"@modelcontextprotocol/sdk": "^1.0"` (optional)
- `peerDependenciesMeta`: `"@modelcontextprotocol/sdk": { "optional": true }`

## Verification

After deleting:
```bash
cd packages/providers
npm run typecheck   # must pass
npm test            # must pass (767 tests)
```

## Changeset Required

This is a patch change to `@sweny-ai/providers` (removes files that were never in a
published release, but document it anyway).

Create `.changeset/cleanup-mcp-poc.md`:
```md
---
"@sweny-ai/providers": patch
---

Remove proof-of-concept MCP provider files (linear-mcp, slack-mcp, github-mcp).
These were exploratory and used the wrong abstraction pattern.
The MCP client wrapper (mcp/client.ts) is retained for future use.
```

## Commit Message

```
chore(providers): remove MCP POC provider files

Keep mcp/client.ts for future capability adapter work.
```
