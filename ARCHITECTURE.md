# Architecture

## Current Architecture

SWEny is an open-source framework for building and running AI agent workflows as YAML DAGs. Each node in the graph contains a natural language instruction, a set of skills (tool bundles), and optional structured output. Edges can be unconditional or use natural language conditions evaluated by the AI model at runtime.

The Action and CLI are free and run in **your** environment — your CI runner, your terminal, your compute. SWEny never executes code on our infrastructure.

### Packages

| Package | Dir | Published | What it does |
|---------|-----|-----------|--------------|
| `@sweny-ai/core` | `packages/core` | npm | Skills, DAG executor, CLI |
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

All execution happens locally. The executor has an opt-in reporting path that emits a structured summary (status, duration, recommendations) when `SWENY_CLOUD_TOKEN` is set. No code, no diffs, no secrets. Token minting is not currently exposed, so this path is dormant by default; the hosted service behind it is in active development.

### What "scoped tools" means

Each node declares `skills`. MCP servers declared on those resolved skills are passed only to that node. Client-level MCP servers (including CLI catalog auto-wiring and explicit user configuration) remain available across the run.

What SWEny does **not** scope: the underlying Claude Code subprocess runs with `permissionMode: "bypassPermissions"`, which keeps the built-in Bash/Read/Write/Edit tools available without permission prompting. This is intentional — SWEny targets CI-style autonomous runs where interactive approval is not an option, and the agent needs these capabilities to do the work. If you need a stricter sandbox, run the Action in a container that constrains the filesystem and network instead of looking for a flag inside SWEny.

`eval` evaluators are the primary mechanism for making a node's behavior auditable. Each node declares a list of named evaluators with `kind: value | function | judge`. `function` rules (`any_tool_called`, `all_tools_called`, `no_tool_called`) and `value` rules (`output_required`, `output_matches`) are checked deterministically against the recorded tool outcomes and structured output. `judge` evaluators call a small Claude model with a rubric for the conditional and semantic cases the deterministic kinds can't express. See [spec.sweny.ai/nodes/#eval](https://spec.sweny.ai/nodes/#eval).

### Skills

Skills are composable tool bundles. Three types:

- **Built-in** — set the credential, the skill is ready (e.g., `github`, `linear`, `sentry`, `datadog`)
- **Custom**: author a `SKILL.md` with instructions and an optional MCP server declaration
- **MCP** — any MCP-compatible server, wired per-node via skill config

Custom skills are harness-agnostic: the same `SKILL.md` works in Claude Code, Codex, Gemini CLI, and SWEny.

See [spec.sweny.ai/skills](https://spec.sweny.ai/skills/) for the formal specification.

### Skill-declared MCP execution (#328)

Skill MCP declarations are supported through the library executor, so CLI and library runs use the same path. `execute()` passes each node's resolved skill servers through `Claude.run({ mcpServers })`; custom implementations of `Claude` must honor that optional field. Caller-provided skills take precedence over inline definitions. Catalog defaults have lowest precedence, followed by node skill declarations, then explicit client MCP configuration. An omitted transport is inferred from `command` (stdio) or `url` (HTTP).

MCP-only inline skills are rejected during workflow validation with an instruction-specific diagnostic. Add `instruction` describing how to use the server. Resolved caller-provided and discovered MCP-only skills remain supported. The MCP skill ID `sweny-core` is reserved for the engine; validation rejects external declarations using it before any node runs.

Discovered `SKILL.md` stdio commands still require `SWENY_ALLOW_SKILL_STDIO_COMMAND=1`; discovery strips them otherwise. Inline workflow declarations and caller-provided skills are explicit configuration and do not use that discovery opt-in. Dry-run execution withholds all external MCP servers, including skill declarations and client overrides. The node `tools.allow`/`tools.deny` filter applies to in-process skill tools only; external MCP tools are not filtered by it.

The regression test launches a local stdio fixture and calls its tool through the configs produced by `execute()` and `ClaudeClient`. The SDK/model boundary is deterministic; this test does not exercise a live Claude session.

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
