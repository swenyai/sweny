# Task: Add provider and recipe authoring documentation

## Goal

Write two concise developer guides so contributors can write custom providers and recipes
without needing to read all the source code. These unlock the ecosystem flywheel.

## Files to create

### 1. `docs/provider-authoring.md`

A guide for writing a new observability or issue-tracking provider.

Structure:
1. **Overview** — what providers do, where they live (`packages/providers/src/`)
2. **Observability provider** — implement `ObservabilityProvider` interface from `types.ts`
   - Show the interface (copy it from `packages/providers/src/observability/types.ts`)
   - Walk through each method: `verifyAccess`, `queryLogs`, `aggregate`, `getAgentEnv`, `getPromptInstructions`
   - Show a minimal skeleton implementation
   - Show how to register in `index.ts`
3. **Issue-tracking provider** — implement `IssueTrackingProvider` interface from `packages/providers/src/issue-tracking/types.ts`
   - Same structure: show interface, walk methods, show skeleton, show index.ts registration
4. **Config schema pattern** — use zod, export `fooConfigSchema`, `FooConfig` type, `foo()` factory
5. **Testing** — mock `fetch` with `vi.spyOn(globalThis, "fetch").mockImplementation(...)`, test each method
6. **Adding to the action** — brief note pointing to `packages/action/src/main.ts` where providers are wired

Tone: concise, practical. Show code, not prose. Each section should be short enough to read in 2 minutes.

### 2. `docs/recipe-authoring.md`

A guide for writing a new recipe (workflow).

Structure:
1. **What is a recipe?** — a DAG of typed nodes, `Recipe<TConfig>` type
2. **Node types** — `learn` vs `act` phases (learn = read-only, act = side effects)
   - Read `packages/engine/src/runner-recipe.ts` to understand the phase system
3. **Writing a node** — show the node shape: `{ name, phase, run(ctx, registry) }`
   - `ctx` gives access to config and previous step results via `ctx.results`
   - `registry` gives access to providers
   - Return `{ status: "success" | "skipped" | "failed", data?, reason? }`
4. **Wiring a recipe** — `const myRecipe: Recipe<MyConfig> = { nodes: [...] }`
5. **Running it** — `runRecipe(myRecipe, config, registry, { logger })`
6. **Testing** — reference `packages/engine/src/recipes/implement/e2e.test.ts` as the pattern for e2e tests using file providers + mock coding agent

Tone: same as above — code-first, concise.

## Reading required before writing

Read these files to ground the docs in actual code:
- `packages/providers/src/observability/types.ts`
- `packages/providers/src/observability/datadog.ts` (example provider)
- `packages/providers/src/issue-tracking/types.ts`
- `packages/providers/src/issue-tracking/linear.ts` (example provider)
- `packages/engine/src/runner-recipe.ts` (recipe runner)
- `packages/engine/src/recipes/implement/index.ts` (example recipe)
- `packages/engine/src/recipes/implement/e2e.test.ts` (e2e test pattern)

## Existing docs to check first

Read `CONTRIBUTING.md` and `ARCHITECTURE.md` to avoid repeating what's already there.
The new docs should complement, not duplicate.

## Commit

After writing both files:
```
docs: add provider and recipe authoring guides
```

## Context

- Repo: `/Users/nate/src/swenyai/sweny`
- Docs should be accurate to the actual code — read the source before writing
- Do NOT create a `docs/` directory if it doesn't exist; check first with ls
- Keep each guide under ~200 lines — brevity is a feature
