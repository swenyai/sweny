# Task: Add reviewMode to engine — types, auto-merge, and risk gating

## Goal

Implement the core `reviewMode` feature in the engine layer:
- Add the type field to configs
- Add `enableAutoMerge` to the source control provider
- In `create-pr`, call auto-merge when `reviewMode === "auto"`
- Risk gating: automatically downgrade `"auto"` to `"review"` when changed files are high-risk

This task is the **foundation** — action and CLI tasks depend on it being committed first.

---

## Step 1: Add `reviewMode` to engine types

**File: `packages/engine/src/recipes/triage/types.ts`**

Add to `TriageConfig` (after `dryRun`):
```ts
/** Controls PR merge behavior after creation.
 *  - "auto"   — enable GitHub auto-merge (merges when CI passes)
 *  - "review" — open PR and wait for human approval (default)
 *  - "notify" — same as review, intended for notification integrations
 */
reviewMode?: "auto" | "review" | "notify";
```

**File: `packages/engine/src/nodes/types.ts`**

Add to `SharedNodeConfig` (after `issueTrackerName`):
```ts
/** Controls PR merge behavior. "auto" enables GitHub auto-merge after CI. */
reviewMode?: "auto" | "review" | "notify";
```

---

## Step 2: Add `enableAutoMerge` to SourceControlProvider

**File: `packages/providers/src/source-control/types.ts`**

Add optional method to the `SourceControlProvider` interface (after `dispatchWorkflow`):
```ts
/**
 * Enable auto-merge on the given pull request number.
 * The PR merges automatically once all required status checks pass.
 * Optional — providers that do not support auto-merge can omit this.
 */
enableAutoMerge?(prNumber: number): Promise<void>;
```

**File: `packages/providers/src/source-control/github.ts`**

Add `enableAutoMerge` to the returned object (after `dispatchWorkflow`):
```ts
async enableAutoMerge(prNumber: number): Promise<void> {
  await git([
    "config", "--local", "alias.pr-automerge",
    `!gh pr merge ${prNumber} --auto --squash --repo ${owner}/${repo}`,
  ], { ignoreReturnCode: true });

  // Use gh CLI directly — simpler and works without GraphQL auth
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);
  try {
    await execFileAsync("gh", [
      "pr", "merge", String(prNumber),
      "--auto", "--squash",
      "--repo", `${owner}/${repo}`,
    ], { env: { ...process.env, GH_TOKEN: token } });
    log.info(`Auto-merge enabled on PR #${prNumber}`);
  } catch (err) {
    // Non-fatal: auto-merge may fail if branch protection is not configured.
    // The PR is still open and a human can merge manually.
    log.warn(`Could not enable auto-merge on PR #${prNumber}: ${err}`);
  }
},
```

Note: `token` is already in scope from the closure. Use `GH_TOKEN` env var so `gh` CLI
uses our token, not whatever is configured globally.

Also update `packages/providers/src/source-control/index.ts` — no change needed if it
re-exports from types.ts already. Just verify.

---

## Step 3: Risk gating utility

**File: `packages/engine/src/nodes/risk-assessor.ts`** (create new file)

```ts
/** Patterns that indicate a high-risk change requiring human review. */
const HIGH_RISK_PATTERNS: RegExp[] = [
  /migrations?\//i,
  /\bauth\//i,
  /\bcrypto\//i,
  /\bsecurity\//i,
  /\.github\/workflows\//i,
  /^package\.json$/,
  /^package-lock\.json$/,
  /^pnpm-lock\.yaml$/,
  /^yarn\.lock$/,
  /schema\.(ts|js|sql|prisma)$/i,
];

export interface RiskAssessment {
  level: "low" | "high";
  reasons: string[];
}

/** Assess the risk of a set of changed file paths. */
export function assessRisk(changedFiles: string[]): RiskAssessment {
  const reasons: string[] = [];

  if (changedFiles.length > 10) {
    reasons.push(`Large change scope: ${changedFiles.length} files modified`);
  }

  for (const file of changedFiles) {
    for (const pattern of HIGH_RISK_PATTERNS) {
      if (pattern.test(file)) {
        reasons.push(`High-risk file: ${file}`);
        break;
      }
    }
  }

  return {
    level: reasons.length > 0 ? "high" : "low",
    reasons,
  };
}
```

---

## Step 4: Integrate into create-pr.ts

**File: `packages/engine/src/nodes/create-pr.ts`**

Add import at top:
```ts
import { assessRisk } from "./risk-assessor.js";
```

After `const pr = await sourceControl.createPullRequest(...)` and the log line,
add the auto-merge + risk logic:

```ts
// -------------------------------------------------------------------------
// 5. Auto-merge if configured (and risk is low)
// -------------------------------------------------------------------------
if (config.reviewMode === "auto" && sourceControl.enableAutoMerge) {
  const changedFiles = await sourceControl.getChangedFiles().catch(() => []);
  const risk = assessRisk(changedFiles);

  if (risk.level === "high") {
    ctx.logger.warn(
      `Auto-merge disabled due to high-risk changes: ${risk.reasons.join(", ")}`,
    );
  } else {
    await sourceControl.enableAutoMerge(pr.number);
  }
}
```

---

## Step 5: Tests

**File: `packages/engine/src/nodes/risk-assessor.test.ts`** (create new)

Test `assessRisk`:
- Returns `low` for `["src/foo.ts", "src/bar.ts"]`
- Returns `high` for `["src/migrations/001.sql"]` with reason mentioning `migrations`
- Returns `high` for `["package.json"]`
- Returns `high` for `[".github/workflows/ci.yml"]`
- Returns `high` when > 10 files (pass an array of 11 items)
- Returns multiple reasons when multiple risk factors apply

**File: `packages/engine/src/recipes/triage/steps/create-pr.test.ts`**

Verify the existing mock for sourceControl includes `enableAutoMerge: vi.fn()`.
Add test: when `reviewMode: "auto"` and files are low-risk, `enableAutoMerge` is called.
Add test: when `reviewMode: "auto"` and a file matches a high-risk pattern,
`enableAutoMerge` is NOT called and a warning is logged.
Add test: when `reviewMode: "review"`, `enableAutoMerge` is never called.

---

## Step 6: Build and test

```bash
cd /Users/nate/src/swenyai/sweny
npm test --workspace=packages/providers -- --reporter=verbose 2>&1 | tail -20
npm test --workspace=packages/engine -- --reporter=verbose 2>&1 | tail -20
npm run build --workspace=packages/engine
```

Fix any TypeScript errors before committing.

---

## Step 7: Commit

```
feat(engine): add reviewMode + risk-gated auto-merge support

- Add reviewMode ("auto" | "review" | "notify") to TriageConfig and SharedNodeConfig
- Add optional enableAutoMerge() to SourceControlProvider; implement in GitHub provider
  using `gh pr merge --auto --squash`
- Risk gating: assessRisk() detects high-risk file patterns (migrations, auth, crypto,
  lockfiles, workflow files) and suppresses auto-merge even when reviewMode is "auto"
- create-pr node calls enableAutoMerge() when reviewMode=auto and risk is low
```

Then rename this file to `01-reviewmode-engine.done.md` and commit:
```
chore: mark task 01 done
```

---

## Context

- Repo: `/Users/nate/src/swenyai/sweny`
- TypeScript monorepo with ESM (`"type": "module"`)
- Test framework: Vitest 4 — mock factory pattern, `vi.fn()`, `vi.spyOn`
- The `file` source control provider does not need to implement `enableAutoMerge` —
  it is optional in the interface
- The `gh` CLI is available in GitHub Actions runners; it uses `GH_TOKEN` env var
