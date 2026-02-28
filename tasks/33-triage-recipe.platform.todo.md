# Extract Triage as an Engine Recipe

## Context
The triage workflow currently lives in `@sweny/action` as hardcoded phases (`investigate.ts`, `implement.ts`, `notify.ts`). This task extracts it into a `Workflow` definition using the engine from task 32, making triage the first "recipe" on the platform.

After this task:
- `@sweny/engine` exports the triage recipe
- `@sweny/action` becomes a thin GitHub Action wrapper that parses inputs, creates providers, and calls `runWorkflow(triageWorkflow, ...)`
- The triage logic is reusable by cloud worker, CLI, or any other entry point

## Dependencies
- Task 32 (engine package) must be complete

## Files to Create

### `packages/engine/src/recipes/triage/types.ts`
Triage-specific config and result types extracted from `packages/action/src/config.ts`:

```typescript
export interface TriageConfig {
  // Investigation parameters
  timeRange: string;
  severityFocus: string;
  serviceFilter: string;
  investigationDepth: string;
  maxInvestigateTurns: number;
  maxImplementTurns: number;
  serviceMapPath: string;

  // Issue tracker settings
  projectId: string;           // e.g., Linear team ID
  bugLabelId: string;
  triageLabelId: string;
  stateBacklog: string;
  stateInProgress: string;
  statePeerReview: string;

  // Source control context
  repository: string;          // "owner/repo"

  // Behavior
  dryRun: boolean;
  noveltyMode: boolean;
  issueOverride: string;       // specific issue to work on
  additionalInstructions: string;

  // Coding agent auth (passed through as env vars)
  agentEnv: Record<string, string>;
}

export interface InvestigationResult {
  issuesFound: boolean;
  bestCandidate: boolean;
  recommendation: string;
  existingIssue: string;
  targetRepo: string;
  shouldImplement: boolean;
}

export interface ImplementResult {
  issueIdentifier: string;
  issueUrl: string;
  prUrl: string;
  prNumber: number;
  skipped: boolean;
  skipReason?: string;
}
```

### `packages/engine/src/recipes/triage/steps/`
Break the monolithic phases into discrete workflow steps. Each is a function returning `StepResult`:

1. **`verify-access.ts`** — Verify observability + issue tracker access (from investigate.ts lines 25-30)
2. **`build-context.ts`** — Build known issues context from Linear + GitHub PRs (from investigate.ts `buildKnownIssuesContext`)
3. **`investigate.ts`** — Run Claude coding agent with investigation prompt, parse results (from investigate.ts core logic)
4. **`novelty-gate.ts`** — Check recommendation: skip / +1 existing / implement (from implement.ts lines 34-66)
5. **`create-issue.ts`** — Extract title, get-or-create issue in tracker (from implement.ts lines 68-147)
6. **`cross-repo-check.ts`** — Dispatch to another repo if needed (from implement.ts lines 149-189)
7. **`implement-fix.ts`** — Create branch, run Claude, check for changes, push (from implement.ts lines 191-347)
8. **`create-pr.ts`** — Generate PR description, create PR, link to issue (from implement.ts lines 349-415)
9. **`notify.ts`** — Build summary, send via notification provider (from notify.ts)

Each step reads prior results from `ctx.results.get("step-name")` and writes its own results to `StepResult.data`.

### `packages/engine/src/recipes/triage/prompts.ts`
Move `buildInvestigationPrompt`, `buildImplementPrompt`, `buildPrDescriptionPrompt` here (from investigate.ts and implement.ts). These are the prompt templates — keep them mostly as-is but parameterized via `TriageConfig` instead of `ActionConfig`.

### `packages/engine/src/recipes/triage/index.ts`
Assembles and exports the triage workflow:

```typescript
import type { Workflow } from "../../types.js";
import type { TriageConfig } from "./types.js";

export const triageWorkflow: Workflow<TriageConfig> = {
  name: "triage",
  description: "Investigate production issues, implement fixes, and report results",
  steps: [
    { name: "verify-access", phase: "learn", run: verifyAccess },
    { name: "build-context", phase: "learn", run: buildContext },
    { name: "investigate", phase: "learn", run: investigate },
    { name: "novelty-gate", phase: "act", run: noveltyGate },
    { name: "create-issue", phase: "act", run: createIssue },
    { name: "cross-repo-check", phase: "act", run: crossRepoCheck },
    { name: "implement-fix", phase: "act", run: implementFix },
    { name: "create-pr", phase: "act", run: createPr },
    { name: "notify", phase: "report", run: sendNotification },
  ],
};
```

Also export types:
```typescript
export type { TriageConfig, InvestigationResult, ImplementResult } from "./types.js";
```

### `packages/engine/src/index.ts`
Add recipe exports:
```typescript
export { triageWorkflow } from "./recipes/triage/index.js";
export type { TriageConfig, InvestigationResult, ImplementResult } from "./recipes/triage/index.js";
```

## Files to Modify

### `packages/action/src/main.ts`
Rewrite to use engine:

```typescript
import { runWorkflow, triageWorkflow, createProviderRegistry } from "@sweny/engine";
import { parseInputs } from "./config.js";
import { createProviders } from "./providers/index.js";

async function run(): Promise<void> {
  const config = parseInputs();
  const providers = createProviders(config);

  // Map ActionConfig → TriageConfig
  const triageConfig = mapToTriageConfig(config);

  const result = await runWorkflow(triageWorkflow, triageConfig, providers, {
    logger: actionsLogger,
    beforeStep: (step) => { core.startGroup(`${step.phase}: ${step.name}`); },
    afterStep: (step) => { core.endGroup(); },
  });

  // Set outputs from step results
  setGitHubOutputs(result);
}
```

### `packages/action/src/providers/index.ts`
Update `createProviders` to return a `ProviderRegistry` instead of the typed `Providers` interface. Register providers by role key:
- `"observability"` → ObservabilityProvider
- `"issueTracker"` → IssueTrackingProvider
- `"sourceControl"` → SourceControlProvider
- `"notification"` → NotificationProvider
- `"codingAgent"` → CodingAgent

### `packages/action/src/phases/` — DELETE
Remove `investigate.ts`, `implement.ts`, `notify.ts` — logic has moved to engine recipes.

### `packages/action/package.json`
Add dependency on `@sweny/engine` (workspace).

## Key Design Decisions

1. **Steps read from `ctx.results`** — e.g., `implement-fix` reads `ctx.results.get("investigate")?.data` for the `InvestigationResult`. This is the inter-step communication mechanism.

2. **`skipPhase("act")` from novelty-gate** — When recommendation is "skip", the novelty-gate step calls `ctx.skipPhase("act")` so remaining act steps are skipped, but report still runs.

3. **Provider access is generic** — Steps do `ctx.providers.get<ObservabilityProvider>("observability")` rather than `providers.observability`. This is what makes the engine provider-agnostic.

4. **Prompts stay as-is** — The investigation and implementation prompts are battle-tested. Move them, don't rewrite them.

5. **`@actions/core` dependency stays in action only** — The engine steps use `ctx.logger` for logging, not `core.info`. The action wrapper maps `core` to the logger interface.

## Verification
- `npm run build --workspace=packages/engine` passes
- `npm run build --workspace=packages/action` passes
- `npm run test --workspace=packages/engine` passes
- `npm run test --workspace=packages/action` passes
- The action's `npm run package` (ncc bundle) still produces a working `dist/index.js`
- No references to `phases/investigate`, `phases/implement`, `phases/notify` remain in action
