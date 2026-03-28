---
title: Architecture
description: SWEny's two-layer execution model and design decisions.
---

SWEny uses a two-layer execution model that separates **orchestration** (deterministic DAG traversal) from **agency** (Claude reasoning with tools). This split gives you the reliability of a pipeline with the flexibility of an AI agent.

## Two layers

### Orchestration layer — the DAG executor

The orchestration layer is deterministic. A workflow is a directed acyclic graph (DAG) of nodes connected by edges. The executor walks the graph from the entry node to a terminal node, one node at a time. At each node it:

1. Gathers the tools from the node's declared skills
2. Builds context from the input plus all prior node results
3. Hands instruction, context, and tools to Claude
4. Records the result and resolves the next edge

Edge resolution follows simple rules:

- **Zero outbound edges** — terminal node, workflow ends
- **One unconditional edge** — follow it
- **Multiple or conditional edges** — Claude evaluates the `when` clauses and picks one

This means you can see exactly which node ran, what tools were called, and how long each step took. The path through the graph is structural, not emergent.

### Agent layer — Claude with tools

At each node, Claude operates as a full agent. It receives an instruction (what to accomplish), a set of tools (from the node's skills), and context (results from prior nodes). Claude reasons, calls tools, and produces a result. The executor treats this as a black box — it only cares about the output.

By default, Claude runs via headless [Claude Code](https://docs.anthropic.com/en/docs/claude-code) through the `@anthropic-ai/claude-agent-sdk`. This gives Claude access to the file system, terminal, and any MCP servers you configure — not just API tool calls. Alternative coding agents (OpenAI Codex, Google Gemini) can be selected via `coding-agent-provider` for the implementation phase, but Claude remains the default and most-tested backend.

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
| `@sweny-ai/action` | GitHub Action wrapper (private, calls `@sweny-ai/core`) |

`@sweny-ai/core` is the only runtime dependency. It exports the executor, all built-in skills, the Claude client, and the CLI.

## Key design decisions

### Skills replace providers

The v2 architecture used typed provider interfaces — `ObservabilityProvider`, `IssueTrackingProvider`, etc. Each integration implemented a multi-method interface that step code called directly.

Skills are simpler. A skill is a group of tools with shared configuration. Tools are exposed to Claude via MCP, and Claude calls them directly. No step code, no typed interfaces, no dispatch layer. The `github` skill exports tools like `github_search_code` and `github_create_issue` — Claude decides which to call based on the node instruction.

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
