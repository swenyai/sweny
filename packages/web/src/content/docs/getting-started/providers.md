---
title: Provider Reference
description: Which providers SWEny supports and how to choose one for each category.
---

Providers connect SWEny to your existing tools — your observability platform, issue tracker, source control, and notification channels. You choose one provider per category and configure it through Action inputs or `.sweny.yml`. No code required.

## Supported providers

| Category | Supported services | Configure via |
|----------|--------------------|---------------|
| **Observability** | Datadog, Sentry, CloudWatch, Splunk, Elasticsearch, New Relic, Grafana Loki | `observability-provider` |
| **Issue Tracking** | Linear, GitHub Issues, Jira | `issue-tracker-provider` |
| **Source Control** | GitHub, GitLab | `source-control-provider` |
| **Notification** | GitHub Summary, Slack, Teams, Discord, Email, Webhook | `notification-provider` |
| **Incident** | PagerDuty, OpsGenie | `incident-provider` |
| **Messaging** | Slack, Microsoft Teams | `messaging-provider` |
| **Coding Agent** | Claude Code, OpenAI Codex, Google Gemini | `coding-agent-provider` |

## Choosing a provider

### Observability

If you're already using Datadog, Sentry, CloudWatch, or another supported platform, point SWEny at it directly — no extra setup. See [Observability Providers](/providers/observability/) for the full config reference.

### Issue tracking

**GitHub Issues is the default** — no extra credentials needed. If your team uses Linear or Jira, add the relevant API key and set `issue-tracker-provider`. See [Issue Tracking Providers](/providers/issue-tracking/).

### Notifications

The default is **GitHub Actions Summary** — zero setup, results appear inline in your workflow run. For team channels, configure a Slack webhook URL, Teams webhook, Discord webhook, or SendGrid email. See [Notification Providers](/providers/notification/).

### Source control

**GitHub is the default** when running as a GitHub Action. GitLab is supported for cross-repo scenarios. See [Source Control Providers](/providers/source-control/).

## Multiple notification channels

You can send notifications to more than one channel by passing a comma-separated list:

```yaml
- uses: swenyai/sweny@v3
  with:
    notification-provider: 'github-summary,slack'
    slack-webhook-url: ${{ secrets.SLACK_WEBHOOK_URL }}
```

## Advanced: custom providers

> **Building on top of SWEny?** If you're extending SWEny programmatically, each category is a TypeScript interface you can implement. See the [providers package](https://github.com/swenyai/sweny/tree/main/packages/providers) on GitHub for the interfaces and existing implementations.
