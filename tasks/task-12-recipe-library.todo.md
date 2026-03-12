# Task 12: Recipe Library — Ready-to-Use Stack Configurations

## Context

SWEny works out of the box for any stack, but users coming from a specific technology
stack want to see "here's exactly what to paste to get started with Rails + Sentry" or
"here's the config for a Next.js app on Vercel with Datadog." A library of ready-to-use
recipes dramatically lowers the time-to-value for new users.

This is a docs + example files task. No source code changes required.

## What to Build

Create `docs/recipes/` directory with one markdown file per recipe. Each recipe should
be a complete, copy-paste-ready setup: `.sweny.yml` + `.env.example` + brief explanation.

### Recipes to Create (minimum)

1. **`rails-sentry-github.md`** — Rails app, Sentry observability, GitHub Issues
2. **`nextjs-datadog-linear.md`** — Next.js app, Datadog observability, Linear issue tracker
3. **`python-cloudwatch-github.md`** — Python/FastAPI, CloudWatch logs, GitHub Issues
4. **`node-loki-github.md`** — Node.js microservice, Loki/Grafana logs, GitHub Issues
5. **`monorepo-datadog-linear.md`** — Monorepo with service map, Datadog, Linear

### Each Recipe File Format

```markdown
# Recipe: [Stack Name]

Brief 1-2 sentence description of what this recipe does and who it's for.

## Stack
- **App**: Rails / Next.js / etc.
- **Observability**: Sentry / Datadog / etc.
- **Issue Tracker**: GitHub Issues / Linear
- **Coding Agent**: Claude (default)

## Setup

### 1. Add to your repo

\`\`\`yaml
# .sweny.yml
observability-provider: sentry
sentry-org: your-org
sentry-project: your-project
issue-tracker-provider: github-issues
time-range: 24h
severity-focus: errors
review-mode: review
\`\`\`

### 2. Configure secrets

\`\`\`bash
# .env (never commit this)
CLAUDE_CODE_OAUTH_TOKEN=your-token
SENTRY_AUTH_TOKEN=sntryu_...
GITHUB_TOKEN=ghp_...
\`\`\`

### 3. Run

\`\`\`bash
npx @sweny-ai/cli triage
\`\`\`

## GitHub Actions

\`\`\`yaml
# .github/workflows/triage.yml
...
\`\`\`

## What SWEny Does

Brief explanation of what the agent will investigate and what output to expect.

## Tips

- Any stack-specific tips (e.g. "set sentry-project to the slug shown in your Sentry URL")
```

### Also Create

- `docs/recipes/README.md` — index of all recipes with 1-line descriptions
- `.github/service-map.example.yml` update — add a more realistic multi-service example

## Verification

Each recipe should be reviewable for correctness:
- All env var names match what the providers actually expect (check `packages/providers/src/`)
- All `.sweny.yml` keys match what `packages/cli/src/config.ts` parses
- Action YAML snippets use the correct input names from `action.yml`

No code to test — review for accuracy.

## No Changeset Required

Docs-only change, no published package changes.

## Commit Message

```
docs: add recipe library for popular stacks (Sentry, Datadog, CloudWatch, Loki)
```
