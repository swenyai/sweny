# Update Docs for Platform Narrative

## Context
The README and website currently tell the "SWEny Triage" story — a triage tool with three hardcoded phases. With the engine in place, the narrative shifts to **Learn → Act → Report** as a platform, with triage as the first recipe.

This task updates all public-facing docs to tell the platform story.

## Dependencies
- Tasks 32-35 should be complete (engine + triage recipe + new providers)

## Files to Modify

### `README.md` (root)
Restructure around the platform identity:

**Hero section:**
- Keep "Your on-call engineer that never sleeps" but frame it as the first use case
- Add a platform tagline, e.g.: "Build AI-powered workflows that learn from any source, take any action, and report through any channel."

**How it works → three pillars:**
Replace "Investigate / Implement / Notify" with "Learn / Act / Report":
1. **Learn** — Connect any input source: observability logs, issue trackers, APIs, webhooks
2. **Act** — Take any action: create tickets, open PRs, run commands, call APIs
3. **Report** — Notify through any channel: Slack, email, GitHub, Discord, Teams, webhooks

**Recipes section (new):**
- Explain that a Recipe is a pre-built workflow using the engine
- **SWEny Triage** is the first recipe: monitors observability → creates fix PRs → reports results
- Tease future recipes (security audit, dependency updates, etc.)

**Provider table:**
Update to organize by platform role:

| Role | Providers |
|------|-----------|
| **Learn** | Datadog, Sentry, CloudWatch, Splunk, Elasticsearch, Loki, New Relic |
| **Act** | Linear, GitHub Issues, Jira, GitHub (PRs), GitLab (PRs), PagerDuty, OpsGenie |
| **Report** | Slack, Teams, Discord, Email, Webhook, GitHub Summary |

**Architecture section:**
Show the layered architecture:
```
┌─────────────────────────────────────────────┐
│  Entry Points                               │
│  GitHub Action · Slack Bot · CLI · Cloud     │
├─────────────────────────────────────────────┤
│  @sweny/engine                              │
│  Workflow Runner · Recipes · Step Context    │
├─────────────────────────────────────────────┤
│  @sweny/providers                           │
│  Observability · Issue Tracking · Source     │
│  Control · Notification · Messaging ·       │
│  Incident · Storage · Auth · Access         │
└─────────────────────────────────────────────┘
```

### `packages/web/src/content/docs/` (website)
Update the Starlight documentation pages:

1. **Getting Started** — Frame as platform setup, not just triage setup
2. **Concepts** (new page) — Explain Learn/Act/Report, Workflows, Steps, Recipes, ProviderRegistry
3. **Recipes → Triage** — Move current triage docs here as the first recipe
4. **Providers** — Reorganize by role (Learn / Act / Report) instead of by category
5. **Engine** (new page) — How to create custom recipes using `@sweny/engine`

### `packages/engine/README.md` (new)
Short README for the engine package:
- What it is (workflow runner for Learn → Act → Report)
- Quick example of defining a custom workflow
- Link to full docs

### `packages/providers/README.md`
Update if it exists — mention the Learn/Act/Report framing and that providers are used by the engine.

## Key Messaging Points

1. **"Platform, not tool"** — SWEny is a platform for building AI-powered engineering workflows. Triage is the first recipe.
2. **"Learn → Act → Report"** — Every workflow follows this pattern. The engine enforces it.
3. **"20+ providers"** — The provider library is the moat. Each one is a real, tested integration.
4. **"Open source framework, hosted platform"** — Use the framework for free, or let SWEny Cloud handle orchestration, secrets, and scheduling.

## Verification
- Website builds: `npm run build --workspace=packages/web`
- README renders correctly on GitHub (check markdown)
- No broken links in docs
- Provider counts and names are accurate
