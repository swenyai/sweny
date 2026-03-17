---
title: SWEny Triage
description: Autonomous SRE triage — monitors logs, investigates issues, and opens fix PRs.
---

**SWEny Triage** is the first built-in workflow. It automates the on-call triage loop: monitor your observability logs, identify the highest-impact novel issue, create a ticket with root cause analysis, implement a fix, and open a PR — all without human intervention.

## How it works

### Learn

- Queries your observability provider (Datadog, Sentry, CloudWatch, Splunk, Elasticsearch, New Relic, or Grafana Loki) for errors in the configured time window
- Aggregates errors by service and pattern
- Searches your issue tracker (Linear, GitHub Issues, or Jira) for existing tickets
- Checks open PRs to avoid duplicate work
- Ranks issues by impact and novelty

### Act

- Investigates the top novel issue using Claude AI — reads error logs, traces root causes through the codebase
- Creates a detailed ticket with root cause analysis
- Creates a branch, implements a fix, and opens a PR for human review
- Links the PR back to the originating issue

### Report

- Posts a summary to GitHub Actions, Slack, Teams, Discord, email, or webhooks
- Includes links to the ticket and PR, investigation details, and skipped items

## Key features

**Novelty gate** — Triage won't create duplicate tickets. It checks your issue tracker and open PRs for existing issues before acting. Known issues get a "+1 occurrence" comment instead.

**Cross-repo dispatch** — If the bug belongs to a different repository (determined via your [service map](/action/service-map/)), Triage automatically dispatches the fix workflow to the correct repo.

**Dry-run mode** — Run the full investigation without creating tickets or PRs. Useful for testing your configuration before going live.

## Configuration

Triage is configurable through GitHub Action inputs or programmatically via the engine:

- [Inputs](/action/inputs/) — time range, severity focus, service filter, investigation depth, provider credentials
- [Outputs](/action/outputs/) — issues found, recommendation, issue URL, PR URL
- [Examples](/action/examples/) — dry runs, specific issue targeting, service filtering

## Get started

Follow the [Quick Start](/getting-started/) to set up Triage in your repo in 5 minutes, or see the [End-to-End Walkthrough](/getting-started/walkthrough/) for a real scenario from error spike to merged PR.
