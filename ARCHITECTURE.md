# Architecture

## What SWEny is

SWEny is an open-source framework for building and running AI agent workflows as YAML DAGs. Each node in the graph contains a natural language instruction, a set of skills (tool bundles), and optional structured output. Edges can be unconditional or use natural language conditions evaluated by the AI model at runtime.

The Action and CLI are free and run in **your** environment — your CI runner, your terminal, your compute. SWEny never executes code on our infrastructure.

## What SWEny Cloud is

[cloud.sweny.ai](https://cloud.sweny.ai) is the **analytics and intelligence dashboard**. It collects metadata from Action runs and GitHub webhooks, then shows you what matters: trends, activity, AI-powered insights. It stores metadata only — never source code, diffs, or agent output.

Cloud is to SWEny what Codecov is to testing: the Action does the work, Cloud shows the results.

## Packages

| Package | Dir | Published | What it does |
|---------|-----|-----------|--------------|
| `@sweny-ai/core` | `packages/core` | npm | Skills, DAG executor, CLI |
| `create-sweny` | `packages/create-sweny` | npm | `npx create-sweny` — thin wrapper around `sweny new` |
| `@sweny-ai/studio` | `packages/studio` | npm | Visual DAG editor and execution monitor |
| `@sweny-ai/mcp` | `packages/mcp` | npm | MCP server for Claude Code / Desktop |
| — | `packages/plugin` | no (marketplace) | Claude Code plugin: skills, MCP tools, agent, hooks |
| `@sweny-ai/action` | `packages/action` | no (private) | GitHub Action entrypoint — bundled into root `dist/` |
| — | `packages/web` | no (private) | Docs site (Vercel → docs.sweny.ai) |

## Execution Flow

When a workflow runs (via CLI or GitHub Action):

1. The executor loads the workflow YAML, validates the DAG, and resolves skills
2. Starting from the `entry` node, it builds context (workflow input + prior node outputs)
3. Each node's instruction (augmented with rules/context) is sent to the AI model with scoped tools
4. The model executes, tool calls are tracked, and structured output is captured
5. Edges are evaluated — unconditional edges follow deterministically, conditional edges are routed by the AI model
6. The trace (ordered steps + routing decisions) is emitted as events throughout

All execution happens locally. If `SWENY_CLOUD_TOKEN` is set, a structured summary (status, duration, recommendations) is sent to cloud.sweny.ai — no code, no diffs, no secrets.

## Skills

Skills are composable tool bundles. Three types:

- **Built-in** — set the credential, the skill is ready (e.g., `github`, `linear`, `sentry`, `datadog`)
- **Custom** — author a `SKILL.md` with instructions and/or an MCP server declaration
- **MCP** — any MCP-compatible server, wired per-node via skill config

Custom skills are harness-agnostic: the same `SKILL.md` works in Claude Code, Codex, Gemini CLI, and SWEny.

See [spec.sweny.ai/skills](https://spec.sweny.ai/skills/) for the formal specification.

## MCP Transport Standards

General rule: **don't use `npx -y`** — runtime package downloads bypass lockfiles and
security audits, and the package version is non-deterministic.

**Exception**: `buildAutoMcpServers()` in the CLI uses `npx -y` for a small set of
official first-party vendor MCP servers that have no stable HTTP endpoint:

| Server | Package | Why npx |
|--------|---------|---------|
| GitHub | `@modelcontextprotocol/server-github` | No public HTTP MCP endpoint |
| GitLab | `@modelcontextprotocol/server-gitlab` | No public HTTP MCP endpoint |
| Sentry | `@sentry/mcp-server` | No public HTTP MCP endpoint |
| Slack | `@modelcontextprotocol/server-slack` | No public HTTP MCP endpoint |
| Notion | `@notionhq/notion-mcp-server` | No public HTTP MCP endpoint |
| Monday.com | `@mondaydotcomorg/monday-api-mcp` | No public HTTP MCP endpoint |

These packages are all official vendor packages, not third-party. Users can override any
auto-injected server with a pre-installed binary by setting `mcp-servers-json` in `.sweny.yml`.

For services that DO have HTTP MCP endpoints (Datadog, Linear, New Relic, Better Stack,
PagerDuty), we always prefer the HTTP transport — no download required.
