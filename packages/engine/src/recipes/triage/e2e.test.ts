/**
 * Triage workflow E2E tests using real file providers and mock agent.
 *
 * No external API calls. Uses:
 *   - file observability provider (reads a JSON log fixture)
 *   - fileIssueTracking provider (reads/writes to a temp outputDir)
 *   - fileSourceControl provider (git-ops are no-ops when git detection fails)
 *   - mockAgent (writes fixture files to analysisDir via onRun callback)
 *   - fileNotification provider (writes notification to disk)
 *
 * child_process is mocked so fileSourceControl always reports inGitRepo=false,
 * turning branch/commit/push operations into silent no-ops.
 */

import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runRecipe, createProviderRegistry } from "../../runner-recipe.js";
import { triageRecipe } from "./index.js";
import type { TriageConfig } from "./types.js";

// ── Prevent real git commands ────────────────────────────────────────────────
// fileSourceControl calls execSync("git rev-parse ...") in its constructor.
// When tests run inside the sweny monorepo the CWD IS a git repo, so git
// detection succeeds and branch/commit calls run real git. We throw on any git
// command to make inGitRepo=false and keep all git ops as no-ops.
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    execSync: (cmd: string, opts?: unknown) => {
      if (typeof cmd === "string" && cmd.startsWith("git")) {
        throw new Error("not a git repository (mocked for E2E test isolation)");
      }
      return actual.execSync(cmd as string, opts as Parameters<typeof actual.execSync>[1]);
    },
  };
});

// Mock prompts to avoid filesystem reads for service map / prompt templates
vi.mock("./prompts.js", () => ({
  buildInvestigationPrompt: vi.fn().mockReturnValue("mocked investigation prompt"),
  buildImplementPrompt: vi.fn().mockReturnValue("mocked implement prompt"),
  buildPrDescriptionPrompt: vi.fn().mockReturnValue("mocked pr description prompt"),
  issueLink: vi.fn().mockReturnValue("[IDENTIFIER](https://issue.url)"),
}));

vi.mock("./service-map.js", () => ({
  parseServiceMap: vi.fn().mockReturnValue({ services: [] }),
}));

// ── Import real providers (after mocks are hoisted) ──────────────────────────
import { file as fileObs } from "@sweny-ai/providers/observability";
import { fileIssueTracking } from "@sweny-ai/providers/issue-tracking";
import { fileSourceControl } from "@sweny-ai/providers/source-control";
import type { SourceControlProvider } from "@sweny-ai/providers/source-control";
import { fileNotification } from "@sweny-ai/providers/notification";
import { mockAgent } from "@sweny-ai/providers/coding-agent";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const LOG_FIXTURE: unknown[] = [
  {
    timestamp: "2024-01-01T00:00:00Z",
    service: "api",
    level: "error",
    message: "TypeError: Cannot read properties of undefined (reading 'id') in /checkout",
  },
  {
    timestamp: "2024-01-01T00:01:00Z",
    service: "api",
    level: "error",
    message: "TypeError: Cannot read properties of undefined (reading 'id') in /checkout",
  },
  { timestamp: "2024-01-01T00:02:00Z", service: "worker", level: "warn", message: "Job timeout after 30s" },
  {
    timestamp: "2024-01-01T00:03:00Z",
    service: "api",
    level: "error",
    message: "Database connection failed: ECONNREFUSED 127.0.0.1:5432",
  },
];

// best-candidate.md written by the mock agent into analysisDir
const BEST_CANDIDATE_MD = `# TypeError in /checkout endpoint

RECOMMENDATION: implement

## Root Cause
User session can expire mid-checkout leaving \`req.user\` as null.

## Fix
Add null guard before accessing \`req.user.id\` in the checkout handler.
`;

const ISSUES_REPORT_MD = `## Issues Report

1. **TypeError in /checkout** — 2 occurrences in the last hour
2. **Database connection errors** — 1 occurrence
`;

const silentLogger = {
  info: () => {},
  debug: () => {},
  warn: () => {},
  error: () => {},
};

// ── Test helpers ──────────────────────────────────────────────────────────────

interface Fixture {
  outputDir: string;
  analysisDir: string;
  logFile: string;
  notificationFile: string;
  cleanup: () => void;
}

function createFixture(): Fixture {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "sweny-e2e-triage-"));
  const analysisDir = path.join(outputDir, "analysis");
  const logFile = path.join(outputDir, "logs.json");
  const notificationFile = path.join(outputDir, "notification.json");

  fs.writeFileSync(logFile, JSON.stringify(LOG_FIXTURE, null, 2));
  fs.mkdirSync(analysisDir, { recursive: true });

  return {
    outputDir,
    analysisDir,
    logFile,
    notificationFile,
    cleanup: () => fs.rmSync(outputDir, { recursive: true, force: true }),
  };
}

function buildProviders(fx: Fixture, agentExitCode = 0) {
  const registry = createProviderRegistry();

  registry.set("observability", fileObs({ path: fx.logFile, logger: silentLogger }));

  registry.set("issueTracker", fileIssueTracking({ outputDir: fx.outputDir, logger: silentLogger }));

  registry.set("sourceControl", fileSourceControl({ outputDir: fx.outputDir, logger: silentLogger }));

  registry.set("notification", fileNotification({ outputDir: fx.outputDir, logger: silentLogger }));

  // Mock agent writes the files investigate.ts will read
  registry.set(
    "codingAgent",
    mockAgent({
      exitCode: agentExitCode,
      onRun: async () => {
        fs.mkdirSync(fx.analysisDir, { recursive: true });
        fs.writeFileSync(path.join(fx.analysisDir, "best-candidate.md"), BEST_CANDIDATE_MD);
        fs.writeFileSync(path.join(fx.analysisDir, "issues-report.md"), ISSUES_REPORT_MD);
      },
    }),
  );

  return registry;
}

function buildConfig(fx: Fixture, overrides: Partial<TriageConfig> = {}): TriageConfig {
  return {
    timeRange: "1h",
    severityFocus: "errors",
    serviceFilter: "*",
    investigationDepth: "standard",
    maxInvestigateTurns: 3,
    maxImplementTurns: 5,
    serviceMapPath: "",
    projectId: "LOCAL",
    bugLabelId: "",
    triageLabelId: "",
    stateBacklog: "open",
    stateInProgress: "in-progress",
    statePeerReview: "peer-review",
    repository: "test-org/test-repo",
    baseBranch: "main",
    prLabels: [],
    dryRun: true,
    noveltyMode: false,
    issueOverride: "",
    additionalInstructions: "",
    agentEnv: {},
    analysisDir: fx.analysisDir,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("triageRecipe E2E (file providers + mock agent)", () => {
  let fixture: Fixture;

  afterEach(() => fixture?.cleanup());

  it("verify-access succeeds for all file providers", async () => {
    fixture = createFixture();
    const providers = buildProviders(fixture);
    const config = buildConfig(fixture);

    const result = await runRecipe(triageRecipe, config, providers, { logger: silentLogger });

    const accessStep = result.steps.find((s) => s.name === "verify-access");
    expect(accessStep?.result.status).toBe("success");
  });

  it("build-context reads logs from the fixture file", async () => {
    fixture = createFixture();
    const providers = buildProviders(fixture);
    const config = buildConfig(fixture);

    const result = await runRecipe(triageRecipe, config, providers, { logger: silentLogger });

    const ctxStep = result.steps.find((s) => s.name === "build-context");
    expect(ctxStep?.result.status).toBe("success");
    // The observability provider should have queried the fixture log file
    expect(ctxStep?.result.data).toBeDefined();
  });

  it("investigate step invokes mock agent and parses best-candidate.md", async () => {
    fixture = createFixture();
    const providers = buildProviders(fixture);
    const config = buildConfig(fixture);

    const result = await runRecipe(triageRecipe, config, providers, { logger: silentLogger });

    const investigateStep = result.steps.find((s) => s.name === "investigate");
    expect(investigateStep?.result.status).toBe("success");

    const data = investigateStep?.result.data as Record<string, unknown>;
    expect(data.recommendation).toBe("implement");
    expect(data.issuesFound).toBe(true);
    expect(data.bestCandidate).toBe(true);

    // Confirm the agent actually wrote the file
    expect(fs.existsSync(path.join(fixture.analysisDir, "best-candidate.md"))).toBe(true);
  });

  it("dry-run completes without creating issues or PRs", async () => {
    fixture = createFixture();
    const providers = buildProviders(fixture);
    const config = buildConfig(fixture, { dryRun: true });

    const result = await runRecipe(triageRecipe, config, providers, { logger: silentLogger });

    expect(result.status).toBe("completed");

    // novelty-gate should skip act phase
    const gateStep = result.steps.find((s) => s.name === "novelty-gate");
    expect(gateStep?.result.data).toMatchObject({ outcome: "skip", action: "dry-run" });

    // No issue or PR creation in dry-run
    expect(result.steps.find((s) => s.name === "create-issue")).toBeUndefined();
    expect(result.steps.find((s) => s.name === "create-pr")).toBeUndefined();

    // Notify still runs
    expect(result.steps.find((s) => s.name === "notify")?.result.status).toBe("success");
  });

  it("full non-dry-run flow creates an issue in the file tracker", async () => {
    fixture = createFixture();
    const providers = buildProviders(fixture);
    // fileIssueTracking needs verifyAccess first to create dirs
    await providers.get<{ verifyAccess: () => Promise<void> }>("issueTracker").verifyAccess();

    const config = buildConfig(fixture, { dryRun: false });

    const result = await runRecipe(triageRecipe, config, providers, { logger: silentLogger });

    expect(result.status).toBe("completed");

    const issueStep = result.steps.find((s) => s.name === "create-issue");
    expect(issueStep?.result.status).toBe("success");

    const issueData = issueStep?.result.data as Record<string, unknown>;
    expect(typeof issueData.issueIdentifier).toBe("string");
    expect(issueData.issueIdentifier).toMatch(/^LOCAL-/);
    expect(typeof issueData.issueUrl).toBe("string");

    // Issue should also be persisted on disk
    const state = JSON.parse(fs.readFileSync(path.join(fixture.outputDir, "state.json"), "utf-8"));
    expect(state.issues).toHaveLength(1);
    expect(state.issues[0].title).toContain("TypeError");
  });

  it("verify-access failure aborts the workflow", async () => {
    fixture = createFixture();
    const providers = buildProviders(fixture);

    // Point observability at a file that doesn't exist — verifyAccess should throw
    const badLogPath = path.join(fixture.outputDir, "nonexistent.json");
    providers.set("observability", fileObs({ path: badLogPath, logger: silentLogger }));

    const config = buildConfig(fixture);

    const result = await runRecipe(triageRecipe, config, providers, { logger: silentLogger });

    expect(result.status).toBe("failed");
    expect(result.steps).toHaveLength(2);
    expect(result.steps[1].name).toBe("verify-access");
    expect(result.steps[1].result.status).toBe("failed");
  });
});

// ── create-pr path ────────────────────────────────────────────────────────────
//
// The file source control provider reports no commits when inGitRepo=false, so
// implement-fix always skips under the default setup. The tests below inject a
// custom sourceControl that wraps the real file provider but overrides the git-
// state checks to simulate a branch that has commits. This lets implement-fix
// succeed and exercises the full implement-fix → create-pr → notify path.

/** Wrap fileSourceControl to simulate a branch with new commits. */
function buildSourceControlWithCommits(outputDir: string): SourceControlProvider {
  const real = fileSourceControl({ outputDir, logger: silentLogger });
  return {
    async verifyAccess() {
      return real.verifyAccess();
    },
    async findExistingPr() {
      return null;
    },
    async hasNewCommits() {
      return true;
    },
    async hasChanges() {
      return false;
    },
    async getChangedFiles() {
      return ["src/checkout.ts"];
    },
    async configureBotIdentity() {},
    async createBranch() {},
    async pushBranch() {},
    async resetPaths() {},
    async stageAndCommit() {},
    async createPullRequest(opts) {
      return real.createPullRequest(opts);
    },
    async listPullRequests(opts) {
      return real.listPullRequests(opts);
    },
    async dispatchWorkflow(opts) {
      return real.dispatchWorkflow(opts);
    },
  };
}

function buildProvidersWithCommits(fx: Fixture) {
  const registry = createProviderRegistry();

  registry.set("observability", fileObs({ path: fx.logFile, logger: silentLogger }));
  registry.set("issueTracker", fileIssueTracking({ outputDir: fx.outputDir, logger: silentLogger }));
  registry.set("sourceControl", buildSourceControlWithCommits(fx.outputDir));
  registry.set("notification", fileNotification({ outputDir: fx.outputDir, logger: silentLogger }));

  registry.set(
    "codingAgent",
    mockAgent({
      exitCode: 0,
      onRun: async () => {
        fs.mkdirSync(fx.analysisDir, { recursive: true });
        fs.writeFileSync(path.join(fx.analysisDir, "best-candidate.md"), BEST_CANDIDATE_MD);
        fs.writeFileSync(path.join(fx.analysisDir, "issues-report.md"), ISSUES_REPORT_MD);
      },
    }),
  );

  return registry;
}

describe("triageRecipe E2E — implement-fix → create-pr path", () => {
  let fixture: Fixture;

  afterEach(() => fixture?.cleanup());

  it("dryRun=false with recommendation=implement reaches create-pr and returns prUrl", async () => {
    fixture = createFixture();
    const providers = buildProvidersWithCommits(fixture);
    // fileIssueTracking needs verifyAccess to create dirs before createIssue
    await providers.get<{ verifyAccess: () => Promise<void> }>("issueTracker").verifyAccess();
    // fileSourceControl needs verifyAccess to create the prs/ dir
    await providers.get<SourceControlProvider>("sourceControl").verifyAccess();

    const config = buildConfig(fixture, { dryRun: false });

    const result = await runRecipe(triageRecipe, config, providers, { logger: silentLogger });

    const createPrStep = result.steps.find((s) => s.name === "create-pr");
    expect(createPrStep).toBeDefined();
    expect(createPrStep?.result.status).toBe("success");

    const data = createPrStep?.result.data as Record<string, unknown>;
    expect(typeof data.prUrl).toBe("string");
    // fileSourceControl uses a local file:// URL for the PR artifact
    expect(data.prUrl).toMatch(/^file:\/\//);
  });

  it("create-pr result data shape includes prUrl, prNumber, and issueIdentifier", async () => {
    fixture = createFixture();
    const providers = buildProvidersWithCommits(fixture);
    await providers.get<{ verifyAccess: () => Promise<void> }>("issueTracker").verifyAccess();
    await providers.get<SourceControlProvider>("sourceControl").verifyAccess();

    const config = buildConfig(fixture, { dryRun: false });

    const result = await runRecipe(triageRecipe, config, providers, { logger: silentLogger });

    const createPrStep = result.steps.find((s) => s.name === "create-pr");
    expect(createPrStep?.result.status).toBe("success");

    const data = createPrStep?.result.data as Record<string, unknown>;
    expect(typeof data.prUrl).toBe("string");
    expect(typeof data.prNumber).toBe("number");
    expect(typeof data.issueIdentifier).toBe("string");
    expect(data.issueIdentifier).toMatch(/^LOCAL-/);
  });

  it("fileSourceControl git no-ops leave prs/ dir populated after create-pr", async () => {
    fixture = createFixture();
    const providers = buildProvidersWithCommits(fixture);
    await providers.get<{ verifyAccess: () => Promise<void> }>("issueTracker").verifyAccess();
    await providers.get<SourceControlProvider>("sourceControl").verifyAccess();

    const config = buildConfig(fixture, { dryRun: false });

    await runRecipe(triageRecipe, config, providers, { logger: silentLogger });

    // The file source control provider writes a .md file per PR
    const prsDir = path.join(fixture.outputDir, "prs");
    const prFiles = fs.readdirSync(prsDir).filter((f) => f.endsWith(".md"));
    expect(prFiles.length).toBeGreaterThanOrEqual(1);
  });
});
