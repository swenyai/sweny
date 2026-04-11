# MULTI_HARNESS — Harness-Agnostic Execution

**Status:** Not started. Captured from brainstorming on 2026-04-12. Open questions remain below; do not begin implementation until they are answered.

**Goal:** Make sweny workflow execution harness-agnostic, matching the harness-agnosticism already achieved for skills. A workflow should be able to run nodes under any supported agent CLI (Claude Code, Codex CLI, Gemini CLI, Copilot CLI, etc.) — selected per-node.

---

## 1. Motivation

Today sweny is "married to Claude" at the execution layer. Users who prefer Codex/Gemini/Copilot can't run sweny workflows through their existing agent CLI, and workflow authors can't route a specific node to the harness that's best for that step (e.g. Claude for code edits, Gemini for multimodal, Codex for something else).

Skills (markdown instructions, the superpowers/Anthropic convention) are already harness-agnostic — every major agent CLI loads them out of the box. Model/capability selection is also already solved: a node declares which skill(s) to use, and skills wrap whichever LLM/API is appropriate (e.g. Google TTS, Anthropic vision). The gap is the agent-loop/harness layer itself.

---

## 2. Current Coupling Points (verified 2026-04-12)

The executor is *already* abstracted behind a `Claude` interface — the coupling is in the single implementation.

### 2.1 Executor → `Claude` interface (good, keep)

`packages/core/src/executor.ts:52` — `execute(workflow, input, options)` takes `options.claude: Claude` and calls `claude.run({ instruction, context, tools, outputSchema, onProgress })` at every node (line ~113) and `claude.evaluate(...)` for conditional edge routing (line ~312).

`packages/core/src/types.ts:160-177` — `Claude` interface:

```ts
export interface Claude {
  run(opts: {
    instruction: string;
    context: Record<string, unknown>;
    tools: Tool[];
    outputSchema?: JSONSchema;
    onProgress?: (message: string) => void;
  }): Promise<NodeResult>;

  evaluate(opts: {
    question: string;
    context: Record<string, unknown>;
    choices: { id: string; description: string }[];
  }): Promise<string>;
}
```

This shape is reasonable for any agent harness. Likely rename to `Agent`, `Harness`, or `AgentRuntime` to stop implying Anthropic.

### 2.2 `ClaudeClient` — the actual lock-in

`packages/core/src/claude.ts:34` — only implementation. Imports `query`, `createSdkMcpServer`, `tool as sdkTool` from `@anthropic-ai/claude-agent-sdk`. Header comment at `claude.ts:1-10` explicitly states:

> "This is the ONLY supported LLM backend. The whole point of sweny is to use headless Claude Code — never the raw Anthropic API."

That stance is what this spec overturns (in a narrow way — see Non-Goals §8).

### 2.3 Tool exposure — the real sticky point

`Skill.tools: Tool[]` (types.ts:37-44) are TypeScript objects with `handler: (input, ctx) => Promise<unknown>`. `ClaudeClient` exposes them to the agent loop via `createSdkMcpServer` — an **in-process, Claude-Code-only** mechanism. Other harnesses can't see these tools as-is.

This is the actual structural blocker. Everything else is wiring.

### 2.4 Naming collision

Sweny's `Skill` type (a bundle of typed tools) collides with the broader "skill" concept (markdown instructions loaded by agent CLIs). Every time this spec and future work says "skills stay as skills," it means the markdown kind. Sweny's typed-tool bundles need a new name (`ToolPack`, `ToolProvider`, `Integration`, or similar — **decision deferred; see §6**).

---

## 3. Decisions Made in This Conversation

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | Harness selection is **per-node**, not per-workflow. | Lets authors pick the best harness for each step (e.g. Claude for code edit, Gemini for multimodal). |
| D2 | Model/capability selection is **already solved by skills**. Don't re-solve. | Skills wrap APIs (Google TTS, vision, etc.). That layer is portable. |
| D3 | Markdown skills stay as markdown skills — **no changes**. | Every major harness loads them natively. |
| D4 | The thing that needs to become portable is sweny's **typed `Tool[]` bundles**, currently exposed via `createSdkMcpServer`. | That's the only Claude-Code-specific hook in the execution path. |
| D5 | The natural common denominator for tool exposure across harnesses is **stdio MCP**. | Claude Code, Codex CLI, Gemini CLI, and Copilot CLI all consume stdio MCP config. `@sweny-ai/mcp` already exists as a starting point. |
| D6 | The `Claude` interface stays (rename TBD). `ClaudeClient` becomes one adapter among many. | Executor already abstracts it; we just need more adapters. |

---

## 4. Proposed Architecture

### 4.1 Shape

```
Workflow (YAML/JSON)
  └── Node { harness?: "claude" | "codex" | "gemini" | "copilot", ... }
        │
        ▼
Executor                       ◄──── unchanged walk-the-DAG logic
  │
  ▼
HarnessRegistry.get(node.harness) → Agent adapter
  │
  ▼
Agent adapter:
  1. Boot a local stdio MCP server exposing the node's tools
  2. Generate MCP config block for the target CLI
  3. Invoke the CLI (subprocess) with instruction + MCP config + markdown skill refs
  4. Stream tool calls back through the MCP server (handlers run in-process)
  5. Capture CLI output, convert to NodeResult
  6. Tear down MCP server + subprocess
```

### 4.2 Node schema addition

`packages/core/src/types.ts:55-64` — add optional `harness` field to `Node`:

```ts
export interface Node {
  name: string;
  instruction: string;
  skills: string[];
  output?: JSONSchema;
  harness?: string;     // NEW — e.g. "claude", "codex", "gemini", "copilot"
}
```

Workflow-level default + per-node override. If `harness` is unset on node and workflow, fall back to a single env-configured default.

### 4.3 Interface rename

Rename `Claude` → `Agent` (or `Harness` — decision in §6). Propagate to `executor.ts`, `claude.ts`, `types.ts`, `index.ts`, tests. `ClaudeClient` → `ClaudeCodeAgent` (or `ClaudeCodeHarness`).

### 4.4 Shared stdio MCP server

Extract the tool-exposure logic currently in `claude.ts` into a generic **stdio MCP server builder** that takes a `Tool[]` and serves them over stdio. Likely lives in or extends `@sweny-ai/mcp`.

Each harness adapter calls this builder, gets back `{ port/stdin-stdout handle, mcpConfigBlock }`, and hands the MCP config to its CLI.

### 4.5 Adapter skeleton

```ts
export interface Agent {
  run(opts: AgentRunOptions): Promise<NodeResult>;
  evaluate(opts: AgentEvaluateOptions): Promise<string>;
}

export class CodexAgent implements Agent { /* spawns `codex` with --mcp-config */ }
export class GeminiCliAgent implements Agent { /* spawns `gemini` with settings.json */ }
export class CopilotCliAgent implements Agent { /* spawns copilot with tool config */ }
```

Each adapter owns: subprocess lifecycle, stdout/stderr parsing, CLI-specific flags, auth env vars.

### 4.6 Auth

Each harness has its own credentials (OAuth tokens, API keys). Adapters read from env; document required vars per harness. Fail fast with a clear error if the selected harness's auth is missing.

---

## 5. Implementation Blueprint (for a future agent)

**Order matters — don't skip ahead.**

1. **Answer open questions (§6).** Do not start code until §6 is resolved.
2. **Extract the MCP-exposure code.** Pull the `createSdkMcpServer` + tool-to-SDK-tool conversion out of `packages/core/src/claude.ts` into a reusable stdio MCP builder. Keep a thin wrapper that `ClaudeCodeAgent` uses so behavior doesn't regress. Add tests to pin the current behavior.
3. **Rename `Claude` → `Agent` (or chosen name).** Mechanical change across `types.ts`, `executor.ts`, `claude.ts`, `index.ts`, and every test/import. Watch for any string references in docs.
4. **Add `harness` field to `Node`.** Update `schema.ts` (`nodeZ`), YAML parser, and `workflow-builder.ts`. Default to the env-configured fallback harness if unset.
5. **Build a `HarnessRegistry`.** Maps `harness` string → adapter class. Executor picks an adapter per node. Workflow validator warns when a node references an unregistered harness.
6. **Implement the MVP adapter set** (see §6 for which harnesses). Each adapter:
   - Subprocess management (spawn, kill, timeout)
   - MCP config generation
   - Stdout parsing → `NodeResult`
   - `onProgress` callback wiring (stream tool-call events)
   - Evaluate-mode: for conditional edge routing, either (a) reuse `run()` with a forced-JSON output, or (b) implement a lightweight non-agent LLM call per harness.
7. **Cross-harness integration tests.** Run the `triageWorkflow` e2e under each adapter with a mock source/issue/notification skill. Assert the DAG produces the same shape of result regardless of harness.
8. **Docs.** Update `ARCHITECTURE.md`, add a `docs/` page on harness selection, update CLI `--help`.
9. **Terminology cleanup.** Rename `Skill` → chosen name (see §6). Ripple through types, skills package, docs, tests.
10. **Worker/cloud propagation.** The cloud worker (`/Users/nate/src/swenyai/cloud/services/worker`) imports `@sweny-ai/core`. Make sure cloud jobs can choose a harness per workflow. Default stays Claude for backwards compatibility.

---

## 6. Open Questions — MUST resolve before implementation

| ID | Question | Options | Notes |
|----|----------|---------|-------|
| Q1 | MVP harness set | (a) Claude + Codex (b) Claude + Codex + Gemini (c) Full set incl. Copilot (d) Claude + raw-API adapter we own | User leaned toward "per-node with Claude, Gemini, Codex, Copilot" but did not commit to MVP scope. |
| Q2 | Tool-exposure strategy | (a) Keep typed Tool bundles, expose via stdio MCP (adapter pattern) (b) Kill typed tools, let markdown skills hit APIs via harness-native HTTP/bash (c) Hybrid | Not answered. Q1 partially depends on this. (a) is the lowest-risk default. |
| Q3 | Rename of `Claude` interface | `Agent`, `Harness`, `AgentRuntime`, other | Bikeshed, but pick one and commit before renaming sweeps. |
| Q4 | Rename of sweny's `Skill` type | `ToolPack`, `ToolProvider`, `Integration`, other | Collides with the markdown-skill meaning. Must resolve before docs get written; this is the single biggest source of confusion in the codebase today. |
| Q5 | Default harness when node/workflow don't specify | Env var? Config file? Hardcoded to `claude`? | Backwards-compat — existing workflows have no `harness` field. |
| Q6 | `evaluate()` implementation per harness | Reuse `run()` with forced-JSON output, or direct non-agent LLM call | Direct LLM call is cheaper/faster but needs per-harness API credentials beyond the CLI. |
| Q7 | Subprocess lifecycle | New subprocess per node, or reuse a persistent session across nodes | Persistent is faster but harder to isolate; new-per-node is simpler and matches current semantics. |
| Q8 | Do we keep `createSdkMcpServer` in-process mode for Claude Code as an optimization, or force stdio MCP even for Claude? | Faster in-process vs uniform code path | In-process only benefits Claude Code. Stdio MCP is uniform but adds IPC overhead. |

---

## 7. Files Touched (expected)

Read-only reference — a future agent should verify each still exists and is the right target.

- `packages/core/src/types.ts` — `Claude` interface, `Node`, `Skill`, `Tool`
- `packages/core/src/executor.ts` — rename usage, adapter dispatch
- `packages/core/src/claude.ts` — split into reusable MCP builder + `ClaudeCodeAgent`
- `packages/core/src/index.ts` — new exports (`Agent`, harnesses, registry)
- `packages/core/src/schema.ts` — `nodeZ` gains `harness`
- `packages/core/src/workflow-builder.ts` — accept `harness` in builder
- `packages/core/src/__tests__/executor.test.ts` — harness dispatch tests
- `packages/core/src/mcp.ts` — may host the shared stdio MCP builder
- `packages/mcp/` — possibly becomes the home of the stdio MCP builder
- New: `packages/core/src/agents/claude-code.ts`, `codex.ts`, `gemini.ts`, `copilot.ts` (or similar)
- New: `packages/core/src/agents/registry.ts`
- `packages/cli/` — surface `--harness` flag, env var, config file key
- Cloud monorepo: `/Users/nate/src/swenyai/cloud/services/worker/` — accept `harness` from job payload

---

## 8. Non-Goals

- **Do not** replace markdown skills. They work everywhere and need no change.
- **Do not** build a raw Anthropic/OpenAI/Gemini API agent loop from scratch *unless* Q1 option (d) is chosen. The goal is to reuse existing harnesses, not to write another one.
- **Do not** attempt per-tool routing ("use Gemini for this tool, Claude for that tool inside one node"). Granularity is per-node. Tool choice is up to the running harness.
- **Do not** change workflow semantics (DAG walk, edge routing, dry-run gate, max_iterations). The executor stays intact.
- **Do not** make cloud billing changes (subscription-based Claude Code auth vs per-token API) part of this work. That's a separate decision downstream.

---

## 9. Glossary (read this first if the terms feel overloaded)

| Term | Meaning |
|------|---------|
| **Harness** (this doc) | An agent CLI / agent runtime that runs an agentic loop: prompt in, tool calls + final output out. Examples: Claude Code, Codex CLI, Gemini CLI, Copilot CLI. |
| **Skill** (markdown, the real kind) | A markdown file with instructions that any agent CLI can load. Harness-agnostic. Stays unchanged. |
| **Sweny's `Skill` type** | A TS object `{ id, tools: Tool[] }`. Badly named — it's a tool bundle, not a skill. To be renamed (Q4). |
| **Tool** | A typed function with input schema + handler that an agent calls during execution. |
| **Agent adapter** | A class implementing the renamed `Agent` interface that knows how to drive one harness. |
| **Stdio MCP** | Model Context Protocol over stdio — the cross-vendor protocol for exposing tools to an agent. Supported by all the harnesses in §6 Q1. |

---

## 10. Context dump for the executing agent

When you pick this up:

1. Read this file end-to-end before touching code.
2. Ask the user to resolve every question in §6 — do not guess.
3. Read `packages/core/src/executor.ts`, `claude.ts`, `types.ts`, `mcp.ts`, and `index.ts` in full before writing any plan.
4. Check `@sweny-ai/mcp` (`packages/mcp/`) to see what stdio MCP infrastructure already exists — much of §4.4 may already be partly built.
5. After §6 is resolved, invoke the `superpowers:writing-plans` skill to produce a stepwise implementation plan. Then follow the normal brainstorm → plan → execute flow. This document is the *spec*, not the plan.
6. The comment at `packages/core/src/claude.ts:1-10` ("ONLY supported LLM backend... never the raw Anthropic API") will be wrong after this work lands. Update it.
7. This work touches `@sweny-ai/core` which is published to npm. Expect a semver major. Changesets and the auto-changeset script in `scripts/auto-changeset.mjs` will handle the bump if one is created with the right level.
