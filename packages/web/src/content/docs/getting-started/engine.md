---
title: Engine & Workflows
description: How SWEny's workflow engine orchestrates Learn, Act, Report pipelines.
---

SWEny's engine runs your workflow automatically — you don't need to write any code. It manages the flow between phases, handles provider connections, and routes to the right next step based on what each step returns.

## The three phases

### Learn

The Learn phase connects to your observability stack and issue tracker to gather context:

- Queries logs from your observability provider (Datadog, Sentry, CloudWatch, Splunk, Elasticsearch, New Relic, or Grafana Loki)
- Aggregates errors by service and pattern
- Searches your issue tracker for duplicates and checks open PRs to avoid double-filing
- Produces a ranked list of novel issues worth investigating

### Act

The Act phase hands context to an AI coding agent that takes action:

- Reads error logs and traces root causes through the codebase
- Files detailed tickets with root cause analysis and a suggested fix approach
- Creates branches, implements fixes, and opens PRs for human review

### Report

The Report phase delivers results through your team's channels:

- Posts summaries to GitHub Actions, Slack, Teams, or Discord
- Sends email digests via SendGrid
- Fires generic webhooks for custom integrations

## Key concepts

**Workflow** — A DAG of steps organized into the three phases. Workflows are defined in YAML or TypeScript, executed by the engine, and can be visualized in Studio. Built-in workflows (triage, implement) are ready to use out of the box — or build your own.

**Step** — A single unit of work. Steps run in phase order, and each step's output is available to downstream steps. If a step fails, the engine routes to the appropriate fallback based on the workflow definition.

**Provider** — A connection to an external service (Datadog, Linear, GitHub, Slack, etc.). You configure which providers SWEny uses through Action inputs or `.sweny.yml`. Providers are injected automatically into the steps that need them.

## Built-in workflows

### Triage

Automates the on-call triage loop:

1. **Learn** — query logs, aggregate by pattern, filter out known issues
2. **Act** — investigate the top novel issue, file a ticket, write and push a fix
3. **Report** — post a summary with links to the ticket and PR

See [Quick Start](/getting-started/) to set up Triage in your repo.

### Implement

Takes an existing issue identifier and produces a fix PR:

1. **Learn** — fetch the issue details from your tracker
2. **Act** — investigate the issue, implement a fix, open a PR
3. **Report** — post the result to your notification channel

## What's next

- [Quick Start](/getting-started/) — add Triage to your repo in 5 minutes
- [Provider Reference](/providers/observability/) — configure observability, issue tracking, and notifications
- [Workflow Authoring](/studio/recipe-authoring/) — build a custom workflow with your own steps
