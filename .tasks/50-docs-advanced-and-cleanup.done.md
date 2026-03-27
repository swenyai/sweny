# Task: Write Advanced Section + Root README + /docs/ Cleanup

## Goal
Write the 3 Advanced pages, update the root README, and clean up `/docs/`.

## Pages to write

### Advanced (in `packages/web/src/content/docs/advanced/`)

#### 1. `architecture.md` — Architecture
- Two-layer model: Orchestration (DAG executor) + Agent (Claude with tools)
- The orchestration layer is deterministic: the DAG defines the path, conditions are evaluated by Claude but routing is structural
- The agent layer is agentic: Claude reasons, calls tools, produces results
- Why this matters: reliability + observability. You can see exactly which node ran, what tools were called, how long it took.
- Package structure: `@sweny-ai/core` (engine + skills + CLI), `@sweny-ai/studio` (visual editor), `@sweny-ai/action` (GitHub Action wrapper)
- Claude Code as the LLM backend: SWEny uses headless Claude Code via `@anthropic-ai/claude-agent-sdk`, NOT the raw Anthropic API. This gives Claude access to file system, terminal, and external MCP servers.
- Key design decisions:
  - Skills > Providers (tool groups replace typed interfaces)
  - DAG > Recipe DSL (explicit edges with conditions vs. implicit next/on routing)
  - Environment-driven config (skills declare env var requirements)
  - Event-based observer (streaming for real-time UI)

#### 2. `mcp-servers.md` — MCP Servers
- What MCP is: Model Context Protocol — a standard for connecting tools to AI models
- Auto-injection: SWEny automatically injects MCP servers based on configured providers:
  - Category A (auto): GitHub MCP, Sentry MCP, Linear MCP servers injected when those skills are configured
  - Category B (opt-in): Slack, Notion, PagerDuty, Monday, Asana — enabled via `workspace-tools` input
- Custom MCP servers: pass via `mcp-servers` action input (JSON) or CLI config
- Server config format:
  ```json
  {
    "my-server": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "..." }
    }
  }
  ```
- HTTP transport preferred over stdio for performance
- User config wins on conflict with auto-injected servers

#### 3. `troubleshooting.md` — Troubleshooting
- **Authentication errors**: check env vars, verify tokens haven't expired
- **"No configured skills" error**: run `sweny check` to diagnose
- **Workflow validation failures**: use `sweny workflow validate <file>` for details
- **Node timeouts**: increase `max-investigate-turns` or `max-implement-turns`
- **Rate limiting**: observability APIs may rate-limit; reduce `time-range` or `investigation-depth`
- **MCP server connection failures**: check server is accessible, verify transport type
- **GitHub Actions permissions**: ensure `contents: write`, `issues: write`, `pull-requests: write`

### Root README (`README.md`)

Rewrite to reflect the new architecture:
- SWEny = workflow orchestration for AI-powered engineering
- Core value: define a DAG → Claude executes each node → reliable, observable results
- Quick example (GitHub Action YAML, 10 lines)
- Three entry points: Action, CLI, Studio
- Skills table (7 built-in)
- Link to docs site
- Package table (core, studio, action — mark engine/providers/agent as deprecated)

### /docs/ Cleanup

- Update `docs/architecture.md` — align terminology with new concepts (Skills, Workflows, Nodes)
- Update `docs/mcp-servers.md` — align with current MCP auto-injection
- Delete `docs/provider-authoring.md` — providers are now skills, and custom skills aren't yet supported
- Delete `docs/recipe-authoring.md` — replaced by workflows section in web docs
- Delete `docs/studio.md` — replaced by web docs studio section
- Update `docs/self-hosted-worker.md` — verify still accurate or mark as outdated
- Update `docs/recipes/` — verify the stack recipes still work with new config format

## Source of truth
- `packages/core/src/types.ts` — architecture
- `packages/core/src/mcp.ts` — MCP auto-injection
- `packages/core/src/executor.ts` — execution model
- Root `action.yml` — action inputs
- `packages/core/src/cli/main.ts` — CLI
