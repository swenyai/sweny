<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo-lockup-light.svg" />
    <source media="(prefers-color-scheme: light)" srcset="assets/logo-lockup-dark.svg" />
    <img src="assets/logo-lockup-dark.svg" alt="SWEny" width="280" />
  </picture>
</p>

<p align="center">
  <strong>AI workflows as code. Describe what you want, get a reliable DAG.</strong>
</p>

<p align="center">
  <a href="https://github.com/swenyai/sweny/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/swenyai/sweny/ci.yml?style=flat-square&label=CI" /></a>
  <a href="https://www.npmjs.com/package/@sweny-ai/core"><img alt="npm" src="https://img.shields.io/npm/v/@sweny-ai/core?style=flat-square&color=orange" /></a>
  <a href="https://github.com/swenyai/sweny/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/github/license/swenyai/sweny?style=flat-square" /></a>
  <a href="https://docs.sweny.ai"><img alt="Docs" src="https://img.shields.io/badge/docs-docs.sweny.ai-blue?style=flat-square" /></a>
  <a href="https://marketplace.sweny.ai"><img alt="Marketplace" src="https://img.shields.io/badge/Workflows-marketplace.sweny.ai-blueviolet?style=flat-square" /></a>
</p>

---

## Quickstart

```bash
npm install -g @sweny-ai/core
sweny init                  # pick a workflow → auto-detects providers → done
sweny workflow run .sweny/workflows/pr-review.yml
```

Or build from scratch:

```bash
sweny workflow create "review PRs for security issues and code quality"
sweny workflow run .sweny/workflows/pr-review.yml
```

Browse **[marketplace.sweny.ai](https://marketplace.sweny.ai)** for ready-to-run workflows.

## What it does

Describe a task in plain English. SWEny builds a DAG of focused AI agents — each node gets scoped tools, structured output, and conditional routing. Every tool call is tracked.

```
$ sweny workflow create "audit our repo for security issues, \
    scan dependencies, and create Linear tickets for anything critical"

  GitHub Security Audit

  o Scan Recent Commits for Exposed Secrets
  |
  +---> o Review Open PRs for Security Changes
  +---> o Scan Dependencies for Vulnerabilities
       |
  o Compile Security Posture Report
  |
  o Create Linear Tickets for Critical Findings

  Save to .sweny/workflows/github_security_audit.yml? [Y/n/refine]
```

## Use it anywhere

| Surface | What it does |
|---------|-------------|
| **[CLI](https://docs.sweny.ai/cli/)** | Build, run, and publish workflows from your terminal |
| **[GitHub Action](https://docs.sweny.ai/action/)** | Run any workflow on CI — plus dedicated [triage](https://github.com/swenyai/triage) and [e2e](https://github.com/swenyai/e2e) actions |
| **[Studio](https://docs.sweny.ai/studio/)** | Visual DAG editor and live execution monitor |
| **[Claude Code Plugin](https://docs.sweny.ai/advanced/mcp-plugin/)** | Slash commands, MCP tools, and an isolated workflow agent |
| **[Marketplace](https://marketplace.sweny.ai)** | Browse, fork, and share community workflows |

## Custom skills

Extend any workflow with your own skills. Create a `SKILL.md` with instructions or wire up an MCP server:

```
.sweny/skills/code-standards/SKILL.md
```

```markdown
---
name: code-standards
description: Team coding conventions for TypeScript
---

When reviewing TypeScript code:
- Use camelCase for variables and functions
- Every public function needs at least one test
- Mock at boundaries (HTTP, DB), not internal functions
```

Then reference it in any workflow node:

```yaml
nodes:
  review:
    name: Code Review
    instruction: Review the pull request.
    skills: [code-standards, github]
```

Skills are cross-tool compatible — the same `SKILL.md` works in Claude Code, Codex, and Gemini CLI. Write once, use everywhere. [Learn more](https://docs.sweny.ai/skills/custom/).

## Built-in skills

Set the credential, the skill is ready. No configuration.

| Skill | What it does |
|-------|-------------|
| **github** | Search code, read files, create issues, open PRs |
| **linear** | Create, search, and update issues |
| **sentry** | Query errors, issues, and stack traces |
| **datadog** | Query logs, metrics, and monitors |
| **betterstack** | Query incidents, monitors, and logs |
| **slack** | Send messages via webhook or bot API |
| **notification** | Discord, Teams, email, generic webhooks |

## GitHub Actions

```yaml
# Run any workflow on CI
- uses: swenyai/sweny@v5
  with:
    workflow: .sweny/workflows/security-audit.yml
    claude-oauth-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
  env:
    LINEAR_API_KEY: ${{ secrets.LINEAR_API_KEY }}
```

Focused actions for common use cases:

| Action | Purpose |
|--------|---------|
| [`swenyai/sweny@v5`](https://github.com/swenyai/sweny) | Run any workflow YAML |
| [`swenyai/triage@v1`](https://github.com/swenyai/triage) | SRE triage — observability + issue tracker |
| [`swenyai/e2e@v1`](https://github.com/swenyai/e2e) | Agentic E2E browser tests |

## Publish to the marketplace

Share your workflows and skills with the community:

```bash
sweny publish   # interactive CLI — publish a workflow or skill
```

## Packages

| Package | Description |
|---------|-------------|
| [`@sweny-ai/core`](packages/core) | Skills, DAG executor, CLI, workflows |
| [`@sweny-ai/studio`](packages/studio) | Visual DAG editor and execution monitor |
| [`@sweny-ai/mcp`](packages/mcp) | MCP server for Claude Code / Desktop |

## Links

- [Documentation](https://docs.sweny.ai) — full docs, guides, and reference
- [Workflow Spec](https://spec.sweny.ai) — formal YAML specification
- [Marketplace](https://marketplace.sweny.ai) — browse and share workflows
- [Cloud Dashboard](https://cloud.sweny.ai) — analytics and scheduling

## Development

```bash
npm install          # install all dependencies
npm run build        # build all packages
npm test             # run all tests
```

## License

[MIT](LICENSE)
