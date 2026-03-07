# Task: E2E Integration Tests — CLI + File Providers + Mock Agent

## Why

We have strong unit tests but no end-to-end test that exercises the full triage pipeline:
CLI config → engine runner → providers → step results. When we wire new steps or providers,
unit tests don't catch integration mismatches (wrong provider key names, missing registry
entries, step data shape mismatches, etc.).

The approach here avoids brittle external API dependencies by using only file-based providers
and a mock coding agent. No dummy cloud accounts, no network calls, no credentials at risk.

---

## What the tests cover

A single "happy path" for `triageWorkflow`:

1. A local JSON file acts as the observability log source (via `file` provider)
2. A local JSON file acts as the issue tracker (via file issue-tracking provider)
3. A local git repo acts as source control (via file source-control provider)
4. A mock coding agent returns canned investigation output (no Claude API calls)
5. The engine runs the full workflow: verify-access → build-context → investigate → create-issue → create-pr → notify
6. Assertions verify the result shape, intermediate step data, and file system side-effects

---

## Background: existing file providers

- **`packages/providers/src/observability/file.ts`** — `queryLogs`, `aggregate` from a JSON file. Already tested.
- **`packages/providers/src/issue-tracking/file.ts`** — Issue CRUD from a JSON file. Already tested.
- **`packages/providers/src/source-control/file.ts`** — Git operations on a local repo. Already tested.

The missing piece is a **mock coding agent** that returns a predictable investigation result without
calling the Anthropic API.

---

## Step 1 — Mock coding agent

**File:** `packages/providers/src/coding-agent/mock.ts` (new file)

```typescript
import type { CodingAgentProvider } from "./types.js";

export interface MockAgentConfig {
  /** The text the agent will "output" as its analysis. */
  analysisOutput: string;
  /** Whether to simulate a branch + commit when runAgent is called for implementation. */
  simulateCommit?: boolean;
}

/**
 * A mock coding agent for testing. Returns canned output without calling any external API.
 */
export function mockAgent(config: MockAgentConfig): CodingAgentProvider {
  return {
    async verifyAccess() {
      // no-op
    },
    async runAgent(_prompt: string, opts?: { workDir?: string }) {
      // If simulateCommit is set and a workDir is provided, create a dummy file and commit
      if (config.simulateCommit && opts?.workDir) {
        const { execSync } = await import("node:child_process");
        const fixFile = `${opts.workDir}/fix.txt`;
        const { writeFileSync } = await import("node:fs");
        writeFileSync(fixFile, "mock fix\n");
        execSync("git add . && git commit -m 'mock: apply fix'", { cwd: opts.workDir });
      }
      return config.analysisOutput;
    },
    install() {
      return Promise.resolve();
    },
    getAgentEnv() {
      return {};
    },
    getPromptInstructions() {
      return "";
    },
  };
}
```

Also export from `packages/providers/src/coding-agent/index.ts`:
```typescript
export { mockAgent } from "./mock.js";
```

---

## Step 2 — E2E test fixtures

**Directory:** `packages/engine/tests/e2e/fixtures/`

Create fixture files that the tests will use:

**`fixtures/logs.json`** — A small log file with clear error patterns:
```json
[
  { "timestamp": "2024-01-01T00:00:00Z", "service": "api", "level": "error", "message": "Unhandled exception in /checkout: TypeError: Cannot read property 'id' of undefined" },
  { "timestamp": "2024-01-01T00:01:00Z", "service": "api", "level": "error", "message": "Unhandled exception in /checkout: TypeError: Cannot read property 'id' of undefined" },
  { "timestamp": "2024-01-01T00:02:00Z", "service": "worker", "level": "warn", "message": "Job timeout after 30s" },
  { "timestamp": "2024-01-01T00:03:00Z", "service": "api", "level": "error", "message": "Database connection failed" }
]
```

**`fixtures/issues.json`** — An empty issue store for the file issue-tracker to write into:
```json
[]
```

---

## Step 3 — E2E test setup helper

**File:** `packages/engine/tests/e2e/setup.ts` (new file)

```typescript
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execSync } from "node:child_process";

export interface E2EFixture {
  workDir: string;        // temp git repo (source control)
  logFile: string;        // path to logs.json
  issuesFile: string;     // path to issues.json (file issue-tracker)
  cleanup: () => void;
}

export function createE2EFixture(): E2EFixture {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "sweny-e2e-"));

  // Initialize a bare git repo in workDir
  execSync("git init && git config user.email 'test@test.com' && git config user.name 'Test' && echo 'init' > README.md && git add . && git commit -m 'init'", { cwd: workDir });

  // Write log fixture
  const logFile = path.join(workDir, "logs.json");
  const fixtureLogsPath = new URL("./fixtures/logs.json", import.meta.url).pathname;
  fs.copyFileSync(fixtureLogsPath, logFile);

  // Write empty issues file
  const issuesFile = path.join(workDir, "issues.json");
  fs.writeFileSync(issuesFile, "[]");

  return {
    workDir,
    logFile,
    issuesFile,
    cleanup: () => fs.rmSync(workDir, { recursive: true, force: true }),
  };
}
```

---

## Step 4 — E2E test file

**File:** `packages/engine/tests/e2e/triage-workflow.e2e.test.ts` (new file)

```typescript
import { describe, it, expect, afterEach } from "vitest";
import { runWorkflow, triageWorkflow, createProviderRegistry } from "../../src/index.js";
import { file as fileObs } from "@swenyai/providers/observability";
import { file as fileIssues } from "@swenyai/providers/issue-tracking";
import { file as fileScm } from "@swenyai/providers/source-control";
import { mockAgent } from "@swenyai/providers/coding-agent";
import { createE2EFixture, type E2EFixture } from "./setup.js";
import type { TriageConfig } from "../../src/index.js";

// Canned agent output that matches the format investigate.ts expects
// Look at packages/engine/src/recipes/triage/prompts.ts for the exact format
const INVESTIGATE_OUTPUT = `
## Analysis

The top recurring error is a TypeError in the /checkout endpoint.

RECOMMENDATION: implement
ISSUES_FOUND: true
SUMMARY: TypeError in /checkout endpoint appearing 2x in the last hour. Root cause: user object can be null when session expires mid-checkout.
`;

const silentLogger = { info: () => {}, debug: () => {}, warn: () => {}, error: () => {} };

describe("triageWorkflow E2E (file providers + mock agent)", () => {
  let fixture: E2EFixture;

  afterEach(() => {
    fixture?.cleanup();
  });

  function buildProviders(fx: E2EFixture) {
    const registry = createProviderRegistry();
    registry.set("observability", fileObs({ path: fx.logFile, logger: silentLogger }));
    registry.set("issueTracker", fileIssues({ path: fx.issuesFile }));
    registry.set("sourceControl", fileScm({ repoPath: fx.workDir }));
    registry.set("codingAgent", mockAgent({ analysisOutput: INVESTIGATE_OUTPUT }));
    return registry;
  }

  function buildConfig(fx: E2EFixture): TriageConfig {
    return {
      repository: "test-org/test-repo",
      timeRange: "24h",
      severityFocus: "errors",
      serviceFilter: "*",
      investigationDepth: "quick",
      maxInvestigateTurns: 3,
      maxImplementTurns: 5,
      serviceMapPath: "",
      projectId: "TEST",
      bugLabelId: "",
      triageLabelId: "",
      stateBacklog: "",
      stateInProgress: "",
      statePeerReview: "",
      dryRun: true,       // dry-run: skip actual PR creation
      noveltyMode: false,
      issueOverride: "",
      additionalInstructions: "",
      agentEnv: {},
    };
  }

  it("runs the full workflow and returns a result", async () => {
    fixture = createE2EFixture();
    const providers = buildProviders(fixture);
    const config = buildConfig(fixture);

    const result = await runWorkflow(triageWorkflow, config, providers, { logger: silentLogger });

    expect(result.status).toMatch(/completed|partial/);
    expect(result.steps.length).toBeGreaterThan(0);
  });

  it("verify-access step passes with file providers", async () => {
    fixture = createE2EFixture();
    const providers = buildProviders(fixture);
    const config = buildConfig(fixture);

    const result = await runWorkflow(triageWorkflow, config, providers, { logger: silentLogger });

    const accessStep = result.steps.find(s => s.name === "verify-access");
    expect(accessStep?.result.status).toBe("success");
  });

  it("build-context step reads logs from file", async () => {
    fixture = createE2EFixture();
    const providers = buildProviders(fixture);
    const config = buildConfig(fixture);

    const result = await runWorkflow(triageWorkflow, config, providers, { logger: silentLogger });

    const ctxStep = result.steps.find(s => s.name === "build-context");
    expect(ctxStep?.result.status).toBe("success");
    // Should have found errors in our fixture
    const data = ctxStep?.result.data as Record<string, unknown>;
    expect(data).toBeDefined();
  });

  it("investigate step uses mock agent output", async () => {
    fixture = createE2EFixture();
    const providers = buildProviders(fixture);
    const config = buildConfig(fixture);

    const result = await runWorkflow(triageWorkflow, config, providers, { logger: silentLogger });

    const investigateStep = result.steps.find(s => s.name === "investigate");
    expect(investigateStep?.result.status).toBe("success");
  });

  it("dry-run skips PR creation", async () => {
    fixture = createE2EFixture();
    const providers = buildProviders(fixture);
    const config = { ...buildConfig(fixture), dryRun: true };

    const result = await runWorkflow(triageWorkflow, config, providers, { logger: silentLogger });

    const prStep = result.steps.find(s => s.name === "create-pr");
    // In dry-run mode, the PR step should either be skipped or return a no-op
    if (prStep) {
      expect(prStep.result.data?.dryRun ?? prStep.result.status).toBeTruthy();
    }
  });
});
```

---

## Step 5 — Configure vitest for E2E tests

**File:** `packages/engine/vitest.config.e2e.ts` (new file)

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/e2e/**/*.e2e.test.ts"],
    // No isolate — tests are stateful (git repos, files)
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    // Longer timeout — file I/O + git operations
    testTimeout: 30_000,
  },
});
```

Add script to `packages/engine/package.json`:
```json
"test:e2e": "vitest run --config vitest.config.e2e.ts"
```

---

## Step 6 — Check file provider APIs

Before writing tests, verify the actual method signatures by reading:
- `packages/providers/src/issue-tracking/file.ts` — check the factory function signature and what `fileIssues({ path })` expects
- `packages/providers/src/source-control/file.ts` — check `fileScm({ repoPath })` or whatever the constructor takes
- `packages/providers/src/coding-agent/` — check the `CodingAgentProvider` interface before implementing `mockAgent`

If the file provider APIs differ from what's shown above, adapt the test to match reality.

---

## Acceptance criteria

- `npm run test:e2e` in `packages/engine` runs without hitting external APIs
- At least 4 of the 5 tests pass (the PR dry-run test may need adjustment depending on engine behavior)
- Tests complete in under 30 seconds
- All existing unit tests still pass: `npm test` in `packages/engine`

---

## How to run

```bash
# Unit tests (must still pass):
npm test --workspace=packages/engine

# E2E tests:
cd packages/engine && npm run test:e2e
```
