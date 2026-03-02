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

## Recipe

A **Recipe** is a pre-built workflow with sensible defaults for a specific use case. Instead of wiring together steps manually, you pick a recipe and configure it.

**[SWEny Triage](/recipes/triage/)** is the first recipe — it automates the on-call triage loop by monitoring production logs, investigating the highest-impact issue, and opening a fix PR.

## ProviderRegistry

The **ProviderRegistry** is how the engine connects to external services. You register providers by role — observability, issue tracking, source control, notification — and the engine injects them into steps that need them.

This means you can swap Datadog for CloudWatch, or Linear for Jira, without changing your workflow logic.

```typescript
import { createProviderRegistry } from "@sweny-ai/engine";
import { datadog } from "@sweny-ai/providers/observability";
import { linear } from "@sweny-ai/providers/issue-tracking";
import { github } from "@sweny-ai/providers/source-control";

const providers = createProviderRegistry();
providers.set("observability", datadog({ apiKey, appKey }));
providers.set("issueTracker", linear({ apiKey }));
providers.set("sourceControl", github({ token, owner, repo }));
```

## Provider roles

Providers map to workflow phases:

| Phase | Provider Role | Implementations |
|-------|--------------|-----------------|
| **Learn** | Observability | Datadog, Sentry, CloudWatch, Splunk, Elasticsearch, New Relic, Grafana Loki |
| **Act** | Issue Tracking | Linear, GitHub Issues, Jira |
| **Act** | Source Control | GitHub, GitLab |
| **Act** | Incident Management | PagerDuty, OpsGenie |
| **Act** | Coding Agent | Claude Code, OpenAI Codex, Google Gemini |
| **Report** | Notification | GitHub Summary, Slack, Teams, Discord, Email, Webhook |
| **Report** | Messaging | Slack, Microsoft Teams |

See [Provider Architecture](/getting-started/providers/) for details on the plugin system, and [Engine & Recipes](/getting-started/engine/) for programmatic usage.
