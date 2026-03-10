# Recipe Authoring Guide

A **recipe** is a named, typed DAG of states. The engine walks the graph, executing each state in turn, and uses explicit `on:` transitions (or a `next` default) to decide what runs next.

Built-in recipes live in `packages/engine/src/recipes/`. The runner is in `packages/engine/src/runner-recipe.ts`. For the full specification, see [`packages/engine/SPEC.md`](../packages/engine/SPEC.md).

---

## Core types

```ts
// Pure-data definition — JSON-serializable, renderable, versionable
interface RecipeDefinition {
  id: string;
  version: string;       // semver
  name: string;
  description?: string;
  initial: string;       // id of the first state
  states: Record<string, StateDefinition>;
}

interface StateDefinition {
  phase: "learn" | "act" | "report";
  description?: string;
  critical?: boolean;    // failure aborts the whole recipe
  next?: string;         // default successor (success/skipped only)
  on?: Record<string, string>; // outcome/status → next state id; "end" stops
}

// Complete wired recipe = definition + implementations
interface Recipe<TConfig> {
  definition: RecipeDefinition;
  implementations: StateImplementations<TConfig>;
}

interface StepResult {
  status: "success" | "skipped" | "failed";
  data?: Record<string, unknown>; // downstream states read this via ctx.results
  reason?: string;
}

interface WorkflowContext<TConfig> {
  config: TConfig;
  logger: Logger;
  results: Map<string, StepResult>; // keyed by state id
  providers: ProviderRegistry;
}
```

---

## State phases

| Phase | Intent | Typical use |
|-------|--------|-------------|
| `learn` | Read-only — gather context | Fetch logs, verify credentials, query APIs |
| `act` | Side effects | Write code, commit, open PRs, create issues |
| `report` | Communicate results | Send Slack messages, write summaries |

Phase controls swimlane grouping in the Studio and appears in logs. Failure semantics are controlled by `critical`, not phase.

---

## Writing a state

A state is a plain async function that receives `ctx` and returns a `StepResult`. Keep states small and focused — they are reused across recipes.

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

  const issueId = prev.data?.issueId as string;

  try {
    await tracker.addComment(issueId, "Processing started.");
    return { status: "success", data: { issueId } };
  } catch (err) {
    return { status: "failed", reason: String(err) };
  }
}
```

### Outcome-based routing

Set `data.outcome` to drive `on:` routing beyond the built-in `success`/`skipped`/`failed` keys:

```ts
return { status: "success", data: { outcome: "needs-review" } };
// Triggers: on: { "needs-review": "human-review-state" }
```

---

## Writing a definition

Definitions are pure data — no functions. They can be stored as JSON, imported into the Studio, and validated independently.

```ts
// packages/engine/src/recipes/my-recipe/definition.ts
import type { RecipeDefinition } from "../../types.js";

export const myRecipeDefinition: RecipeDefinition = {
  id: "my-recipe",
  version: "1.0.0",
  name: "My Recipe",
  description: "Does the thing and notifies on completion",
  initial: "verify-setup",
  states: {
    "verify-setup": {
      phase: "learn",
      description: "Check provider connectivity",
      critical: true,
      next: "do-work",
    },
    "do-work": {
      phase: "act",
      description: "Perform the main operation",
      next: "notify",
      on: { failed: "notify" },
    },
    "notify": {
      phase: "report",
      description: "Send completion notification",
    },
  },
};
```

### Transition routing (priority order)

1. `result.data?.outcome` — explicit string outcome set by the implementation
2. `result.status` — `"success"`, `"skipped"`, or `"failed"`
3. `on["*"]` — wildcard fallback
4. `next` — default successor (success/skipped only; unhandled failures stop the recipe)
5. Undefined → recipe terminates

The reserved target `"end"` stops the recipe successfully from any `on:` entry.

---

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

`createRecipe()` validates the definition and confirms every state has an implementation. It throws a `DefinitionError` if either check fails.

---

## Running a recipe

```ts
import { runRecipe, createProviderRegistry } from "@sweny-ai/engine";

const registry = createProviderRegistry();
registry.set("issueTracker", linear({ apiKey: process.env.LINEAR_KEY }));
registry.set("sourceControl", github({ token: process.env.GH_TOKEN }));

const result = await runRecipe(myRecipe, config, registry, {
  logger: myLogger,

  // Called before each state — return false to skip it
  beforeStep: async (meta) => {
    console.log(`▶ ${meta.phase}/${meta.id}`);
  },

  // Called after each state (including skipped and cached)
  afterStep: async (meta, result) => {
    console.log(`  ${meta.id}: ${result.status}`);
  },

  // Optional: replay prior successful states from cache
  cache: myStepCache,

  // Optional: receive real-time ExecutionEvents
  observer: myObserver,
});

console.log(result.status); // "completed" | "failed" | "partial"
console.log(result.steps);  // per-state results in execution order
```

---

## Config type

Define a Zod schema for your recipe's config and infer the TypeScript type. The type flows through `WorkflowContext<TConfig>` so every state sees the correct type for `ctx.config` without casts.

```ts
// packages/engine/src/recipes/my-recipe/types.ts
import { z } from "zod";

export const myRecipeConfigSchema = z.object({
  issueIdentifier: z.string(),
  repository:      z.string(),
  dryRun:          z.boolean().default(false),
});

export type MyRecipeConfig = z.infer<typeof myRecipeConfigSchema>;
```

---

## Observer (real-time events)

Stream execution progress to any destination — the Studio, a WebSocket endpoint, a log sink.

```ts
import { CollectingObserver, CallbackObserver, composeObservers } from "@sweny-ai/engine";

// Collect all events for inspection after the run
const collector = new CollectingObserver();
await runRecipe(myRecipe, config, registry, { observer: collector });
console.log(collector.events); // ExecutionEvent[]

// Stream events to a WebSocket
const streamer = new CallbackObserver((event) => ws.send(JSON.stringify(event)));

// Multiplex multiple observers
const combined = composeObservers(collector, streamer);
```

Event types: `recipe:start`, `state:enter`, `state:exit` (includes result + cached flag), `recipe:end`.

---

## Validation

Validate a definition independently — useful for CI checks and the Studio editor:

```ts
import { validateDefinition } from "@sweny-ai/engine";

const errors = validateDefinition(myDefinition);
if (errors.length > 0) {
  console.error(errors); // DefinitionError[]
}
```

`validateDefinition()` is pure (no Node.js deps) and browser-safe. It checks:
- `initial` exists in `states`
- All `next` and `on` targets exist in `states` or are `"end"`

---

## Testing (e2e pattern)

The canonical example is `packages/engine/src/recipes/implement/e2e.test.ts`.

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import { runRecipe, createProviderRegistry } from "@sweny-ai/engine";
import { fileIssueTracking } from "@sweny-ai/providers/issue-tracking";
import { myRecipe } from "./index.js";

// Prevent git detection from finding the monorepo
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    execSync: (cmd: string, opts?: unknown) => {
      if (typeof cmd === "string" && cmd.startsWith("git"))
        throw new Error("mocked: no git");
      return actual.execSync(
        cmd as string,
        opts as Parameters<typeof actual.execSync>[1],
      );
    },
  };
});

const silentLogger = {
  info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(),
};

describe("my-recipe e2e", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "my-recipe-"));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("runs to completion with file providers", async () => {
    const tracker = fileIssueTracking({ outputDir: tmpDir, logger: silentLogger });
    await tracker.verifyAccess(); // creates output dirs
    const issue = await tracker.createIssue({ title: "Test issue", projectId: "LOCAL" });

    const registry = createProviderRegistry();
    registry.set("issueTracker", tracker);

    const config = {
      issueIdentifier: issue.identifier, // file provider uses LOCAL-N identifiers
      repository: "org/repo",
      dryRun: true,
    };

    const result = await runRecipe(myRecipe, config, registry, {
      logger: silentLogger,
    });

    expect(["completed", "partial"]).toContain(result.status);

    const step = result.steps.find((s) => s.name === "verify-setup");
    expect(step?.result.status).toBe("success");
  });
});
```

Key points:
- Call `tracker.verifyAccess()` before `createIssue()` — it initializes output directories.
- File providers use `LOCAL-N` identifiers — capture the returned identifier and pass it in config.
- Mock `node:child_process` at the top of the test file (Vitest hoists `vi.mock`).
- The mock coding agent (`packages/providers/src/coding-agent/mock.ts`) is a useful template for any agent dependency.
