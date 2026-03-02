---
title: Troubleshooting
description: Common issues and how to fix them.
---

## Action issues

### "No novel issues found" every run

SWEny's duplicate detection checks your issue tracker for matching issues before acting. If it always skips:

- Check `time-range` — the default is `24h`. If your errors are older, try `7d`
- Check `severity-focus` — default is `errors`. Set to `warnings` if your logs use different severity levels
- Check `service-filter` — a filter like `payment-*` only matches services with that prefix
- Try `dry-run: true` with `investigation-depth: thorough` to see what SWEny finds without any skip logic

### Agent runs out of turns

If you see "max turns reached" in the output, the agent hit the iteration limit before finishing:

- Increase `max-investigate-turns` (default: 50) or `max-implement-turns` (default: 30)
- Use `additional-instructions` to focus the agent on a specific area
- Check that your repo isn't too large — the agent has to read files to understand the codebase

### Datadog returns no logs

- Verify your API key has `logs_read` permission
- Check that `dd-site` matches your Datadog region (e.g., `datadoghq.eu` for EU)
- Check that your services emit logs at the severity level you're filtering for
- Try a broader `service-filter` (`*`) and wider `time-range` (`7d`) to verify connectivity

### Linear ticket not created

- Verify `linear-api-key` has write access to the team specified by `linear-team-id`
- Check that `linear-bug-label-id` and `linear-triage-label-id` are valid UUIDs for labels in that team
- Check the Actions run log for error messages from the Linear API

### PR not opened

- Your workflow needs `permissions: { contents: write, pull-requests: write }`
- If using a fine-grained personal access token, it needs repository write access
- Check if a branch with the same name already exists (SWEny won't force-push)

## Agent issues

### "Either ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN must be set"

The agent validates environment variables on startup. Set at least one:

```bash
# Option 1: API key (pay per token)
ANTHROPIC_API_KEY=sk-ant-...

# Option 2: OAuth token (included with Claude Max/Pro)
CLAUDE_CODE_OAUTH_TOKEN=...
```

### Slack bot doesn't respond

- Verify `SLACK_APP_TOKEN` starts with `xapp-` and `SLACK_BOT_TOKEN` starts with `xoxb-`
- Check that Socket Mode is enabled in your Slack app settings
- Verify bot token scopes include `chat:write`, `app_mentions:read`, `im:history`
- Check the agent logs for connection errors

### "Cannot find module '@sweny-ai/providers/...'"

If you see this when building:

- Make sure `@sweny-ai/providers` is installed
- Run `npm run build` in the providers package first (it needs to generate `dist/`)
- Check that your `tsconfig.json` uses `moduleResolution: "NodeNext"`

## Cost questions

### How much does a triage run cost?

With an API key, a typical run uses 10k–50k tokens depending on error complexity and `investigation-depth`. At current Claude Sonnet pricing, that's roughly $0.10–$0.50 per run.

With a Claude Max/Pro OAuth token, triage runs are included in your subscription.

### How do I limit costs?

- Set `max-investigate-turns` to a lower value (e.g., `20` instead of `50`)
- Use `service-filter` to focus on specific services
- Use `investigation-depth: quick` for faster, cheaper runs
- Run less frequently (weekly instead of twice-weekly)

### Agent runs out of context

If you see "context window exceeded" in the output, the codebase or error logs are too large:

- Use `service-filter` to narrow the scope
- Use `severity-focus: errors` to exclude warnings
- Set `investigation-depth: quick` for a lighter analysis
