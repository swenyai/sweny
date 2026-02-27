---
title: Action Inputs
description: All configuration inputs for the SWEny Triage GitHub Action.
---

## Authentication

| Input | Description | Required |
|-------|-------------|----------|
| `claude-oauth-token` | Claude Code OAuth token (Max/Pro subscriptions) | Recommended |
| `anthropic-api-key` | Anthropic API key (pay-per-use) | Alternative |

Most users should use `claude-oauth-token`. The `anthropic-api-key` option is available for direct API billing.

## Observability

| Input | Description | Default |
|-------|-------------|---------|
| `observability-provider` | Provider to use | `datadog` |
| `dd-api-key` | Datadog API key | — |
| `dd-app-key` | Datadog Application key | — |
| `dd-site` | Datadog site | `datadoghq.com` |

## Issue Tracker

| Input | Description | Default |
|-------|-------------|---------|
| `issue-tracker-provider` | Provider to use | `linear` |
| `linear-api-key` | Linear API key | — |
| `linear-team-id` | Linear team UUID | — |
| `linear-bug-label-id` | Label UUID for bugs | — |
| `linear-triage-label-id` | Label UUID for agent-triage | — |
| `linear-state-backlog` | State UUID for Backlog | — |
| `linear-state-in-progress` | State UUID for In Progress | — |
| `linear-state-peer-review` | State UUID for Peer Review | — |

## Investigation

| Input | Description | Default |
|-------|-------------|---------|
| `time-range` | Time window to analyze (`1h`, `6h`, `24h`, `7d`) | `24h` |
| `severity-focus` | What to look for (`errors`, `warnings`, `all`) | `errors` |
| `service-filter` | Service pattern (`my-svc`, `api-*`, `*`) | `*` |
| `investigation-depth` | How deep the agent investigates (`quick`, `standard`, `thorough`) | `standard` |
| `max-investigate-turns` | Max agent turns for investigation | `50` |
| `max-implement-turns` | Max agent turns for implementation | `30` |

## Behavior

| Input | Description | Default |
|-------|-------------|---------|
| `dry-run` | Analyze only, don't create PRs | `false` |
| `novelty-mode` | Only report issues not already tracked | `true` |
| `linear-issue` | Work on a specific Linear issue (e.g., `ENG-123`) | — |
| `additional-instructions` | Extra guidance for the agent | — |
| `service-map-path` | Path to service ownership map | `.github/service-map.yml` |
| `github-token` | GitHub token for PRs | `${{ github.token }}` |
| `bot-token` | Token with cross-repo permissions | — |
