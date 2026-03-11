---
"@sweny-ai/providers": patch
"@sweny-ai/engine": patch
---

Code review fixes for MCP adapters and triage dedup step.

**providers:**
- `MCPClient`: clear `connectPromise` on error to prevent stuck reconnections; use local variable before `callTool` to guard against concurrent disconnect
- `linearMCP`: throw on empty `id`/`identifier` in `toIssue()`; expose `limit` option in `searchIssuesByLabel()` (default 100)
- `githubMCP`: validate `repo` config as `owner/repo` format; guard against PR `number=0`; validate `targetRepo` in `dispatchWorkflow`
- `slackMCP`: clarify `channel` config must be a Slack channel ID (e.g. `C123456`), not a name
- `LabelHistoryCapable`: add `limit?: number` to `searchIssuesByLabel` opts

**engine:**
- `dedup-check` step: rename outcome from `"notify"` → `"duplicate"` so routing key is distinct from target node name
- `triage definition`: update `on: { duplicate: "notify" }` to match
