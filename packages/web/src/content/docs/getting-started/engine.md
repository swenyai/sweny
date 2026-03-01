---
title: Engine & Recipes
description: How SWEny's workflow engine orchestrates Learn, Act, Report pipelines.
---

## Overview

SWEny is built on a workflow engine that orchestrates AI-powered engineering tasks through three phases: **Learn**, **Act**, and **Report**. The engine manages provider connections, step execution, and data flow between phases.

Recipes are pre-built workflows that combine these phases for a specific use case. **Triage** is the first recipe -- it monitors production logs, investigates errors, and opens fix PRs.

## The three phases

### Learn

The Learn phase connects to your observability stack and issue tracker to gather context:

- Queries logs from your observability provider (Datadog, Sentry, CloudWatch, Splunk, Elasticsearch, New Relic, or Grafana Loki)
- Aggregates errors by service and pattern
- Searches your issue tracker (Linear, GitHub Issues, or Jira) for duplicates
- Checks open PRs in your source control (GitHub or GitLab) to avoid double-filing
- Produces a ranked list of novel issues worth investigating

### Act

The Act phase hands context to an AI agent that takes action:

- Reads error logs and traces root causes through the codebase
- Files detailed tickets with root cause analysis and suggested approach
- Creates branches, implements fixes, and opens PRs for human review
- Links PRs back to the originating issue

### Report

The Report phase delivers results through your team's channels:

- Posts summaries to GitHub Actions, Slack, Teams, or Discord
- Sends email digests via SendGrid
- Fires generic webhooks for custom integrations

## Core concepts

### Workflow

A Workflow is an ordered sequence of Steps. Each step receives context from previous steps and can produce output for downstream steps. The engine handles retries, timeouts, and error propagation.

### Step

A Step is a single unit of work within a workflow. Steps declare their inputs (what they read from context) and outputs (what they produce). Built-in steps include `QueryLogs`, `DeduplicateIssues`, `InvestigateError`, `CreateTicket`, `WriteFix`, and `Notify`.

### Recipe

A Recipe is a pre-configured Workflow with sensible defaults. It bundles together the right steps and provider configuration for a specific use case. The Triage recipe, for example, wires up Learn (query + deduplicate), Act (investigate + ticket + fix), and Report (notify).

### ProviderRegistry

The ProviderRegistry is how the engine discovers and connects to external services. You register providers by category -- observability, issue tracking, source control, notification -- and the engine injects them into steps that need them.

```typescript
import { createProviderRegistry } from "@sweny/engine";
import { datadog } from "@sweny/providers/observability";
import { linear } from "@sweny/providers/issue-tracking";
import { github } from "@sweny/providers/source-control";
import { slackWebhook } from "@sweny/providers/notification";

const providers = createProviderRegistry();
providers.set("observability", datadog({ apiKey: "...", appKey: "..." }));
providers.set("issueTracker", linear({ apiKey: "..." }));
providers.set("sourceControl", github({ token: "...", owner: "my-org", repo: "my-repo" }));
providers.set("notification", slackWebhook({ webhookUrl: "..." }));
```

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                     SWEny Engine                         │
│                                                          │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐           │
│  │  Learn    │───>│   Act    │───>│  Report  │           │
│  └────┬─────┘    └────┬─────┘    └────┬─────┘           │
│       │               │               │                  │
│  ┌────┴─────┐    ┌────┴─────┐    ┌────┴─────┐           │
│  │QueryLogs │    │Investigate│   │  Notify  │           │
│  │ Dedup    │    │ Ticket   │    │          │           │
│  │          │    │ Fix / PR │    │          │           │
│  └────┬─────┘    └────┬─────┘    └────┬─────┘           │
│       │               │               │                  │
├───────┴───────────────┴───────────────┴──────────────────┤
│                  ProviderRegistry                        │
│  Observability │ Issue Tracking │ Source Control │ Notify │
└──────────────────────────────────────────────────────────┘
```

## Triage: the first recipe

Triage is the first recipe shipped with SWEny. It automates the on-call triage loop:

1. **Learn** -- query logs for the configured time range, aggregate by error pattern, filter out known issues
2. **Act** -- investigate the top novel issue, file a ticket, write and push a fix
3. **Report** -- post a summary with links to the ticket and PR

See the [Quick Start](/getting-started/) to set up Triage in your repo.

## Running a workflow programmatically

```typescript
import { runWorkflow, triageWorkflow, createProviderRegistry } from "@sweny/engine";
import { datadog } from "@sweny/providers/observability";
import { linear } from "@sweny/providers/issue-tracking";
import { github } from "@sweny/providers/source-control";
import { githubSummary } from "@sweny/providers/notification";
import { claudeCode } from "@sweny/providers/coding-agent";

const providers = createProviderRegistry();
providers.set("observability", datadog({
  apiKey: process.env.DD_API_KEY!,
  appKey: process.env.DD_APP_KEY!,
}));
providers.set("issueTracker", linear({
  apiKey: process.env.LINEAR_API_KEY!,
}));
providers.set("sourceControl", github({
  token: process.env.GITHUB_TOKEN!,
  owner: "my-org",
  repo: "my-repo",
}));
providers.set("notification", githubSummary({}));
providers.set("codingAgent", claudeCode({}));

const result = await runWorkflow(triageWorkflow, {
  timeRange: "24h",
  severityFocus: "errors",
  serviceFilter: "*",
  repository: "my-org/my-repo",
  // ... other TriageConfig fields
}, providers);

console.log(result.status); // "completed" | "failed" | "partial"
```

## Provider docs

- [Observability](/providers/observability/) -- Datadog, Sentry, CloudWatch, Splunk, Elasticsearch, New Relic, Grafana Loki
- [Issue Tracking](/providers/issue-tracking/) -- Linear, GitHub Issues, Jira
- [Source Control](/providers/source-control/) -- GitHub, GitLab
- [Notification](/providers/notification/) -- GitHub Summary, Slack, Teams, Discord, Email, Webhook
