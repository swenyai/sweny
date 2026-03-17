# Create "Why SWEny?" Page

## Why this matters
Users evaluating SWEny come from: (a) existing manual triage processes, (b) home-grown cron scripts,
(c) competing tools. Without a clear "why" page, they can't quickly understand SWEny's positioning.
This is the #1 conversion page for developer tools — Stripe has one, Linear has one, Vercel has one.

## What to do
Create `packages/web/src/content/docs/getting-started/why-sweny.md`
Add to sidebar under Getting Started, before Walkthrough.

## Content

### The problem SWEny solves
On-call engineers spend 2-4 hours per week on production error triage:
scanning logs, cross-referencing code, filing tickets with incomplete info, opening PRs manually.
Most of this is mechanical — no creative thinking required. SWEny automates the mechanical parts.

### What SWEny is (and isn't)
**Is**: A workflow automation platform for engineering tasks that follow Learn → Act → Report.
Triage and Implement are the first workflows. More can be built.

**Isn't**: A monitoring platform (use Datadog/Sentry for that). Isn't an AIOps tool that predicts
outages. Isn't a replacement for on-call — it handles the first response, not the architectural fix.

### vs. DIY cron scripts
| | DIY script | SWEny |
|---|---|---|
| Setup time | Days–weeks | 5 minutes |
| Duplicate detection | You build it | Built-in |
| PR opening | You build it | Built-in |
| AI root cause analysis | You build it | Built-in |
| Provider swaps (Jira→Linear) | Rewrite the script | Change one config value |
| Maintenance | You own it | Updates via npm |

### vs. GitHub Dependabot / Renovate
Dependabot and Renovate handle dependency updates. SWEny handles runtime production errors.
They're complementary — run both.

### vs. Custom Claude Code scripts
You could write a bash script that calls Claude Code directly. SWEny gives you:
- Structured workflows with phases and transitions
- Provider abstraction (swap Datadog for Sentry without touching workflow code)
- Built-in deduplication, caching, dry-run mode
- GitHub Action + CLI deployment out of the box
- Studio visual editor for workflow design

### When to use SWEny
- You have production logs and want automated investigation → Triage workflow
- You have a backlog of filed bugs and want automated fixes → Implement workflow
- You want to build custom AI engineering workflows → Engine + custom steps
- You're an SRE tired of being paged for issues that could be self-healing → SWEny

### When NOT to use SWEny
- Outages requiring immediate human judgment — SWEny is async, not real-time incident response
- Security incidents — don't give automated agents write access during a security incident
- Architecture-level changes — the agent is great at localized bug fixes, not system redesign

## Related files
- `packages/web/src/content/docs/getting-started/walkthrough.md` — link from here
- `packages/web/astro.config.mjs` — add to sidebar
