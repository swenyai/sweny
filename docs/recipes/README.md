# SWEny Recipe Library

Ready-to-use stack configurations — copy, paste, and go.

Each recipe includes a `.sweny.yml` snippet, the required environment variables, and a GitHub Actions workflow you can drop into your repo.

## Recipes

| Recipe | App | Observability | Issue Tracker |
|--------|-----|---------------|---------------|
| [Rails + Sentry + GitHub Issues](./rails-sentry-github.md) | Ruby on Rails | Sentry | GitHub Issues |
| [Next.js + Datadog + Linear](./nextjs-datadog-linear.md) | Next.js / Node | Datadog | Linear |
| [Python/FastAPI + CloudWatch + GitHub Issues](./python-cloudwatch-github.md) | Python / FastAPI | AWS CloudWatch | GitHub Issues |
| [Node.js microservice + Loki + GitHub Issues](./node-loki-github.md) | Node.js | Grafana Loki | GitHub Issues |
| [Monorepo + Datadog + Linear](./monorepo-datadog-linear.md) | Monorepo (multi-service) | Datadog | Linear |

## Quick orientation

Every recipe follows the same three-step flow:

1. Add `.sweny.yml` to your repo root — sets providers and investigation parameters.
2. Add secrets to your CI environment (or a local `.env` file you never commit).
3. Add the GitHub Actions workflow to `.github/workflows/triage.yml` — SWEny runs on a schedule.

SWEny triages errors, opens GitHub Issues or Linear tickets, and (when `review-mode: auto`) opens a fix PR automatically.

## Choosing a recipe

- **Small team, GitHub-native** — [Rails + Sentry](./rails-sentry-github.md) or [Node.js + Loki](./node-loki-github.md) keep everything inside GitHub.
- **Datadog shop** — [Next.js + Datadog + Linear](./nextjs-datadog-linear.md) is the simplest starting point; the [monorepo variant](./monorepo-datadog-linear.md) adds a service map for multi-service scoping.
- **AWS-native (Lambda / ECS / Fargate)** — [Python + CloudWatch](./python-cloudwatch-github.md) uses IAM roles and needs no extra credentials in CI.
- **Self-hosted Grafana stack** — [Node.js + Loki](./node-loki-github.md) works with any Loki instance including Grafana Cloud.
