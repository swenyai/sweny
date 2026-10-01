---
title: Test a workflow without a model
description: Catch missing fixtures and wrong routes before running a workflow with a live agent.
---

Use `MockHarness` to run the real executor with scripted node results. You can
check routing, preconditions, and evaluations without an API key or model call.

```ts
import assert from "node:assert/strict";
import { execute, type Workflow } from "@sweny-ai/core";
import { MockHarness } from "@sweny-ai/core/testing";

const workflow: Workflow = {
  id: "review",
  name: "Review",
  description: "Check a scripted finding",
  entry: "inspect",
  nodes: {
    inspect: { name: "Inspect", instruction: "Inspect the repository", skills: [] },
  },
  edges: [],
};

const harness = new MockHarness({
  strict: true,
  responses: { inspect: { data: { finding: "Missing timeout" } } },
});

const run = await execute(workflow, {}, {
  harness,
  skills: new Map(),
  env: {},
  offline: true,
});

assert.equal(run.results.get("inspect")?.status, "success");
assert.equal(run.results.get("inspect")?.data.finding, "Missing timeout");
assert.deepEqual(harness.executedNodes, ["inspect"]);
```

## Catch incomplete fixtures

With `strict: true`, a missing node response or an unavailable scripted tool
returns a failed result naming the problem. `fail_soft` cannot turn these
fixture errors into success. All scripted tool names are checked before any
handler runs for that attempt.

The executor supplies the node ID on every attempt. Duplicate instructions,
workflow rules, and retry feedback therefore select the same node fixture.
Each retry reuses that node's response. For a manual `harness.run()` call,
pass `nodeId`, or supply `workflow` to the constructor and use an exact, unique
instruction. Strict mode refuses ambiguous instructions instead of guessing.

Without `strict`, older manual callers retain instruction and sequential
matching. `MockClaude` remains an alias for `MockHarness`.

## Tools still execute their handlers

Scripted `toolCalls` invoke the handlers supplied to the executor. Strict mode
checks fixtures; it does **not** isolate file writes or network requests. Use
in-memory tool handlers when a test must have no external effects.

The example above supplies no skills or tool calls. `offline: true` also
prevents remote source resolution; it does not sandbox a custom tool handler.
For conditional branches, supply `routes: { sourceNodeId: "targetNodeId" }`
and assert the executed nodes as well as the final result. Checking only a
successful final status can miss the wrong branch or an incomplete fixture.
