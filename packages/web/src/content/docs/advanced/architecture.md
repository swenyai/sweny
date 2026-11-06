---
title: Architecture
description: SWEny's two-layer execution model and design decisions.
---

SWEny uses a two-layer execution model that separates **orchestration** (deterministic DAG traversal) from **agency** (a coding agent reasoning with tools). This split gives you the reliability of a pipeline with the flexibility of an AI agent.

## Two layers

### Orchestration layer — the DAG executor

The orchestration layer is deterministic. A workflow is a directed acyclic graph (DAG) of nodes connected by edges. The executor walks the graph from the entry node to a terminal node, one node at a time. At each node it:

1. Gathers the tools from the node's declared skills
2. Builds context from the input plus all prior node results
3. Hands instruction, context, and tools to the coding agent
4. Records the result and resolves the next edge

Edge resolution follows simple rules:

- **Zero outbound edges** — terminal node, workflow ends
- **One unconditional edge** — follow it
- **Multiple or conditional edges** — the coding agent evaluates the `when` clauses and picks one

This means you can see exactly which node ran, what tools were called, and how long each step took. The path through the graph is structural, not emergent.

### Agent layer — a coding agent with tools

At each node, a coding agent operates as a full agent. It receives an instruction (what to accomplish), a set of tools (from the node's skills), and context (results from prior nodes). The agent reasons, calls tools, and produces a result. The executor treats this as a black box — it only cares about the output.

Each node runs on a harness for the agent you pick with `--agent` (or `coding-agent-provider`): headless [Claude Code](https://docs.anthropic.com/en/docs/claude-code) by default (through the `@anthropic-ai/claude-agent-sdk`), the Codex CLI, pi, or any [Agent Client Protocol](https://agentclientprotocol.com) agent (`acp:<command>`). This gives the agent the file system, terminal, and any MCP servers you configure, not just API tool calls. Other values are rejected. SWEny applies the same opinions to every harness (scoped env, read-only dry runs, output checks, timeouts) and reports what an agent cannot enforce itself as degraded or refuses the node under `--harness-policy strict`; see [Agents and policies](/getting-started/agents-and-policies/). What the agent can see and reach is scoped per node; see [Agent sandbox](/advanced/agent-sandbox/).

## Why this matters

Traditional AI pipelines are either fully scripted (reliable but rigid) or fully agentic (flexible but unpredictable). SWEny's split gives you both:

- **Reliability** — The DAG defines the path. You know investigation runs before issue creation, every time.
- **Observability** — Every node emits structured events (`node:enter`, `tool:call`, `tool:result`, `node:exit`, `route`). Studio renders these in real time.
- **Composability** — Swap a node's skills without touching the graph. Add a new path by adding an edge with a `when` clause.

## Package structure

| Package | Role |
|---------|------|
| `@sweny-ai/core` | Engine, skills, CLI, workflows — everything that runs |
| `@sweny-ai/studio` | Visual DAG editor and execution monitor (React) |
| `@sweny-ai/mcp` | MCP server for Claude Code / Desktop |

`@sweny-ai/core` is the only runtime dependency. It exports the executor, all built-in skills, the agent harnesses, and the CLI. The GitHub Action is the composite `action.yml` at the repo root, which runs `sweny workflow run`.

## Key design decisions

### Skills replace providers

The v2 architecture used typed provider interfaces — `ObservabilityProvider`, `IssueTrackingProvider`, etc. Each integration implemented a multi-method interface that step code called directly.

Skills are simpler. A skill is a group of tools with shared configuration. Tools are exposed to the agent (in process, over a tool bridge, or via MCP, depending on the harness), and the agent calls them directly. No step code, no typed interfaces, no dispatch layer. The `github` skill exports tools like `github_search_code` and `github_create_issue` — the agent decides which to call based on the node instruction.

### DAG replaces recipe DSL

The v2 recipe format used implicit routing — each step had `next` and `on` fields that the engine evaluated. The DAG model makes routing explicit: edges connect node IDs, and conditional edges carry a natural-language `when` clause.

This makes workflows easier to visualize (Studio renders them directly), easier to validate (cycles and dead ends are detectable statically), and easier to extend (add an edge, not a routing rule).

### Environment-driven configuration

Skills declare what environment variables they need via `config` fields. The executor resolves config at startup — checking explicit overrides first, then environment variables — and throws if required values are missing. No config files, no service discovery, no runtime lookups.

```typescript
config: {
  GITHUB_TOKEN: {
    description: "GitHub personal access token",
    required: true,
    env: "GITHUB_TOKEN",
  },
}
```

### Event-based observer

The executor emits `ExecutionEvent` objects for every state change — workflow start/end, node enter/exit, tool calls, and routing decisions. Observers are plain functions `(event: ExecutionEvent) => void`. The CLI uses an observer to render progress. Studio uses one for live execution streaming. You can attach your own for logging, metrics, or custom UIs.

## Execution flow

A simplified view of what happens when a workflow runs:

```
execute(workflow, input, { skills, claude })
│
├─ validate(workflow, skills)        ← check entry node, edges, skill refs
├─ resolveConfig(skills, overrides)  ← merge env vars + overrides, fail on missing
│
├─ node: investigate
│   ├─ resolveTools(["sentry", "github"])  ← gather tools from skills
│   ├─ claude.run({ instruction, context, tools })
│   │   ├─ tool: sentry_list_issues → [...]
│   │   ├─ tool: github_search_code → [...]
│   │   └─ result: { status: "success", data: {...} }
│   └─ resolveNext() → "create_issue" (when: "novel issue found")
│
├─ node: create_issue
│   ├─ resolveTools(["linear"])
│   ├─ claude.run(...)
│   │   ├─ tool: linear_create_issue → { id: "ENG-456" }
│   │   └─ result: { status: "success", data: {...} }
│   └─ resolveNext() → "notify" (unconditional)
│
├─ node: notify
│   ├─ resolveTools(["slack"])
│   ├─ claude.run(...)
│   └─ resolveNext() → null (terminal)
│
└─ return results: Map<nodeId, NodeResult>
```

## Source code

The core implementation lives in three files:

- [`packages/core/src/types.ts`](https://github.com/swenyai/sweny/blob/main/packages/core/src/types.ts) — All type definitions (Skill, Node, Edge, Workflow, ExecutionEvent)
- [`packages/core/src/executor.ts`](https://github.com/swenyai/sweny/blob/main/packages/core/src/executor.ts) — The DAG executor (~230 lines)
- [`packages/core/src/claude.ts`](https://github.com/swenyai/sweny/blob/main/packages/core/src/claude.ts) — Claude Code client via `@anthropic-ai/claude-agent-sdk`
