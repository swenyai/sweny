---
title: Concepts
description: Core concepts behind SWEny's workflow platform.
---

## Learn → Act → Report

Every SWEny workflow follows three phases:

1. **Learn** — Gather context from your systems. Query observability logs, search issue trackers for duplicates, check open PRs, and build a picture of what's happening.
2. **Act** — Take action based on AI-driven analysis. Create tickets, open branches, implement fixes, dispatch to other repos.
3. **Report** — Deliver results through your team's channels. Post summaries to Slack, email, GitHub, Discord, Teams, or fire webhooks.

The engine enforces this phase ordering. Steps in the Learn phase always run before Act, and Act before Report.

## Workflow

A **Workflow** is an ordered sequence of steps organized into the three phases. The engine executes steps in order, passing context and results between them. If a step fails, the engine can skip downstream steps or the entire phase.

## Step

A **Step** is a single unit of work within a workflow. Each step receives a context object with the workflow configuration, provider registry, and results from previous steps. Steps return a result with a status and optional data.

Built-in steps include things like "query logs", "deduplicate issues", "investigate error", "create ticket", "write fix", and "send notification".

**[SWEny Triage](/recipes/triage/)** is the built-in triage workflow — it automates the on-call triage loop by monitoring production logs, investigating the highest-impact issue, and opening a fix PR.

## Providers

**Providers** connect SWEny to your existing tools — your observability platform, issue tracker, source control, and notification channels. You choose one provider per category and configure it through Action inputs or `.sweny.yml`. No code required.

This means you can swap Datadog for CloudWatch, or Linear for Jira, without changing your workflow logic.

## Supported providers

| Phase | Category | Supported services |
|-------|----------|--------------------|
| **Learn** | Observability | Datadog, Sentry, CloudWatch, Splunk, Elasticsearch, New Relic, Grafana Loki |
| **Act** | Issue Tracking | Linear, GitHub Issues, Jira |
| **Act** | Source Control | GitHub, GitLab |
| **Act** | Coding Agent | Claude Code, OpenAI Codex, Google Gemini |
| **Report** | Notification | GitHub Summary, Console, Slack, Teams, Discord, Email, Webhook, File |

See [Provider Reference](/getting-started/providers/) to configure your observability, issue tracking, and notification providers.
