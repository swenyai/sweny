---
"@sweny-ai/providers": minor
"@sweny-ai/cli": patch
"@sweny-ai/action": patch
---

Task 03/04/05: wire slackMCP, add file providers to Action, shared factories.

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
