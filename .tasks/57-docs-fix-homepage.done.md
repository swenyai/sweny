# Task 57: Fix homepage and landing page

## Goal
Fix broken links, outdated claims, and misaligned messaging on the docs homepage.

## File to edit
`packages/web/src/content/docs/index.mdx`

## Changes required

### 1. Broken link
**Current:** Links to `/getting-started/engine/` which doesn't exist.
**Fix:** Update to the correct path. The workflows overview is at `/workflows/`. Change the link text and target to point there.

### 2. "Two deployment modes" section is outdated
**Current:** Describes "GitHub Action" and "Interactive Agent" as the two modes. The "Interactive Agent" description ("a bot your team can chat with... supports Slack") is stale — the product now has three entry points: Action, CLI, Studio.
**Fix:** Replace "Two deployment modes" with "Three entry points" to match the README:
- **GitHub Action** — Runs on schedule in CI. Primary deployment for production monitoring.
- **CLI** — Run `sweny triage` locally. Ideal for testing, debugging, and development.
- **Studio** — Visual DAG editor and live execution monitor. Design, simulate, and watch workflows.

### 3. Skills cards — missing BetterStack
**Current:** The CardGrid mentions Sentry and Datadog under "Observability" but not BetterStack.
**Fix:** Add BetterStack: "**Sentry**, **Datadog**, and **BetterStack** skills — query errors, search logs, list monitors, and pull metrics from your existing monitoring stack."

### 4. Hero tagline
**Current:** "SWEny is a platform for building AI-powered engineering workflows..."
**Review:** This is OK but could be tighter. Consider: "Define what Claude should do at each step, give it the right tools, and let the DAG executor handle the rest. Triage alerts, investigate errors, and open fix PRs — automatically." Keep it concise.

## Verification
- All links resolve to actual pages in the sidebar config (`astro.config.mjs`)
- No references to "Interactive Agent" remain
- BetterStack appears alongside other observability tools
