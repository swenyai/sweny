---
title: FAQ
description: Frequently asked questions about SWEny — cost, setup, behavior, security, and custom workflows.
---

## General

### What does SWEny cost?

SWEny itself has no subscription fee. The AI cost depends on how you authenticate:

- **Claude Max/Pro subscription** (`CLAUDE_CODE_OAUTH_TOKEN`) — covered by your existing subscription, no additional per-run charge.
- **Anthropic API key** (`ANTHROPIC_API_KEY`) — pay-per-use. A typical triage run with Claude Sonnet costs roughly $0.10–$0.50 depending on log volume and investigation depth.

### Does SWEny store my code or logs?

No. Logs are queried in-flight from your observability provider and passed to Claude during the investigation. Nothing is persisted on SWEny servers. SWEny runs entirely inside your CI environment — your code and logs stay in your infrastructure.

### What Claude model does SWEny use?

Claude Sonnet (latest) by default. You can switch coding agent providers via `coding-agent-provider` — see [Coding Agent Providers](/providers/coding-agent/) for OpenAI Codex and Google Gemini options.

---

## Setup

### Do I need Datadog? What if I use a different observability tool?

Datadog is the default but not required. SWEny also works with **Sentry**, **CloudWatch**, **Splunk**, **Elasticsearch**, **New Relic**, and **Grafana Loki** — set `observability-provider` to the one you use. You can also point it at a local JSON file (`observability-provider: file`) for testing without any external service.

### Do I need Linear? I use Jira or GitHub Issues.

GitHub Issues is the default — no extra credentials needed. Jira is supported with an API token and base URL. Set `issue-tracker-provider` to `jira` or `linear` and add the relevant env vars. See [Issue Tracking Providers](/providers/issue-tracking/).

### Does it work with GitLab instead of GitHub?

Yes. Set `source-control-provider: gitlab` and add `GITLAB_TOKEN` and `GITLAB_PROJECT_ID`. The CLI works against any GitLab instance. The GitHub Action runs in GitHub Actions but can open MRs on GitLab repos. See [Source Control Providers](/providers/source-control/).

### How do I test without creating real tickets or PRs?

Two options:

1. **`dry-run: true`** — runs the full investigation but skips creating tickets, PRs, or notifications. Output goes to `.sweny/output/` (CLI) or `.github/sweny-output/` (Action).
2. **File-based providers** — set all providers to `file`, point `log-file` at a local JSON log, and the entire run is local-only with no external API calls.

See [CLI Quick Start](/cli/) for a 60-second local-only setup.

---

## Behavior

### Why does SWEny say "no novel issues found" every run?

Common causes:

- **Time range too narrow** — increase `time-range` (e.g., `24h` → `7d`)
- **All issues already tracked** — `novelty-mode: true` skips issues that match existing tickets; set `novelty-mode: false` to force re-investigation
- **Service filter too narrow** — check that `service-filter` matches your service names
- **Observability query returning nothing** — verify credentials with `sweny check`

See [Troubleshooting](/getting-started/troubleshooting/) for more detail.

### Will SWEny create duplicate tickets?

No. Before creating a ticket, SWEny checks your issue tracker for recent issues that match the same error pattern. If a match exists, it adds a "+1 occurrence" comment to the existing issue instead of creating a new one.

To disable this behaviour (e.g., for testing), set `novelty-mode: false`.

### Can SWEny fix complex bugs, or just simple ones?

It depends on the codebase and the bug. SWEny is most effective at:

- Bugs with clear error messages and stack traces
- Root causes localized to a small number of files
- Issues with well-understood fix patterns (null checks, type coercions, missing guards)

It's less effective at bugs requiring architectural changes, data model redesigns, or reasoning across many loosely-coupled services. Setting `investigation-depth: thorough` and increasing `max-investigate-turns` gives the agent more room to explore.

### Does it auto-merge PRs?

Not by default. The default `review-mode` is `review` — PRs are opened and wait for human approval.

Set `review-mode: auto` to enable GitHub auto-merge when CI passes. Even then, SWEny suppresses auto-merge for high-risk changes (migrations, auth-related files, diffs over 20 files) regardless of the setting.

---

## Security

### Does SWEny need write access to my repo?

Only if you want it to create PRs. `dry-run: true` requires only `contents: read` and `pull-requests: read`. To create PRs, grant `contents: write` and `pull-requests: write` in your workflow permissions block.

SWEny only creates branches and PRs — it never pushes directly to protected branches (unless you explicitly configure `review-mode: auto` and GitHub auto-merge is enabled).

### Can I restrict what the agent can do?

Yes:

- **`dry-run: true`** — prevents any writes (no tickets, no PRs, no branches)
- **Workflow permissions** — the agent runs with the `GITHUB_TOKEN` permissions you grant in your workflow file
- **`review-mode: review`** (default) — all PRs require human approval before merge

---

## Custom Workflows

### Can I build my own workflows?

Yes. SWEny ships a full workflow engine with a TypeScript API. You can:

- Write YAML workflow files and run them with `sweny workflow run`
- Export built-in workflows as a starting point: `sweny workflow export triage`
- Register custom step types in JavaScript and load them with `--steps`

See [Workflow Authoring](/studio/recipe-authoring/) and the [Engine reference](/getting-started/engine/).

### Can I use SWEny for things other than error triage?

Yes. The workflow engine is general-purpose — Triage and Implement are the built-in workflows, but the engine supports any repetitive engineering task that follows a **Learn → Act → Report** pattern: dependency update PRs, documentation generation, code review summaries, test gap analysis, and more.
