---
title: Why SWEny?
description: What problem SWEny solves, how it compares to alternatives, and when to use it.
---

## The problem

On-call engineers spend 2–4 hours per week on production error triage: scanning logs, cross-referencing code, filing tickets with incomplete context, and opening fix PRs manually. Most of this is mechanical — no creative thinking required.

SWEny automates the mechanical parts.

## What SWEny is (and isn't)

**SWEny is** a workflow automation platform for engineering tasks that follow **Learn → Act → Report**. Triage and Implement are the built-in workflows. You can build your own.

**SWEny isn't** a monitoring platform — use Datadog, Sentry, or your existing stack for that. It isn't an AIOps tool that predicts outages. It isn't a replacement for on-call engineers — it handles the first response and the initial PR, not the architectural decision.

## How it compares

### vs. DIY cron scripts

| | DIY script | SWEny |
|---|---|---|
| Setup time | Days–weeks | 5 minutes |
| Duplicate detection | You build it | Built-in |
| PR opening | You build it | Built-in |
| AI root cause analysis | You build it | Built-in |
| Swap Jira for Linear | Rewrite the script | Change one config value |
| Maintenance | You own it | Updates via npm |

### vs. GitHub Dependabot / Renovate

Dependabot and Renovate handle dependency updates. SWEny handles runtime production errors. They're complementary — run both.

### vs. writing Claude Code scripts yourself

You could write a shell script that calls Claude Code directly. SWEny gives you on top of that:

- Structured workflows with phases, step caching, and clean retry behaviour
- Provider abstraction — swap Datadog for Sentry without touching workflow logic
- Built-in deduplication, novelty gate, and dry-run mode
- GitHub Action and CLI deployment out of the box
- Studio visual editor for designing and inspecting workflows

## When to use SWEny

- You have production logs and want automated investigation → **Triage workflow**
- You have a backlog of filed bugs and want automated fix PRs → **Implement workflow**
- You want to build custom AI engineering workflows → **Engine + custom steps**
- You're an SRE tired of being paged for issues that could self-heal → **SWEny**

## When NOT to use SWEny

- **Active outages requiring immediate human judgment** — SWEny runs asynchronously, it's not a real-time incident response tool
- **Security incidents** — don't give automated agents write access during a live security incident
- **Architecture-level changes** — the agent excels at localized bug fixes, not system-wide redesigns

---

Ready to see it end-to-end? Read the [walkthrough](/getting-started/walkthrough/) — a real Datadog error spike through to a merged PR.
