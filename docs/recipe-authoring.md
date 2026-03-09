# Recipe Authoring Guide

A **recipe** is a named, typed DAG of nodes. The engine walks the graph,
executing each node in turn, and uses explicit `on:` transitions (or
declaration order as a fallback) to decide what runs next.

Built-in recipes live in `packages/engine/src/recipes/`. The runner is in
`packages/engine/src/runner-recipe.ts`.

---

## Core types (`packages/engine/src/types.ts`)

```ts
interface Recipe<TConfig = unknown> {
  name: string;
  description?: string;
  start: string;           // id of the first node
  nodes: RecipeStep<TConfig>[];
}

interface RecipeStep<TConfig = unknown> {
  id: string;
  phase: "learn" | "act" | "report";
  run: (ctx: WorkflowContext<TConfig>) => Promise<StepResult>;
  on?: Record<string, string>;   // outcome/status → next node id; "end" stops the recipe
  critical?: boolean;            // true → failure aborts the whole recipe
}

interface StepResult {
  status: "success" | "skipped" | "failed";
  data?: Record<string, unknown>;  // downstream nodes read this via ctx.results
  reason?: string;
}

interface WorkflowContext<TConfig = unknown> {
  config: TConfig;
  logger: Logger;
  results: Map<string, StepResult>;   // keyed by node id
  providers: ProviderRegistry;
}
```

---

## Node phases

| Phase | Semantics |
|---|---|
| `learn` | Read-only — fetch data, verify credentials. Failures here usually abort. |
| `act` | Side effects — write code, commit, open PRs. |
| `report` | Notifications, summaries. Runs after act, failures are non-critical. |

Phase is advisory — the runner logs it and uses it in output. Failure semantics
are controlled by `critical`, not the phase.

---

## Writing a node

A node is a plain function that receives `ctx` and returns a `StepResult`.
Keep nodes small and focused — they are reused across recipes.

```ts
// packages/engine/src/nodes/my-node.ts
import type { WorkflowContext, StepResult } from "../types.js";
import type { MyRecipeConfig } from "../recipes/my-recipe/types.js";

export async function myNode(ctx: WorkflowContext<MyRecipeConfig>): Promise<StepResult> {
  const { config, logger, results, providers } = ctx;

  // Access a provider
  const tracker = providers.get<IssueTrackingProvider>("issueTracker");

  // Read a previous step's output
  const prevData = results.get("some-earlier-node");
  if (!prevData || prevData.status !== "success") {
    return { status: "skipped", reason: "earlier node did not succeed" };
  }

  const issueId = prevData.data?.issueId as string;

  try {
    await tracker.addComment(issueId, "Processing started.");
    return { status: "success", data: { issueId } };
  } catch (err) {
    // Throwing also works — the runner catches and records status: "failed"
    return { status: "failed", reason: String(err) };
  }
}
```

Set `data.outcome` (a string) to drive `on:` routing beyond the default
`success`/`skipped`/`failed` keys:

```ts
return { status: "success", data: { outcome: "needs-review" } };
// triggers on: { "needs-review": "human-review-node" } if present
```

---

## Wiring a recipe

```ts
// packages/engine/src/recipes/my-recipe/index.ts
import type { Recipe } from "../../types.js";
import type { MyRecipeConfig } from "./types.js";
import { verifySetup } from "./steps/verify-setup.js";
import { doWork } from "../../nodes/do-work.js";
import { sendNotification } from "../../nodes/notify.js";

export const myRecipe: Recipe<MyRecipeConfig> = {
  name: "my-recipe",
  description: "Does the thing and notifies on completion",
  start: "verify-setup",
  nodes: [
    { id: "verify-setup", phase: "learn", run: verifySetup, critical: true },
    { id: "do-work",      phase: "act",   run: doWork, on: { failed: "notify" } },
    { id: "notify",       phase: "report", run: sendNotification },
  ],
};
```

Routing rules:
- **Declaration order** is the default — nodes run top-to-bottom unless `on:` overrides it.
- A `failed` node with no `on.failed` stops the recipe (`status: "partial"`).
- A `critical` node that fails sets `status: "failed"` and stops immediately.
- `on: { failed: "notify" }` routes failures to `notify` instead of stopping.

---

## Running a recipe

```ts
import { runRecipe, createProviderRegistry } from "@sweny-ai/engine";

const registry = createProviderRegistry();
registry.set("issueTracker", linear({ apiKey: process.env.LINEAR_KEY }));
registry.set("sourceControl", github({ token: process.env.GH_TOKEN }));

const result = await runRecipe(myRecipe, config, registry, {
  logger: myLogger,
  beforeStep: async (meta, ctx) => {
    console.log(`starting ${meta.phase}/${meta.id}`);
    // return false to skip this node
  },
});

console.log(result.status);  // "completed" | "failed" | "partial"
console.log(result.steps);   // per-node results in execution order
```

`RunOptions` also accepts a `cache` for step-level replay — see the CLI's
`--no-cache` flag for context.

---

## Config type

Define a Zod schema for your recipe's config and infer the TypeScript type:

```ts
// packages/engine/src/recipes/my-recipe/types.ts
import { z } from "zod";

export const myRecipeConfigSchema = z.object({
  issueIdentifier: z.string(),
  repository: z.string(),
  dryRun: z.boolean().default(false),
});

export type MyRecipeConfig = z.infer<typeof myRecipeConfigSchema>;
```

`TConfig` flows through `WorkflowContext<TConfig>` so every node sees the
correct type for `ctx.config` without casts.

---

## Testing (e2e pattern)

The canonical example is
`packages/engine/src/recipes/implement/e2e.test.ts`. The pattern:

1. Spin up a temp directory with `fs.mkdtempSync`.
2. Seed required state using file providers (`fileIssueTracking`, `fileSourceControl`).
3. Mock `node:child_process` to prevent git detection from finding the monorepo.
4. Build a `ProviderRegistry` with file providers + a mock coding agent.
5. Call `runRecipe(myRecipe, config, registry, { logger: silentLogger })`.
6. Assert per-step statuses via `result.steps.find(s => s.name === "node-id")`.

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
      if (typeof cmd === "string" && cmd.startsWith("git")) throw new Error("mocked: no git");
      return actual.execSync(cmd as string, opts as Parameters<typeof actual.execSync>[1]);
    },
  };
});

const silentLogger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };

describe("my-recipe e2e", () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "my-recipe-")); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it("runs to completion with file providers", async () => {
    const tracker = fileIssueTracking({ outputDir: tmpDir, logger: silentLogger });
    await tracker.verifyAccess();
    const issue = await tracker.createIssue({ title: "Test issue", projectId: "LOCAL" });

    const registry = createProviderRegistry();
    registry.set("issueTracker", tracker);

    const config = { issueIdentifier: issue.identifier, repository: "org/repo", dryRun: true };
    const result = await runRecipe(myRecipe, config, registry, { logger: silentLogger });

    expect(["completed", "partial"]).toContain(result.status);
    const step = result.steps.find(s => s.name === "verify-setup");
    expect(step?.result.status).toBe("success");
  });
});
```

Key points:
- Call `tracker.verifyAccess()` before `createIssue()` — it initialises the output dirs.
- File issue tracker uses `LOCAL-N` identifiers; capture the returned identifier and pass it in config.
- Mock `node:child_process` at the top of the test file (Vitest hoists `vi.mock`).
- The mock coding agent in the implement tests (`makeMockAgent`) is a useful template for any agent dependency.
