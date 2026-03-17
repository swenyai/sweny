---
title: Workflow Authoring
description: How to build custom SWEny workflows — define steps, wire transitions, run the DAG, and test end-to-end.
---

A **workflow** is a named DAG of steps. The engine walks the graph, executing each step in turn, routing to the next step based on the outcome — or stopping if no route is defined.

Built-in workflows (`triage`, `implement`) are ready to use out of the box. To build your own, install `@sweny-ai/engine` and define a `WorkflowDefinition` + step implementations.

## Core types

```ts
import type {
  WorkflowDefinition,
  StepDefinition,
} from "@sweny-ai/engine";

// Pure-data definition — JSON-serializable, renderable, versionable
interface WorkflowDefinition {
  name: string;
  initial: string;           // id of the first step
  steps: Record<string, StepDefinition>;
}

interface StepDefinition {
  phase: "learn" | "act" | "report";
  description?: string;
  critical?: boolean;        // failure aborts the whole workflow
  type?: string;             // built-in step type (e.g. "sweny/investigate")
  timeout?: number;          // ms — step is aborted if it exceeds this
  transitions?: Array<{
    on: string;              // outcome string or "*" wildcard
    target: string;          // step id, or "end" to terminate
  }>;
}
```

## Step phases

| Phase | Intent | Typical use |
|-------|--------|-------------|
| `learn` | Read-only — gather context | Fetch logs, verify credentials, query APIs |
| `act` | Side effects | Write code, commit, open PRs, create issues |
| `report` | Communicate results | Send Slack messages, write summaries |

Phase controls swimlane grouping in Studio and appears in execution logs. Failure semantics are controlled by `critical`, not phase.

## Writing a step

A step is a plain async function that receives `ctx` and returns a `StepResult`:

```ts
// src/workflows/my-workflow/steps/my-step.ts
import type { WorkflowContext, StepResult } from "@sweny-ai/engine";
import type { IssueTrackingProvider } from "@sweny-ai/providers/issue-tracking";
import type { MyWorkflowConfig } from "../types.js";

export async function myStep(ctx: WorkflowContext<MyWorkflowConfig>): Promise<StepResult> {
  const { config, logger, results, providers } = ctx;
  const tracker = providers.get<IssueTrackingProvider>("issueTracker");

  // Read a previous step's output
  const prev = results.get("some-earlier-step");
  if (!prev || prev.status !== "success") {
    return { status: "skipped", reason: "earlier step did not succeed" };
  }

  try {
    await tracker.addComment(prev.data!.issueId as string, "Processing started.");
    return { status: "success", data: { issueId: prev.data!.issueId } };
  } catch (err) {
    return { status: "failed", reason: String(err) };
  }
}
```

Set `data.outcome` to drive transition routing with custom keys:

```ts
return { status: "success", data: { outcome: "needs-review" } };
// Triggers: transitions: [{ on: "needs-review", target: "human-review-step" }]
```

## Transition routing (priority order)

1. `result.data?.outcome` — explicit string outcome set by the implementation
2. `result.status` — `"success"`, `"skipped"`, or `"failed"`
3. `on: "*"` — wildcard fallback
4. Undefined → workflow terminates

The reserved target `"end"` stops the workflow successfully from any transition.

## Writing a definition

```ts
// src/workflows/my-workflow/definition.ts
import type { WorkflowDefinition } from "@sweny-ai/engine";

export const myWorkflowDefinition: WorkflowDefinition = {
  name: "my-workflow",
  initial: "verify-setup",
  steps: {
    "verify-setup": {
      phase: "learn",
      critical: true,
      transitions: [
        { on: "done", target: "do-work" },
      ],
    },
    "do-work": {
      phase: "act",
      transitions: [
        { on: "done",   target: "notify" },
        { on: "failed", target: "notify" },
      ],
    },
    "notify": {
      phase: "report",
    },
  },
};
```

## Wiring the workflow

```ts
// src/workflows/my-workflow/index.ts
import { createWorkflow } from "@sweny-ai/engine";
import { myWorkflowDefinition } from "./definition.js";
import { verifySetup } from "./steps/verify-setup.js";
import { doWork } from "./steps/do-work.js";
import { sendNotification } from "./steps/notify.js";
import type { MyWorkflowConfig } from "./types.js";

export const myWorkflow = createWorkflow<MyWorkflowConfig>(myWorkflowDefinition, {
  "verify-setup": verifySetup,
  "do-work":      doWork,
  "notify":       sendNotification,
});
```

`createWorkflow()` validates that every step in the definition has an implementation and throws if not.

## Running a workflow

```ts
import { runWorkflow, createProviderRegistry } from "@sweny-ai/engine";
import { linear } from "@sweny-ai/providers/issue-tracking";
import { github } from "@sweny-ai/providers/source-control";

const registry = createProviderRegistry();
registry.set("issueTracker", linear({ apiKey: process.env.LINEAR_KEY }));
registry.set("sourceControl", github({ token: process.env.GH_TOKEN, owner: "my-org", repo: "my-repo" }));

const result = await runWorkflow(myWorkflow, config, registry, {
  observer: myObserver,
});

console.log(result.status); // "completed" | "failed" | "partial"
console.log(result.steps);  // per-step results in execution order
```

## Config type

```ts
import { z } from "zod";

export const myWorkflowConfigSchema = z.object({
  issueIdentifier: z.string(),
  repository:      z.string(),
  dryRun:          z.boolean().default(false),
});

export type MyWorkflowConfig = z.infer<typeof myWorkflowConfigSchema>;
```

## Observer (real-time events)

```ts
import type { RunObserver } from "@sweny-ai/engine";

const observer: RunObserver = {
  onEvent(event) {
    switch (event.type) {
      case "workflow:start":
        console.log(`Starting: ${event.workflowName}`);
        break;
      case "step:enter":
        console.log(`→ ${event.stepId}`);
        break;
      case "step:exit":
        console.log(`✓ ${event.stepId} [${event.result.status}]`);
        break;
      case "workflow:end":
        console.log(`Done: ${event.status}`);
        break;
    }
  }
};

await runWorkflow(myWorkflow, config, registry, { observer });
```

You can also use the built-in helpers:

```ts
import { CollectingObserver, CallbackObserver, composeObservers } from "@sweny-ai/engine";

const collector = new CollectingObserver();
const streamer  = new CallbackObserver((event) => ws.send(JSON.stringify(event)));
const combined  = composeObservers(collector, streamer);
```

## Validation

```ts
import { validateWorkflow } from "@sweny-ai/engine";

const errors = validateWorkflow(myDefinition);
// errors: WorkflowDefinitionError[] — each has { code, message, stateId? }
// codes: MISSING_INITIAL, UNKNOWN_INITIAL, UNKNOWN_TRANSITION_TARGET, UNREACHABLE_STEP
```

`validateWorkflow()` is browser-safe — Studio calls it continuously while you edit.

## Running a YAML workflow from the CLI

You can run custom workflows without writing any TypeScript using the CLI:

```bash
sweny workflow run ./my-workflow.yml
```

The CLI streams live step output as the workflow executes. See [CLI Commands](/cli/) for details.

## Testing

File providers write outputs to disk and don't require real credentials — perfect for testing workflows without connecting to external services:

```ts
import { describe, it, expect } from "vitest";
import { runWorkflow, createProviderRegistry } from "@sweny-ai/engine";
import { fileIssueTracking } from "@sweny-ai/providers/issue-tracking";
import { myWorkflow } from "./index.js";

describe("myWorkflow", () => {
  it("runs to completion with file providers", async () => {
    const tmpDir = "/tmp/sweny-test";
    const tracker = fileIssueTracking({ outputDir: tmpDir });
    await tracker.verifyAccess();

    const issue = await tracker.createIssue({ title: "Test issue", projectId: "LOCAL" });

    const registry = createProviderRegistry();
    registry.set("issueTracker", tracker);

    const result = await runWorkflow(
      myWorkflow,
      { issueIdentifier: issue.identifier, repository: "my-org/my-repo" },
      registry,
    );

    expect(result.status).toBe("completed");
  });
});
```

File providers return `LOCAL-N` identifiers. Call `verifyAccess()` before `createIssue()` to ensure the output directory is initialised.
