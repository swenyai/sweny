# Task 05 — Dogfood: Run sweny triage against quote-tool

## Goal

Run `sweny triage` against a real GitHub issue in `wickdninja/jjs-quote-tool` to validate
the full stack end-to-end: CLI → providers → engine → Claude Code → GitHub Issues → PR.

## ⚠️ Human action required

This task requires real API credentials. It cannot be automated.

## Prerequisites

- `sweny` CLI installed globally: `npm install -g @sweny-ai/cli`
  OR run from source: `node /path/to/sweny/packages/cli/dist/main.js`
- Real credentials:
  - `ANTHROPIC_API_KEY` — from console.anthropic.com
  - `GITHUB_TOKEN` — PAT with `repo` + `issues` scopes for `wickdninja/jjs-quote-tool`
  - `VERCEL_TOKEN` — from vercel.com/account/tokens
- A real GitHub issue number in `wickdninja/jjs-quote-tool`

## Setup

```sh
cd /Users/nate/src/me/jjs/quote-tool
cp .env.sweny.example .env.sweny
# Edit .env.sweny — fill in ANTHROPIC_API_KEY, GITHUB_TOKEN, VERCEL_TOKEN
source .env.sweny
```

## Run

```sh
# Dry run first (no issues or PRs created)
sweny triage --dry-run

# Full run against a specific issue
sweny triage --issue-override <github-issue-number>

# Or let it discover issues from Vercel logs
sweny triage
```

## Config already committed

`.sweny.yml` in the quote-tool repo has:
- `observability-provider: vercel`
- `vercel-project-id: prj_Nq3Qv572Rik1rQZpcpHsCw8pfYij`
- `vercel-team-id: team_q73iqEacPA0Mtx3VrYkvZyo0`
- `issue-tracker-provider: github-issues`
- `repository: wickdninja/jjs-quote-tool`

## What to validate

- [ ] Vercel observability provider fetches logs successfully
- [ ] Investigation step runs (Claude Code analyzes the logs)
- [ ] Issue is created in GitHub Issues (or skipped if no issues found)
- [ ] PR is opened if implementation is triggered (or skipped on dry-run)
- [ ] No crashes or unhandled errors

## Notes

- Use `--dry-run` first to validate the full flow without side effects
- If Vercel logs are sparse, use `--issue-override <number>` to target a known issue
- The `sweny check` command validates credentials without running the full workflow
