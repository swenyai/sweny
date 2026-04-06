---
name: triage
description: Run SWEny triage to investigate production alerts, create issues, and optionally implement fixes. Use when the user wants to analyze recent errors or alerts.
disable-model-invocation: true
allowed-tools: Bash
context: fork
agent: sweny-workflow
argument-hint: [--dry-run]
---

# SWEny Triage

Run the SWEny triage workflow. This investigates production alerts from configured observability providers (Datadog, Sentry, BetterStack, etc.), performs root cause analysis, creates issues, and optionally implements fixes.

**Prerequisites:** A `.sweny.yml` config file and provider credentials must be set up. Run `/sweny:check` first if unsure.

## Usage

Run triage with default settings:

```bash
sweny triage --stream
```

Run in dry-run mode (investigate only, skip creating issues/PRs):

```bash
sweny triage --stream --dry-run
```

If the user provided arguments, pass them through:

```bash
sweny triage --stream $ARGUMENTS
```

## What to expect

- The workflow takes 2-10 minutes depending on alert volume
- Progress events stream as NDJSON (node:enter, node:progress, node:exit)
- On completion, report a concise summary: how many alerts found, issues created, PRs opened
- If it fails, check `sweny check` output for credential issues

## Common flags

- `--dry-run` — investigate without creating issues or PRs
- `--time-range <range>` — time window to analyze (default: 24h)
- `--severity-focus <focus>` — severity level (default: errors)
- `--service-filter <filter>` — filter by service pattern
