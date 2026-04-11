# Custom Skills Extension System — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable workflow authors to define custom instruction skills and MCP-backed skills, with multi-harness discovery and node-scoped injection.

**Architecture:** Extend `@sweny-ai/core` types, schemas, custom-loader, executor, and MCP module with additive (non-breaking) changes. Update the spec site, marketplace, and docs site to reflect the new capabilities.

**Tech Stack:** TypeScript (ESM), Zod, Vitest, YAML, Astro (spec site), Next.js (marketplace)

**Spec:** `docs/superpowers/specs/2026-04-11-custom-skills-design.md`

---

## File Structure

### Modified Files

| File | Responsibility |
|------|---------------|
| `packages/core/src/types.ts` | Add `instruction`, `mcp` to Skill; add `SkillDefinition`, `skills` to Workflow |
| `packages/core/src/schema.ts` | Add `mcpServerConfigZ`, `skillDefinitionZ`, update `skillZ`, `workflowZ`, `workflowJsonSchema`, `validateWorkflow` |
| `packages/core/src/skills/custom-loader.ts` | Rewrite: multi-directory scan, capture markdown body as instruction, parse MCP from frontmatter |
| `packages/core/src/skills/index.ts` | Update `createSkillMap` merge logic for custom overrides |
| `packages/core/src/executor.ts` | Inject skill instructions into prompt, update runtime guard for instruction-only skills |
| `packages/core/src/mcp.ts` | Accept skill-declared MCP servers in `buildSkillMcpServers` |
| `packages/core/src/index.ts` | Export new types: `SkillDefinition`, `McpServerConfig` (already exported) |
| `spec/src/content/docs/skills.mdx` | Add instruction, mcp, McpServerConfig, Custom Skills sections |
| `spec/src/content/docs/workflow.mdx` | Add `skills` field, SkillDefinition section |
| `spec/src/content/docs/nodes.mdx` | Add skill instruction injection to Input Augmentation |
| `spec/src/content/docs/execution.mdx` | Add MCP wiring step, update instruction build step |

### Modified Test Files

| File | Tests Added |
|------|------------|
| `packages/core/src/__tests__/schema.test.ts` | `skillDefinitionZ`, `mcpServerConfigZ`, `workflowZ` with skills, `validateWorkflow` inline skill warnings |
| `packages/core/src/__tests__/skills.test.ts` | Multi-directory discovery, instruction capture, MCP parsing, precedence override, merge behavior |
| `packages/core/src/executor.test.ts` | Skill instruction injection, instruction-only nodes, mixed skill types |
| `packages/core/src/mcp.test.ts` | Skill-declared MCP servers merged into buildSkillMcpServers |

---

### Task 1: Types — Add instruction, mcp, and SkillDefinition

**Files:**
- Modify: `packages/core/src/types.ts:37-44` (Skill interface)
- Modify: `packages/core/src/types.ts:77-84` (Workflow interface)
- Modify: `packages/core/src/index.ts:26-46` (exports)

- [ ] **Step 1: Add instruction and mcp to Skill interface**

In `packages/core/src/types.ts`, update the `Skill` interface:

```typescript
/** A skill groups related tools with shared config requirements */
export interface Skill {
  id: string;
  name: string;
  description: string;
  category: SkillCategory;
  config: Record<string, ConfigField>;
  tools: Tool[];
  /** Natural language expertise injected into the node prompt when this skill is referenced. */
  instruction?: string;
  /** External MCP server definition wired for nodes referencing this skill. */
  mcp?: McpServerConfig;
}
```

- [ ] **Step 2: Add SkillDefinition interface**

After the `Workflow` interface in `types.ts`, add:

```typescript
/**
 * Inline skill definition in a workflow's `skills` block.
 * Must provide at least `instruction` or `mcp`.
 */
export interface SkillDefinition {
  name?: string;
  description?: string;
  /** Natural language expertise injected into the node prompt. */
  instruction?: string;
  /** External MCP server. */
  mcp?: McpServerConfig;
}
```

- [ ] **Step 3: Add skills field to Workflow interface**

```typescript
export interface Workflow {
  id: string;
  name: string;
  description: string;
  nodes: Record<string, Node>;
  edges: Edge[];
  entry: string;
  /** Inline skill definitions scoped to this workflow. */
  skills?: Record<string, SkillDefinition>;
}
```

- [ ] **Step 4: Export SkillDefinition from index.ts**

In `packages/core/src/index.ts`, add `SkillDefinition` to the type exports:

```typescript
export type {
  Skill,
  SkillCategory,
  Tool,
  ToolContext,
  ConfigField,
  JSONSchema,
  Workflow,
  Node,
  Edge,
  NodeResult,
  ToolCall,
  ExecutionEvent,
  Observer,
  Claude,
  Logger,
  TraceStep,
  TraceEdge,
  ExecutionTrace,
  ExecutionResult,
  SkillDefinition,
} from "./types.js";
```

- [ ] **Step 5: Run tests to verify nothing breaks**

Run: `npx vitest run --reporter=dot`
Expected: All 1279 tests still pass (additive changes only).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/types.ts packages/core/src/index.ts
git commit -m "feat(core): add instruction, mcp, and SkillDefinition types"
```

---

### Task 2: Schema — Add mcpServerConfigZ, skillDefinitionZ, update workflowZ and skillZ

**Files:**
- Modify: `packages/core/src/schema.ts:35-42` (skillZ), `packages/core/src/schema.ts:58-65` (workflowZ), `packages/core/src/schema.ts:227-280` (workflowJsonSchema)
- Test: `packages/core/src/__tests__/schema.test.ts`

- [ ] **Step 1: Write failing tests for new schemas**

Add these tests to `packages/core/src/__tests__/schema.test.ts`:

```typescript
import {
  workflowZ,
  nodeZ,
  edgeZ,
  skillZ,
  toolZ,
  mcpServerConfigZ,
  skillDefinitionZ,
  parseWorkflow,
  validateWorkflow,
  workflowJsonSchema,
} from "../schema.js";

// In a new describe block at the end of the file:

describe("mcpServerConfigZ", () => {
  it("accepts stdio config", () => {
    const result = mcpServerConfigZ.parse({
      command: "npx",
      args: ["-y", "@company/tool-server"],
    });
    expect(result.command).toBe("npx");
  });

  it("accepts http config", () => {
    const result = mcpServerConfigZ.parse({
      url: "https://mcp.example.com",
      headers: { Authorization: "Bearer token" },
    });
    expect(result.url).toBe("https://mcp.example.com");
  });

  it("accepts explicit type", () => {
    const result = mcpServerConfigZ.parse({
      type: "stdio",
      command: "node",
      args: ["server.js"],
    });
    expect(result.type).toBe("stdio");
  });

  it("accepts env field", () => {
    const result = mcpServerConfigZ.parse({
      command: "npx",
      args: ["-y", "server"],
      env: { API_KEY: "Company API key" },
    });
    expect(result.env).toEqual({ API_KEY: "Company API key" });
  });

  it("rejects config with neither command nor url", () => {
    expect(() => mcpServerConfigZ.parse({ args: ["foo"] })).toThrow(
      "MCP server must have either command (stdio) or url (HTTP)"
    );
  });
});

describe("skillDefinitionZ", () => {
  it("accepts instruction-only skill", () => {
    const result = skillDefinitionZ.parse({
      name: "Code Standards",
      instruction: "Follow our coding conventions...",
    });
    expect(result.instruction).toBe("Follow our coding conventions...");
  });

  it("accepts mcp-only skill", () => {
    const result = skillDefinitionZ.parse({
      mcp: { command: "npx", args: ["-y", "server"] },
    });
    expect(result.mcp?.command).toBe("npx");
  });

  it("accepts both instruction and mcp", () => {
    const result = skillDefinitionZ.parse({
      instruction: "Use this server for...",
      mcp: { url: "https://mcp.example.com" },
    });
    expect(result.instruction).toBeDefined();
    expect(result.mcp).toBeDefined();
  });

  it("rejects skill with neither instruction nor mcp", () => {
    expect(() => skillDefinitionZ.parse({ name: "Empty" })).toThrow(
      "Inline skill must provide instruction, mcp, or both"
    );
  });
});

describe("skillZ with new fields", () => {
  it("accepts skill with instruction and no tools", () => {
    const result = skillZ.parse({
      id: "code-standards",
      name: "Code Standards",
      description: "Team coding conventions",
      category: "general",
      instruction: "Follow camelCase naming...",
    });
    expect(result.tools).toEqual([]);
    expect(result.instruction).toBe("Follow camelCase naming...");
  });

  it("accepts skill with mcp and no tools", () => {
    const result = skillZ.parse({
      id: "our-crm",
      name: "Our CRM",
      description: "CRM integration",
      category: "general",
      mcp: { url: "https://crm.example.com/mcp" },
    });
    expect(result.tools).toEqual([]);
    expect(result.mcp?.url).toBe("https://crm.example.com/mcp");
  });

  it("rejects skill with no tools, no instruction, no mcp", () => {
    expect(() =>
      skillZ.parse({
        id: "empty",
        name: "Empty",
        description: "Nothing",
        category: "general",
      })
    ).toThrow("Skill must provide at least one of: tools, instruction, or mcp");
  });

  it("defaults tools to empty array", () => {
    const result = skillZ.parse({
      id: "x",
      name: "X",
      description: "X",
      category: "general",
      instruction: "do stuff",
    });
    expect(result.tools).toEqual([]);
  });

  it("defaults config to empty object", () => {
    const result = skillZ.parse({
      id: "x",
      name: "X",
      description: "X",
      category: "general",
      instruction: "do stuff",
    });
    expect(result.config).toEqual({});
  });
});

describe("workflowZ with skills", () => {
  it("parses workflow with inline skills", () => {
    const result = workflowZ.parse({
      id: "test",
      name: "Test",
      entry: "a",
      nodes: { a: { name: "A", instruction: "Do A", skills: ["my-skill"] } },
      edges: [],
      skills: {
        "my-skill": {
          name: "My Skill",
          instruction: "Custom guidance here",
        },
      },
    });
    expect(result.skills?.["my-skill"]?.instruction).toBe("Custom guidance here");
  });

  it("defaults skills to empty object", () => {
    const result = workflowZ.parse({
      id: "x",
      name: "X",
      entry: "a",
      nodes: { a: { name: "A", instruction: "Do A" } },
      edges: [],
    });
    expect(result.skills).toEqual({});
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/core/src/__tests__/schema.test.ts --reporter=verbose`
Expected: FAIL — `mcpServerConfigZ`, `skillDefinitionZ` not exported; `skillZ` rejects instruction-only; `workflowZ` rejects skills field.

- [ ] **Step 3: Add mcpServerConfigZ and skillDefinitionZ to schema.ts**

In `packages/core/src/schema.ts`, after `skillCategoryZ` (line 33) and before `skillZ` (line 35), add:

```typescript
export const mcpServerConfigZ = z
  .object({
    type: z.enum(["stdio", "http"]).optional(),
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    url: z.string().optional(),
    headers: z.record(z.string()).optional(),
    env: z.record(z.string()).optional(),
  })
  .refine((c) => c.command || c.url, {
    message: "MCP server must have either command (stdio) or url (HTTP)",
  });

export const skillDefinitionZ = z
  .object({
    name: z.string().optional(),
    description: z.string().optional(),
    instruction: z.string().optional(),
    mcp: mcpServerConfigZ.optional(),
  })
  .refine((s) => s.instruction || s.mcp, {
    message: "Inline skill must provide instruction, mcp, or both",
  });
```

- [ ] **Step 4: Update skillZ to support instruction/mcp and optional tools**

Replace the existing `skillZ`:

```typescript
export const skillZ = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    description: z.string(),
    category: skillCategoryZ,
    config: z.record(configFieldZ).default({}),
    tools: z.array(toolZ).default([]),
    instruction: z.string().optional(),
    mcp: mcpServerConfigZ.optional(),
  })
  .refine((s) => s.tools.length > 0 || s.instruction || s.mcp, {
    message: "Skill must provide at least one of: tools, instruction, or mcp",
  });
```

- [ ] **Step 5: Update workflowZ to include skills field**

Replace the existing `workflowZ`:

```typescript
export const workflowZ = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(""),
  nodes: z.record(nodeZ),
  edges: z.array(edgeZ),
  entry: z.string().min(1),
  skills: z.record(skillDefinitionZ).default({}),
});
```

- [ ] **Step 6: Update workflowJsonSchema to include skills property**

In the `workflowJsonSchema` object, add `skills` to the `properties` block (after `edges`):

```typescript
skills: {
  type: "object",
  description: "Inline skill definitions scoped to this workflow",
  additionalProperties: {
    type: "object",
    properties: {
      name: { type: "string" },
      description: { type: "string" },
      instruction: { type: "string", description: "Natural language expertise injected into the node prompt" },
      mcp: {
        type: "object",
        description: "External MCP server definition",
        properties: {
          type: { type: "string", enum: ["stdio", "http"] },
          command: { type: "string" },
          args: { type: "array", items: { type: "string" } },
          url: { type: "string" },
          headers: { type: "object", additionalProperties: { type: "string" } },
          env: { type: "object", additionalProperties: { type: "string" } },
        },
      },
    },
  },
},
```

Also update `additionalProperties: false` at the top level — change it to allow `skills` by either removing `additionalProperties: false` or keeping it and including `skills` in the properties list. Since `skills` IS now in properties, `additionalProperties: false` will still work correctly.

- [ ] **Step 7: Update validateWorkflow for inline skill awareness**

In the `validateWorkflow` function's skill reference check section (around line 204), update it to also check workflow-level inline skills:

```typescript
// Skill references
if (knownSkills) {
  // Merge workflow inline skills into known set
  const allKnown = new Set(knownSkills);
  if (workflow.skills) {
    for (const id of Object.keys(workflow.skills)) {
      allKnown.add(id);
    }
  }
  for (const [nodeId, node] of Object.entries(workflow.nodes)) {
    for (const skillId of node.skills) {
      if (!allKnown.has(skillId)) {
        errors.push({
          code: "UNKNOWN_SKILL",
          message: `Node "${nodeId}" references unknown skill "${skillId}"`,
          nodeId,
        });
      }
    }
  }
}
```

Note: The `workflow` parameter's type will need to accept `skills` — update the function signature from `z.infer<typeof workflowZ>` (which now includes `skills`) so this works automatically.

- [ ] **Step 8: Add a test for inline skill awareness in validateWorkflow**

Add to the `validateWorkflow` describe block in `schema.test.ts`:

```typescript
it("recognizes inline workflow skills as known", () => {
  const wf = {
    ...validWorkflow,
    nodes: {
      ...validWorkflow.nodes,
      a: { ...validWorkflow.nodes.a, skills: ["custom-rubric"] },
    },
    skills: {
      "custom-rubric": {
        instruction: "Score things 1-5",
      },
    },
  };
  // With knownSkills not including custom-rubric, but workflow.skills has it
  const errors = validateWorkflow(wf, new Set(["github"]));
  // Should NOT have UNKNOWN_SKILL for custom-rubric
  expect(errors.filter((e) => e.code === "UNKNOWN_SKILL")).toEqual([]);
});
```

- [ ] **Step 9: Export new schemas from schema.ts**

Update the exports in `packages/core/src/index.ts`:

```typescript
export { workflowZ, nodeZ, edgeZ, skillZ, mcpServerConfigZ, skillDefinitionZ, parseWorkflow, validateWorkflow, workflowJsonSchema } from "./schema.js";
```

- [ ] **Step 10: Run tests to verify they pass**

Run: `npx vitest run packages/core/src/__tests__/schema.test.ts --reporter=verbose`
Expected: All tests PASS.

- [ ] **Step 11: Run full test suite**

Run: `npx vitest run --reporter=dot`
Expected: All tests pass. Existing `skillZ` tests may need the `config` and `tools` fields added since they were previously required — check if the existing test at line 116-130 of `schema.test.ts` still passes (it provides both `config` and `tools` explicitly, so it should).

- [ ] **Step 12: Commit**

```bash
git add packages/core/src/schema.ts packages/core/src/__tests__/schema.test.ts packages/core/src/index.ts
git commit -m "feat(core): add mcpServerConfigZ, skillDefinitionZ, update workflowZ and skillZ schemas"
```

---

### Task 3: Custom Loader — Multi-directory discovery with instruction capture and MCP parsing

**Files:**
- Modify: `packages/core/src/skills/custom-loader.ts` (full rewrite)
- Test: `packages/core/src/__tests__/skills.test.ts`

- [ ] **Step 1: Write failing tests for multi-directory discovery**

Add to the `loadCustomSkills` describe block in `packages/core/src/__tests__/skills.test.ts`. First, update the imports:

```typescript
import { loadCustomSkills, discoverSkills, configuredSkills } from "../skills/custom-loader.js";
```

Then add these tests:

```typescript
describe("discoverSkills (multi-directory)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "sweny-discover-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeSkillAt(base: string, dirName: string, content: string) {
    const dir = join(tmpDir, base, "skills", dirName);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), content);
  }

  it("discovers skills from .sweny/skills/", () => {
    writeSkillAt(".sweny", "my-skill", `---\nname: my-skill\ndescription: A skill\n---\nDo things well.`);
    const skills = discoverSkills(tmpDir);
    expect(skills).toHaveLength(1);
    expect(skills[0].id).toBe("my-skill");
  });

  it("discovers skills from .claude/skills/", () => {
    writeSkillAt(".claude", "claude-skill", `---\nname: claude-skill\ndescription: Claude\n---\nInstructions.`);
    const skills = discoverSkills(tmpDir);
    expect(skills).toHaveLength(1);
    expect(skills[0].id).toBe("claude-skill");
  });

  it("discovers skills from .agents/skills/", () => {
    writeSkillAt(".agents", "agent-skill", `---\nname: agent-skill\ndescription: Agent\n---\nBody.`);
    const skills = discoverSkills(tmpDir);
    expect(skills).toHaveLength(1);
  });

  it("discovers skills from .gemini/skills/", () => {
    writeSkillAt(".gemini", "gemini-skill", `---\nname: gemini-skill\ndescription: Gemini\n---\nBody.`);
    const skills = discoverSkills(tmpDir);
    expect(skills).toHaveLength(1);
  });

  it("higher-priority directory wins on ID collision", () => {
    // .sweny/ is priority 2, .claude/ is priority 3 — .sweny wins
    writeSkillAt(".sweny", "shared", `---\nname: shared\ndescription: From sweny\n---\nSweny instructions.`);
    writeSkillAt(".claude", "shared", `---\nname: shared\ndescription: From claude\n---\nClaude instructions.`);
    const skills = discoverSkills(tmpDir);
    const shared = skills.find((s) => s.id === "shared")!;
    expect(shared.description).toBe("From sweny");
    expect(shared.instruction).toBe("Sweny instructions.");
  });

  it("captures markdown body as instruction", () => {
    writeSkillAt(".sweny", "code-standards", `---
name: code-standards
description: Coding conventions
---

When writing TypeScript:
- Use camelCase for variables
- Use PascalCase for types`);
    const skills = discoverSkills(tmpDir);
    expect(skills[0].instruction).toContain("Use camelCase for variables");
    expect(skills[0].instruction).toContain("Use PascalCase for types");
  });

  it("parses mcp from frontmatter", () => {
    writeSkillAt(".sweny", "our-crm", `---
name: our-crm
description: CRM integration
mcp:
  command: npx
  args:
    - -y
    - "@company/crm-server"
  env:
    API_KEY: CRM API key
---

Use the CRM tools to look up customer data.`);
    const skills = discoverSkills(tmpDir);
    expect(skills[0].mcp).toEqual({
      command: "npx",
      args: ["-y", "@company/crm-server"],
      env: { API_KEY: "CRM API key" },
    });
    expect(skills[0].instruction).toContain("Use the CRM tools");
  });

  it("parses mcp with url (HTTP transport)", () => {
    writeSkillAt(".sweny", "http-tool", `---
name: http-tool
description: HTTP MCP
mcp:
  url: https://mcp.example.com
  headers:
    Authorization: Bearer token
---

Instructions.`);
    const skills = discoverSkills(tmpDir);
    expect(skills[0].mcp?.url).toBe("https://mcp.example.com");
  });

  it("returns empty array when no skill directories exist", () => {
    const skills = discoverSkills(tmpDir);
    expect(skills).toEqual([]);
  });

  it("merges skills from all directories", () => {
    writeSkillAt(".sweny", "skill-a", `---\nname: skill-a\ndescription: A\n---\nA.`);
    writeSkillAt(".claude", "skill-b", `---\nname: skill-b\ndescription: B\n---\nB.`);
    writeSkillAt(".agents", "skill-c", `---\nname: skill-c\ndescription: C\n---\nC.`);
    const skills = discoverSkills(tmpDir);
    expect(skills).toHaveLength(3);
    const ids = skills.map((s) => s.id).sort();
    expect(ids).toEqual(["skill-a", "skill-b", "skill-c"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/core/src/__tests__/skills.test.ts --reporter=verbose`
Expected: FAIL — `discoverSkills` not exported.

- [ ] **Step 3: Rewrite custom-loader.ts**

Replace the entire contents of `packages/core/src/skills/custom-loader.ts`:

```typescript
/**
 * Custom skill discovery — Node-only.
 *
 * Scans multiple skill directories (multi-harness) for SKILL.md files,
 * captures the markdown body as `instruction`, and parses optional `mcp`
 * from frontmatter.
 *
 * Discovery priority (higher number wins on ID collision):
 *   .gemini/skills/ < .agents/skills/ < .claude/skills/ < .sweny/skills/
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";

import type { Skill, SkillCategory, McpServerConfig } from "../types.js";
import { builtinSkills, isSkillConfigured } from "./index.js";

/** Directories to scan, in ascending priority order. Last match wins. */
const SKILL_DIRS = [".gemini/skills", ".agents/skills", ".claude/skills", ".sweny/skills"];

/**
 * Discover custom skills from all known harness directories.
 *
 * Scans `.gemini/skills/`, `.agents/skills/`, `.claude/skills/`, `.sweny/skills/`
 * in that order. For each directory found, reads `<name>/SKILL.md` files and
 * produces Skill objects with `instruction` (from markdown body) and optional
 * `mcp` (from frontmatter).
 *
 * If the same skill ID appears in multiple directories, the higher-priority
 * directory wins (`.sweny/` > `.claude/` > `.agents/` > `.gemini/`).
 */
export function discoverSkills(cwd: string = process.cwd()): Skill[] {
  const skillMap = new Map<string, Skill>();

  for (const relDir of SKILL_DIRS) {
    const skillsDir = join(cwd, relDir);
    if (!existsSync(skillsDir)) continue;

    let entries: string[];
    try {
      entries = readdirSync(skillsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
    } catch {
      continue;
    }

    for (const dirName of entries) {
      const skillFile = join(skillsDir, dirName, "SKILL.md");
      if (!existsSync(skillFile)) continue;

      try {
        const content = readFileSync(skillFile, "utf-8");
        const parsed = parseSkillMd(content);
        if (!parsed) continue;

        skillMap.set(parsed.id, parsed);
      } catch {
        // Skip malformed skill files
      }
    }
  }

  return [...skillMap.values()];
}

/**
 * Parse a SKILL.md file into a Skill object.
 *
 * Extracts YAML frontmatter for metadata (name, description, mcp)
 * and the markdown body for instruction content.
 */
function parseSkillMd(content: string): Skill | null {
  const frontmatter = parseFrontmatter(content);
  if (!frontmatter?.name) return null;

  const instruction = extractBody(content);

  let mcp: McpServerConfig | undefined;
  if (frontmatter.mcp && typeof frontmatter.mcp === "object") {
    const m = frontmatter.mcp;
    if (m.command || m.url) {
      mcp = {
        type: m.type ?? (m.command ? "stdio" : "http"),
        ...(m.command ? { command: m.command } : {}),
        ...(m.args ? { args: m.args } : {}),
        ...(m.url ? { url: m.url } : {}),
        ...(m.headers ? { headers: m.headers } : {}),
        ...(m.env ? { env: m.env } : {}),
      };
    }
  }

  return {
    id: frontmatter.name,
    name: frontmatter.name,
    description: frontmatter.description ?? `Custom skill: ${frontmatter.name}`,
    category: "general" as SkillCategory,
    config: {},
    tools: [],
    instruction: instruction || undefined,
    mcp,
  };
}

/** Extract YAML frontmatter from a markdown file (between --- delimiters). */
function parseFrontmatter(content: string): Record<string, any> | null {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return null;
  try {
    return YAML.parse(match[1]);
  } catch {
    return null;
  }
}

/** Extract the markdown body (everything after closing ---). */
function extractBody(content: string): string {
  const match = content.match(/^---\s*\n[\s\S]*?\n---\s*\n?([\s\S]*)/);
  if (!match) return "";
  return match[1].trim();
}

/**
 * Legacy API — load custom skills from `.claude/skills/` only.
 * @deprecated Use `discoverSkills` for multi-directory support.
 */
export function loadCustomSkills(cwd: string = process.cwd()): Skill[] {
  return discoverSkills(cwd);
}

/**
 * From all builtins + custom repo skills, return only the skills that are usable.
 * Built-in skills are filtered by env vars; custom skills are always included.
 *
 * Node-only: reads skill directories from disk. Browser code should call
 * `configuredBuiltinSkills` from `@sweny-ai/core/browser` instead.
 */
export function configuredSkills(env: Record<string, string | undefined> = process.env, cwd?: string): Skill[] {
  const configured = builtinSkills.filter((s) => isSkillConfigured(s, env));
  const custom = discoverSkills(cwd);

  // Custom skills can override built-in IDs. When overriding, merge:
  // keep the built-in's tools and config, add the custom instruction/mcp.
  const configuredMap = new Map(configured.map((s) => [s.id, s]));

  for (const skill of custom) {
    const existing = configuredMap.get(skill.id);
    if (existing) {
      // Merge: built-in tools + custom instruction/mcp
      configuredMap.set(skill.id, {
        ...existing,
        instruction: skill.instruction ?? existing.instruction,
        mcp: skill.mcp ?? existing.mcp,
      });
    } else {
      configuredMap.set(skill.id, skill);
    }
  }

  return [...configuredMap.values()];
}
```

- [ ] **Step 4: Export discoverSkills from index.ts**

Update the custom-loader export line in `packages/core/src/index.ts`:

```typescript
export { loadCustomSkills, discoverSkills, configuredSkills } from "./skills/custom-loader.js";
```

- [ ] **Step 5: Update existing loadCustomSkills tests**

The existing `loadCustomSkills` tests should still pass since `loadCustomSkills` now delegates to `discoverSkills`. However, update the test that checks precedence ("built-in skills take precedence over custom skills with same ID") since the behavior is now inverted — custom skills override built-in IDs (keeping tools):

In the `configuredSkills with custom skills` describe block, update the "built-in skills take precedence" test:

```typescript
it("custom skills override built-in ID but merge tools", () => {
  writeSkill("notification", `---\nname: notification\ndescription: Custom override\n---\nCustom notification guidance.`);
  const skills = configuredSkills({}, tmpDir);
  const notif = skills.filter((s) => s.id === "notification");
  expect(notif).toHaveLength(1);
  // Built-in tools are preserved
  expect(notif[0].tools.length).toBeGreaterThan(0);
  // Custom instruction is added
  expect(notif[0].instruction).toBe("Custom notification guidance.");
});
```

Also update the test that checks ".claude/skills/" works — since `loadCustomSkills` now calls `discoverSkills` which scans all 4 directories, the `.claude/skills/` tests still pass.

- [ ] **Step 6: Run tests**

Run: `npx vitest run packages/core/src/__tests__/skills.test.ts --reporter=verbose`
Expected: All tests PASS.

- [ ] **Step 7: Run full suite**

Run: `npx vitest run --reporter=dot`
Expected: All tests pass.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/skills/custom-loader.ts packages/core/src/__tests__/skills.test.ts packages/core/src/index.ts
git commit -m "feat(core): multi-directory skill discovery with instruction capture and MCP parsing"
```

---

### Task 4: Executor — Skill instruction injection and updated runtime guard

**Files:**
- Modify: `packages/core/src/executor.ts:173-200` (buildNodeInstruction), `packages/core/src/executor.ts:77-89` (runtime guard), `packages/core/src/executor.ts:217-222` (resolveTools)
- Test: `packages/core/src/executor.test.ts`

- [ ] **Step 1: Write failing tests for instruction injection**

Add to `packages/core/src/executor.test.ts`:

```typescript
describe("skill instruction injection", () => {
  let outputDir: string;

  beforeEach(() => {
    outputDir = freshDir("skill-inject");
  });

  it("injects skill instructions into the prompt", async () => {
    // Create a skill with instruction
    const instructionSkill: Skill = {
      id: "code-standards",
      name: "Code Standards",
      description: "Team conventions",
      category: "general",
      config: {},
      tools: [],
      instruction: "Always use camelCase for variable names.",
    };

    const workflow: Workflow = {
      id: "test-inject",
      name: "Inject Test",
      description: "",
      entry: "step",
      nodes: {
        step: {
          name: "Do Work",
          instruction: "Write some code.",
          skills: ["code-standards"],
        },
      },
      edges: [],
    };

    let capturedInstruction = "";
    const claude: Claude = {
      async run(opts) {
        capturedInstruction = opts.instruction;
        return { status: "success", data: {}, toolCalls: [] };
      },
      async evaluate() {
        return "";
      },
    };

    await execute(workflow, {}, {
      skills: createSkillMap([instructionSkill]),
      claude,
      config: {},
    });

    expect(capturedInstruction).toContain("## Skill: Code Standards");
    expect(capturedInstruction).toContain("Always use camelCase for variable names.");
    expect(capturedInstruction).toContain("Write some code.");
  });

  it("injects multiple skill instructions in array order", async () => {
    const skillA: Skill = {
      id: "skill-a",
      name: "Skill A",
      description: "First",
      category: "general",
      config: {},
      tools: [],
      instruction: "AAA instruction",
    };
    const skillB: Skill = {
      id: "skill-b",
      name: "Skill B",
      description: "Second",
      category: "general",
      config: {},
      tools: [],
      instruction: "BBB instruction",
    };

    const workflow: Workflow = {
      id: "test-multi",
      name: "Multi Inject",
      description: "",
      entry: "step",
      nodes: {
        step: {
          name: "Work",
          instruction: "Do the work.",
          skills: ["skill-a", "skill-b"],
        },
      },
      edges: [],
    };

    let capturedInstruction = "";
    const claude: Claude = {
      async run(opts) {
        capturedInstruction = opts.instruction;
        return { status: "success", data: {}, toolCalls: [] };
      },
      async evaluate() { return ""; },
    };

    await execute(workflow, {}, {
      skills: createSkillMap([skillA, skillB]),
      claude,
      config: {},
    });

    const posA = capturedInstruction.indexOf("AAA instruction");
    const posB = capturedInstruction.indexOf("BBB instruction");
    const posBase = capturedInstruction.indexOf("Do the work.");
    expect(posA).toBeLessThan(posB);
    expect(posB).toBeLessThan(posBase);
  });

  it("allows instruction-only nodes (no tools, no error)", async () => {
    const instructionSkill: Skill = {
      id: "rubric",
      name: "Evaluation Rubric",
      description: "Scoring criteria",
      category: "general",
      config: {},
      tools: [],
      instruction: "Score quality 1-5.",
    };

    const workflow: Workflow = {
      id: "test-notools",
      name: "No Tools",
      description: "",
      entry: "judge",
      nodes: {
        judge: {
          name: "Judge",
          instruction: "Evaluate the output.",
          skills: ["rubric"],
        },
      },
      edges: [],
    };

    const claude: Claude = {
      async run() {
        return { status: "success", data: { score: 4 }, toolCalls: [] };
      },
      async evaluate() { return ""; },
    };

    // Should NOT throw "none are configured"
    const { results } = await execute(workflow, {}, {
      skills: createSkillMap([instructionSkill]),
      claude,
      config: {},
    });
    expect(results.get("judge")?.status).toBe("success");
  });
});
```

Add the import for `Skill` and `Claude` types at the top of the file:

```typescript
import type { Workflow, ExecutionEvent, Skill, Claude } from "./types.js";
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/core/src/executor.test.ts --reporter=verbose`
Expected: FAIL — instruction not injected (missing from captured instruction), or runtime guard throws on instruction-only nodes.

- [ ] **Step 3: Update resolveTools to also return skill instructions**

In `packages/core/src/executor.ts`, add a new function alongside `resolveTools`:

```typescript
/** Collect instruction strings from skills that have them, in array order. */
function resolveSkillInstructions(skillIds: string[], skills: Map<string, Skill>): { name: string; instruction: string }[] {
  return skillIds
    .map((id) => skills.get(id))
    .filter((s): s is Skill => s != null && s.instruction != null)
    .map((s) => ({ name: s.name, instruction: s.instruction! }));
}
```

- [ ] **Step 4: Update buildNodeInstruction to accept and inject skill instructions**

Update the `buildNodeInstruction` function signature and body:

```typescript
function buildNodeInstruction(
  baseInstruction: string,
  input: unknown,
  skillInstructions?: { name: string; instruction: string }[],
): string {
  const inp = input as Record<string, unknown> | null;
  const sections: string[] = [];

  if (inp) {
    // New structured format
    const rules = typeof inp.rules === "string" && inp.rules ? inp.rules : "";
    const context = typeof inp.context === "string" && inp.context ? inp.context : "";

    if (rules) {
      sections.push(`## Rules — You MUST Follow These\n\n${rules}`);
    }
    if (context) {
      sections.push(`## Background Context\n\n${context}`);
    }

    // Legacy fallback
    if (sections.length === 0) {
      const legacy = typeof inp.additionalContext === "string" ? inp.additionalContext : "";
      if (legacy) {
        sections.push(`## Additional Context & Rules\n\n${legacy}`);
      }
    }
  }

  // Skill instructions — injected between context and base instruction
  if (skillInstructions && skillInstructions.length > 0) {
    for (const { name, instruction } of skillInstructions) {
      sections.push(`## Skill: ${name}\n\n${instruction}`);
    }
  }

  if (sections.length === 0) return baseInstruction;
  return `${sections.join("\n\n---\n\n")}\n\n---\n\n${baseInstruction}`;
}
```

- [ ] **Step 5: Update the execute function to pass skill instructions**

In the `execute` function, after `resolveTools` (around line 78), add:

```typescript
const skillInstructions = resolveSkillInstructions(node.skills, skills);
```

Update the `buildNodeInstruction` call (around line 110):

```typescript
const instruction = buildNodeInstruction(node.instruction, input, skillInstructions);
```

- [ ] **Step 6: Update runtime guard for instruction-only skills**

Replace the runtime guard (around line 84):

```typescript
// Runtime guard: if this node declares skills but none resolved to tools
// or instructions, the node cannot do its job.
if (node.skills.length > 0 && tools.length === 0 && skillInstructions.length === 0) {
  throw new Error(
    `Node "${currentId}" requires skills [${node.skills.join(", ")}] but none are configured. ` +
      `Set the required environment variables and try again.`,
  );
}
```

- [ ] **Step 7: Run tests**

Run: `npx vitest run packages/core/src/executor.test.ts --reporter=verbose`
Expected: All tests PASS (including new ones).

- [ ] **Step 8: Run full suite**

Run: `npx vitest run --reporter=dot`
Expected: All tests pass.

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/executor.ts packages/core/src/executor.test.ts
git commit -m "feat(core): inject skill instructions into node prompts, update runtime guard"
```

---

### Task 5: MCP — Accept skill-declared MCP servers

**Files:**
- Modify: `packages/core/src/mcp.ts:14-21` (SkillMcpOptions), `packages/core/src/mcp.ts:37-193` (buildSkillMcpServers)
- Test: `packages/core/src/mcp.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `packages/core/src/mcp.test.ts`, in the `buildSkillMcpServers` describe block:

```typescript
it("includes skill-declared MCP servers", () => {
  const result = buildSkillMcpServers({
    referencedSkills: new Set(["our-crm"]),
    credentials: {},
    skillMcpServers: {
      "our-crm": {
        type: "stdio",
        command: "npx",
        args: ["-y", "@company/crm-server"],
        env: { API_KEY: "test-key" },
      },
    },
  });
  expect(result["our-crm"]).toBeDefined();
  expect(result["our-crm"].command).toBe("npx");
});

it("skill-declared MCP is only included when skill is referenced", () => {
  const result = buildSkillMcpServers({
    referencedSkills: new Set(["github"]),
    credentials: { GITHUB_TOKEN: "ghp_test" },
    skillMcpServers: {
      "our-crm": {
        type: "stdio",
        command: "npx",
        args: ["-y", "@company/crm-server"],
      },
    },
  });
  expect(result["github"]).toBeDefined();
  expect(result["our-crm"]).toBeUndefined();
});

it("user-supplied servers win over skill-declared", () => {
  const result = buildSkillMcpServers({
    referencedSkills: new Set(["our-crm"]),
    credentials: {},
    skillMcpServers: {
      "our-crm": {
        type: "stdio",
        command: "npx",
        args: ["-y", "@company/crm-server"],
      },
    },
    userMcpServers: {
      "our-crm": {
        type: "http",
        url: "https://override.example.com",
      },
    },
  });
  expect(result["our-crm"].url).toBe("https://override.example.com");
});

it("skill-declared and auto-wired MCPs coexist", () => {
  const result = buildSkillMcpServers({
    referencedSkills: new Set(["github", "our-crm"]),
    credentials: { GITHUB_TOKEN: "ghp_test" },
    skillMcpServers: {
      "our-crm": {
        type: "stdio",
        command: "npx",
        args: ["-y", "@company/crm-server"],
      },
    },
  });
  expect(result["github"]).toBeDefined();
  expect(result["our-crm"]).toBeDefined();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/core/src/mcp.test.ts --reporter=verbose`
Expected: FAIL — `skillMcpServers` property not accepted.

- [ ] **Step 3: Update SkillMcpOptions**

In `packages/core/src/mcp.ts`, update the `SkillMcpOptions` interface:

```typescript
export interface SkillMcpOptions {
  /** Skill IDs referenced by the workflow being executed. Only these get MCPs. */
  referencedSkills: Set<string>;
  /** Flat credential map (env vars). MCPs are only wired when their creds are set. */
  credentials: Record<string, string>;
  /** MCP servers declared by custom skills. Only wired when the skill is referenced. */
  skillMcpServers?: Record<string, McpServerConfig>;
  /** User-supplied MCP servers — always win on key conflict. */
  userMcpServers?: Record<string, McpServerConfig>;
}
```

- [ ] **Step 4: Update buildSkillMcpServers to merge skill-declared servers**

At the end of `buildSkillMcpServers`, before the user-supplied merge line, add:

```typescript
// Skill-declared MCP servers — only include for referenced skills.
if (opts.skillMcpServers) {
  for (const [skillId, mcpConfig] of Object.entries(opts.skillMcpServers)) {
    if (refs.has(skillId) && !auto[skillId]) {
      auto[skillId] = mcpConfig;
    }
  }
}

// User-supplied servers always win on key conflict.
return { ...auto, ...(opts.userMcpServers ?? {}) };
```

Remove the old final line (`return { ...auto, ...(opts.userMcpServers ?? {}) };`) since we've replaced it.

- [ ] **Step 5: Run tests**

Run: `npx vitest run packages/core/src/mcp.test.ts --reporter=verbose`
Expected: All tests PASS.

- [ ] **Step 6: Export SkillMcpOptions from index.ts**

In `packages/core/src/index.ts`, update the MCP exports:

```typescript
export { buildAutoMcpServers, buildSkillMcpServers, buildProviderContext } from "./mcp.js";
export type { ProviderContextOptions, SkillMcpOptions } from "./mcp.js";
```

- [ ] **Step 7: Run full suite**

Run: `npx vitest run --reporter=dot`
Expected: All tests pass.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/mcp.ts packages/core/src/mcp.test.ts packages/core/src/index.ts
git commit -m "feat(core): accept skill-declared MCP servers in buildSkillMcpServers"
```

---

### Task 6: Spec Site — Update skills.mdx

**Files:**
- Modify: `spec/src/content/docs/skills.mdx`

- [ ] **Step 1: Add instruction and mcp fields to Skill Object table**

In the Skill Object table (after the `tools` row), add:

```markdown
| `instruction` | string | OPTIONAL | — | Natural language expertise injected into the node prompt when this skill is referenced. |
| `mcp` | [McpServerConfig](#mcpserverconfig-object) | OPTIONAL | — | External MCP server definition wired for nodes referencing this skill. |
```

- [ ] **Step 2: Add "at least one" constraint note**

After the Skill Object table, add:

```markdown
A valid Skill MUST provide at least one of `tools`, `instruction`, or `mcp`.
```

- [ ] **Step 3: Add McpServerConfig Object section**

After the Config Field Object section, add a new section:

```markdown
## McpServerConfig Object

Declares an external MCP (Model Context Protocol) server that provides tools to the AI model at runtime.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"stdio"` \| `"http"` | OPTIONAL | Transport type. Inferred from presence of `command` (stdio) or `url` (http) when omitted. |
| `command` | string | CONDITIONAL | Spawn command (stdio transport). Required if `url` absent. |
| `args` | string[] | OPTIONAL | Arguments for the command. |
| `url` | string | CONDITIONAL | HTTP endpoint (HTTP transport). Required if `command` absent. |
| `headers` | Record&lt;string, string&gt; | OPTIONAL | HTTP headers (HTTP transport only). |
| `env` | Record&lt;string, string&gt; | OPTIONAL | Environment variable names the server needs. Values are human-readable descriptions, not secrets. Actual values are resolved from `process.env` at runtime. |

A conforming executor:

- **MUST** wire the MCP server only for nodes that reference the skill declaring it (node-scoped, not global).
- **MUST** resolve `env` values from `process.env` at runtime (the declared values are descriptions, not secrets).
- **SHOULD** prefer user-supplied MCP server configs over skill-declared ones when both exist for the same key.
```

- [ ] **Step 4: Add Custom Skills section**

At the end of the file (before Examples), add:

```markdown
## Custom Skills

Custom skills are authored as directories containing a `SKILL.md` file. The format follows the [Agent Skills Open Standard](https://agentskills.io).

### SKILL.md Format

A skill directory contains a `SKILL.md` file with YAML frontmatter and a markdown body:

\`\`\`markdown
---
name: code-standards
description: Team coding conventions for TypeScript projects
mcp:
  command: npx
  args: ["-y", "@company/tool-server"]
  env:
    API_KEY: Company API key
---

When writing TypeScript code, follow these standards:
- Use camelCase for variables and functions
- Use PascalCase for types and interfaces
\`\`\`

The markdown body becomes the skill's `instruction` — injected into the node prompt when the skill is referenced. The `mcp` frontmatter field is a SWEny-specific extension for declaring an MCP server.

### Multi-Harness Discovery

A conforming executor SHOULD discover custom skills from the following directories, in priority order (highest first):

| Priority | Directory | Convention |
|----------|-----------|------------|
| 1 | `.sweny/skills/<name>/SKILL.md` | SWEny-native |
| 2 | `.claude/skills/<name>/SKILL.md` | Claude Code |
| 3 | `.agents/skills/<name>/SKILL.md` | Universal (Codex, Gemini CLI, OpenCode) |
| 4 | `.gemini/skills/<name>/SKILL.md` | Gemini CLI |

On ID collision, the higher-priority directory wins. When a custom skill overrides a well-known skill ID, the custom skill's instruction is injected AND the well-known skill's tools remain available.
```

- [ ] **Step 5: Commit**

```bash
git add spec/src/content/docs/skills.mdx
git commit -m "docs(spec): add instruction, mcp, McpServerConfig, and Custom Skills to skills spec"
```

---

### Task 7: Spec Site — Update workflow.mdx

**Files:**
- Modify: `spec/src/content/docs/workflow.mdx`

- [ ] **Step 1: Add skills field to Workflow Object table**

In the Workflow Object table (after `edges`), add:

```markdown
| `skills` | Record&lt;string, [SkillDefinition](#skilldefinition-object)&gt; | OPTIONAL | `{}` | Inline skill definitions scoped to this workflow. |
```

- [ ] **Step 2: Add SkillDefinition Object section**

After the Error Codes section, add:

```markdown
## SkillDefinition Object

Inline skill definitions declared in the workflow's `skills` block. These are scoped to the workflow and available to any node that references them by key.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | OPTIONAL | Display name. Defaults to the map key. |
| `description` | string | OPTIONAL | What this skill provides. |
| `instruction` | string | OPTIONAL | Natural language expertise injected into the node prompt. |
| `mcp` | [McpServerConfig](/skills#mcpserverconfig-object) | OPTIONAL | External MCP server definition. |

A valid SkillDefinition MUST provide at least one of `instruction` or `mcp`.

Inline skills cannot define `tools` (those require runtime code). They provide instruction-based expertise and/or external MCP server connections.

### Example

\`\`\`yaml
skills:
  sre-rubric:
    name: SRE Postmortem Rubric
    instruction: |
      Score each postmortem dimension 1-5:
      - Completeness: Can you reconstruct the incident?
      - Root Cause Depth: "Database was slow" = 1, specific PR + mechanism = 5
      - Blamelessness: No individual names as responsible parties
      - Action Items: Specific, assignable, measurable
\`\`\`
```

- [ ] **Step 3: Add skills to structural validation rules**

In the Structural Validation section, add:

```markdown
7. **Inline skill constraint.** Every entry in `skills` MUST provide at least one of `instruction` or `mcp`. An inline skill with neither is invalid.
```

Add to the Error Codes table:

```markdown
| `INVALID_INLINE_SKILL` | An inline skill provides neither `instruction` nor `mcp`. |
```

- [ ] **Step 4: Update the Full Example to include an inline skill**

Update the full example YAML to add a `skills:` block. After the `entry: gather` line, add:

```yaml
skills:
  triage-rubric:
    name: Triage Severity Rubric
    instruction: |
      When assessing severity: critical = customer-facing outage,
      high = degraded service, medium = internal impact, low = cosmetic.
```

And update the `investigate` node's skills to include `triage-rubric`:

```yaml
  investigate:
    name: Root Cause Analysis
    instruction: >-
      Classify each issue found as novel or duplicate. Assess severity
      and fix complexity. Output structured findings.
    skills:
      - github
      - linear
      - triage-rubric
```

- [ ] **Step 5: Commit**

```bash
git add spec/src/content/docs/workflow.mdx
git commit -m "docs(spec): add skills field and SkillDefinition to workflow spec"
```

---

### Task 8: Spec Site — Update nodes.mdx and execution.mdx

**Files:**
- Modify: `spec/src/content/docs/nodes.mdx:27-45` (Input Augmentation)
- Modify: `spec/src/content/docs/execution.mdx:29-38` (Node Execution Sequence)

- [ ] **Step 1: Update nodes.mdx Input Augmentation**

In the "Input Augmentation" section, after the context block and before "When both are present", add:

```markdown
### Skill Instruction Injection

If any skill referenced by the node has an `instruction` field, a conforming executor MUST inject each skill's instruction into the prompt, in the order the skills appear in the node's `skills` array:

\`\`\`
## Skill: {skill.name}

{skill.instruction}
\`\`\`

When rules, context, and skill instructions are all present, the assembly order is: rules first, then context, then skill instructions, then the node's base instruction, separated by `---`.
```

- [ ] **Step 2: Update execution.mdx Node Execution Sequence**

Replace the 7-step sequence with 9 steps:

```markdown
1. **Resolve skills** from the node's `skills` list (see [Skills](/skills)).
2. **Collect tools** from resolved skills that have `tools`.
3. **Collect MCP servers** from resolved skills that have `mcp`. Wire them for this node's execution session only (node-scoped, not global).
4. **Build context** — the accumulated context object (input + all prior node results).
5. **Build instruction** — the node's base instruction, augmented with input `rules` and `context` fields (see [Nodes — Input Augmentation](/nodes#input-augmentation)), then **skill instructions** from resolved skills that have `instruction`.
6. **Invoke the AI model** with: instruction, context, tools (from step 2 + MCP tools from step 3), and output schema (if present).
7. **Capture the result** as a `NodeResult`.
8. **Emit execution events** (see [Execution Events](#execution-events) below).
9. **Resolve the next node** via [edge routing](/edges#routing-algorithm).
```

- [ ] **Step 3: Commit**

```bash
git add spec/src/content/docs/nodes.mdx spec/src/content/docs/execution.mdx
git commit -m "docs(spec): add skill instruction injection and MCP wiring to execution model"
```

---

### Task 9: Marketplace — Update validate.mjs to accept skills block

**Files:**
- Modify: `marketplace/scripts/validate.mjs`

Note: This file lives in the marketplace repo, not the sweny repo. If you're working in the sweny worktree, you'll need to edit the marketplace repo separately. The changes are small.

- [ ] **Step 1: Update validate.mjs**

After the existing metadata checks (line 42), add inline skill validation:

```javascript
// Validate inline skills block
if (parsed.skills && typeof parsed.skills === "object") {
  for (const [skillId, def] of Object.entries(parsed.skills)) {
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(skillId) || skillId.includes("--") || skillId.length > 64) {
      errors.push(`[skills] invalid skill ID '${skillId}' (lowercase alphanumeric + hyphens, no consecutive hyphens, max 64 chars)`);
    }
    if (!def.instruction && !def.mcp) {
      errors.push(`[skills] skill '${skillId}' must have instruction or mcp`);
    }
  }
}
```

- [ ] **Step 2: Commit (in marketplace repo)**

```bash
git add scripts/validate.mjs
git commit -m "feat: validate inline skills block in workflow YAML"
```

---

### Task 10: Marketplace — Update types and workflow loading

**Files:**
- Modify: `marketplace/site/src/lib/types.ts:40-46` (MarketplaceWorkflow)
- Modify: `marketplace/site/src/lib/workflows.ts:42-57` (skill collection)

- [ ] **Step 1: Add customSkills to MarketplaceWorkflow type**

In `marketplace/site/src/lib/types.ts`, update `MarketplaceWorkflow`:

```typescript
export interface MarketplaceWorkflow extends Workflow, MarketplaceMetadata {
  source: "official" | "community";
  filePath: string;
  nodeCount: number;
  edgeCount: number;
  skills: string[];
  /** Inline custom skills defined in the workflow's skills block */
  customSkills: Record<string, { name?: string; description?: string; instruction?: string; mcp?: any }>;
}
```

- [ ] **Step 2: Update workflows.ts to extract custom skills**

In the `readYamlFiles` function, after collecting `allSkills` and before `workflows.push(...)`, add:

```typescript
// Extract inline custom skills from the workflow's skills block
const customSkills: Record<string, any> = {};
if (parsed.skills && typeof parsed.skills === "object") {
  for (const [id, def] of Object.entries(parsed.skills)) {
    customSkills[id] = def;
    allSkills.add(id); // Include custom skill IDs in the skills list
  }
}
```

Update the `workflows.push(...)` call to include `customSkills`:

```typescript
workflows.push({
  ...workflow,
  ...meta,
  source,
  filePath: `workflows/${source}/${file}`,
  nodeCount: Object.keys(workflow.nodes).length,
  edgeCount: workflow.edges.length,
  skills: [...allSkills],
  customSkills,
});
```

- [ ] **Step 3: Commit (in marketplace repo)**

```bash
git add site/src/lib/types.ts site/src/lib/workflows.ts
git commit -m "feat: extract and expose custom skills from workflow YAML"
```

---

### Task 11: Marketplace — Update WorkflowDetail to show custom skills

**Files:**
- Modify: `marketplace/site/src/components/WorkflowDetail.tsx:130-144` (skills tab)

- [ ] **Step 1: Update the skills tab rendering**

Replace the skills tab content (the grid inside `tab === "skills"`) with:

```tsx
{tab === "skills" && (
  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
    {[...skillNodes.entries()].map(([skill, nodes]) => {
      const customDef = workflow.customSkills?.[skill];
      const isCustom = !!customDef;
      const hasMcp = !!customDef?.mcp;

      return (
        <div key={skill} className="bg-[#111] border border-[#1e1e2e] rounded-lg p-2.5">
          <div className="flex items-center gap-1.5 mb-1">
            {isCustom ? (
              hasMcp ? (
                <svg className="w-3.5 h-3.5 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10.172 13.828a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.102 1.101" />
                </svg>
              ) : (
                <svg className="w-3.5 h-3.5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                </svg>
              )
            ) : (
              <div className="w-1.5 h-1.5 rounded-full bg-blue-400" />
            )}
            <span className="text-xs text-gray-200 font-medium capitalize">
              {customDef?.name ?? skill}
            </span>
            {isCustom && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${hasMcp ? "bg-purple-950/50 text-purple-400" : "bg-green-950/50 text-green-400"}`}>
                {hasMcp ? "MCP" : "instruction"}
              </span>
            )}
          </div>
          <span className="text-[11px] text-gray-600 break-words">
            {customDef?.instruction
              ? customDef.instruction.slice(0, 80) + (customDef.instruction.length > 80 ? "..." : "")
              : `Used in: ${nodes.join(", ")}`}
          </span>
        </div>
      );
    })}
  </div>
)}
```

- [ ] **Step 2: Commit (in marketplace repo)**

```bash
git add site/src/components/WorkflowDetail.tsx
git commit -m "feat: show custom skills with instruction/MCP badges in workflow detail"
```

---

### Task 12: Docs Site — Create custom skills guide

**Files:**
- Create: `packages/web/src/content/docs/skills/custom.md`
- Modify: `packages/web/src/content/docs/skills/index.md`

- [ ] **Step 1: Create the custom skills guide**

Create `packages/web/src/content/docs/skills/custom.md`:

```markdown
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

```markdown
---
name: code-standards
description: Team coding conventions for TypeScript
---

When writing or reviewing TypeScript code:
- Use camelCase for variables and functions
- Use PascalCase for types, interfaces, and classes
- Every public function needs at least one test
- Mock at boundaries (HTTP, DB), not internal functions
```

### Frontmatter Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Skill ID. Lowercase letters, numbers, hyphens. Must match directory name. |
| `description` | Yes | What this skill provides. |
| `mcp` | No | MCP server config (see below). |

## Instruction Skills

The simplest custom skill: the markdown body is injected into the prompt when a workflow node references this skill.

```yaml
# In your workflow:
nodes:
  review:
    name: Code Review
    instruction: Review the pull request for issues.
    skills: [code-standards]  # ← injects your SKILL.md content
```

Use instruction skills for:
- Coding standards and conventions
- Evaluation rubrics and scoring criteria
- Domain-specific knowledge
- Process guidelines

## MCP Skills

Add an `mcp` field to the frontmatter to declare an MCP server:

```markdown
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
```

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
    Authorization: Bearer ${API_KEY}
```

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
```

- [ ] **Step 2: Update skills/index.md**

Add a section to the bottom of `packages/web/src/content/docs/skills/index.md` (before any closing content):

```markdown
## Custom Skills

In addition to built-in skills, you can create custom instruction skills and MCP-backed skills. See the [Custom Skills guide](/skills/custom) for details on:

- Creating `SKILL.md` files with instruction content
- Declaring MCP server integrations
- Inline workflow skill definitions
- Multi-harness skill discovery
```

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/content/docs/skills/custom.md packages/web/src/content/docs/skills/index.md
git commit -m "docs: add custom skills guide to docs site"
```

---

### Task 13: Final integration test and build verification

**Files:**
- No new files

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run --reporter=dot`
Expected: All tests pass.

- [ ] **Step 2: Build core package**

Run: `npm run build --workspace=packages/core`
Expected: Clean build, no type errors.

- [ ] **Step 3: Build spec site**

Run: `npm run build --workspace=spec`
Expected: Clean build. All new/modified MDX pages compile.

- [ ] **Step 4: Build docs site**

Run: `npm run build --workspace=packages/web`
Expected: Clean build. New custom skills page compiles.

- [ ] **Step 5: Verify JSON schema export**

Check that the `workflowJsonSchema` export includes the `skills` property:

```bash
node -e "const { workflowJsonSchema } = await import('./packages/core/dist/schema.js'); console.log(JSON.stringify(workflowJsonSchema.properties.skills, null, 2))"
```

Expected: JSON output showing the skills property definition.

- [ ] **Step 6: Commit any remaining changes**

```bash
git status
# If anything needs committing:
git add -A
git commit -m "chore: final integration verification"
```

---

## Self-Review Checklist

### Spec Coverage

| Spec Section | Task(s) |
|-------------|---------|
| §2 Skill Object Evolution | Task 1 (types), Task 2 (schema), Task 6 (spec) |
| §3 Workflow-Level Skills | Task 1 (types), Task 2 (schema), Task 7 (spec) |
| §4 SKILL.md Format | Task 3 (custom-loader), Task 6 (spec), Task 12 (docs) |
| §5 Multi-Harness Discovery | Task 3 (custom-loader) |
| §6 Executor Changes | Task 4 (executor) |
| §7 Schema Validation | Task 2 (schema) |
| §8.1 Spec Site | Tasks 6, 7, 8 |
| §8.2 Core Library | Tasks 1-5 |
| §8.3 Marketplace | Tasks 9, 10, 11 |
| §8.5 Docs Site | Task 12 |
| §9 Testing Strategy | Tests in Tasks 2, 3, 4, 5 |
| §10 Backwards Compatibility | All tasks (additive changes only) |

### Not in scope (per spec §8.4, §8.6, §11)

- Cloud dashboard RunViewer changes (minimal — skill info already in workflow YAML)
- CLI `sweny skill list` / `sweny skill create` commands (future)
- GitHub Action changes (none needed)
- Harness-agnostic execution research (deferred, post-implementation)
