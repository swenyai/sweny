# Task: Write GitHub Action Section (5 pages)

## Goal
Write the 5 GitHub Action pages. This is the primary and most powerful entry point — set up a cron, forget about it, wake up to triaged issues.

## Pages to write

All pages go in `packages/web/src/content/docs/action/`.

### 1. `index.md` — Setup
- What the Action does: runs SWEny workflows (triage or implement) in GitHub Actions
- Installation: add `swenyai/sweny@main` as a step
- Minimal setup (3 secrets): ANTHROPIC_API_KEY + observability creds + GITHUB_TOKEN (auto-provided)
- Permissions needed: `contents: write`, `issues: write`, `pull-requests: write`
- First run: manual dispatch, check the Actions summary
- By default uses GitHub Issues — no extra tracker setup needed
- Mention Linear/Jira as upgrade options

### 2. `inputs.md` — Inputs & Outputs
- Full reference table of all action inputs from `action.yml` at repo root
- Group by category:
  - **Workflow**: `workflow` (triage/implement)
  - **Authentication**: `anthropic-api-key`, `claude-oauth-token`, `github-token`, `bot-token`
  - **Coding Agent**: `coding-agent-provider`, `openai-api-key`, `gemini-api-key`
  - **Observability**: `observability-provider` + per-provider credentials (datadog, sentry, cloudwatch, splunk, elastic, newrelic, loki, betterstack, plus newer: vercel, supabase, netlify, fly, render, prometheus, pagerduty, honeycomb, axiom, heroku, opsgenie, file)
  - **Issue Tracking**: `issue-tracker-provider`, `linear-api-key`, `linear-team-id`, etc., jira creds
  - **Source Control**: `source-control-provider`, `gitlab-token`, etc.
  - **Notification**: `notification-provider`, `notification-webhook-url`, etc.
  - **Investigation**: `time-range`, `severity-focus`, `service-filter`, `investigation-depth`, `max-investigate-turns`, `max-implement-turns`
  - **PR Settings**: `base-branch`, `pr-labels`
  - **Behavior**: `dry-run`, `review-mode`, `novelty-mode`, `linear-issue`, `additional-instructions`
  - **Service Map**: `service-map-path`
  - **Workspace Tools**: `workspace-tools` (slack, notion, pagerduty, monday, asana)
  - **MCP Servers**: `mcp-servers` (JSON object)
- Outputs table:
  - `issues-found` (true/false)
  - `recommendation` (implement, +1 existing, skip)
  - `issue-identifier` (e.g., ENG-123, #42)
  - `issue-url`
  - `pr-url`
  - `pr-number`

### 3. `scheduling.md` — Cron & Dispatch
- Cron scheduling: run triage on a schedule (daily, hourly, weekdays)
  - Example: weekdays at 9am UTC: `cron: '0 9 * * 1-5'`
  - Example: every 6 hours: `cron: '0 */6 * * *'`
- `workflow_dispatch`: manual trigger from Actions tab, optionally with inputs
- Event-driven: trigger on `issues` events (for implement workflow), `alert` webhooks, etc.
- Multiple workflows in one repo: one for triage (cron), one for implement (on issue label)
- Best practice: start with daily cron, tune time-range to match

### 4. `service-map.md` — Service Map
- What it does: maps alerts to services so triage focuses on the right code
- Create `.github/service-map.yml`:
  ```yaml
  services:
    api:
      paths: ["src/api/**", "src/routes/**"]
      owners: ["@backend-team"]
      observability:
        sentry-project: api-service
    worker:
      paths: ["src/workers/**"]
      owners: ["@infra-team"]
  ```
- Multi-repo setup: install the Action in multiple repos, each with its own service map
- How service-filter input interacts with the map
- Team-scale triage: one Action per repo, each scoped to that repo's services

### 5. `examples.md` — Examples
- **Minimal triage** (Sentry + GitHub Issues)
- **Full stack** (Datadog + Linear + Slack notification)
- **Implement from Linear issue** (workflow: implement, linear-issue: ENG-123)
- **Multi-provider** (Sentry for errors + Datadog for metrics)
- **Custom MCP servers** (adding filesystem or custom tools)
- **With workspace tools** (Slack + Notion)
- **Dry run** (analyze without creating issues/PRs)
- Each example should be a complete, copy-pasteable workflow YAML

## Source of truth
- `action.yml` at repo root — all inputs/outputs with descriptions and defaults
- `packages/action/src/main.ts` — how inputs are processed
- `packages/action/src/config.ts` — input parsing and validation
