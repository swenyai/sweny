---
title: Recipe Authoring
description: How to build custom SWEny recipes — define states, wire transitions, run the DAG, and test end-to-end.
---

A **recipe** is a named, typed DAG of states. The engine walks the graph, executing each state in turn, routing to the next state based on the outcome — or stopping if no route is defined.

Built-in recipes (`triage`, `implement`) live in `packages/engine/src/recipes/`. The full specification is in [`packages/engine/SPEC.md`](https://github.com/swenyai/sweny/blob/main/packages/engine/SPEC.md).

## Core types

```ts
// Pure-data definition — JSON-serializable, renderable, versionable
interface RecipeDefinition {
  id: string;
  version: string;        // semver
  name: string;
  description?: string;
  initial: string;        // id of the first state
  states: Record<string, StateDefinition>;
}

interface StateDefinition {
  phase: "learn" | "act" | "report";
  description?: string;
  critical?: boolean;     // failure aborts the whole recipe
  next?: string;          // default successor (success/skipped only)
  on?: Record<string, string>; // outcome/status → next state id; "end" terminates
}

// Complete wired recipe = definition + implementations
interface Recipe<TConfig> {
  definition: RecipeDefinition;
  implementations: StateImplementations<TConfig>;
}
```

## State phases

| Phase | Intent | Typical use |
|-------|--------|-------------|
| `learn` | Read-only — gather context | Fetch logs, verify credentials, query APIs |
| `act` | Side effects | Write code, commit, open PRs, create issues |
| `report` | Communicate results | Send Slack messages, write summaries |

Phase controls swimlane grouping in Studio and appears in execution logs. Failure semantics are controlled by `critical`, not phase.

## Writing a state

A state is a plain async function that receives `ctx` and returns a `StepResult`:

```ts
// packages/engine/src/nodes/my-node.ts
import type { WorkflowContext, StepResult } from "../types.js";
import type { MyRecipeConfig } from "../recipes/my-recipe/types.js";

export async function myNode(ctx: WorkflowContext<MyRecipeConfig>): Promise<StepResult> {
  const { config, logger, results, providers } = ctx;
  const tracker = providers.get<IssueTrackingProvider>("issueTracker");

  // Read a previous state's output
  const prev = results.get("some-earlier-state");
  if (!prev || prev.status !== "success") {
    return { status: "skipped", reason: "earlier state did not succeed" };
  }

  try {
    await tracker.addComment(prev.data!.issueId as string, "Processing started.");
    return { status: "success", data: { issueId: prev.data!.issueId } };
  } catch (err) {
    return { status: "failed", reason: String(err) };
  }
}
```

Set `data.outcome` to drive `on:` routing with custom keys:

```ts
return { status: "success", data: { outcome: "needs-review" } };
// Triggers: on: { "needs-review": "human-review-state" }
```

## Transition routing (priority order)

1. `result.data?.outcome` — explicit string outcome set by the implementation
2. `result.status` — `"success"`, `"skipped"`, or `"failed"`
3. `on["*"]` — wildcard fallback
4. `next` — default successor (success/skipped only)
5. Undefined → recipe terminates

The reserved target `"end"` stops the recipe successfully from any `on:` entry.

## Writing a definition

```ts
// packages/engine/src/recipes/my-recipe/definition.ts
import type { RecipeDefinition } from "../../types.js";

export const myRecipeDefinition: RecipeDefinition = {
  id: "my-recipe",
  version: "1.0.0",
  name: "My Recipe",
  initial: "verify-setup",
  states: {
    "verify-setup": {
      phase: "learn",
      critical: true,
      next: "do-work",
    },
    "do-work": {
      phase: "act",
      next: "notify",
      on: { failed: "notify" },
    },
    "notify": {
      phase: "report",
    },
  },
};
```

## Wiring the recipe

```ts
// packages/engine/src/recipes/my-recipe/index.ts
import { createRecipe } from "@sweny-ai/engine";
import { myRecipeDefinition } from "./definition.js";
import { verifySetup } from "./steps/verify-setup.js";
import { doWork } from "../../nodes/do-work.js";
import { sendNotification } from "../../nodes/notify.js";
import type { MyRecipeConfig } from "./types.js";

export const myRecipe = createRecipe<MyRecipeConfig>(myRecipeDefinition, {
  "verify-setup": verifySetup,
  "do-work":      doWork,
  "notify":       sendNotification,
});
```

`createRecipe()` validates that every state in the definition has an implementation and throws `DefinitionError` if not.

## Running a recipe

```ts
import { runRecipe, createProviderRegistry } from "@sweny-ai/engine";

const registry = createProviderRegistry();
registry.set("issueTracker", linear({ apiKey: process.env.LINEAR_KEY }));
registry.set("sourceControl", github({ token: process.env.GH_TOKEN }));

const result = await runRecipe(myRecipe, config, registry, {
  observer: myObserver,
});

console.log(result.status); // "completed" | "failed" | "partial"
console.log(result.steps);  // per-state results in execution order
```

## Config type

```ts
import { z } from "zod";

export const myRecipeConfigSchema = z.object({
  issueIdentifier: z.string(),
  repository:      z.string(),
  dryRun:          z.boolean().default(false),
});

export type MyRecipeConfig = z.infer<typeof myRecipeConfigSchema>;
```

## Observer (real-time events)

```ts
import { CollectingObserver, CallbackObserver, composeObservers } from "@sweny-ai/engine";

const collector = new CollectingObserver();
const streamer  = new CallbackObserver((event) => ws.send(JSON.stringify(event)));
const combined  = composeObservers(collector, streamer);

await runRecipe(myRecipe, config, registry, { observer: combined });
```

Event types: `recipe:start`, `state:enter`, `state:exit`, `recipe:end`.

## Validation

```ts
import { validateDefinition } from "@sweny-ai/engine";

const errors = validateDefinition(myDefinition);
// checks: initial exists, all next/on targets exist or are "end"
```

`validateDefinition()` is browser-safe — Studio calls it continuously while you edit.

## Testing

```ts
import { runRecipe, createProviderRegistry } from "@sweny-ai/engine";
import { fileIssueTracking } from "@sweny-ai/providers/issue-tracking";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    execSync: (cmd: string, opts?: unknown) => {
      if (typeof cmd === "string" && cmd.startsWith("git"))
        throw new Error("mocked: no git");
      return actual.execSync(cmd as string, opts as never);
    },
  };
});

it("runs to completion with file providers", async () => {
  const tracker = fileIssueTracking({ outputDir: tmpDir, logger: silentLogger });
  await tracker.verifyAccess();
  const issue = await tracker.createIssue({ title: "Test", projectId: "LOCAL" });

  const registry = createProviderRegistry();
  registry.set("issueTracker", tracker);

  const result = await runRecipe(myRecipe, { issueIdentifier: issue.identifier }, registry, {
    logger: silentLogger,
  });

  expect(["completed", "partial"]).toContain(result.status);
});
```

Key points:
- Call `tracker.verifyAccess()` before `createIssue()` — it initialises output directories
- File providers return `LOCAL-N` identifiers — capture and pass them in config
- Mock `node:child_process` so the file source control doesn't detect the monorepo's git repo
