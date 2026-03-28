---
title: FAQ
description: Frequently asked questions about SWEny — cost, AI model, integrations, security, and custom workflows.
---

## How much does SWEny cost?

SWEny is free and open source. You pay for Claude usage only.

- **Claude Max/Pro subscription** (`claude-oauth-token`) — triage runs are included in your existing subscription. No per-run charge.
- **Anthropic API key** (`anthropic-api-key`) — pay-per-use. A typical triage run costs roughly $0.10-$0.50 depending on log volume and investigation depth.

## What AI model does SWEny use?

Claude, via headless [Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview) — not the raw Anthropic API. Claude Code provides tool use, context management, and structured output built into the runtime. SWEny's executor sends each node's instruction and tools to Claude Code, which handles the rest.

## What observability tools are supported?

**Built-in skills:** Sentry, Datadog, and BetterStack (observability), GitHub (git), Linear (issue tracking), Slack and Notification (notifications). These have native skill integrations with purpose-built tools.

**Via Action inputs:** CloudWatch, Splunk, Elasticsearch, New Relic, Grafana Loki, Honeycomb, Axiom, Prometheus, PagerDuty, OpsGenie, Vercel, Supabase, Netlify, Fly.io, Render, Heroku. Set `observability-provider` to the one you use and add the relevant credentials.

**Via MCP servers:** Any tool with an MCP server can be added using the `mcp-servers` Action input. See [MCP Servers](/advanced/mcp-servers/).

**For testing:** Set `observability-provider: file` and point `log-file-path` at a local JSON log file. No external API calls.

## What issue trackers work?

| Tracker | Configuration |
|---------|--------------|
| **GitHub Issues** | Default — no extra credentials needed |
| **Linear** | Set `issue-tracker-provider: linear` + `linear-api-key` + `linear-team-id` |
| **Jira** | Set `issue-tracker-provider: jira` + `jira-base-url` + `jira-email` + `jira-api-token` |

## Can I create custom workflows?

Yes. Workflows are pure data — YAML or JSON — so you can write them by hand or use Studio's visual editor.

- Write a YAML workflow file and run it with the CLI: `sweny workflow run my-workflow.yml`
- Export a built-in workflow as a starting point: `sweny workflow export triage`
- Use [Studio](/studio/) to visually build and edit workflows in the browser

See [Custom Workflows](/workflows/custom/) and [YAML Reference](/workflows/yaml-reference/) for the full guide.

## How do skills work?

Skills are groups of tools. The `github` skill provides 7 tools: `github_search_code`, `github_get_issue`, `github_search_issues`, `github_create_issue`, `github_create_pr`, `github_list_recent_commits`, and `github_get_file`. Each skill declares its required environment variables — set them and the skill activates automatically.

At each node in the workflow, you list which skill IDs are available. Claude only sees tools from the skills assigned to that node. This keeps each step focused and prevents tool sprawl.

See [Skills Overview](/skills/) for the full catalog and configuration details.

## Is my code or data sent anywhere?

SWEny runs entirely within your infrastructure:

- **GitHub Action** — runs on GitHub Actions runners. Your code stays in the runner. API calls go only to your configured providers (Sentry, Datadog, Linear, etc.) and to Anthropic (for Claude).
- **CLI** — runs on your local machine. Same boundaries apply.

Nothing is persisted on SWEny servers. There are no SWEny servers — the project is a GitHub Action and npm packages.

## Can I use a different LLM?

The `coding-agent-provider` input supports three options for the **Implement** workflow:

| Provider | Input value | Credential |
|----------|------------|------------|
| Claude (default) | `claude` | `anthropic-api-key` or `claude-oauth-token` |
| OpenAI Codex | `codex` | `openai-api-key` |
| Google Gemini | `gemini` | `gemini-api-key` |

The Triage workflow always uses Claude for investigation and routing. The implementation step (writing code, opening PRs) can use any of the three providers.

## Does SWEny auto-merge PRs?

Not by default. The default `review-mode` is `review` — PRs are opened and wait for human approval.

Set `review-mode: auto` to enable GitHub auto-merge when CI passes. Even then, SWEny automatically suppresses auto-merge for high-risk changes: migrations, auth-related files, lockfile changes, or diffs touching more than 20 files.

## Does SWEny need write access to my repo?

Only if you want it to create issues and PRs. For a read-only dry run, set `dry-run: true` and use these minimal permissions:

```yaml
permissions:
  contents: read
  issues: read
```

For full operation (creating issues, opening PRs), grant:

```yaml
permissions:
  contents: write
  issues: write
  pull-requests: write
```

SWEny never pushes directly to protected branches. It creates feature branches and opens PRs.

## Why does SWEny say "no novel issues found"?

Common causes:

- **Time range too narrow** — increase `time-range` (e.g., `4h` to `24h` or `7d`)
- **All issues already tracked** — `novelty-mode: true` (the default) skips issues that match existing tickets. Set `novelty-mode: false` to force re-investigation
- **Service filter too narrow** — check that `service-filter` matches your service names
- **Observability credentials invalid** — verify your API keys are correct and have the right scopes

## Will SWEny create duplicate tickets?

No. Before creating an issue, the Triage workflow searches your issue tracker for recent issues matching the same error pattern. If a match exists, it skips to the terminal node instead of filing a duplicate. Set `novelty-mode: false` to disable this behavior during testing.

## Does it work with GitLab?

Yes. Set `source-control-provider: gitlab` and add `gitlab-token` and `gitlab-project-id`. The GitHub Action runs in GitHub Actions but can interact with GitLab repositories. The CLI works against any GitLab instance.

## Where do I get help?

- [Troubleshooting](/advanced/troubleshooting/) — common issues and solutions
- [GitHub Issues](https://github.com/swenyai/sweny/issues) — report bugs and request features
- [GitHub Discussions](https://github.com/swenyai/sweny/discussions) — ask questions and share workflows
