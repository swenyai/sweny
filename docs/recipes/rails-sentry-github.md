# Recipe: Rails + Sentry + GitHub Issues

For Rails applications that report errors to Sentry and track work in GitHub Issues. SWEny queries Sentry for recent errors, investigates the root cause, opens a GitHub Issue, and optionally opens a fix PR.

## Stack

- **App**: Ruby on Rails
- **Observability**: Sentry
- **Issue Tracker**: GitHub Issues
- **Source Control**: GitHub
- **Coding Agent**: Claude (default)

## Setup

### 1. Add `.sweny.yml` to your repo root

```yaml
# .sweny.yml
observability-provider: sentry
sentry-org: your-org-slug
sentry-project: your-project-slug
issue-tracker-provider: github-issues
source-control-provider: github
time-range: 24h
severity-focus: errors
review-mode: review
```

Key fields:

| Key | Description |
|-----|-------------|
| `sentry-org` | Your Sentry organization slug — visible in your Sentry URL: `sentry.io/organizations/<slug>/` |
| `sentry-project` | Your Sentry project slug — visible in Project Settings |
| `time-range` | How far back to look. `24h` is a good daily triage window. |
| `review-mode` | `review` (default) opens a PR for human approval; `auto` enables GitHub auto-merge when CI passes. |

### 2. Configure secrets

Never commit these values. Add them as GitHub Actions secrets (for CI) or a local `.env` file (for CLI usage).

```bash
# .env  — never commit this file
ANTHROPIC_API_KEY=sk-ant-...
SENTRY_AUTH_TOKEN=sntryu_...
GITHUB_TOKEN=ghp_...
```

| Variable | Where to get it |
|----------|-----------------|
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) — or use `CLAUDE_CODE_OAUTH_TOKEN` instead |
| `SENTRY_AUTH_TOKEN` | Sentry → User Settings → Auth Tokens → Create token with `project:read` and `event:read` scopes |
| `GITHUB_TOKEN` | In GitHub Actions, `${{ secrets.GITHUB_TOKEN }}` is provided automatically |

### 3. Run locally

```bash
npx @sweny-ai/cli triage
```

## GitHub Actions

```yaml
# .github/workflows/triage.yml
name: SWEny Triage

on:
  schedule:
    - cron: "0 9 * * 1-5"   # weekdays at 09:00 UTC
  workflow_dispatch:

jobs:
  triage:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      issues: write
      pull-requests: write
    steps:
      - uses: actions/checkout@v4

      - uses: sweny-ai/sweny@v1
        with:
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
          observability-provider: sentry
          sentry-auth-token: ${{ secrets.SENTRY_AUTH_TOKEN }}
          sentry-org: your-org-slug
          sentry-project: your-project-slug
          issue-tracker-provider: github-issues
          github-token: ${{ secrets.GITHUB_TOKEN }}
          time-range: 24h
          severity-focus: errors
          review-mode: review
```

## What SWEny Does

1. Queries Sentry for error-level issues in the configured project over the last 24 hours.
2. Investigates the top issue — reads the stack trace, looks at the affected code paths in your repo.
3. Determines whether the issue is novel (not already tracked in GitHub Issues).
4. If novel: creates a GitHub Issue with a detailed description and fix suggestions.
5. If `review-mode: auto` and the fix is low-risk: opens a pull request with the proposed change.

The `issues-found`, `recommendation`, and `pr-url` Action outputs are available for downstream steps.

## Tips

- **Sentry org slug** is the subdomain of your Sentry URL, not the display name. Check it at `sentry.io/organizations/<slug>/settings/`.
- **Sentry project slug** appears in project URLs: `sentry.io/organizations/<org>/projects/<slug>/`.
- **Self-hosted Sentry**: add `sentry-base-url: https://sentry.yourcompany.com` to `.sweny.yml` and `sentry-base-url` to the Action `with:` block.
- **Novelty mode** (on by default) prevents SWEny from creating duplicate issues for errors already tracked. Disable with `novelty-mode: false` in `.sweny.yml` only if you want to re-evaluate known issues.
- Set `severity-focus: warnings` if you want SWEny to also surface warning-level Sentry issues.
- Rails apps often have many N+1 warnings — consider `service-filter: your-rails-app` to scope investigation to a specific Sentry transaction pattern.
