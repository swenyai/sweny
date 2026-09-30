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
  <a href="https://marketplace.sweny.ai"><img alt="Marketplace" src="https://img.shields.io/badge/Workflows-marketplace.sweny.ai-blue?style=flat-square" /></a>
</p>

---

## Quickstart

Requires Node 20+ and a Claude login (`claude` signed in) or an `ANTHROPIC_API_KEY` / `CLAUDE_CODE_OAUTH_TOKEN` (SWEny runs its nodes on the Claude Code agent).

```bash
npm install -g @sweny-ai/core
sweny new --template explain-repo --yes   # zero-credential starter: reads this checkout, no tokens
sweny workflow validate .sweny/workflows/explain-repo.yml
sweny workflow diagram .sweny/workflows/explain-repo.yml   # Mermaid graph of the DAG
sweny workflow run .sweny/workflows/explain-repo.yml
```

`sweny new` with no flags opens the interactive picker. `--template <id> --yes` skips every prompt (no
terminal needed). It writes `.sweny.yml`, `.env` (added to `.gitignore`), and the workflow file.
CI runs everything above except `run` in a clean container on every PR (`scripts/quickstart-smoke.sh`).

Templates that use skills such as GitHub need their token first. `sweny new` writes blank values for
credentials it can't infer:

```bash
$EDITOR .env                # fill in GITHUB_TOKEN etc. for the skills your workflow uses
sweny check                 # verify only the credentials your workflows need
sweny workflow run .sweny/workflows/pr-review.yml
```

Already have a `.sweny.yml`? `sweny new` adds additional workflows to it non-destructively.

[`examples/file-ops.yml`](./examples/file-ops.yml) is another local file-I/O workflow that needs nothing
beyond your Claude auth:

```bash
sweny workflow run examples/file-ops.yml
```

Build a workflow from scratch: pick "Describe your own" in the `sweny new` picker.

```bash
# Visualize any workflow as a Mermaid diagram — drop it into a PR or README
sweny workflow diagram .sweny/workflows/pr-review.yml -o pr-review.mmd
```

Keep the CLI current:

```bash
sweny upgrade          # pulls the latest @sweny-ai/core via your package manager
sweny upgrade --check  # dry-run: just report the available version
```

Browse **[marketplace.sweny.ai](https://marketplace.sweny.ai)** for ready-to-run workflows.

## What it does

Describe a task in plain English. SWEny builds a DAG of focused AI agents — each node gets its own MCP tool set scoped by the skills it declares, structured output, and conditional routing. Every tool call is tracked. (The underlying Claude Code agent process keeps its built-in tools available so nodes stay agentic inside their box; see [ARCHITECTURE.md](./ARCHITECTURE.md#what-scoped-tools-means) for the exact capability contract.)

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

## Workflows

Three recurring packs, built to be enabled once and useful again next week. Each is read-only except one declared output, validates with no credentials, and comes with a GitHub Action trigger. Pick one in `sweny new` (right after "Explain this repo") or by id. Setup, permissions, and gates: [docs.sweny.ai/workflows/packs](https://docs.sweny.ai/workflows/packs/).

| Pack | Runs | Output | Tokens per run (estimate) |
|------|------|--------|---------------------------|
| `weekly-digest` | Mondays | Commits, merged PRs, issues opened and closed, risky files, as one issue or Slack message | 15k to 40k |
| `dependency-drift` | Weekly | Lockfiles plus open advisories, one deduped issue with what matters and why | 20k to 60k |
| `pr-risk-review` | Every PR | Read-only scope and risk comment: size, tests touched, risky areas | 10k to 30k |

```bash
sweny new --template weekly-digest --yes
sweny workflow validate .sweny/workflows/weekly-digest.yml   # no credentials needed
```

<details>
<summary>Sample output: weekly-digest</summary>

```text
Weekly digest 2026-09-21 to 2026-09-28 (acme/api)

Auth middleware rewrite landed; 11 PRs merged, one touching the session store.

11 commits by 4 authors | 11 PRs merged | 6 issues opened | 9 closed

Merged
- #482 Rotate session secrets on deploy (@dana)
- #479 Cache permit lookups (@ravi)

Risky files
- src/auth/session.ts (auth): session secret handling changed, no test touched
- db/migrations/0041_add_index.sql (data): new index on a 40M-row table

Watch next week
- Add a test for session rotation (src/auth/session.ts)
```

</details>

<details>
<summary>Sample output: dependency-drift</summary>

```text
Dependency drift: 2 actionable

| Package | Severity | Advisory | Why it matters | Fix |
| --- | --- | --- | --- | --- |
| jsonwebtoken | high | GHSA-xxxx-xxxx-xxxx | Runtime dependency of the auth middleware | Upgrade to 9.0.0 |
| lodash | medium | GHSA-yyyy-yyyy-yyyy | Runtime dependency, reachable from the export route | Upgrade to 4.17.21 |

Drift
- services/worker/package.json: no lockfile, installs are unpinned

9 lower-severity or dev-only alerts deferred.
```

</details>

<details>
<summary>Sample output: pr-risk-review</summary>

```text
Risk: high (size m, 6 files)

- src/auth/session.ts changed and no test file was touched
- db/migrations/0041_add_index.sql is a data migration

Where to look
- session secret handling in src/auth/session.ts
- whether 0041 needs a concurrent index build

Read-only scope review. No code was changed.
```

</details>

The samples are illustrative (made-up repo), not captured from a run.

## Custom skills

Extend any workflow with your own skills. Scaffold one in a single command:

```bash
sweny skill new code-standards -d "Team TypeScript conventions"
sweny skill list
```

Or write the file by hand at `.sweny/skills/code-standards/SKILL.md`:

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

### Run reporting (optional, not yet available)

SWEny runs locally or in CI with **zero phone-home behavior**. No anonymous telemetry, no pings, nothing.

The CLI contains an opt-in run reporting path, gated entirely on a `SWENY_CLOUD_TOKEN` project token. Unless you set that variable yourself, every reporting entry point returns before making a request, so a default install sends nothing.

The hosted service behind it is in active development and **not open for sign-ups**, so there is no token to obtain today. See [PRIVACY.md](./PRIVACY.md) for the exact payload if you point it at your own endpoint.

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

## Development

```bash
npm install          # install all dependencies
npm run build        # build all packages
npm test             # run all tests
```

## License

[MIT](LICENSE)
