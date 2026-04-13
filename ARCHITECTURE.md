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

---

## Future: Managed Execution (aws-cloud)

> **Status:** Not live. This architecture was designed and partially built in the
> [aws-cloud repo](https://github.com/swenyai/aws-cloud) but is not the current
> cloud product. It represents a possible future direction — managed execution for
> teams who don't want to run their own CI.

### Open-Core Split

**Open (this repo):**

- **engine** — recipe runner, step execution, cycle detection
- **providers** — all integrations (Datadog, Linear, GitHub, etc.)
- **action** — GitHub Action wrapper
- **cli** — `sweny` CLI for local/CI use
- **agent** — Claude Code subprocess management

**Open (worker):**

- **worker** — the BullMQ job executor (queue consumer + runRecipe)
  The worker is the open-source engine running inside a BullMQ queue consumer.
  Customers can audit and verify exactly what runs on their data, and optionally
  run the worker in their own VPC (BYO Worker tier).

**Closed (managed platform):**

- **API** — multi-tenant orchestration, billing, auth, org management
- **UI** — dashboard, settings, job history, analytics
- **Infrastructure** — deployment, scaling, monitoring

### Why this split?

The value of managed execution is NOT in the code that executes jobs (that's open).
The value is in: managed execution, team collaboration, result history, integrations
UI, compliance features (BYOK, TEE), and operational reliability.

You can run the engine yourself for free. The managed platform handles it at scale,
keeps it running, and gives your team visibility.

### Job Execution Flow

When the managed platform runs a job:

1. The API dispatches a `WorkerJobPayload` onto a BullMQ queue
2. The worker (open-source) picks up the job
3. The worker fetches the bundle encryption key (BEK) from the internal API using a one-time job token
4. The worker decrypts credentials in memory, clones the repo, and runs `runRecipe()` from `@sweny-ai/engine`
5. The worker submits a structured `JobOutcome` back to the internal API
6. The API persists job metadata and notifies the UI

Steps 3–5 are the open-source worker. Steps 1, 2, and 6 are the closed platform.
No proprietary business logic lives in the worker — it is pure engine orchestration.

### Audit Path

Customers who want to verify what ran on their data can:

1. Check the open-source worker source at `packages/worker/` in the aws-cloud repo
2. Compare the published Docker image digest against the build attestation in GitHub Releases
3. Use `verify-build.sh` to verify a specific image was built from a known commit
4. Run the worker themselves in their own VPC (BYO Worker tier)

The `WorkerJobPayload` type defines the exact public interface: no billing info, no
internal org state, no platform secrets cross this boundary.

### Self-Hosted Worker

See [docs/self-hosted-worker.md](docs/self-hosted-worker.md) for instructions on running
the worker in your own infrastructure (applies to the aws-cloud managed execution model).
