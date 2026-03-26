---
title: Workflow Authoring
description: How to build custom SWEny workflows — define nodes, wire edges with conditions, and run the DAG with skills.
---

A **workflow** is a named DAG of nodes. The executor walks the graph, running Claude at each node with the specified skills. Claude evaluates natural-language conditions on edges to decide where to go next — or stops if no outbound edge matches.

Built-in workflows (`triage`, `implement`) are ready to use out of the box. To build your own, install `@sweny-ai/core` and define a `Workflow`.

## Core types

```ts
import type { Workflow, Node, Edge } from "@sweny-ai/core";

interface Workflow {
  id: string;
  name: string;
  description: string;
  entry: string;              // id of the first node
  nodes: Record<string, Node>;
  edges: Edge[];
}

interface Node {
  name: string;
  instruction: string;        // what Claude does at this node
  skills: string[];            // which skill tools are available
  output?: JSONSchema;         // optional structured output schema
}

interface Edge {
  from: string;
  to: string;
  when?: string;               // natural language condition (Claude evaluates)
}
```

## Skills

Each node declares which **skills** Claude can use. A skill is a group of tools — for example, the `github` skill provides `github_search_code`, `github_get_issue`, `github_create_pr`, and more.

| Skill | Tools | Purpose |
|-------|-------|---------|
| `github` | 6 tools | Search code, manage issues and PRs |
| `linear` | 3 tools | Create, search, and update Linear issues |
| `sentry` | 3 tools | Query errors and issues from Sentry |
| `datadog` | 3 tools | Query logs, metrics, and monitors |
| `slack` | 2 tools | Send messages via webhook or bot |
| `notification` | 4 tools | Discord, Teams, email, webhooks |

Skills are configured through environment variables (e.g. `GITHUB_TOKEN`, `DD_API_KEY`). The executor resolves config automatically from `process.env`.

## Writing a workflow

```ts
import type { Workflow } from "@sweny-ai/core";

export const myWorkflow: Workflow = {
  id: "my-workflow",
  name: "My Workflow",
  description: "Investigate an issue and fix it",
  entry: "analyze",

  nodes: {
    analyze: {
      name: "Analyze Issue",
      instruction: `Read the issue details and understand what needs to change.
Use GitHub to check the code and Linear to fetch the ticket.`,
      skills: ["github", "linear"],
      output: {
        type: "object",
        properties: {
          summary: { type: "string" },
          risk: { type: "string", enum: ["low", "medium", "high"] },
        },
        required: ["summary", "risk"],
      },
    },
    implement: {
      name: "Implement Fix",
      instruction: "Create a branch, make the fix, and commit.",
      skills: ["github"],
    },
    notify: {
      name: "Notify Team",
      instruction: "Send a summary of what was done.",
      skills: ["slack", "notification"],
    },
    skip: {
      name: "Skip",
      instruction: "Log why this was skipped. No action needed.",
      skills: [],
    },
  },

  edges: [
    { from: "analyze", to: "implement", when: "Risk is low or medium" },
    { from: "analyze", to: "skip", when: "Risk is high or the issue is unclear" },
    { from: "implement", to: "notify" },
  ],
};
```

## Edge routing

Edges can be **unconditional** (no `when` — always taken) or **conditional** (Claude evaluates the `when` clause against the node's output).

When a node has multiple outbound edges with `when` conditions, Claude picks the best match. If no conditional edge matches and there's an unconditional edge, that one is taken. If nothing matches, the workflow ends at that node.

## Running a workflow

```ts
import { execute, createSkillMap, ClaudeClient } from "@sweny-ai/core";
import { github, linear, slack } from "@sweny-ai/core/skills";
import { myWorkflow } from "./my-workflow.js";

const skills = createSkillMap([github, linear, slack]);
const claude = new ClaudeClient({ apiKey: process.env.ANTHROPIC_API_KEY! });

const results = await execute(myWorkflow, {
  input: "Fix issue LIN-1234",
  skills,
  claude,
  observer: (event) => console.log(event.type, event),
});

// results: Record<string, NodeResult>
for (const [nodeId, result] of Object.entries(results)) {
  console.log(`${nodeId}: ${result.status}`);
}
```

## Observer (real-time events)

```ts
import type { Observer, ExecutionEvent } from "@sweny-ai/core";

const observer: Observer = (event: ExecutionEvent) => {
  switch (event.type) {
    case "workflow:start":
      console.log("Starting workflow");
      break;
    case "node:enter":
      console.log(`→ entering ${event.node}`);
      break;
    case "tool:call":
      console.log(`  calling ${event.tool}`);
      break;
    case "node:exit":
      console.log(`← ${event.node} [${event.result.status}]`);
      break;
    case "workflow:end":
      console.log("Workflow complete");
      break;
  }
};

const results = await execute(myWorkflow, { input, skills, claude, observer });
```

## Validation

```ts
import { validateWorkflow } from "@sweny-ai/core/schema";

const errors = validateWorkflow(myWorkflow);
// errors: WorkflowError[] — each has { code, message, nodeId? }
// codes: MISSING_ENTRY, UNKNOWN_TARGET, UNREACHABLE_NODE, UNKNOWN_SKILL
```

`validateWorkflow()` is browser-safe — Studio calls it continuously while you edit.

## Running from the CLI

```bash
sweny workflow run ./my-workflow.yml
```

The CLI streams live node output as the workflow executes. See [CLI Commands](/cli/) for details.

## Testing with MockClaude

`MockClaude` lets you test workflows without an API key:

```ts
import { describe, it, expect } from "vitest";
import { execute, createSkillMap } from "@sweny-ai/core";
import { MockClaude } from "@sweny-ai/core/testing";
import { github, linear } from "@sweny-ai/core/skills";
import { myWorkflow } from "./my-workflow.js";

describe("myWorkflow", () => {
  it("runs to completion with mock responses", async () => {
    const mock = new MockClaude({
      responses: {
        analyze: { status: "success", data: { summary: "Bug in auth", risk: "low" } },
        implement: { status: "success" },
        notify: { status: "success" },
      },
    });

    const results = await execute(myWorkflow, {
      input: "Fix auth bug",
      skills: createSkillMap([github, linear]),
      claude: mock,
    });

    expect(results.analyze.status).toBe("success");
    expect(results.implement.status).toBe("success");
  });
});
```
