# SWEny Workflow Specification Site — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `spec.sweny.ai` — a formal, normative specification for the SWEny Workflow format, built with Astro + Starlight, hosted on Vercel.

**Architecture:** Static site in `spec/` at the monorepo root. 6 MDX content pages defining the workflow format with RFC 2119 conformance language. 2 JSON Schema files served as static assets. Content extracted from `packages/core/src/schema.ts`, `types.ts`, and `executor.ts`.

**Tech Stack:** Astro 6, @astrojs/starlight 0.38, Vercel, Porkbun DNS.

---

## File Map

```
spec/
  package.json
  astro.config.mjs
  tsconfig.json
  src/
    content.config.ts
    content/docs/
      index.mdx              # Overview — abstract, conformance, links
      workflow.mdx            # Workflow object spec
      nodes.mdx               # Node object + instruction semantics
      edges.mdx               # Edge object + routing semantics
      skills.mdx              # Skill + Tool interfaces
      execution.mdx           # Execution model + events + trace
  public/
    favicon.svg               # Copy from packages/web/public/
    schemas/
      workflow.json            # Canonical JSON Schema for Workflow
      skill.json               # Canonical JSON Schema for Skill
```

---

### Task 1: Scaffold Astro + Starlight project

**Files:**
- Create: `spec/package.json`
- Create: `spec/astro.config.mjs`
- Create: `spec/tsconfig.json`
- Create: `spec/src/content.config.ts`

- [ ] **Step 1: Create `spec/package.json`**

```json
{
  "name": "@sweny-ai/spec",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "astro dev",
    "build": "astro build",
    "preview": "astro preview"
  },
  "dependencies": {
    "@astrojs/starlight": "^0.38.3",
    "astro": "^6.1.3",
    "sharp": "^0.34.2"
  }
}
```

- [ ] **Step 2: Create `spec/astro.config.mjs`**

```javascript
// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
  site: "https://spec.sweny.ai",
  integrations: [
    starlight({
      title: "SWEny Workflow Specification",
      description: "A declarative format for AI agent orchestration",
      favicon: "/favicon.svg",
      head: [
        { tag: "meta", attrs: { property: "og:type", content: "website" } },
      ],
      social: [
        { icon: "github", label: "GitHub", href: "https://github.com/swenyai/sweny" },
        { icon: "external", label: "Docs", href: "https://docs.sweny.ai" },
      ],
      editLink: {
        baseUrl: "https://github.com/swenyai/sweny/edit/main/spec/",
      },
      sidebar: [
        { label: "Overview", slug: "" },
        { label: "Workflow", slug: "workflow" },
        { label: "Nodes", slug: "nodes" },
        { label: "Edges & Routing", slug: "edges" },
        { label: "Skills & Tools", slug: "skills" },
        { label: "Execution Model", slug: "execution" },
      ],
    }),
  ],
});
```

- [ ] **Step 3: Create `spec/tsconfig.json`**

```json
{
  "extends": "astro/tsconfigs/strict",
  "include": [".astro/types.d.ts", "**/*"],
  "exclude": ["dist"]
}
```

- [ ] **Step 4: Create `spec/src/content.config.ts`**

```typescript
import { defineCollection } from "astro:content";
import { docsLoader } from "@astrojs/starlight/loaders";
import { docsSchema } from "@astrojs/starlight/schema";

export const collections = {
  docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }),
};
```

- [ ] **Step 5: Copy favicon**

```bash
cp packages/web/public/favicon.svg spec/public/favicon.svg
```

- [ ] **Step 6: Install dependencies and verify build**

```bash
cd spec && npm install && npm run build
```

Expected: Build succeeds (may warn about missing content — that's fine, we add pages next).

- [ ] **Step 7: Commit**

```bash
git add spec/
git commit -m "feat(spec): scaffold Astro + Starlight spec site"
```

---

### Task 2: Write JSON Schema static assets

**Files:**
- Create: `spec/public/schemas/workflow.json`
- Create: `spec/public/schemas/skill.json`

These are derived from `packages/core/src/schema.ts` lines 227-280 (workflowJsonSchema) and the Zod `skillZ` schema at lines 35-42. They are the machine-readable normative source.

- [ ] **Step 1: Create `spec/public/schemas/workflow.json`**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://spec.sweny.ai/schemas/workflow.json",
  "title": "SWEny Workflow",
  "description": "A declarative AI agent orchestration workflow.",
  "type": "object",
  "required": ["id", "name", "nodes", "edges", "entry"],
  "additionalProperties": false,
  "properties": {
    "id": {
      "type": "string",
      "minLength": 1,
      "description": "Unique identifier for this workflow."
    },
    "name": {
      "type": "string",
      "minLength": 1,
      "description": "Human-readable name."
    },
    "description": {
      "type": "string",
      "default": "",
      "description": "Optional description of the workflow's purpose."
    },
    "entry": {
      "type": "string",
      "minLength": 1,
      "description": "Node ID where execution begins. MUST reference a key in 'nodes'."
    },
    "nodes": {
      "type": "object",
      "description": "Map of node ID to Node definition. Keys are referenced by 'entry' and edge 'from'/'to' fields.",
      "additionalProperties": {
        "$ref": "#/$defs/Node"
      }
    },
    "edges": {
      "type": "array",
      "description": "Directed edges connecting nodes. Define execution flow and routing conditions.",
      "items": {
        "$ref": "#/$defs/Edge"
      }
    }
  },
  "$defs": {
    "Node": {
      "type": "object",
      "required": ["name", "instruction"],
      "additionalProperties": false,
      "properties": {
        "name": {
          "type": "string",
          "minLength": 1,
          "description": "Display name for this node."
        },
        "instruction": {
          "type": "string",
          "minLength": 1,
          "description": "Natural language instruction for the AI model. This is the primary directive for this step."
        },
        "skills": {
          "type": "array",
          "items": { "type": "string" },
          "default": [],
          "description": "Skill IDs available to this node. Determines which tools the AI model can invoke."
        },
        "output": {
          "type": "object",
          "description": "Optional JSON Schema for structured output. When present, the executor MUST request output conforming to this schema."
        }
      }
    },
    "Edge": {
      "type": "object",
      "required": ["from", "to"],
      "additionalProperties": false,
      "properties": {
        "from": {
          "type": "string",
          "minLength": 1,
          "description": "Source node ID. MUST reference a key in 'nodes'."
        },
        "to": {
          "type": "string",
          "minLength": 1,
          "description": "Target node ID. MUST reference a key in 'nodes'."
        },
        "when": {
          "type": "string",
          "description": "Natural language condition. Evaluated by the AI model against accumulated context to determine routing."
        },
        "max_iterations": {
          "type": "integer",
          "minimum": 1,
          "description": "Maximum times this edge can be followed. Enables bounded retry loops. REQUIRED for self-loops (from === to)."
        }
      }
    }
  }
}
```

- [ ] **Step 2: Create `spec/public/schemas/skill.json`**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://spec.sweny.ai/schemas/skill.json",
  "title": "SWEny Skill",
  "description": "A composable tool bundle that provides capabilities to workflow nodes.",
  "type": "object",
  "required": ["id", "name", "description", "category", "config", "tools"],
  "additionalProperties": false,
  "properties": {
    "id": {
      "type": "string",
      "minLength": 1,
      "description": "Unique skill identifier. Referenced by nodes' 'skills' arrays."
    },
    "name": {
      "type": "string",
      "description": "Human-readable skill name."
    },
    "description": {
      "type": "string",
      "description": "What this skill provides."
    },
    "category": {
      "type": "string",
      "enum": ["git", "observability", "tasks", "notification", "general"],
      "description": "Functional category for grouping and validation."
    },
    "config": {
      "type": "object",
      "description": "Configuration fields required by this skill.",
      "additionalProperties": {
        "$ref": "#/$defs/ConfigField"
      }
    },
    "tools": {
      "type": "array",
      "description": "Tools this skill provides to nodes.",
      "items": {
        "$ref": "#/$defs/Tool"
      }
    }
  },
  "$defs": {
    "ConfigField": {
      "type": "object",
      "required": ["description"],
      "additionalProperties": false,
      "properties": {
        "description": {
          "type": "string",
          "description": "Human-readable description of this config field."
        },
        "required": {
          "type": "boolean",
          "default": false,
          "description": "Whether this field must be provided for the skill to function."
        },
        "env": {
          "type": "string",
          "description": "Default environment variable to read this value from."
        }
      }
    },
    "Tool": {
      "type": "object",
      "required": ["name", "description", "input_schema"],
      "additionalProperties": false,
      "properties": {
        "name": {
          "type": "string",
          "description": "Tool name. Must be unique within the skill."
        },
        "description": {
          "type": "string",
          "description": "What this tool does. Provided to the AI model for tool selection."
        },
        "input_schema": {
          "type": "object",
          "description": "JSON Schema defining the tool's input parameters."
        }
      }
    }
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add spec/public/schemas/
git commit -m "feat(spec): add canonical JSON Schema for workflow and skill"
```

---

### Task 3: Write Overview page

**Files:**
- Create: `spec/src/content/docs/index.mdx`

- [ ] **Step 1: Create `spec/src/content/docs/index.mdx`**

Write the overview page. This is the front page of spec.sweny.ai. Contents:

- Title: "SWEny Workflow Specification v1.0"
- Abstract: 2-3 sentences defining the format
- Status badge (e.g., "Draft" or "Stable")
- Conformance language section defining MUST, SHOULD, MAY per RFC 2119
- Table of contents linking to the 5 other spec pages
- Links: canonical JSON Schema URL, reference implementation (GitHub), docs site
- License: Apache 2.0

The tone is formal. Model after [OpenAPI 3.1 overview](https://spec.openapis.org/oas/latest.html). Use YAML code blocks for examples. No tutorials.

Key content for the abstract:

> The SWEny Workflow Specification defines a YAML-based format for describing AI agent orchestration as a directed graph. Each node in the graph contains a natural language instruction executed by an AI model, with access to a declared set of skills (tool bundles). Edges define execution flow, with optional natural language conditions evaluated at runtime.

- [ ] **Step 2: Verify build**

```bash
cd spec && npm run build
```

Expected: Clean build, site renders at localhost.

- [ ] **Step 3: Commit**

```bash
git add spec/src/content/docs/index.mdx
git commit -m "feat(spec): add overview page with abstract and conformance language"
```

---

### Task 4: Write Workflow page

**Files:**
- Create: `spec/src/content/docs/workflow.mdx`

- [ ] **Step 1: Create `spec/src/content/docs/workflow.mdx`**

Defines the top-level Workflow object. Source of truth: `workflowZ` from schema.ts lines 58-65 and `Workflow` interface from types.ts.

Must include:

**Field table:**

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `id` | string | REQUIRED | — | Unique identifier. MUST be non-empty. |
| `name` | string | REQUIRED | — | Human-readable name. MUST be non-empty. |
| `description` | string | OPTIONAL | `""` | Purpose of the workflow. |
| `entry` | string | REQUIRED | — | Node ID where execution begins. MUST reference a key in `nodes`. |
| `nodes` | Record<string, [Node](/nodes)> | REQUIRED | — | Map of node ID to Node. Keys are referenced by `entry` and edge `from`/`to`. |
| `edges` | [Edge](/edges)[] | REQUIRED | — | Directed edges defining execution flow. |

**Structural validation rules** (from validateWorkflow(), schema.ts lines 101-219):

1. `entry` MUST reference an existing key in `nodes`.
2. Every edge `from` and `to` MUST reference existing keys in `nodes`.
3. All nodes MUST be reachable from `entry` via edges (BFS traversal).
4. Self-loops (`from === to`) MUST have `max_iterations` set.
5. Cycles where no edge has `max_iterations` are invalid (unbounded cycles).
6. All skill IDs referenced in nodes SHOULD exist in the executor's skill registry.

**YAML examples:** Minimal valid workflow (3 nodes, 2 edges) and a full workflow with conditional routing.

**JSON Schema reference:** Link to `spec.sweny.ai/schemas/workflow.json`.

- [ ] **Step 2: Verify build**

```bash
cd spec && npm run build
```

- [ ] **Step 3: Commit**

```bash
git add spec/src/content/docs/workflow.mdx
git commit -m "feat(spec): add Workflow object specification"
```

---

### Task 5: Write Nodes page

**Files:**
- Create: `spec/src/content/docs/nodes.mdx`

- [ ] **Step 1: Create `spec/src/content/docs/nodes.mdx`**

Defines the Node object and its semantics. Source of truth: `nodeZ` (schema.ts lines 44-49), `Node` interface (types.ts), and `buildNodeInstruction()` (executor.ts lines 162-189).

Must include:

**Field table:**

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `name` | string | REQUIRED | — | Display name. MUST be non-empty. |
| `instruction` | string | REQUIRED | — | Natural language instruction for the AI model. MUST be non-empty. |
| `skills` | string[] | OPTIONAL | `[]` | Skill IDs this node can access. |
| `output` | JSON Schema | OPTIONAL | — | Structured output schema. |

**Instruction semantics:**
- A conforming executor MUST pass the instruction as the primary directive to the AI model.
- The instruction MAY be augmented with context from prior nodes (see [Execution Model](/execution)) but MUST NOT be altered, summarized, or truncated.
- If the workflow input contains a `rules` field (string), a conforming executor MUST prepend it to the instruction with the heading "Rules — You MUST Follow These".
- If the workflow input contains a `context` field (string), a conforming executor MUST prepend it with the heading "Background Context".

**Skills semantics:**
- A conforming executor MUST resolve tools from the listed skill IDs and make them available during node execution.
- Tools from skills NOT listed MUST NOT be available to the node.
- If a listed skill is not configured (missing required config), the executor SHOULD skip it silently rather than failing the workflow.

**Output schema semantics:**
- When `output` is present, the executor MUST request structured output conforming to this JSON Schema.
- The structured output becomes the node's result data, available to downstream nodes via context accumulation.
- When `output` is absent, the node's result data is implementation-defined.

**Examples:** Node with output schema (from triage.yml investigate node), minimal node with just name + instruction.

- [ ] **Step 2: Verify build**

```bash
cd spec && npm run build
```

- [ ] **Step 3: Commit**

```bash
git add spec/src/content/docs/nodes.mdx
git commit -m "feat(spec): add Node object specification"
```

---

### Task 6: Write Edges & Routing page

**Files:**
- Create: `spec/src/content/docs/edges.mdx`

- [ ] **Step 1: Create `spec/src/content/docs/edges.mdx`**

Defines the Edge object and routing semantics. Source of truth: `edgeZ` (schema.ts lines 51-56), `Edge` interface (types.ts), and `resolveNext()` (executor.ts lines 248-329).

Must include:

**Field table:**

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `from` | string | REQUIRED | — | Source node ID. MUST reference a key in `nodes`. |
| `to` | string | REQUIRED | — | Target node ID. MUST reference a key in `nodes`. |
| `when` | string | OPTIONAL | — | Natural language routing condition. |
| `max_iterations` | integer (>= 1) | OPTIONAL | unlimited | Maximum times this edge can be followed. |

**Routing algorithm** (normative, from resolveNext()):

After a node completes, a conforming executor MUST:

1. Collect all outgoing edges from the completed node.
2. Exclude edges that have exhausted their `max_iterations` count.
3. If zero edges remain: execution is complete. This is a **terminal node**.
4. If exactly one edge remains and it has no `when` clause: follow it unconditionally.
5. Otherwise: present all remaining edge conditions to the AI model as choices. The model evaluates each `when` clause against the accumulated context and selects one. The executor follows the selected edge.

**Conditional edges:**
- The `when` field is a natural language condition (e.g., `"novel_count is greater than 0 AND highest_severity is medium or higher"`).
- A conforming executor MUST evaluate conditions by providing the AI model with: (a) the accumulated context (workflow input + all prior node results), and (b) the list of conditions as choices.
- The executor MUST NOT evaluate conditions programmatically. The AI model is the evaluator.

**Unconditional edges:**
- An edge without `when` is unconditional.
- If a node has exactly one unconditional outgoing edge, the executor MUST follow it without invoking the AI model.

**Bounded cycles:**
- `max_iterations` limits how many times an edge can be followed.
- Self-loops (`from === to`) MUST have `max_iterations` set. A workflow with a self-loop lacking `max_iterations` is invalid.
- Once an edge reaches its `max_iterations` count, it is excluded from routing. If this leaves zero edges, the node becomes terminal.

**Unbounded cycles:**
- A cycle where no edge in the cycle path has `max_iterations` is invalid.
- A conforming validator MUST detect and reject unbounded cycles.

**Examples:** Unconditional linear flow, conditional branching (from triage.yml investigate → create_issue / skip), bounded retry loop.

- [ ] **Step 2: Verify build**

```bash
cd spec && npm run build
```

- [ ] **Step 3: Commit**

```bash
git add spec/src/content/docs/edges.mdx
git commit -m "feat(spec): add Edge object and routing semantics"
```

---

### Task 7: Write Skills & Tools page

**Files:**
- Create: `spec/src/content/docs/skills.mdx`

- [ ] **Step 1: Create `spec/src/content/docs/skills.mdx`**

Defines the Skill and Tool interfaces. Source of truth: `skillZ`, `toolZ`, `configFieldZ` (schema.ts), and `Skill`, `Tool`, `ConfigField` interfaces (types.ts).

Must include:

**Skill field table:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | REQUIRED | Unique identifier. Referenced by node `skills` arrays. |
| `name` | string | REQUIRED | Human-readable name. |
| `description` | string | REQUIRED | What this skill provides. |
| `category` | SkillCategory | REQUIRED | Functional category. |
| `config` | Record<string, ConfigField> | REQUIRED | Configuration fields. |
| `tools` | Tool[] | REQUIRED | Tools this skill provides. |

**SkillCategory enum:** `"git"`, `"observability"`, `"tasks"`, `"notification"`, `"general"`

**ConfigField field table:**

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `description` | string | REQUIRED | — | Human-readable description. |
| `required` | boolean | OPTIONAL | `false` | Whether this field must be provided. |
| `env` | string | OPTIONAL | — | Default environment variable name. |

**Config resolution:**
- A conforming executor MUST resolve config values by checking explicit overrides first, then environment variables (via the `env` field).
- If a required config field is missing, the skill MUST be treated as unavailable. The executor SHOULD NOT fail the workflow — the skill is silently excluded.

**Tool field table:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | REQUIRED | Tool name. Unique within the skill. |
| `description` | string | REQUIRED | What this tool does. Provided to the AI model. |
| `input_schema` | JSON Schema | REQUIRED | Input parameter schema. |
| `handler` | function | REQUIRED (runtime) | Implementation-defined. Not serialized. |

**Tool invocation contract:**
- A conforming executor MUST validate tool inputs against `input_schema` before invocation.
- Tool outputs are opaque JSON values. They are included in the execution trace and available to the AI model within the current node's execution.

**Well-known skill registry:**

| ID | Category | Required Config | Description |
|----|----------|-----------------|-------------|
| `github` | git | `GITHUB_TOKEN` | GitHub code search, issues, PRs |
| `linear` | tasks | `LINEAR_API_KEY` | Linear issue tracking |
| `slack` | notification | `SLACK_WEBHOOK_URL` | Slack messaging |
| `sentry` | observability | `SENTRY_AUTH_TOKEN` | Sentry error tracking |
| `datadog` | observability | `DD_API_KEY`, `DD_APP_KEY` | Datadog logs and metrics |
| `betterstack` | observability | `BETTERSTACK_API_TOKEN` | BetterStack incident management |
| `notification` | notification | varies | Multi-channel notifications |
| `supabase` | general | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase database operations |

Implementations MAY support additional skills beyond this registry.

- [ ] **Step 2: Verify build**

```bash
cd spec && npm run build
```

- [ ] **Step 3: Commit**

```bash
git add spec/src/content/docs/skills.mdx
git commit -m "feat(spec): add Skill and Tool interface specification"
```

---

### Task 8: Write Execution Model page

**Files:**
- Create: `spec/src/content/docs/execution.mdx`

- [ ] **Step 1: Create `spec/src/content/docs/execution.mdx`**

The behavioral specification. Source of truth: `execute()` (executor.ts lines 52-153), ExecutionEvent types (types.ts lines 102-110), ExecutionTrace/ExecutionResult (types.ts lines 121-153).

Must include:

**Context accumulation:**

At each node, a conforming executor MUST provide a context object containing:
- `input` — the original workflow input (the `input` parameter passed to `execute()`)
- One key per previously completed node, where the key is the node ID and the value is that node's result data

```
context = { input, nodeA: nodeAResult.data, nodeB: nodeBResult.data, ... }
```

This context is available to the node's instruction execution and to edge condition evaluation.

**Node execution sequence:**

For each node, a conforming executor MUST:
1. Resolve available tools from the node's `skills` list.
2. Build the context object (input + all prior node results).
3. Build the instruction (base instruction, optionally augmented with input `rules` and `context` — see [Nodes](/nodes)).
4. Invoke the AI model with: instruction, context, tools, and output schema (if present).
5. Capture the result as a `NodeResult`.
6. Emit execution events (see below).
7. Resolve the next node via edge routing (see [Edges & Routing](/edges)).

**NodeResult:**

| Field | Type | Description |
|-------|------|-------------|
| `status` | `"success"` \| `"skipped"` \| `"failed"` | Outcome of this node. |
| `data` | Record<string, unknown> | Output data. Available to downstream nodes. |
| `toolCalls` | ToolCall[] | Record of tools invoked during execution. |

**ToolCall:**

| Field | Type | Description |
|-------|------|-------------|
| `tool` | string | Tool name. |
| `input` | unknown | Input passed to the tool. |
| `output` | unknown | Output returned by the tool. Optional (absent on error). |

**Dry-run semantics:**

When the workflow input contains `dryRun: true`, a conforming executor MUST:
- Execute nodes normally through unconditional edges.
- Stop at the first node that has conditional outgoing edges (edges with `when` clauses).
- Return the execution result with all nodes completed up to that point.

This enables "analysis without action" — a workflow can gather data and investigate, but stop before taking action decisions.

**Execution events:**

A conforming executor MUST emit the following events during execution:

| Event Type | Payload | When |
|------------|---------|------|
| `workflow:start` | `{ workflow: string }` | Before first node executes. |
| `node:enter` | `{ node: string, instruction: string }` | Before a node begins execution. |
| `tool:call` | `{ node: string, tool: string, input: unknown }` | Before a tool is invoked. |
| `tool:result` | `{ node: string, tool: string, output: unknown }` | After a tool returns. |
| `node:progress` | `{ node: string, message: string }` | During node execution (streaming). |
| `node:exit` | `{ node: string, result: NodeResult }` | After a node completes. |
| `route` | `{ from: string, to: string, reason: string }` | After an edge is selected. |
| `workflow:end` | `{ results: Record<string, NodeResult> }` | After all execution is complete. |

Events are delivered to an observer callback. If the observer throws, the executor MUST NOT crash — observer errors are silently swallowed.

**Execution trace:**

A conforming executor MUST produce an `ExecutionTrace` after execution completes:

**TraceStep:**

| Field | Type | Description |
|-------|------|-------------|
| `node` | string | Node ID. |
| `status` | `"success"` \| `"failed"` \| `"skipped"` | Outcome. |
| `iteration` | number | 1-based. 2 means this node executed a second time (via bounded cycle). |

**TraceEdge:**

| Field | Type | Description |
|-------|------|-------------|
| `from` | string | Source node ID. |
| `to` | string | Target node ID. |
| `reason` | string | Why this edge was followed (condition text or "only path"). |

**ExecutionResult:**

| Field | Type | Description |
|-------|------|-------------|
| `results` | Map<string, NodeResult> | Final result per node. If a node executed multiple times (bounded cycle), this contains the last result. |
| `trace` | ExecutionTrace | Ordered record of all steps and routing decisions. |

**Error handling:**
- A node that fails MUST produce a `NodeResult` with `status: "failed"`.
- Whether the executor continues to subsequent nodes or terminates is implementation-defined.
- The trace MUST record the failure.

**Claude interface (informative, not normative):**

The reference implementation uses two AI model operations:

1. **`run`** — Execute a node: takes instruction, context, tools, optional output schema. Returns `NodeResult`.
2. **`evaluate`** — Route at a conditional edge: takes a question, context, and list of choices. Returns the selected choice ID.

Alternative implementations MAY use different AI model interfaces as long as the observable behavior (context accumulation, routing, events, trace) conforms to this specification.

- [ ] **Step 2: Verify build**

```bash
cd spec && npm run build
```

- [ ] **Step 3: Commit**

```bash
git add spec/src/content/docs/execution.mdx
git commit -m "feat(spec): add execution model specification"
```

---

### Task 9: Build, verify, and push

**Files:**
- All files from Tasks 1-8

- [ ] **Step 1: Full build**

```bash
cd spec && npm run build
```

Expected: Clean build, zero errors.

- [ ] **Step 2: Local preview**

```bash
cd spec && npm run preview
```

Open `http://localhost:4321` and verify:
- All 6 pages render
- Sidebar navigation works
- JSON Schema links resolve (`/schemas/workflow.json`, `/schemas/skill.json`)
- Code examples render with syntax highlighting
- Field tables are readable

- [ ] **Step 3: Commit and push**

```bash
git add -A spec/
git commit -m "feat(spec): complete SWEny Workflow Specification v1.0 site"
git push
```

---

### Task 10: Deploy to Vercel and wire DNS

- [ ] **Step 1: Create Vercel project**

```bash
cd spec && npx vercel --yes
```

Set root directory to `spec/` when prompted (or configure via Vercel dashboard). Framework: Astro.

- [ ] **Step 2: Configure custom domain in Vercel**

In Vercel dashboard → Project Settings → Domains → Add `spec.sweny.ai`.

- [ ] **Step 3: Add DNS record in Porkbun**

In Porkbun → sweny.ai → DNS Records:
- Type: CNAME
- Host: `spec`
- Answer: `cname.vercel-dns.com`
- TTL: 600

- [ ] **Step 4: Verify deployment**

Wait for DNS propagation (usually <5 minutes with Porkbun), then verify:
- `https://spec.sweny.ai` loads
- `https://spec.sweny.ai/schemas/workflow.json` returns valid JSON
- `https://spec.sweny.ai/schemas/skill.json` returns valid JSON
- All 6 pages accessible and rendering correctly

- [ ] **Step 5: Add cross-links from docs.sweny.ai**

Update `packages/web/src/content/docs/workflows/yaml-reference.md` to add a callout at the top:

```markdown
:::note
For the formal specification, see [spec.sweny.ai](https://spec.sweny.ai).
:::
```
