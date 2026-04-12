# SWEny Workflow Specification Site — Design Document

**Date:** 2026-04-10
**Status:** Draft
**Author:** Claude + Nate

---

## Problem

SWEny's core innovation — a declarative YAML format for orchestrating AI agents as a directed graph with natural language routing — exists only as implementation artifacts (schema.ts, types.ts, executor.ts) and tutorial-oriented docs. There is no standalone, formal specification that defines the format independent of the SWEny implementation.

This matters because:
- Open-source projects that define a **format** capture ecosystems (Docker Compose, OpenAPI, Terraform HCL). SWEny should own the standard for AI agent workflow definition.
- A formal spec enables third-party tooling: IDE plugins, linters, CI validators, alternative executors.
- Enterprise buyers trust standards over tools.
- The marketplace becomes "workflows in a standard format" rather than "SWEny-specific files."

## Solution

A formal specification document hosted at **spec.sweny.ai**, living inside the sweny monorepo at `spec/`. Built with Astro + Starlight (matching docs.sweny.ai). Deployed to Vercel. DNS via Porkbun CNAME.

## Architecture

### Location

`spec/` — top-level directory in the sweny monorepo, not under `packages/` (it's a document, not an npm package). Co-located with schema.ts and types.ts so PRs that change the engine must update the spec atomically.

### Stack

- **Framework:** Astro + Starlight (same as packages/web)
- **Hosting:** Vercel project, root directory set to `spec/`
- **DNS:** `spec.sweny.ai` — CNAME to Vercel via Porkbun
- **Static assets:** JSON Schema files served from `spec/public/schemas/`

### Versioning

- Starts at **v1.0**.
- Version declared in spec Overview page frontmatter.
- Current version lives at the root (`spec.sweny.ai/`). No `/v1/` prefix until v2 exists — avoid premature complexity.
- When v2 ships, v1 moves to `spec.sweny.ai/v1/` and the root becomes v2.
- Non-breaking additions (new optional fields, new event types) are additive to the current version.
- Breaking changes (field removals, semantic changes) get a new major version.

## Content Structure

### Pages (6)

#### 1. Overview (`index.mdx`)

What the SWEny Workflow Specification is. Positions it as a vendor-neutral format for declarative AI agent orchestration.

Contents:
- Abstract (2-3 sentences defining the format)
- Versioning policy
- Conformance language: MUST, SHOULD, MAY per RFC 2119
- Link to canonical JSON Schema (`spec.sweny.ai/schemas/workflow.json`)
- Link to reference implementation (`github.com/swenyai/sweny`)
- Table of contents linking to the other 5 pages
- License (Apache 2.0, matching the monorepo)

#### 2. Workflow Object (`workflow.mdx`)

The top-level document structure.

Contents:
- Formal field table: `id`, `name`, `description`, `nodes`, `edges`, `entry`
- Each field: type, required/optional, constraints, description
- YAML and JSON examples showing a minimal valid workflow and a full workflow
- Relationship between `entry` and `nodes` keys
- The `nodes` object is a Record<string, Node> keyed by node ID
- Node ID constraints (must be valid YAML key, referenced by edges)

#### 3. Nodes (`nodes.mdx`)

The Node object and its semantics.

Contents:
- Formal field table: `name`, `instruction`, `skills[]`, `output`
- **Instruction semantics:** A conforming executor MUST pass the instruction to the AI model as the primary directive for this step. The instruction is natural language. It MAY be augmented with context from prior nodes but MUST NOT be altered or summarized.
- **Skills:** An array of skill IDs that this node has access to. A conforming executor MUST make the tools from these skills available during node execution. Skills not listed MUST NOT be available.
- **Output schema:** An optional JSON Schema object. When present, a conforming executor MUST request structured output matching this schema. The output becomes available to downstream nodes via context accumulation.
- Examples: minimal node, node with output schema, node with multiple skills

#### 4. Edges & Routing (`edges.mdx`)

The Edge object and routing semantics.

Contents:
- Formal field table: `from`, `to`, `when`, `max_iterations`
- **Unconditional edges:** An edge without a `when` clause. If a node has exactly one unconditional outgoing edge, a conforming executor MUST follow it without evaluation.
- **Conditional edges:** An edge with a `when` clause (natural language condition). A conforming executor MUST evaluate the condition against the accumulated context (input + all prior node results) and route to the first edge whose condition is satisfied.
- **Multiple outgoing edges:** When a node has multiple outgoing edges (conditional or mixed), a conforming executor MUST present all conditions to the AI model and follow the selected route.
- **Terminal nodes:** A node with zero outgoing edges is terminal. Execution ends when a terminal node completes.
- **Bounded cycles:** An edge with `max_iterations` creates a bounded cycle. A conforming executor MUST track iteration count and exclude the edge from routing once exhausted. An edge with a self-loop (from === to) MUST have `max_iterations` set.
- **Unbounded cycles:** A workflow with a cycle where no edge in the cycle has `max_iterations` is invalid. A conforming validator MUST reject it.
- Diagram: example DAG with conditional routing, bounded cycle, and terminal nodes

#### 5. Skills & Tools (`skills.mdx`)

The Skill and Tool interfaces.

Contents:
- **Skill object:** `id`, `name`, `description`, `category`, `config`, `tools[]`
- **Skill categories:** Enumeration — `git`, `observability`, `tasks`, `notification`, `general`
- **Config fields:** `description`, `required` (boolean), `env` (environment variable name). A conforming executor MUST resolve config by checking explicit overrides first, then environment variables. Missing required config MUST cause the skill to be unavailable (not a hard error — the workflow can still run if no node requires that skill).
- **Tool object:** `name`, `description`, `input_schema` (JSON Schema), handler (implementation-defined)
- **Tool invocation contract:** A conforming executor MUST validate tool inputs against `input_schema` before invocation. Tool outputs are opaque JSON values included in the execution trace.
- **Built-in skill registry:** The specification defines a set of well-known skill IDs (`github`, `linear`, `slack`, `sentry`, `datadog`, `betterstack`, `notification`, `supabase`) with their expected categories and config fields. Implementations MAY support additional skills.

#### 6. Execution Model (`execution.mdx`)

The behavioral specification for workflow execution.

Contents:
- **Context accumulation:** At each node, a conforming executor MUST provide: (a) the original workflow input, and (b) the output of every previously completed node, keyed by node ID. This is the "context" available to the instruction and to edge condition evaluation.
- **Node execution:** For each node, a conforming executor MUST: (1) resolve available tools from the node's skills, (2) build the context object, (3) invoke the AI model with the instruction, context, and tools, (4) capture the result (structured output if schema provided, otherwise freeform), (5) emit execution events.
- **Edge resolution algorithm:** After a node completes: (a) collect all outgoing edges, (b) filter out edges that have exhausted `max_iterations`, (c) if zero remaining edges, execution is complete, (d) if one unconditional edge, follow it, (e) otherwise, evaluate conditions via the AI model and follow the selected edge.
- **Dry-run semantics:** When the input includes `dryRun: true`, a conforming executor MUST stop at the first conditional edge. Unconditional edges are followed normally. This allows "analysis without action" — the workflow runs through gathering/analysis nodes but stops before taking action decisions.
- **Execution events (9 types):** `workflow:start`, `node:enter`, `tool:call`, `tool:result`, `node:exit`, `node:progress`, `route`, `workflow:end`. Each event type defined with its payload schema.
- **Execution trace:** A conforming executor MUST produce an `ExecutionTrace` containing: `steps[]` (node ID, status, iteration number) and `edges[]` (from, to, reason string).
- **Error handling:** A node that fails MUST produce a result with `status: "failed"`. The executor MAY continue to subsequent nodes or terminate — this is implementation-defined. The trace MUST record the failure.

### Machine-Readable Artifacts

#### `spec/public/schemas/workflow.json`

The canonical JSON Schema for a SWEny Workflow document. Derived from and kept in sync with `packages/core/src/schema.ts`. Served at `spec.sweny.ai/schemas/workflow.json`.

IDEs can reference this via `$schema` for autocomplete and validation:
```yaml
# $schema: https://spec.sweny.ai/schemas/workflow.json
id: my-workflow
name: My Workflow
...
```

#### `spec/public/schemas/skill.json`

JSON Schema for the Skill definition. Derived from the Zod `skillZ` schema. Served at `spec.sweny.ai/schemas/skill.json`.

### Starlight Configuration

- **Title:** "SWEny Workflow Specification"
- **Tagline:** "A declarative format for AI agent orchestration"
- **Sidebar:** Single flat group, 6 pages in order (Overview, Workflow, Nodes, Edges, Skills, Execution)
- **Social links:** GitHub repo
- **Theme:** Dark mode default, matching the SWEny brand (blue accents, not indigo)
- **No search** initially — 6 pages don't need it
- **Favicon:** SWEny logo

### Tone & Style

Formal, precise, normative. Modeled after:
- [OpenAPI Specification](https://spec.openapis.org/oas/latest.html) — field tables, MUST/SHOULD/MAY language
- [Docker Compose Specification](https://docs.docker.com/compose/compose-file/) — YAML examples inline
- [JSON Schema Specification](https://json-schema.org/specification) — machine-readable + prose

Every field gets: name, type, required/optional, default (if any), constraints, and a one-sentence description. No tutorials, no "getting started," no hand-holding. This is a reference document for implementers.

## What This Is NOT

- **Not a replacement for docs.sweny.ai** — the docs site keeps its tutorial/guide tone and links to the spec for formal definitions.
- **Not marketplace metadata** — the marketplace adds `author`, `category`, `tags`, `version` on top of the core spec. Those are marketplace concerns, not workflow format concerns.
- **Not a CLI reference** — how to run `sweny workflow validate` is a docs topic.
- **Not skill implementation details** — the spec defines what a Skill IS, not what github.ts does internally.

## Deployment

1. Vercel project: new project in the swenyai Vercel team, root directory `spec/`
2. DNS: Porkbun CNAME `spec.sweny.ai` → Vercel
3. Build command: `npm run build` (standard Astro)
4. Output: `dist/`

## Success Criteria

- `spec.sweny.ai` loads with the 6-page spec
- JSON Schema served at `spec.sweny.ai/schemas/workflow.json`
- Every field from schema.ts and types.ts is documented with normative language
- The execution model section matches executor.ts behavior
- A developer who has never seen SWEny could implement a conforming executor from the spec alone
