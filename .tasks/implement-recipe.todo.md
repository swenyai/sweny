# Task: Add `implement` recipe to the engine

## Why

The triage recipe is a full-cycle workflow: investigate → decide → implement → PR.
But users often already know what they want to fix — they have a specific Linear issue,
GitHub issue, or Jira ticket. Running the full triage cycle (which investigates logs
first) is wasteful when the issue is already defined.

The `implement` recipe is a focused workflow: given an issue identifier, clone the
repo, read the issue, implement a fix, and open a PR. It reuses the existing
`implement-fix`, `create-pr` step implementations and provider interfaces.

This unlocks the CLI use case `sweny implement --issue ENG-123` and is also the
right primitive for the cloud "work on a specific issue" flow.

---

## How the engine works

Read `packages/engine/src/runner.ts` and `packages/engine/src/types.ts` before
starting. The key types:

```typescript
// A workflow is an ordered list of steps grouped into phases
interface Workflow<TConfig> {
  name: string;
  steps: Step<TConfig>[];
}

// Each step has a phase and a run function
interface Step<TConfig> {
  name: string;
  phase: WorkflowPhase; // "learn" | "act" | "report"
  run: (ctx: WorkflowContext<TConfig>) => Promise<StepResult>;
}
```

The triage recipe is at `packages/engine/src/recipes/triage/index.ts`. Create
the implement recipe at `packages/engine/src/recipes/implement/index.ts` using the
same structure.

---

## Recipe design

The implement recipe needs these steps:

```
learn:
  - verify-access     (can we push to the repo?)
  - fetch-issue       (get the issue from the tracker by identifier)

act:
  - implement-fix     (run coding agent to implement the fix)
  - create-pr         (generate PR description, open PR, link to issue)

report:
  - notify            (send notification with PR link)
```

The `verify-access` and `notify` steps already exist in triage and can be reused
directly — just import and reference them.

`create-pr` also exists in triage and can be reused.

`implement-fix` exists but assumes the issue was already created in a previous step.
It reads `getStepData(ctx, "create-issue")` for the issue identifier and branch name.
For the implement recipe, the preceding step is `fetch-issue` — so `implement-fix`
needs to work with data from `fetch-issue` instead.

---

## Step 1 — Define `ImplementConfig`

Create `packages/engine/src/recipes/implement/types.ts`:

```typescript
export interface ImplementConfig {
  // The issue to implement (exactly one required)
  issueIdentifier: string; // e.g., "ENG-123" or "github#42"

  // Source control context
  repository: string; // "owner/repo"

  // Behavior
  dryRun: boolean;
  maxImplementTurns: number;  // default: 30
  prDescriptionMaxTurns?: number; // default: 10

  // PR settings
  baseBranch?: string;   // default: "main"
  prLabels?: string[];   // default: ["agent", "triage", "needs-review"]

  // Coding agent auth
  agentEnv: Record<string, string>;

  // Analysis directory for intermediate files
  analysisDir?: string; // default: ".github/triage-analysis"

  // Issue tracker config (same as TriageConfig — needed for update issue state)
  projectId: string;
  stateInProgress: string;
  statePeerReview: string;
}
```

---

## Step 2 — `fetch-issue` step

Create `packages/engine/src/recipes/implement/steps/fetch-issue.ts`:

```typescript
import type { IssueTrackingProvider } from "@sweny-ai/providers/issue-tracking";
import type { StepResult, WorkflowContext } from "../../../types.js";
import type { ImplementConfig } from "../types.js";

/** Fetch issue details from the tracker and write a context file for the coding agent. */
export async function fetchIssue(ctx: WorkflowContext<ImplementConfig>): Promise<StepResult> {
  const issueTracker = ctx.providers.get<IssueTrackingProvider>("issueTracker");
  const issue = await issueTracker.getIssue(ctx.config.issueIdentifier);

  ctx.logger.info(`Fetched issue: ${issue.identifier} — ${issue.title}`);

  // Write a context file so the coding agent can read it
  const analysisDir = ctx.config.analysisDir ?? ".github/triage-analysis";
  const fs = await import("node:fs");
  fs.mkdirSync(analysisDir, { recursive: true });
  fs.writeFileSync(
    `${analysisDir}/best-candidate.md`,
    [
      `# ${issue.title}`,
      ``,
      `**Issue**: ${issue.identifier}`,
      `**URL**: ${issue.url}`,
      ``,
      `## Description`,
      ``,
      issue.description ?? "(no description provided)",
    ].join("\n"),
  );

  return {
    status: "success",
    data: {
      issueId: issue.id,
      issueIdentifier: issue.identifier,
      issueTitle: issue.title,
      issueUrl: issue.url,
      issueBranchName: issue.branchName,
    },
  };
}
```

The data shape matches what `implement-fix` and `create-pr` already expect from
`create-issue` — so they can be reused without modification.

---

## Step 3 — Wire the recipe

Create `packages/engine/src/recipes/implement/index.ts`:

```typescript
import type { Workflow } from "../../types.js";
import type { ImplementConfig } from "./types.js";
import { verifyAccess } from "../triage/steps/verify-access.js";
import { fetchIssue } from "./steps/fetch-issue.js";
import { implementFix } from "../triage/steps/implement-fix.js";
import { createPr } from "../triage/steps/create-pr.js";
import { sendNotification } from "../triage/steps/notify.js";

export const implementWorkflow: Workflow<ImplementConfig> = {
  name: "implement",
  description: "Implement a fix for a specific issue and open a pull request",
  steps: [
    { name: "verify-access", phase: "learn", run: verifyAccess },
    { name: "fetch-issue",   phase: "learn", run: fetchIssue },
    { name: "implement-fix", phase: "act",   run: implementFix },
    { name: "create-pr",     phase: "act",   run: createPr },
    { name: "notify",        phase: "report", run: sendNotification },
  ],
};

export type { ImplementConfig } from "./types.js";
```

---

## Step 4 — Export from the engine package

In `packages/engine/src/index.ts`, add:

```typescript
export { implementWorkflow } from "./recipes/implement/index.js";
export type { ImplementConfig } from "./recipes/implement/types.js";
```

---

## Step 5 — CLI command `sweny implement`

In `packages/cli/src/main.ts`, add a new command:

```typescript
program
  .command("implement")
  .description("Implement a fix for a specific issue")
  .requiredOption("--issue <identifier>", "Issue identifier (e.g., ENG-123)")
  .option("--dry-run", "Preview mode — no PRs created", false)
  .option("--max-turns <n>", "Max implementation turns", "30")
  // ... other options from the .sweny.yml config ...
  .action(async (options) => {
    // Load config file, validate, run implementWorkflow
    // Similar pattern to the triage command action
  });
```

The implement command is simpler than triage — it needs:
- Auth (anthropicApiKey or claudeOauthToken)
- Issue tracker credentials (to fetch the issue)
- Source control credentials (to push the branch and open the PR)
- `--issue` argument

It does NOT need: observability credentials, service map, novelty mode, time range.

---

## Step 6 — Tests

Create `packages/engine/tests/implement.test.ts`:

```typescript
describe("implement workflow", () => {
  it("fetches issue and runs implement-fix and create-pr", async () => {
    // mock providers: issueTracker.getIssue, sourceControl.*, codingAgent.*
    // run implementWorkflow with a mock config
    // assert steps completed in order
  });

  it("skips create-pr if implement-fix was skipped", async () => {
    // sourceControl.findExistingPr returns an existing PR → implement-fix skips
    // assert create-pr also skips
  });

  it("aborts on fetch-issue failure (learn phase)", async () => {
    // issueTracker.getIssue throws
    // result.status === "failed"
  });
});
```

Use the existing `test-helpers.ts` in `packages/engine/src/recipes/triage/` for
provider mock factories.

---

## Acceptance

- `implementWorkflow` is exported from `@sweny-ai/engine`
- Running `sweny implement --issue ENG-123` (with valid credentials in `.env`) works
  end-to-end in dry-run mode
- At least 3 tests for the implement workflow
- All existing 514+ tests still pass
