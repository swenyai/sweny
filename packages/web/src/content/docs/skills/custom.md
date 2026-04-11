---
title: Custom Skills
description: Create custom instruction and MCP-backed skills for SWEny workflows.
---

# Custom Skills

Custom skills let you extend SWEny workflows with domain-specific expertise and external tool integrations. There are two approaches: **instruction skills** (natural language guidance) and **MCP skills** (external tool servers).

## SKILL.md Format

Create a directory with a `SKILL.md` file:

```
.sweny/skills/code-standards/
  SKILL.md
```

The `SKILL.md` uses YAML frontmatter for metadata and markdown for the instruction:

````markdown
---
name: code-standards
description: Team coding conventions for TypeScript
---

When writing or reviewing TypeScript code:
- Use camelCase for variables and functions
- Use PascalCase for types, interfaces, and classes
- Every public function needs at least one test
- Mock at boundaries (HTTP, DB), not internal functions
````

### Frontmatter Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Skill ID. Lowercase letters, numbers, hyphens. Must match directory name. |
| `description` | No | What this skill provides. Falls back to "Custom skill: {name}" if omitted. |
| `mcp` | No | MCP server config (see below). |

## Instruction Skills

The simplest custom skill: the markdown body is injected into the prompt when a workflow node references this skill.

```yaml
# In your workflow:
nodes:
  review:
    name: Code Review
    instruction: Review the pull request for issues.
    skills: [code-standards]  # injects your SKILL.md content
```

Use instruction skills for:
- Coding standards and conventions
- Evaluation rubrics and scoring criteria
- Domain-specific knowledge
- Process guidelines

## MCP Skills

Add an `mcp` field to the frontmatter to declare an MCP server:

````markdown
---
name: our-crm
description: Company CRM integration
mcp:
  command: npx
  args: ["-y", "@company/crm-mcp-server"]
  env:
    CRM_API_KEY: CRM API key
---

Use the CRM tools to look up customer data. Always search by email first.
````

The MCP server is wired only for nodes that reference this skill — not globally.

### MCP Transport Types

**stdio** (local process):
```yaml
mcp:
  command: npx
  args: ["-y", "@company/server"]
  env:
    API_KEY: Description of the key
```

**HTTP** (remote endpoint):
```yaml
mcp:
  url: https://mcp.example.com/mcp
  headers:
    Authorization: Bearer your-token-here
```

Note: Header values are passed as-is (no variable interpolation). Use literal values or configure them via your environment.

## Inline Workflow Skills

For skills that only make sense within a single workflow, define them inline:

```yaml
id: incident-postmortem
name: Incident Postmortem
entry: gather
skills:
  sre-rubric:
    name: SRE Postmortem Rubric
    instruction: |
      Score each dimension 1-5:
      - Completeness
      - Root Cause Depth
      - Blamelessness
      - Action Items
nodes:
  gather:
    name: Gather Timeline
    instruction: Reconstruct the incident timeline.
    skills: [github, sentry]
  draft:
    name: Draft Postmortem
    instruction: Write a blameless postmortem.
    skills: [sre-rubric]
```

## Skill Discovery Directories

SWEny discovers skills from multiple directories, making workflows portable across AI coding tools:

| Priority | Directory | Tool |
|----------|-----------|------|
| 1 (highest) | `.sweny/skills/` | SWEny |
| 2 | `.claude/skills/` | Claude Code |
| 3 | `.agents/skills/` | Codex, Gemini CLI, OpenCode |
| 4 | `.gemini/skills/` | Gemini CLI |

If the same skill ID exists in multiple directories, the highest-priority directory wins.

### Overriding Built-in Skills

Place a custom skill with the same ID as a built-in (e.g., `github`):

```
.sweny/skills/github/SKILL.md
```

The built-in tools remain available — your instruction is added on top. Use this to provide team-specific guidance like "Use our GitHub Enterprise instance at github.corp.com."

## Cross-Tool Compatibility

Skills authored as `SKILL.md` files follow the [Agent Skills Open Standard](https://agentskills.io). This means:
- Claude Code reads skills from `.claude/skills/`
- Codex reads from `.agents/skills/`
- Gemini CLI reads from `.gemini/skills/`
- SWEny reads from all of the above

Write your skill once, put it in `.agents/skills/` (the universal directory), and it works everywhere.
