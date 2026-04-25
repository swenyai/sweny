# Architecture

## Current Architecture

SWEny is an open-source framework for building and running AI agent workflows as YAML DAGs. Each node in the graph contains a natural language instruction, a set of skills (tool bundles), and optional structured output. Edges can be unconditional or use natural language conditions evaluated by the AI model at runtime.

The Action and CLI are free and run in **your** environment — your CI runner, your terminal, your compute. SWEny never executes code on our infrastructure.

### What SWEny Cloud is (today)

[cloud.sweny.ai](https://cloud.sweny.ai) is the **analytics and intelligence dashboard**. It collects metadata from Action runs and GitHub webhooks, then shows you what matters: trends, activity, AI-powered insights. It stores metadata only — never source code, diffs, or agent output.

Cloud is to SWEny what Codecov is to testing: the Action does the work, Cloud shows the results.

### Packages

| Package | Dir | Published | What it does |
|---------|-----|-----------|--------------|
| `@sweny-ai/core` | `packages/core` | npm | Skills, DAG executor, CLI |
| `create-sweny` | `packages/create-sweny` | npm | `npx create-sweny` — thin wrapper around `sweny new` |
| `@sweny-ai/studio` | `packages/studio` | npm | Visual DAG editor and execution monitor |
| `@sweny-ai/mcp` | `packages/mcp` | npm | MCP server for Claude Code / Desktop |
| — | `packages/plugin` | no (marketplace) | Claude Code plugin: skills, MCP tools, agent, hooks |
| `@sweny-ai/action` | `packages/action` | no (private) | GitHub Action entrypoint — bundled into root `dist/` |
| — | `packages/web` | no (private) | Docs site (Vercel → docs.sweny.ai) |

### Execution Flow

When a workflow runs (via CLI or GitHub Action):

1. The executor loads the workflow YAML, validates the DAG, and resolves skills
2. Starting from the `entry` node, it builds context (workflow input + prior node outputs)
3. Each node's instruction (augmented with rules/context) is sent to the AI model with scoped tools
4. The model executes, tool calls are tracked, and structured output is captured
5. Edges are evaluated — unconditional edges follow deterministically, conditional edges are routed by the AI model
6. The trace (ordered steps + routing decisions) is emitted as events throughout

All execution happens locally. If `SWENY_CLOUD_TOKEN` is set, a structured summary (status, duration, recommendations) is sent to cloud.sweny.ai — no code, no diffs, no secrets.

### What "scoped tools" means

Each node declares `skills`, and SWEny wires only those skills' MCP servers into that node's invocation. In that sense the MCP tool surface is scoped per node.

What SWEny does **not** scope: the underlying Claude Code subprocess runs with `permissionMode: "bypassPermissions"`, which keeps the built-in Bash/Read/Write/Edit tools available without permission prompting. This is intentional — SWEny targets CI-style autonomous runs where interactive approval is not an option, and the agent needs these capabilities to do the work. If you need a stricter sandbox, run the Action in a container that constrains the filesystem and network instead of looking for a flag inside SWEny.

`eval` evaluators are the primary mechanism for making a node's behavior auditable. Each node declares a list of named evaluators with `kind: value | function | judge`. `function` rules (`any_tool_called`, `all_tools_called`, `no_tool_called`) and `value` rules (`output_required`, `output_matches`) are checked deterministically against the recorded tool outcomes and structured output. `judge` evaluators call a small Claude model with a rubric for the conditional and semantic cases the deterministic kinds can't express. See [spec.sweny.ai/nodes/#eval](https://spec.sweny.ai/nodes/#eval).

### Skills

Skills are composable tool bundles. Three types:

- **Built-in** — set the credential, the skill is ready (e.g., `github`, `linear`, `sentry`, `datadog`)
- **Custom** — author a `SKILL.md` with instructions and/or an MCP server declaration
- **MCP** — any MCP-compatible server, wired per-node via skill config

Custom skills are harness-agnostic: the same `SKILL.md` works in Claude Code, Codex, Gemini CLI, and SWEny.

See [spec.sweny.ai/skills](https://spec.sweny.ai/skills/) for the formal specification.

### MCP Transport Standards and npx

General rule: **don't use `npx -y`** — runtime package downloads bypass lockfiles and
security audits, and the package version is non-deterministic.

**Exception**: stdio MCP servers are allowed via `npx -y` when no public HTTP MCP
endpoint exists and the package is official first-party vendor code (or the
de-facto community standard where no first-party alternative exists). Every
exception must declare its reason in code.

**Authoritative list:** `packages/core/src/mcp-catalog.ts` — each entry's
`npxExceptionReason` field names the server, its package, and why the exception is
acceptable. A module-load assertion and `mcp-catalog.test.ts` fail the build if a
stdio entry is missing its reason or an http entry declares one. Update the code
and the notes here together whenever a provider is added, removed, or changes
transport.

Currently stdio (via `npx -y`): GitHub, GitLab, Sentry, Slack, Notion, Monday.com,
Jira/Confluence (community `@sooperset/mcp-atlassian` — documented in the catalog
as a community exception; revisit when Atlassian ships a first-party server).

Currently http (no exception needed): Datadog, Linear, New Relic, BetterStack,
PagerDuty.

Users can override any auto-injected server with a pre-installed binary by setting
`mcp-servers-json` in `.sweny.yml`.

---

## Where to look next

- [spec.sweny.ai](https://spec.sweny.ai) — the formal workflow specification (nodes, edges, eval, requires, retry, sources, skills).
- [docs.sweny.ai](https://docs.sweny.ai) — narrative guides, getting-started flows, CLI reference.
- [`packages/core/src/mcp-catalog.ts`](packages/core/src/mcp-catalog.ts) — single source of truth for skill ↔ MCP wiring.
