---
description: Set up SWEny in the current project. Interactive wizard that creates .sweny.yml config and .env template.
disable-model-invocation: true
---

# SWEny Init

Initialize SWEny in the current project. This runs an interactive setup wizard that detects your git remote and walks you through configuring:

1. **Source control** — GitHub or GitLab
2. **Observability** — Datadog, Sentry, BetterStack, New Relic, CloudWatch, or None
3. **Issue tracker** — GitHub Issues, Linear, or Jira
4. **Notifications** — Console, Slack, Discord, Teams, or Webhook
5. **GitHub Action** — optional scheduled triage workflow

**This is an interactive terminal command.** Ask the user to run it directly:

> Run `! sweny init` in this session to start the setup wizard.

The wizard creates:
- `.sweny.yml` — provider configuration
- `.env` — credential placeholders with helpful comments
- `.github/workflows/sweny.yml` — optional CI/CD integration

After init, run `/sweny:check` to verify credentials are working.
