# Custom Skills Extension System — Design Spec

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable workflow authors to define custom skills — both natural language instruction skills and MCP-backed tool skills — that are portable, harness-agnostic, and scoped to individual workflow nodes.

**Architecture:** Extend the SWEny Workflow Specification v1.0 with additive (non-breaking) changes: new optional fields on the Skill and Workflow objects, a multi-directory skill discovery algorithm that reads from `.sweny/`, `.claude/`, `.agents/`, and `.gemini/` skill directories, and instruction injection semantics in the executor. Follows the Agent Skills Open Standard (agentskills.io) published by Anthropic.

**Tech Stack:** TypeScript (ESM), Zod schemas, Vitest, YAML parsing, Astro (spec site), Next.js (marketplace site).

---

## 1. Problem Statement

SWEny workflows currently reference skills by ID from a hardcoded registry of 8 built-in skills (github, linear, slack, sentry, datadog, betterstack, notification, supabase). There is no way for workflow authors to:

- Define custom natural language skills (domain expertise, coding standards, evaluation rubrics)
- Declare custom MCP tool servers scoped to specific workflow nodes
- Ship self-contained marketplace workflows that carry their own skill definitions
- Use skills authored for other AI coding tools (Claude Code, Codex, Gemini CLI)

A custom skill loader exists (`custom-loader.ts`) but only reads from `.claude/skills/`, produces instruction-only skills with no MCP support, and injects all custom skills globally rather than scoping them to nodes that reference them.

## 2. Skill Object Evolution (Spec v1.1)

The Skill object gains two optional fields. A valid skill MUST provide at least one of `tools`, `instruction`, or `mcp`.

### Updated Skill Object

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `id` | string | REQUIRED | — | Unique identifier. Referenced by node `skills` arrays. |
| `name` | string | REQUIRED | — | Human-readable name. |
| `description` | string | REQUIRED | — | What this skill provides. |
| `category` | SkillCategory | REQUIRED | — | Functional category. |
| `config` | Record<string, ConfigField> | OPTIONAL | `{}` | Configuration fields. |
| `tools` | Tool[] | OPTIONAL | `[]` | Callable tools (current behavior). |
| `instruction` | string | OPTIONAL | — | **NEW.** Natural language expertise injected into the node prompt when this skill is referenced. |
| `mcp` | McpServerConfig | OPTIONAL | — | **NEW.** External MCP server definition wired for nodes referencing this skill. |

### McpServerConfig Object

Aligns with the existing `McpServerConfig` type in `@sweny-ai/core/types.ts`.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"stdio"` \| `"http"` | OPTIONAL | Transport type. Inferred from presence of `command` (stdio) or `url` (http) when omitted. |
| `command` | string | CONDITIONAL | Spawn command (stdio transport). Required if `url` absent. |
| `args` | string[] | OPTIONAL | Arguments for the command. |
| `url` | string | CONDITIONAL | HTTP endpoint (HTTP transport). Required if `command` absent. |
| `headers` | Record<string, string> | OPTIONAL | HTTP headers (HTTP transport only). |
| `env` | Record<string, string> | OPTIONAL | Environment variable names the server needs. Values are human-readable descriptions, not secrets. Actual values are resolved from `process.env` at runtime. |

### Skill Capability Matrix

A skill can provide any combination of capabilities:

| Example | tools | instruction | mcp | Use case |
|---------|-------|-------------|-----|----------|
| Built-in `github` | 8 tools | — | — | Current behavior |
| Team `code-standards` | — | markdown | — | Coding conventions |
| Custom `our-crm` | — | guidance | MCP server | External integration with usage instructions |
| Extended `github` (override) | — | "Use our GHE instance..." | — | Team-specific guidance layered on built-in |

## 3. Workflow-Level Skill Declarations

The Workflow object gains an optional `skills` field for inline skill definitions.

### Updated Workflow Object

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `id` | string | REQUIRED | — | Unique identifier. |
| `name` | string | REQUIRED | — | Human-readable name. |
| `description` | string | OPTIONAL | `""` | Purpose of the workflow. |
| `entry` | string | REQUIRED | — | Entry node ID. |
| `nodes` | Record<string, Node> | REQUIRED | — | Node definitions. |
| `edges` | Edge[] | REQUIRED | — | Edge definitions. |
| `skills` | Record<string, SkillDefinition> | OPTIONAL | `{}` | **NEW.** Custom skill definitions scoped to this workflow. |

### SkillDefinition Object (Inline Form)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | OPTIONAL | Display name. Defaults to the map key. |
| `description` | string | OPTIONAL | What this skill provides. |
| `instruction` | string | OPTIONAL | Natural language expertise. |
| `mcp` | McpServerConfig | OPTIONAL | External MCP server. |

Constraint: must provide at least one of `instruction` or `mcp`. Inline skills cannot define `tools` (those require code and live in the runtime registry).

### Example: Marketplace Workflow with Inline Skills

```yaml
id: incident-postmortem
name: Incident Postmortem
entry: gather-timeline
skills:
  sre-rubric:
    name: SRE Postmortem Rubric
    description: Scoring criteria for blameless postmortems
    instruction: |
      When evaluating a postmortem, score each dimension 1-5:

      **Completeness**: Can you reconstruct the incident without
      additional context? Timeline must have UTC timestamps for
      detection, acknowledgment, mitigation, and resolution.

      **Root Cause Depth**: "The database was slow" scores 1.
      "Connection pool exhaustion from leaked connections in the
      retry logic added in PR #482" scores 5.

      **Blamelessness**: Names of individuals must never appear
      as responsible parties. Human error is a symptom of system
      design, not a root cause. Use "we" not "they."

      **Action Items**: Each must be specific, assignable, and
      measurable. "Improve monitoring" fails. "Add p99 latency
      alert on /api/payments at 500ms [P1, Platform team]" passes.

      **Actionability**: Could someone uninvolved read this and
      understand what happened and what to do about it?
nodes:
  gather-timeline:
    name: Gather Incident Timeline
    instruction: Reconstruct a detailed timeline from all available sources...
    skills: [github, sentry, datadog]
  draft-postmortem:
    name: Draft Postmortem Document
    instruction: Write a blameless postmortem following Google SRE style...
    skills: [sre-rubric]
  judge-quality:
    name: Quality Judge
    instruction: Evaluate this postmortem critically...
    skills: [sre-rubric]
edges:
  - from: gather-timeline
    to: draft-postmortem
  - from: draft-postmortem
    to: judge-quality
```

## 4. Skill File Format (SKILL.md)

Skills are authored as directories containing a `SKILL.md` file, following the Agent Skills Open Standard (agentskills.io).

### Directory Structure

```
<name>/
  SKILL.md           # Required — YAML frontmatter + markdown body
  references/        # Optional — detailed reference docs
  scripts/           # Optional — executable helpers
  assets/            # Optional — templates, data files
  examples/          # Optional — example outputs
```

### SKILL.md Format

```markdown
---
name: code-standards
description: Our team's coding conventions for TypeScript projects
# Standard agentskills.io fields:
license: MIT
compatibility: node >= 18
metadata:
  team: platform
# SWEny extension — optional MCP server:
mcp:
  command: npx -y @company/custom-tool-server
  env:
    API_KEY: Company API key
---

When writing or reviewing TypeScript code, follow these standards:

## Naming
- Use camelCase for variables and functions
- Use PascalCase for types, interfaces, and classes

## Error Handling
- Always use typed errors extending AppError
- Never catch and silently swallow errors

## Testing
- Every public function needs at least one test
- Use describe/it blocks, not test()
- Mock at boundaries (HTTP, DB), not internal functions
```

### Frontmatter Fields

| Field | Required | Source | Description |
|-------|----------|--------|-------------|
| `name` | REQUIRED | agentskills.io | 1-64 chars. Lowercase letters, numbers, hyphens only. Must not start/end with hyphen. Must not contain consecutive hyphens (`--`). Must match parent directory name. Pattern: `^[a-z0-9]([a-z0-9-]*[a-z0-9])?$` (with `--` rejected separately). |
| `description` | REQUIRED | agentskills.io | 1-1024 chars. What this skill does and when to use it. |
| `license` | OPTIONAL | agentskills.io | License name or reference. |
| `compatibility` | OPTIONAL | agentskills.io | Environment requirements. Max 500 chars. |
| `metadata` | OPTIONAL | agentskills.io | Arbitrary string-to-string key-value map. |
| `mcp` | OPTIONAL | SWEny extension | McpServerConfig object. External MCP server to wire when this skill is active. **Note:** This field is NOT part of the agentskills.io standard. It is a SWEny-specific extension. Other AI tools will ignore it. |

The markdown body (everything after the closing `---`) is the skill's **instruction**. It is injected into the node prompt when the skill is referenced. The current `custom-loader.ts` discards this body — it must be updated to capture and store it as the `instruction` field on the Skill object.

Tool-specific frontmatter fields from other harnesses (Claude Code's `model`, `effort`, `context`, `agent`, `hooks`, `paths`; Codex's `agents/openai.yaml`; etc.) are ignored by SWEny but preserved — each tool reads what it understands.

## 5. Multi-Harness Skill Discovery

SWEny reads skills from every known AI coding tool convention, making workflows portable across harnesses.

### Discovery Directories

| Priority | Directory | Convention |
|----------|-----------|------------|
| 1 | Workflow `skills:` block | SWEny inline (YAML) |
| 2 | `.sweny/skills/<name>/SKILL.md` | SWEny-native |
| 3 | `.claude/skills/<name>/SKILL.md` | Claude Code |
| 4 | `.agents/skills/<name>/SKILL.md` | Universal (Codex, Gemini, OpenCode) |
| 5 | `.gemini/skills/<name>/SKILL.md` | Gemini CLI |
| 6 | Well-known registry | Built-in (github, linear, slack, etc.) |

### Resolution Rules

- **First match wins on ID collision.** If `.sweny/skills/github/SKILL.md` exists, it takes precedence over the built-in `github` skill. This allows teams to override built-in behavior with custom instructions.
- **Built-in tools are additive.** If a custom skill overrides a built-in by ID, the custom skill's instruction is injected AND the built-in's tools remain available (unless the custom skill explicitly has no tools). This means `skills: [github]` with a custom `github` SKILL.md gives you the built-in GitHub tools PLUS the custom instruction.
- **MCP from custom skills is node-scoped.** A skill's `mcp` server is only wired for nodes that reference that skill, not globally.
- **Unknown skill IDs remain warnings, not errors** (spec rule 6, unchanged).

### Discovery Algorithm

```
function discoverSkills(workflowDir, workflow):
  skills = Map<string, Skill>

  # Priority 6: Built-in well-known registry
  for skill in builtinSkills:
    if isConfigured(skill, env):
      skills.set(skill.id, skill)

  # Priority 5-2: Directory scan (reverse priority — later overwrites)
  for dir in [".gemini/skills", ".agents/skills", ".claude/skills", ".sweny/skills"]:
    for entry in scanDir(resolve(workflowDir, dir)):
      skill = parseSkillMd(entry)
      if skill:
        existing = skills.get(skill.id)
        if existing and existing.tools.length > 0:
          # Merge: keep built-in tools, add custom instruction/mcp
          skill.tools = existing.tools
          skill.config = existing.config
        skills.set(skill.id, skill)

  # Priority 1: Workflow inline skills
  for [id, def] in workflow.skills:
    existing = skills.get(id)
    skill = inlineToSkill(id, def)
    if existing and existing.tools.length > 0:
      skill.tools = existing.tools
      skill.config = existing.config
    skills.set(id, skill)

  return skills
```

## 6. Executor Changes — Instruction Injection

When a node references a skill that has an `instruction` field, the executor injects that instruction into the node's prompt.

### Updated Prompt Assembly Order

```
## Rules — You MUST Follow These
{input.rules}
---
## Background Context
{input.context}
---
## Skill: {skill1.name}
{skill1.instruction}
---
## Skill: {skill2.name}
{skill2.instruction}
---
{node.instruction}
```

Skills are injected in the order they appear in the node's `skills` array. Each skill gets a heading with its name for clarity.

### Updated Node Execution Sequence

For each node, a conforming executor MUST perform the following steps in order:

1. **Resolve skills** from the node's `skills` list against the merged skill registry.
2. **Collect tools** from resolved skills that have `tools`.
3. **Collect MCP servers** from resolved skills that have `mcp`. Wire them for this node's Claude session.
4. **Build context** — the accumulated context object (input + all prior node results).
5. **Build instruction** — augmented with rules, context, **skill instructions**, then the node's base instruction.
6. **Invoke the AI model** with: instruction, context, tools, MCP servers, and output schema.
7. **Capture the result** as a NodeResult.
8. **Emit execution events.**
9. **Resolve the next node** via edge routing.

Step 3 (MCP wiring) and the skill instruction injection in step 5 are new.

## 7. Schema Validation Changes

### Workflow Zod Schema (core)

```typescript
const mcpServerConfigZ = z.object({
  type: z.enum(["stdio", "http"]).optional(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  url: z.string().optional(),
  headers: z.record(z.string()).optional(),
  env: z.record(z.string()).optional(),
}).refine(
  (c) => c.command || c.url,
  { message: "MCP server must have either command (stdio) or url (HTTP)" }
);

const skillDefinitionZ = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  instruction: z.string().optional(),
  mcp: mcpServerConfigZ.optional(),
}).refine(
  (s) => s.instruction || s.mcp,
  { message: "Inline skill must provide instruction, mcp, or both" }
);

// Updated workflow schema
const workflowZ = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(""),
  nodes: z.record(nodeZ),
  edges: z.array(edgeZ),
  entry: z.string().min(1),
  skills: z.record(skillDefinitionZ).default({}),  // NEW
});

// Updated skill schema (existing skillZ — make tools optional)
const skillZ = z.object({
  id: z.string().min(1),
  name: z.string(),
  description: z.string(),
  category: skillCategoryZ,
  config: z.record(configFieldZ).default({}),        // was required, now optional w/ default
  tools: z.array(toolZ).default([]),                  // was required, now optional w/ default
  instruction: z.string().optional(),                 // NEW
  mcp: mcpServerConfigZ.optional(),                   // NEW
}).refine(
  (s) => s.tools.length > 0 || s.instruction || s.mcp,
  { message: "Skill must provide at least one of: tools, instruction, or mcp" }
);
```

### Marketplace Validation (validate.mjs)

- Accept `skills:` block in workflow YAML.
- Validate each inline skill has `instruction` or `mcp`.
- Validate inline skill IDs match the agentskills.io pattern: `^[a-z0-9]([a-z0-9-]*[a-z0-9])?$`, no consecutive hyphens, max 64 chars.

### Structural Validation Addition

New warning (not error): if a node references a skill ID that is not in the well-known registry AND not declared in the workflow's `skills:` block, emit `UNKNOWN_SKILL` warning. At runtime, the skill may be resolved from a project-level directory.

## 8. Cross-Product Changes

### Spec Site (spec.sweny.ai)

- Update `skills.mdx`: add `instruction` and `mcp` fields to Skill Object table, add McpServerConfig section, add "Custom Skills" section with SKILL.md format and discovery algorithm.
- Update `workflow.mdx`: add `skills` field to Workflow Object table, add SkillDefinition section with inline example.
- Update `nodes.mdx`: add skill instruction injection to "Input Augmentation" section.
- Update `execution.mdx`: add step 3 (MCP wiring) and updated step 5 (skill instruction injection) to Node Execution Sequence.
- Update JSON schemas: `workflow.json` adds `skills` property, `skill.json` adds `instruction` and `mcp` properties.

### Core Library (@sweny-ai/core)

- `types.ts`: Add `instruction?: string` and `mcp?: McpServerConfig` to Skill. Add `skills?: Record<string, SkillDefinition>` to Workflow. Add McpServerConfig and SkillDefinition interfaces.
- `schema.ts`: Add `skillDefinitionZ`, `mcpServerConfigZ`, and `skills` field to `workflowZ`. Update `validateWorkflow` to check inline skill IDs.
- `skills/custom-loader.ts`: Rewrite to scan `.sweny/`, `.claude/`, `.agents/`, `.gemini/` skill directories. Parse `mcp` from frontmatter. Return skills with instruction + optional MCP.
- `executor.ts`: Update `resolveTools` to also collect instructions and MCP configs. Update `buildNodeInstruction` to inject skill instructions. Update node execution to wire node-scoped MCP servers.
- `mcp.ts`: Update `buildSkillMcpServers` to accept skill-declared MCP servers (from custom skills), merged with the hardcoded mapping and user-supplied servers.
- `skills/index.ts`: Update `configuredSkills()` to use new multi-directory discovery. Update `createSkillMap()` to handle merging (custom instruction + built-in tools).

### Marketplace

- `scripts/validate.mjs`: Accept and validate `skills:` block in workflow YAML.
- `site/src/lib/types.ts`: Add `skills` field to MarketplaceWorkflow type. Add `customSkills` to the aggregated workflow data.
- `site/src/lib/workflows.ts`: Parse `skills:` block from YAML, expose on workflow object.
- `site/src/components/WorkflowDetail.tsx`: In the Skills Required tab, show custom skills (instruction preview, MCP badge) alongside built-in skills. Differentiate visually: built-in skills show as tool badges, custom instruction skills show with a document icon, MCP skills show with a plug icon.
- Workflow YAML files: Update `incident-postmortem.yml` and other workflows that use LLM judges to extract scoring rubrics into inline `skills:` blocks. This demonstrates the feature in the marketplace.

### Cloud Dashboard (app)

- `src/components/RunViewer.tsx`: When displaying node details, show custom skill names that were active. No schema changes — skill info comes from the workflow YAML already stored with the run.

### Docs Site (packages/web)

- New page: `skills/custom.md` — "Creating Custom Skills" guide covering:
  - SKILL.md format and frontmatter fields
  - Directory conventions (`.sweny/`, `.claude/`, `.agents/`, `.gemini/`)
  - Instruction skills vs MCP skills vs hybrid
  - Inline workflow skills for marketplace
  - Multi-harness compatibility (write once, use with Claude Code, Codex, Gemini CLI)
  - Examples: coding standards, evaluation rubrics, external integrations
- Update `skills/index.md`: Add custom skills section, link to new guide.

### CLI

- `sweny skill list`: Show all discovered skills from all directories with their source (built-in, .sweny, .claude, .agents, .gemini).
- `sweny skill create <name>`: Scaffold a new skill directory with SKILL.md template in `.sweny/skills/<name>/`.

### GitHub Action

- No changes needed. The Action runs `sweny workflow run` which invokes the executor. Skills resolve from the repo's directories automatically. The Action's checkout step already clones `.sweny/`, `.claude/`, `.agents/`, `.gemini/` directories if they exist.

## 9. Testing Strategy

### Core Unit Tests

| Test | Description |
|------|-------------|
| Multi-directory discovery | Mock filesystem with skills in `.sweny/`, `.claude/`, `.agents/`, `.gemini/`. Verify discovery order and precedence (most specific wins). |
| SKILL.md parsing | Frontmatter: name, description, mcp block. Markdown body becomes instruction. Invalid frontmatter (no name) rejects. |
| Precedence override | Custom `.sweny/skills/github/SKILL.md` overrides built-in github ID. Verify built-in tools are preserved, custom instruction is added. |
| Inline skill parsing | Workflow with `skills:` block parses correctly. Missing instruction AND mcp rejects. |
| Instruction injection | Verify prompt assembly: rules → context → skill instructions (ordered) → node instruction. Multiple skills inject in array order. |
| Node-scoped MCP | Skill with `mcp` block wires MCP only for nodes referencing that skill. Other nodes don't see it. |
| Mixed skill types | Node with built-in + instruction + MCP skill. All three resolve: tools from built-in, instruction injected, MCP wired. |
| Empty skills directory | No crash when `.sweny/skills/` doesn't exist. |
| ID collision across directories | Same skill ID in `.sweny/` and `.claude/` — `.sweny/` wins. |

### Schema Validation Tests

| Test | Description |
|------|-------------|
| Valid workflow with skills | Workflow with `skills:` block and node references validates. |
| Invalid inline skill | Skill with neither instruction nor mcp rejects with message. |
| Skill ID validation | IDs matching `^[a-z0-9-]+$` pass. Others warn. |
| Unknown skill reference | Node referencing an ID not in registry or workflow skills emits UNKNOWN_SKILL warning. |

### Marketplace Tests

| Test | Description |
|------|-------------|
| validate.mjs accepts skills | Workflow YAML with `skills:` block passes validation. |
| WorkflowDetail renders custom skills | Skills tab shows custom instruction skills with preview text and appropriate icon. |

### Integration Tests

| Test | Description |
|------|-------------|
| End-to-end with instruction skill | Workflow with inline instruction skill executes. Verify the instruction text appears in the prompt sent to the AI model. |
| End-to-end with MCP skill | Workflow with MCP skill wires the server and makes tools available. |

## 10. Backwards Compatibility

This is a **v1.1 additive change** to the SWEny Workflow Specification:

- Existing workflows with no `skills:` block are valid and execute identically.
- The `Skill.tools` field is now formally OPTIONAL (default `[]`). All existing skills that have tools continue to work.
- The `Skill.instruction` and `Skill.mcp` fields are OPTIONAL additions. Existing skills without them are unchanged.
- Unknown skill IDs remain warnings, not errors (spec rule 6, unchanged).
- The discovery algorithm finds skills in new directories but doesn't require them to exist.
- No existing API signatures change. `execute()`, `createSkillMap()`, `configuredSkills()` accept the same arguments. New functionality is opt-in via the new fields and directories.

## 11. Future Work (Not In Scope)

- **Harness-agnostic execution**: Currently SWEny is married to Claude (via `@anthropic-ai/claude-agent-sdk`). A follow-up design should abstract the AI model interface to support OpenAI, Gemini, and open-source models. The skill system designed here is already model-agnostic — instructions and MCP servers work with any model.
- **Skill marketplace / registry**: Skills published and shared independently from workflows (Approach C from brainstorming). The current inline + file-based approach is the foundation for this.
- **Skill versioning**: Skills with semver constraints. Not needed until the skill ecosystem grows.
- **Skill composition**: Skills that depend on other skills. Adds complexity without clear value today.
