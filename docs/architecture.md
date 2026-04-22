# SWEny Architecture & Design Philosophy (ARCHIVED)

> **This document is archived.** It predates the current workflow/node/edge/skill
> model in `@sweny-ai/core`. Terminology like "recipe", "provider", and "step"
> has been superseded by workflow / skill / node.
>
> For the current architecture see:
> - **[`ARCHITECTURE.md`](../ARCHITECTURE.md)** (repo root) — authoritative
>   current architecture, including the MCP catalog policy and "scoped tools"
>   semantics.
> - **[`spec/src/content/docs/`](../spec/src/content/docs/)** — the formal
>   spec published at spec.sweny.ai.
> - **[`packages/core/src/mcp-catalog.ts`](../packages/core/src/mcp-catalog.ts)**
>   — the single source of truth for provider/skill → MCP wiring.
>
> The material below is preserved for historical context — the distinction
> between orchestration vs agentic layers and Type A vs Type B providers
> still informs current design — but flag names, file paths, and some
> conclusions are stale. Treat this as background, not as operative guidance.

---

## The Mission

SWEny is a **reliable execution layer for agentic AI workflows**, not an API aggregation library.

The value proposition:
- **MCP handles what the agent CAN do** — tool access, data retrieval, service integration
- **SWEny handles WHEN and IN WHAT ORDER the agent does it** — workflow, reliability, structure, cost control

Neither replaces the other. A fully agentic system with MCP tools is powerful but unreliable. The workflow DAG makes it production-grade.

---

## The Two Layers (Never Conflate These)

```
┌─ ORCHESTRATION LAYER (sweny workflow DAG) ──────────────────────────┐
│  Deterministic execution, structured data handoffs, node validation   │
│                                                                       │
│  prepare → gather → investigate → create_issue → implement           │
│  → create_pr → notify                                                │
│  (with conditional routing: investigate → skip, create_issue → notify)│
│                                                                       │
│  Each node gives Claude an instruction + skills (tools).             │
│  The executor routes between nodes via conditional edges.             │
└──────────────────────────────────────────────────────────────────────┘

┌─ AGENT LAYER (inside each node) ────────────────────────────────────┐
│  LLM reasoning + tool access (skills + MCP servers)                  │
│                                                                       │
│  Agent (Claude / Codex / Gemini) receives:                           │
│  - A focused instruction describing the task                         │
│  - Skill tools + MCP servers injected as available tools             │
│                                                                       │
│  Agent can use Datadog MCP, Linear MCP, GitHub MCP, etc.            │
│  directly — WE DO NOT CALL THESE APIS. THE AGENT DOES.              │
└──────────────────────────────────────────────────────────────────────┘
```

---

## MCP Strategy: Injection, Not Wrapping

### The Right Pattern

MCP servers are **configuration passed to the agent**, not backends called by workflow nodes.

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

| Provider | Trigger | MCP Server | Transport | Auth |
|---|---|---|---|---|
| GitHub source control | `source-control-provider: github` | `@modelcontextprotocol/server-github` | stdio (npx) | `GITHUB_PERSONAL_ACCESS_TOKEN` |
| GitHub Issues tracker | `issue-tracker-provider: github-issues` | `@modelcontextprotocol/server-github` | stdio (npx) | `GITHUB_PERSONAL_ACCESS_TOKEN` |
| GitLab | `source-control-provider: gitlab` | `@modelcontextprotocol/server-gitlab` | stdio (npx) | `GITLAB_PERSONAL_ACCESS_TOKEN` |
| Linear | `issue-tracker-provider: linear` | `https://mcp.linear.app/mcp` | HTTP | `Authorization: Bearer <token>` |
| Datadog | `observability-provider: datadog` | `https://mcp.datadoghq.com/api/unstable/mcp-server/mcp` | HTTP | `DD_API_KEY` + `DD_APPLICATION_KEY` headers |
| Sentry | `observability-provider: sentry` | `@sentry/mcp-server` | stdio (npx) | `SENTRY_ACCESS_TOKEN` env |
| New Relic | `observability-provider: newrelic` | `https://mcp.newrelic.com/mcp/` (US) or `https://mcp.eu.newrelic.com/mcp/` (EU) | HTTP | `Api-Key: <key>` header |

Category B — requires **both** an explicit declaration in `workspace-tools` config **and** the credential env var to be set. Neither alone is sufficient.

```yaml
# .sweny.yml or action input
workspace-tools: slack,notion,pagerduty
```

| Tool name | Credential env var | MCP Server | Transport | Notes |
|---|---|---|---|---|
| `slack` | `SLACK_BOT_TOKEN` | `@modelcontextprotocol/server-slack` | stdio (npx) | Full bidirectional API; separate from notification webhook. Package deprecated upstream — override via `mcp-servers` when Slack ships a stable replacement. |
| `notion` | `NOTION_TOKEN` (or `NOTION_API_KEY`) | `@notionhq/notion-mcp-server` | stdio (npx) | Runbooks, on-call docs, incident templates |
| `pagerduty` | `PAGERDUTY_API_TOKEN` | `https://mcp.pagerduty.com/mcp` | HTTP | Auth: `Token token=<key>` (not Bearer) |
| `monday` | `MONDAY_TOKEN` | `@mondaydotcomorg/monday-api-mcp` | stdio (npx) | Monday.com project/issue context |

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
// ❌ WRONG — calling MCP from workflow nodes
const raw = await mcpClient.call("search_issues", { query: "TypeError" });
const issues = parseResponse(raw);

// ❌ WRONG — npx in MCPClient (when SWEny itself acts as MCP client)
new StdioClientTransport({ command: "npx", args: ["-y", "@linear/mcp"] })
// npx -y has no lockfile, no security audit, slow cold start
// For the coding agent's MCP config, npx is acceptable since the agent handles spawning

// ❌ WRONG — custom observability providers for data the agent can get via MCP
registry.set("observability", datadog({ apiKey, appKey }));
// If Datadog has an MCP server, the agent can query Datadog directly
```

---

## Provider Taxonomy

Not all providers are equal. Two fundamentally different kinds:

### Type A: Thin Orchestration Providers (Keep These)

These are called by **workflow nodes**, return **structured data** that subsequent nodes depend on, and cannot be replaced by agent reasoning because the workflow needs typed return values.

| Skill | Operation | Why It Must Be Deterministic |
|---|---|---|
| `linear` / `github` | `create_issue` | Returns `{ identifier, url }` used by implement node |
| `linear` / `github` | `update_issue` | State mutation with known outcome |
| `github` | `create_pr` | Returns `{ prUrl, prNumber }` used by notify node |
| `slack` / `notification` | `send` | Final output node, must succeed reliably |

These providers are **thin** — 20–50 lines. They are not feature-complete API clients. They implement exactly what the workflow needs and nothing more.

All Type A providers expose a `configSchema: ProviderConfigSchema` field declaring their required env vars. The engine validates this before step 1 fires (see Pre-flight Validation below).

### Type B: Agent Tool Access (Use MCP, Not Providers)

These are accessed by **the agent during reasoning** to gather information, not by workflow nodes that need structured returns. The agent calls them as MCP tools.

| Category | Examples | Correct Approach |
|---|---|---|
| Observability | Datadog, Sentry, CloudWatch, Splunk | MCP server config |
| Issue search/history | Linear search, Jira search | MCP server config |
| Code lookup | GitHub search, file reading | MCP server config |
| Docs/context | Confluence, Notion, web search | MCP server config |

**Do not write custom providers for Type B.** Every custom observability provider we maintain is technical debt that becomes obsolete when the vendor ships an MCP server.

---

## Provider Config Schema + Pre-flight Validation

Every Type A provider exposes a `configSchema` object alongside its implementation:

```typescript
interface ProviderConfigField {
  key: string;         // logical name ("apiKey")
  envVar: string;      // env var ("DD_API_KEY")
  required?: boolean;  // default true
  description: string;
}
interface ProviderConfigSchema {
  role: string;        // provider role ("observability")
  name: string;        // display name ("Datadog")
  fields: ProviderConfigField[];
}
```

The executor reads `skills: string[]` from each node definition, looks up the registered skill, and collects all required config fields. Before the first node executes it throws listing **all** missing env vars grouped by node — never one at a time.

```
Missing required configuration for workflow "triage":
  node "gather" (Datadog):    DD_API_KEY, DD_APP_KEY
  node "create_issue" (Linear): LINEAR_API_KEY
  node "create_pr" (GitHub):  GITHUB_TOKEN
```

**Rules:**
- Validate ALL nodes upfront (even conditionally-reached ones) — you want to know about missing config before the 45-minute investigation node, not after
- Nodes without skills are skipped in pre-flight
- Providers without `configSchema` are skipped (validation is additive/opt-in)
- `required: false` fields are never validated (they have defaults)

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

**LLM judges are valid** for verification of reasoning-based outputs. They are wasteful for verification of retrievable facts. The workflow naturally separates these — deterministic steps validate facts, agent steps reason.

---

## Why the Workflow DAG Still Matters in an Agentic World

You might ask: "Why not give the agent all MCP tools and a prompt saying do A→B→C?"

Because:

1. **Reliability** — LLMs claim to have done things they haven't. Workflow steps validate that each step actually succeeded before proceeding. "Create issue" returns the issue ID or throws — there's no ambiguity.

2. **Structured data handoffs** — The `create-issue` step returns `{ issueIdentifier: "ENG-123" }`. The `implement-fix` step uses that ID. Parsing "what issue did the agent create?" from natural language transcript is fragile and breaks when phrasing changes.

3. **Cost control** — Investigation (50k+ tokens) and implementation (100k+ tokens) are bounded to their steps. They don't bleed into "create a Slack message." Without step boundaries, a single agent run for the full pipeline would cost 10-50x more.

4. **Resumability** — If `create-pr` fails, the workflow retries just that step with full context from prior steps. A monolithic agent run restarts from scratch.

5. **Human gates** — The `novelty-gate` step can pause for human review before spending money on implementation. A monolithic agent has already done everything by the time you review.

6. **Multi-model orchestration** — Investigation might use Claude Opus for deep reasoning; implementation uses Claude Sonnet for cost; PR description uses a template. The workflow can use different models/agents per step. One prompt = one model.

7. **Auditability** — "What did each step do and why?" is trivially answered by the workflow runner's step results. A monolithic agent transcript requires full parsing.

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
| Workflow DAG over monolithic agent prompt | Reliability, structured handoffs, cost control, human gates |
| MCP injection over custom observability providers | Zero maintenance, cross-agent, vendor-owned |
| Thin native providers for create/update/notify | Structured returns required by workflow; 20–50 lines each |
| `npx -y` prohibited for stdio MCP | Runtime npm download: no lockfile, security risk, slow |
| Streamable HTTP preferred over stdio for remote MCP | Current spec standard, supports auth, scales |
| LLM for reasoning steps; deterministic for fact retrieval | Optimal cost/reliability tradeoff |
| Cross-agent by default (no Claude lock-in) | Provider replaceability; business continuity |
| `WorkflowDefinition` / `StepDefinition` over `RecipeDefinition` / `StateDefinition` | Accurate terminology; "recipe" implies linear/sequential, not a conditional state machine |
| Provider `configSchema` + pre-flight validation | Fail fast with full error report before any LLM spend; self-documenting config requirements |
| `StepDefinition.uses[]` over `provider: string` | Steps can depend on multiple provider roles; array is more expressive and future-proof |
