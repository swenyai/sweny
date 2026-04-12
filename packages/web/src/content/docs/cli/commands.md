---
title: Commands Reference
description: Full reference for every SWEny CLI command, flag, and option.
---

The `sweny` binary is provided by the `@sweny-ai/core` package. All commands auto-load `.env` and search upward for `.sweny.yml` before parsing flags.

## sweny new

Create a new SWEny workflow. Interactive picker offering templates, AI-generated workflows, end-to-end browser testing, or a blank start.

```bash
sweny new
```

In a fresh repo, walks you through provider inference, credential collection, and writes `.sweny.yml` + `.env` + `.sweny/workflows/<id>.yml`. In a repo that already has `.sweny.yml`, adds the new workflow non-destructively — existing config is preserved and `.env` is append-only.

> `sweny init` is a deprecated alias for `sweny new`. Use `sweny new` instead.

## sweny check

Verify that all configured provider credentials are valid and can connect.

```bash
sweny check
```

Reads providers from `.sweny.yml` and `.env`, then tests connectivity for each one. Prints a pass/fail status per provider with actionable error messages. Exits `0` if all providers pass, `1` if any fail.

Run this after initial setup or when rotating credentials.

## sweny setup

Create the standard SWEny label set in your issue tracker or source control provider. This is an interactive setup wizard with provider-specific subcommands.

### sweny setup linear

Create SWEny labels in a Linear workspace.

```bash
sweny setup linear --team-id <id>
```

| Option | Description | Default |
|--------|-------------|---------|
| `--team-id <id>` | Linear team ID (required) | `LINEAR_TEAM_ID` env var |

Requires `LINEAR_API_KEY` in your environment. Creates the `agent` parent label, work-type labels (`triage`, `feature`, `optimization`, `research`, `support`, `spec`, `task`), signal labels (`agent-needs-input`, `agent-error`, `human-only`, `needs-review`), and a `bug` label. Prints a config snippet ready to paste into `.sweny.yml`.

### sweny setup github

Create SWEny labels in a GitHub repository.

```bash
sweny setup github --repo <owner/repo>
```

| Option | Description | Default |
|--------|-------------|---------|
| `--repo <owner/repo>` | GitHub repository (required) | `GITHUB_REPOSITORY` env var |

Requires `GITHUB_TOKEN` in your environment. Creates the same label set as the Linear setup, referenced by name (no UUIDs needed for GitHub).

## sweny triage

Run the SWEny triage workflow: fetch errors from your observability platform, investigate root causes, create issues, and optionally open fix PRs.

```bash
sweny triage [options]
```

### Provider options

| Option | Description | Default |
|--------|-------------|---------|
| `--agent <provider>` | Coding agent: `claude`, `codex`, `gemini` (alias: `--coding-agent-provider`) | `claude` |
| `--observability-provider <provider>` | Observability platform | `datadog` |
| `--issue-tracker-provider <provider>` | Issue tracker: `github-issues`, `linear`, `jira`, `file` | `github-issues` |
| `--source-control-provider <provider>` | Source control: `github`, `gitlab`, `file` | `github` |
| `--notification-provider <provider>` | Notification: `console`, `slack`, `teams`, `discord`, `email`, `webhook`, `file` | `console` |

### Investigation options

| Option | Description | Default |
|--------|-------------|---------|
| `--time-range <range>` | Time range to analyze (e.g. `1h`, `4h`, `24h`, `7d`) | `24h` |
| `--severity-focus <focus>` | Severity level focus | `errors` |
| `--service-filter <filter>` | Service filter glob pattern | `*` |
| `--investigation-depth <depth>` | Investigation depth: `quick`, `standard`, `thorough` | `standard` |
| `--max-investigate-turns <n>` | Max Claude turns for investigation (1-500) | `50` |
| `--max-implement-turns <n>` | Max Claude turns for implementation (1-500) | `30` |

### PR and branch options

| Option | Description | Default |
|--------|-------------|---------|
| `--base-branch <branch>` | Base branch for PRs | `main` |
| `--pr-labels <labels>` | Comma-separated PR labels | `agent,triage,needs-review` |
| `--issue-labels <labels>` | Comma-separated labels for agent-created issues | -- |
| `--repository <owner/repo>` | Repository (auto-detected from git remote) | -- |
| `--review-mode <mode>` | PR merge behavior: `auto` (merge when CI passes) or `review` (human approval) | `review` |

### Behavior options

| Option | Description | Default |
|--------|-------------|---------|
| `--dry-run` | Analyze only -- the executor stops at the first conditional edge, guaranteeing zero side effects (no issues created, no PRs opened, no notifications sent). This is enforced by the executor, not by prompt instructions. | `false` |
| `--no-novelty-mode` | Allow +1 on existing issues instead of skipping duplicates | -- |
| `--issue-override <issue>` | Work on a specific existing issue instead of scanning for new ones | -- |
| `--additional-instructions <text>` | Extra instructions passed to the coding agent | -- |
| `--service-map-path <path>` | Path to service map YAML | `.github/service-map.yml` |

### Output options

| Option | Description | Default |
|--------|-------------|---------|
| `--json` | Output results as JSON to stdout; suppress progress rendering | `false` |
| `--stream` | Stream NDJSON `ExecutionEvent` objects to stdout (for Studio / automation) | `false` |
| `--bell` | Ring terminal bell on completion | `false` |

### Cache options

The executor caches each completed node's result. If a workflow crashes mid-execution and is restarted, previously completed nodes are loaded from cache instead of re-executed. This saves time and API costs during development and crash recovery.

| Option | Description | Default |
|--------|-------------|---------|
| `--cache-dir <path>` | Step cache directory | `.sweny/cache` |
| `--cache-ttl <seconds>` | Cache TTL in seconds (0 = infinite) | `86400` |
| `--no-cache` | Disable step cache entirely | -- |
| `--output-dir <path>` | Output directory for file providers | `.sweny/output` |

Disable caching with `--no-cache` when debugging or when input data has changed but the workflow definition hasn't.

### Provider-specific options

| Option | Description |
|--------|-------------|
| `--linear-team-id <id>` | Linear team ID |
| `--linear-bug-label-id <id>` | Linear bug label ID |
| `--linear-triage-label-id <id>` | Linear triage label ID |
| `--linear-state-backlog <name>` | Linear backlog state name |
| `--linear-state-in-progress <name>` | Linear in-progress state name |
| `--linear-state-peer-review <name>` | Linear peer-review state name |
| `--log-file <path>` | Path to JSON log file (for `--observability-provider file`) |
| `--dd-site <site>` | Datadog site (default: `datadoghq.com`) |
| `--sentry-org <org>` | Sentry organization slug |
| `--sentry-project <project>` | Sentry project slug |
| `--sentry-base-url <url>` | Sentry base URL (default: `https://sentry.io`) |
| `--cloudwatch-region <region>` | AWS CloudWatch region (default: `us-east-1`) |
| `--cloudwatch-log-group-prefix <prefix>` | CloudWatch log group prefix |
| `--splunk-index <index>` | Splunk index (default: `main`) |
| `--elastic-index <index>` | Elasticsearch index (default: `logs-*`) |
| `--newrelic-region <region>` | New Relic region (default: `us`) |
| `--prometheus-url <url>` | Prometheus base URL |
| `--prometheus-token <token>` | Prometheus bearer token |
| `--heroku-app-name <name>` | Heroku application name |
| `--opsgenie-region <region>` | OpsGenie region (default: `us`) |
| `--honeycomb-dataset <name>` | Honeycomb dataset name |
| `--axiom-dataset <name>` | Axiom dataset name |
| `--axiom-org-id <id>` | Axiom org ID |
| `--betterstack-source-id <id>` | Better Stack log source ID |
| `--betterstack-table-name <name>` | Better Stack ClickHouse table name |
| `--gitlab-base-url <url>` | GitLab base URL (default: `https://gitlab.com`) |
| `--workspace-tools <tools>` | Comma-separated workspace tool integrations: `slack`, `notion`, `pagerduty`, `monday` |

## sweny implement

Implement a fix for an existing issue and open a PR. Fetches the issue from your tracker, investigates the codebase, implements a fix, and creates a pull request. No observability provider needed.

```bash
sweny implement <issueId> [options]
```

The `<issueId>` argument is the issue identifier from your tracker (e.g. `ENG-123` for Linear, `#42` for GitHub Issues).

| Option | Description | Default |
|--------|-------------|---------|
| `--agent <provider>` | Coding agent: `claude`, `codex`, `gemini` (alias: `--coding-agent-provider`) | `claude` |
| `--issue-tracker-provider <provider>` | Issue tracker: `linear`, `jira`, `github-issues`, `file` | `linear` |
| `--source-control-provider <provider>` | Source control: `github`, `gitlab`, `file` | `github` |
| `--dry-run` | Skip creating PR -- report only | `false` |
| `--max-implement-turns <n>` | Max coding agent turns (1-500) | `40` |
| `--base-branch <branch>` | Base branch for PRs | `main` |
| `--repository <owner/repo>` | Repository (auto-detected from git remote) | -- |
| `--review-mode <mode>` | PR merge: `auto` or `review` | `review` |
| `--additional-instructions <text>` | Extra instructions for the coding agent | -- |
| `--stream` | Stream NDJSON events to stdout (for Studio / automation) | `false` |
| `--linear-team-id <id>` | Linear team ID | -- |
| `--linear-state-in-progress <name>` | Linear in-progress state name | -- |
| `--linear-state-peer-review <name>` | Linear peer-review state name | -- |
| `--output-dir <path>` | Output directory for file providers | `.sweny/output` |
| `--workspace-tools <tools>` | Comma-separated workspace tool integrations | -- |

## sweny workflow

Manage and run workflow files. All workflow subcommands operate on YAML or JSON workflow definitions.

### sweny workflow validate

Validate a workflow file without running it.

```bash
sweny workflow validate <file> [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `--json` | Output result as JSON | `false` |

Exits `0` if valid, `1` with error details if not. Useful in CI to catch schema errors before deployment.

```bash
sweny workflow validate my-workflow.yml
# ✓ my-workflow.yml is valid

sweny workflow validate broken.yml
# ✕ broken.yml has 2 validation errors:
#     Missing required field: entry
#     Node "fetch" references unknown skill "nonexistent"
```

### sweny workflow run

Execute a custom workflow file.

```bash
sweny workflow run <file> [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `--dry-run` | Validate the workflow and print its node list without running | `false` |
| `--json` | Output result as JSON to stdout; suppress progress rendering | `false` |
| `--stream` | Stream NDJSON events to stdout (for Studio / automation) | `false` |

Loads the workflow definition, validates its schema, then executes it with the same DAG renderer and skill infrastructure as the built-in `triage` and `implement` commands. Provider settings from `.sweny.yml` and `.env` apply.

### sweny workflow export

Print a built-in workflow as YAML. Use this to get a starting point for customization.

```bash
sweny workflow export <name>
```

The `<name>` argument must be `triage` or `implement`.

```bash
# Export the triage workflow and save it for editing
sweny workflow export triage > my-triage.yml
```

### sweny workflow create

Generate a new workflow from a natural language description.

```bash
sweny workflow create <description> [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `--json` | Output workflow JSON to stdout (skip interactive prompt) | `false` |

In interactive mode, the CLI displays a DAG preview of the generated workflow and prompts you to save, refine, or discard:

```
  Save to .sweny/workflows/check-slow-queries.yml? [Y/n/refine]
```

Choosing `refine` (or typing a refinement instruction directly) sends your feedback back to the LLM to iterate on the design.

### sweny workflow edit

Edit an existing workflow file with natural language instructions.

```bash
sweny workflow edit <file> [instruction] [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `--json` | Output updated workflow JSON to stdout (skip interactive prompt) | `false` |

If `[instruction]` is omitted, the CLI prompts you interactively. After editing, the updated DAG is displayed with the same save/refine/discard flow as `workflow create`.

```bash
# Inline instruction
sweny workflow edit my-workflow.yml "add a Slack notification after creating tickets"

# Interactive
sweny workflow edit my-workflow.yml
#  What would you like to change? _
```

### sweny workflow list

List all available skills that can be used in workflow nodes.

```bash
sweny workflow list [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `--json` | Output as JSON array | `false` |

Prints each skill's ID, category, and description. Skills are the building blocks that workflow nodes reference via the `skills` field.

## sweny e2e

Generate and run AI-driven end-to-end browser tests. See the [E2E Testing guide](/cli/e2e/) for the full walkthrough.

### sweny e2e init

Interactive wizard that generates workflow YAML files for testing your web app's flows.

```bash
sweny e2e init
```

Walks you through selecting flow types (registration, login, purchase, onboarding, upgrade, cancellation, custom), configuring per-flow details (URL paths, form fields, success criteria), setting the base URL, and optionally enabling cleanup. Outputs `.sweny/e2e/<flow-name>.yml` files and appends env vars to `.env`.

### sweny e2e run

Execute e2e workflow files.

```bash
sweny e2e run [file] [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `[file]` | Run a specific workflow file | All `.sweny/e2e/*.yml` |
| `--timeout <ms>` | Timeout per workflow in milliseconds | `900000` (15 min) |

Without a file argument, runs all `.yml` files in `.sweny/e2e/` sequentially. Loads `.env`, resolves template variables (`{base_url}`, `{test_email}`, `{run_id}`, etc.), and executes each workflow. Exits `0` if all pass, `1` if any fail.

## sweny publish

Publish a workflow or skill to the SWEny marketplace. Interactive CLI that validates your content and opens a pull request against the marketplace repository.

```bash
sweny publish
```

Walks you through:

1. **Select type** — workflow or skill
2. **Select path** — pick the file (workflow) or directory (skill) to publish
3. **Validate** — checks schema, frontmatter, and structure
4. **Metadata** — add tags, category, and description
5. **Submit** — forks the marketplace repo via `gh`, creates a branch, and opens a PR

Requires the [GitHub CLI](https://cli.github.com/) (`gh`) to be installed and authenticated. If `gh` is not available, the command saves validated files locally to `./sweny-publish/` for manual submission.

## Global options

These options are available on all commands:

| Option | Description |
|--------|-------------|
| `--version` | Print the CLI version |
| `--help` | Show help for a command |
