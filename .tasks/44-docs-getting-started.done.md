# Task: Write Getting Started Section (5 pages)

## Goal
Write the 5 Getting Started pages for the SWEny docs site. These are the entry funnel — a new user should understand what SWEny is and have it running within 10 minutes.

## Key framing
SWEny is a **workflow orchestration layer** for Claude. Its value is the DAG — reliable, observable, repeatable execution. Skills are just tool groups that wire into nodes.

## Pages to write

All pages go in `packages/web/src/content/docs/getting-started/`. Use Starlight markdown with `---` frontmatter (title, description).

### 1. `index.md` — Introduction
- What SWEny is: workflow orchestration for AI-powered engineering tasks
- Core value: define a DAG of nodes, each with instructions + skills, connected by conditional edges → reliable execution every time
- Three ways to run: GitHub Action (recommended), CLI, Studio
- Quick visual: show the triage workflow DAG conceptually
- Link to Quick Start

### 2. `concepts.md` — Core Concepts
- **Workflow**: a directed acyclic graph (DAG) of nodes connected by edges
- **Node**: a step in the workflow — has a name, instruction (natural language), and available skills
- **Edge**: connection between nodes, optionally with a `when` condition (natural language, evaluated by Claude)
- **Skill**: a group of tools Claude can call at a node (e.g., GitHub skill = search code, create issue, create PR, etc.)
- **Entry node**: where execution starts
- **Execution model**: executor walks the DAG node by node → Claude runs instruction with tools → result → edge conditions evaluated → next node
- Include the TypeScript interfaces from `packages/core/src/types.ts` as reference (Workflow, Node, Edge, Skill)

### 3. `quick-start.md` — Quick Start (Action-first)
- Prerequisites: GitHub repo, observability platform (Sentry/Datadog/BetterStack/etc.), Claude auth (Max subscription or API key)
- Step 1: Create `.github/workflows/sweny-triage.yml`:
  ```yaml
  name: SWEny Triage
  on:
    workflow_dispatch:
    schedule:
      - cron: '0 9 * * 1-5'  # weekdays at 9am
  permissions:
    contents: write
    issues: write
    pull-requests: write
  jobs:
    triage:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: swenyai/sweny@main
          with:
            anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
            observability-provider: sentry
            sentry-auth-token: ${{ secrets.SENTRY_AUTH_TOKEN }}
            sentry-org: your-org
            sentry-project: your-project
  ```
- Step 2: Add secrets (ANTHROPIC_API_KEY + observability credentials)
- Step 3: Run manually via workflow_dispatch, or wait for cron
- Step 4: Check GitHub Actions summary for results
- "What just happened?" section explaining the triage DAG
- Next: point to CLI for local dev, Studio for visual editing

### 4. `walkthrough.md` — End-to-End Walkthrough
- Scenario: payment service error spike detected by Sentry
- Walk through each node of the triage workflow:
  1. **Gather Context**: pulls Sentry errors, searches GitHub for recent commits
  2. **Root Cause Analysis**: correlates error with a recent deploy, assesses severity as "high"
  3. **Routing**: condition "novel and severity medium+" → routes to Create Issue
  4. **Create Issue**: files a Linear ticket with root cause, severity, affected services
  5. **Notify**: sends Slack message with summary and issue link
- Show what the output looks like (GitHub Actions summary, CLI DAG rendering)
- Keep it concrete with realistic data

### 5. `faq.md` — FAQ
- **How much does SWEny cost?** Free and open source. You pay for Claude usage only.
- **What AI model does SWEny use?** Claude via headless Claude Code — not the raw API.
- **What observability tools are supported?** Sentry, Datadog, BetterStack built-in. Others via MCP servers or Action inputs (CloudWatch, Splunk, Elastic, New Relic, Loki, etc.)
- **What issue trackers work?** GitHub Issues (default), Linear, Jira
- **Can I create custom workflows?** Yes — write YAML or use Studio visual editor. See Custom Workflows.
- **How do skills work?** Skills are groups of tools. Each skill auto-configures from environment variables. See Skills Overview.
- **Is my code/data sent anywhere?** Claude Code runs locally (CLI) or in GitHub Actions runners. Only observability API calls go to your providers.
- **Can I use a different LLM?** The `coding-agent-provider` input supports Claude, Codex, and Gemini for implementation. Triage uses Claude.

## Source of truth
- Workflow definitions: `packages/core/src/workflows/triage.ts`, `implement.ts`
- Types: `packages/core/src/types.ts`
- Action inputs: `action.yml` at repo root
- Skills: `packages/core/src/skills/*.ts`

## Style
- Professional, direct, imperative instructions
- Code examples should be real and copy-pasteable
- Use `:::note[...]` for callouts
- Tables for reference material
