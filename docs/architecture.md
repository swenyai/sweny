# SWEny Architecture & Design Philosophy

> **This document is the source of truth for architectural decisions.**
> Before changing how providers, recipes, or MCP integration work — read this first.
> It exists because the wrong patterns are easy to accidentally rebuild.

---

## The Mission

SWEny is a **reliable execution layer for agentic AI workflows**, not an API aggregation library.

The value proposition:
- **MCP handles what the agent CAN do** — tool access, data retrieval, service integration
- **SWEny handles WHEN and IN WHAT ORDER the agent does it** — workflow, reliability, structure, cost control

Neither replaces the other. A fully agentic system with MCP tools is powerful but unreliable. The recipe DAG makes it production-grade.

---

## The Two Layers (Never Conflate These)

```
┌─ ORCHESTRATION LAYER (sweny recipe DAG) ────────────────────────────┐
│  Deterministic execution, structured data handoffs, step validation  │
│                                                                       │
│  dedup-check → verify-access → build-context → investigate           │
│  → novelty-gate → create-issue → cross-repo-check                    │
│  → implement-fix → create-pr → notify                                │
│                                                                       │
│  Steps that need structured returns (Issue ID, PR URL) use           │
│  thin native providers. Steps that need reasoning use agents.         │
└──────────────────────────────────────────────────────────────────────┘

┌─ AGENT LAYER (inside investigate / implement-fix steps) ────────────┐
│  LLM reasoning + MCP tool access                                     │
│                                                                       │
│  Agent (Claude / Codex / Gemini) receives:                           │
│  - A focused prompt describing the task                              │
│  - MCP servers injected as available tools                           │
│                                                                       │
│  Agent can use Datadog MCP, Linear MCP, GitHub MCP, etc.            │
│  directly — WE DO NOT CALL THESE APIS. THE AGENT DOES.              │
└──────────────────────────────────────────────────────────────────────┘
```

---

## MCP Strategy: Injection, Not Wrapping

### The Right Pattern

MCP servers are **configuration passed to the agent**, not backends called by recipe steps.

```yaml
# .sweny.yml — user configures which MCP servers the agent gets access to
mcp-servers:
  datadog:
    type: http
    url: https://mcp.datadoghq.com/api/unstable/mcp-server/mcp
    headers:
      DD_API_KEY: "${DD_API_KEY}"
      DD_APPLICATION_KEY: "${DD_APP_KEY}"
  linear:
    type: http
    url: https://mcp.linear.app/mcp
    headers:
      Authorization: "Bearer ${LINEAR_API_KEY}"
  github:
    type: stdio
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github@latest"]
    env:
      GITHUB_TOKEN: "${GITHUB_TOKEN}"
```

When the `investigate` or `implement-fix` step runs the agent, it serializes this config to a temp JSON file and passes `--mcp-config <path>` to the agent CLI. The agent now has every tool from every configured MCP server available during its reasoning.

### Auto-Injection (The Better Pattern for Users)

Users should **never** need to configure MCP servers manually for the providers they've already wired up. `buildAutoMcpServers()` in `packages/cli/src/main.ts` and `packages/action/src/main.ts` reads the user's provider config and auto-injects the corresponding MCP servers before passing to the agent.

**Current auto-injections:**

Category A — triggered by provider config (structured credentials already collected):

| Provider | Trigger | MCP Server | Transport |
|---|---|---|---|
| GitHub source control | `source-control-provider: github` | `@modelcontextprotocol/server-github` | stdio (npx) |
| GitHub Issues tracker | `issue-tracker-provider: github-issues` | `@modelcontextprotocol/server-github` | stdio (npx) |
| GitLab | `source-control-provider: gitlab` | `@modelcontextprotocol/server-gitlab` | stdio (npx) |
| Linear | `issue-tracker-provider: linear` | `https://mcp.linear.app/mcp` | HTTP |
| Datadog | `observability-provider: datadog` | `https://mcp.datadoghq.com/api/unstable/mcp-server/mcp` | HTTP |
| Sentry | `observability-provider: sentry` | `@sentry/mcp-server` | stdio (npx) |

Category B — triggered by env var presence (zero new config required; set as workflow/shell secrets):

| Env Var | MCP Server | Notes |
|---|---|---|
| `SLACK_BOT_TOKEN` | `@modelcontextprotocol/server-slack` | Full API access; separate from notification webhook |
| `NOTION_API_KEY` | `@notionhq/notion-mcp-server` | Runbooks, on-call docs, incident templates |

**Rules:**
- HTTP transport is preferred for remote services — no local install, vendor-managed, scales
- stdio (npx) used when no stable HTTP endpoint exists; the agent process handles spawning
- Category B env vars let users add MCP tools without changing any provider config
- User-supplied `mcp-servers` config **always wins** on key conflict (explicit overrides auto)
- New provider added to CLI/Action? Add a corresponding auto-injection in `buildAutoMcpServers()`

**Note on `npx` for agent MCP configs:** The `npx -y` prohibition in the ADL below applies to `MCPClient` (when SWEny itself calls MCP tools from recipe steps). For the coding agent's own MCP config, the agent process handles spawning — `npx` is acceptable as a fallback when no HTTP endpoint exists, but prefer HTTP.

### Why This Architecture

1. **Zero maintenance burden** — Datadog ships a new MCP tool? Users get it automatically. We write zero code.
2. **Cross-agent compatibility** — MCP is the open standard across Claude Code, OpenAI Codex CLI, Gemini CLI, Cursor, Cline, Goose. Injecting MCP configs works for all of them.
3. **Unlimited extensibility** — Any service with an MCP server becomes available to sweny agents with one config line.
4. **Correct mental model** — The agent reasons with tools. We orchestrate the agent. These are different jobs.

### The Wrong Pattern (Do Not Rebuild)

```typescript
// ❌ WRONG — calling MCP from recipe steps
const raw = await mcpClient.call("search_issues", { query: "TypeError" });
const issues = parseResponse(raw);

// ❌ WRONG — npx in MCPClient (when SWEny itself acts as MCP client from recipe steps)
new StdioClientTransport({ command: "npx", args: ["-y", "@linear/mcp"] })
// npx -y has no lockfile, no security audit, slow cold start
// For the coding agent's mcpServers config, npx is acceptable since the agent handles spawning

// ❌ WRONG — custom observability providers for data the agent can get via MCP
registry.set("observability", datadog({ apiKey, appKey }));
// If Datadog has an MCP server, the agent can query Datadog directly
```

---

## Provider Taxonomy

Not all providers are equal. Two fundamentally different kinds:

### Type A: Thin Orchestration Providers (Keep These)

These are called by **recipe steps**, return **structured data** that subsequent steps depend on, and cannot be replaced by agent reasoning because the recipe needs typed return values.

| Provider | Operation | Why It Must Be Deterministic |
|---|---|---|
| `issueTracker` | `createIssue()` | Returns `{ identifier, url }` used by implement-fix |
| `issueTracker` | `updateIssue()` | State mutation with known outcome |
| `sourceControl` | `createPullRequest()` | Returns `{ prUrl, prNumber }` used by notify |
| `notification` | `send()` | Final output step, must succeed reliably |

These providers are **thin** — 20–50 lines. They are not feature-complete API clients. They implement exactly what the recipe needs and nothing more.

### Type B: Agent Tool Access (Use MCP, Not Providers)

These are accessed by **the agent during reasoning** to gather information, not by recipe steps that need structured returns. The agent calls them as MCP tools.

| Category | Examples | Correct Approach |
|---|---|---|
| Observability | Datadog, Sentry, CloudWatch, Splunk | MCP server config |
| Issue search/history | Linear search, Jira search | MCP server config |
| Code lookup | GitHub search, file reading | MCP server config |
| Docs/context | Confluence, Notion, web search | MCP server config |

**Do not write custom providers for Type B.** Every custom observability provider we maintain is technical debt that becomes obsolete when the vendor ships an MCP server.

---

## When to Use LLM vs Deterministic Code

```
Use LLM when:              → the answer requires reasoning over unstructured information
Use deterministic code when → the answer is a fact you can retrieve directly from an API

Examples:
  "Was the GitHub PR created?"          → deterministic (API returns 201 or 404)
  "Is this issue novel?"                → LLM (requires comparing against known patterns)
  "What's the root cause?"              → LLM (reasoning over logs and code)
  "What issue ID was created?"          → deterministic (API response field)
  "Should we implement this fix?"       → LLM (cost/risk judgment)
  "Did the tests pass?"                 → deterministic (CI exit code)
```

**LLM judges are valid** for verification of reasoning-based outputs. They are wasteful for verification of retrievable facts. The recipe naturally separates these — deterministic steps validate facts, agent steps reason.

---

## Why the Recipe DAG Still Matters in an Agentic World

You might ask: "Why not give the agent all MCP tools and a prompt saying do A→B→C?"

Because:

1. **Reliability** — LLMs claim to have done things they haven't. Recipe steps validate that each step actually succeeded before proceeding. "Create issue" returns the issue ID or throws — there's no ambiguity.

2. **Structured data handoffs** — The `create-issue` step returns `{ issueIdentifier: "ENG-123" }`. The `implement-fix` step uses that ID. Parsing "what issue did the agent create?" from natural language transcript is fragile and breaks when phrasing changes.

3. **Cost control** — Investigation (50k+ tokens) and implementation (100k+ tokens) are bounded to their steps. They don't bleed into "create a Slack message." Without step boundaries, a single agent run for the full pipeline would cost 10-50x more.

4. **Resumability** — If `create-pr` fails, the recipe retries just that step with full context from prior steps. A monolithic agent run restarts from scratch.

5. **Human gates** — The `novelty-gate` step can pause for human review before spending money on implementation. A monolithic agent has already done everything by the time you review.

6. **Multi-model orchestration** — Investigation might use Claude Opus for deep reasoning; implementation uses Claude Sonnet for cost; PR description uses a template. The recipe can use different models/agents per step. One prompt = one model.

7. **Auditability** — "What did each step do and why?" is trivially answered by the recipe runner's step results. A monolithic agent transcript requires full parsing.

---

## MCP Transport Standards

The MCP spec (2025-03-26) defines two transports:

| Transport | Use Case | Status |
|---|---|---|
| **Streamable HTTP** | Remote servers, cloud-hosted, multi-client | Current standard |
| **stdio** | Local binaries, single-client | Valid for local tools |
| ~~HTTP+SSE~~ | ~~Old remote transport~~ | **Deprecated** |

For our `MCPClient` (when sweny itself needs to act as MCP client):
- Support **both** Streamable HTTP and stdio
- For stdio: accept pre-installed binary paths — **never** `npx -y <package>` at runtime
- For HTTP: pass auth via headers (API key) or OAuth `ClientCredentialsProvider`
- Prefer HTTP for any provider that exposes an endpoint

---

## Cross-Agent Compatibility

MCP is the universal tool interface across all major coding agents. Injecting MCP configs makes sweny MORE compatible, not less:

| Agent | MCP Support |
|---|---|
| Claude Code | `--mcp-config`, stdio + Streamable HTTP |
| OpenAI Codex CLI | stdio + HTTP streaming |
| Gemini CLI | HTTP + DCR |
| Cursor, Cline, Goose | stdio + HTTP |

The `mcpServers` config passed to `claudeCode()`, `openaiCodex()`, `googleGemini()` is serialized to the agent's native MCP config format. Users write the config once; it works across agents.

---

## What We Are Not Building

To prevent scope creep and accidental rebuilding of the wrong patterns:

- **Not** a feature-complete API client library for every SaaS tool
- **Not** an MCP server aggregator (we don't proxy MCP servers through sweny)
- **Not** a replacement for native API clients when MCP exists (use MCP injection instead)
- **Not** dependent on any single AI provider (Claude, OpenAI, Google are all equal citizens)
- **Not** trying to make every agent step deterministic (some steps ARE the LLM reasoning)

---

## Architectural Decision Log

| Decision | Rationale |
|---|---|
| Recipe DAG over monolithic agent prompt | Reliability, structured handoffs, cost control, human gates |
| MCP injection over custom observability providers | Zero maintenance, cross-agent, vendor-owned |
| Thin native providers for create/update/notify | Structured returns required by recipe; 20–50 lines each |
| `npx -y` prohibited for stdio MCP | Runtime npm download: no lockfile, security risk, slow |
| Streamable HTTP preferred over stdio for remote MCP | Current spec standard, supports auth, scales |
| LLM for reasoning steps; deterministic for fact retrieval | Optimal cost/reliability tradeoff |
| Cross-agent by default (no Claude lock-in) | Provider replaceability; business continuity |
