---
"@sweny-ai/providers": major
"@sweny-ai/cli": major
---

Remove wrong-pattern MCP adapter providers (breaking change).

`linearMCP`, `githubMCP`, and `slackMCP` have been removed. These adapters called MCP servers from recipe steps — the wrong architectural layer. MCP servers are agent tools accessed during reasoning, not recipe-step backends.

**Migration:** Configure these MCP servers via `mcpServers` in `CodingAgentRunOptions` (now supported in all three coding agents). The agent gets access to Linear, GitHub, and Slack MCP tools during its reasoning session with zero custom provider code.

Also removed: `slack-mcp` notification provider option from CLI and GitHub Action (previously required `SLACK_BOT_TOKEN`, `SLACK_TEAM_ID`, `SLACK_CHANNEL`). Use the `slack` webhook notification provider or configure the Slack MCP server for the agent directly.
