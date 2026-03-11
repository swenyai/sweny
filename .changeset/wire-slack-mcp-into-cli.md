---
"@sweny-ai/cli": minor
"@sweny-ai/providers": patch
---

Add `slack-mcp` as a selectable notification provider. Set `--notification-provider slack-mcp` with `SLACK_BOT_TOKEN`, `SLACK_TEAM_ID`, and `--slack-channel` to send notifications via the Slack MCP server using an OAuth bot token instead of an incoming webhook URL.

Also fixes `SlackMCPConfig` type to use `z.input` so callers can omit `postMessageTool` (which has a default value).
