---
title: CLI Quick Start
description: Install the SWEny CLI, run a named workflow, and read its receipt.
---

The SWEny CLI is how you create, run, and compare workflows from your terminal. This page is the shortest path from nothing to a first useful run.

## Credentials

You need Node 20+ and a login or API key for the agent that runs your nodes. Claude Code is the default; pick another with `--agent`.

| Agent | Credentials it needs |
|-------|----------------------|
| Claude Code (default) | `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`), or `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN`, or a Claude Code login (`claude`, then `/login`), or Bedrock / Vertex routing. |
| Codex (`--agent codex`) | `CODEX_API_KEY`, `OPENAI_API_KEY` or `CODEX_ACCESS_TOKEN`, or a `codex login`. |
| pi (`--agent pi`) | The API key of the model provider pi calls (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, ...). |
| ACP agent (`--agent "acp:<command>"`) | Whatever that agent needs. Pass its API key env var through `SWENY_ENV_PASSTHROUGH`. |

Skill credentials (`GITHUB_TOKEN` and so on) are separate and only needed by workflows that use those skills. The CLI auto-loads `.env` at startup. See [Agents and policies](/getting-started/agents-and-policies/).

## Your first run

```bash
npx @sweny-ai/core new      # pick a named workflow, for example explain-repo
```

Install once with `npm install -g @sweny-ai/core` and the binary is `sweny`; the rest of this page uses it.

**1. Pick a named workflow.** `sweny new` opens the picker; `sweny new --template explain-repo --yes` skips the prompts. `explain-repo` reads your checkout and needs no skill credentials. It writes `.sweny.yml`, `.env` and `.sweny/workflows/explain-repo.yml`.

**2. Check before you run.** `sweny check` verifies your agent login and only the credentials your workflows need, and stops with the fix when one is missing.

```bash
sweny check
```

**3. Run it and read the receipt.**

```bash
sweny workflow run .sweny/workflows/explain-repo.yml
```

The run prints the answer, then a receipt: nodes, tool calls, duration, tokens, cost and the policy the agent ran under. The answer is saved to `.sweny/runs/<id>/output.md`.

**4. What next.** After your first successful run in a workspace the CLI prints three next steps, once (never in CI): `sweny runs` lists your history, `sweny runs diff` compares the run with the one before it after you run it again, and `sweny new --template weekly-digest` puts a workflow on a schedule. See the [Quick Start](/getting-started/quick-start/) for the full path.

:::tip[Replay demo]
`sweny try` replays a recorded demo with no login, no credentials and no network. It is sample data, not a real run, and it writes no files.
:::

## Build your own

**1. Create a workflow from a description:**

```bash
sweny new
```

Pick "Describe your own" and describe the task (for example: "analyze our codebase for common security anti-patterns, compile a report, and create tickets for critical findings"). SWEny generates a full workflow with nodes, conditional routing, and structured output schemas. It renders an ASCII DAG and prompts you to save, refine, or discard:

```
  Save to .sweny/workflows/security_audit.yml? [Y/n/refine]
```

Type a refinement instruction to iterate on the design, or press `Y` to save.

**2. Run it:**

```bash
sweny workflow run .sweny/workflows/security_audit.yml
```

**3. Refine it later:**

```bash
sweny workflow edit .sweny/workflows/security_audit.yml \
  "add a quality gate that rejects vague findings"
```

## Try the built-in triage workflow

SWEny also ships production-ready workflows for SRE triage. No external services needed for a quick test -- just an API key and a log file.

**1. Create a config file:**

```bash
sweny new
```

This runs the interactive picker and writes a starter `.sweny.yml`. Uncomment the local-only block:

```yaml
# .sweny.yml
observability-provider: file
log-file: ./sample-errors.json
issue-tracker-provider: file
source-control-provider: file
notification-provider: file
```

**2. Run a dry-run triage:**

```bash
sweny triage --dry-run
```

SWEny reads `.sweny.yml`, loads secrets from `.env`, analyzes your logs, and writes results to `.sweny/output/` without creating any real issues or PRs.

## Live progress display

When running on an interactive terminal, the CLI renders a live progress display that updates in place as each node executes:

```
  ⠹ [2/5] Investigate errors  1m 42s
    ↳ Calling sentry.list_issues
    ↳ Calling github.search_code
    ↳ Analyzing stack traces
```

The progress block shows a spinner, step counter, node name, and elapsed time. Below it, the last few activity messages stream in as the agent works. When a node finishes, the block is replaced with a completion line:

```
  ✓ [1/5] Fetch errors  12s
    ↳ Found 3 unresolved issues
  ✓ [2/5] Investigate errors  2m 14s
    ↳ Root cause identified in webhook handler
  ⠹ [3/5] Create issues  4s
```

Non-TTY environments (CI, pipes) get simple periodic status lines instead of animated output.

### NDJSON streaming

Pass `--stream` to emit raw `ExecutionEvent` objects as newline-delimited JSON to stdout. This is how Studio's Live Mode connects to a running workflow:

```bash
sweny triage --stream | studio-consumer
```

`--stream` can be combined with the normal progress display — structured events go to stdout while the spinner renders to stderr. Events are redacted the same way as `--json` output (secret values and token shapes become `[redacted]`).

## Config priority

Settings resolve in this order (highest wins):

```
CLI flag  >  environment variable  >  .sweny.yml  >  default
```

Use flags for one-off overrides without editing your config file:

```bash
sweny triage --dry-run --time-range 1h --service-filter 'billing-*'
```

## Config file reference

`.sweny.yml` uses flat kebab-case keys that map 1:1 to CLI flags. You can copy any flag from `--help` directly into the YAML:

```yaml
# .sweny.yml -- commit this file. Secrets go in .env.

# Providers
observability-provider: datadog
issue-tracker-provider: github-issues
source-control-provider: github
coding-agent-provider: claude
notification-provider: console

# Investigation
time-range: 24h
severity-focus: errors
service-filter: "*"
investigation-depth: standard

# PR / branch
base-branch: main
pr-labels: agent,triage,needs-review

# Paths
log-file: ./logs/errors.json
```

Secrets (API keys, tokens) are never read from the config file -- always use environment variables or `.env`.

## Connecting providers

Once local-only mode works, swap in real providers. Set the provider in `.sweny.yml` and add credentials to `.env`:

```yaml
# .sweny.yml
observability-provider: sentry
sentry-org: my-org
sentry-project: my-project
issue-tracker-provider: linear
```

```bash
# .env
SENTRY_AUTH_TOKEN=sntrys_...
LINEAR_API_KEY=lin_api_...
GITHUB_TOKEN=ghp_...
```

Verify credentials before running a full workflow:

```bash
sweny check
```

See the [Commands Reference](/cli/commands/) for all supported providers and their options.

## What's next?

- [E2E Testing](/cli/e2e/) -- generate and run AI-driven browser tests
- [Commands Reference](/cli/commands/) -- every command, flag, and option
- [Examples](/cli/examples/) -- common configurations and real-world workflows
