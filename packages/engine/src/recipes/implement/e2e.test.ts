/**
 * E2E tests for the implement workflow using file-based providers + mock coding agent.
 *
 * These tests exercise the full workflow orchestration without any external API
 * calls. File providers read/write real files in a temp directory; the coding
 * agent is a no-op mock.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as os from "node:os";
import * as fs from "node:fs";
import * as path from "node:path";
import { runRecipe } from "../../runner-recipe.js";
import { createProviderRegistry } from "../../runner-recipe.js";
import { implementRecipe } from "./index.js";
import { fileIssueTracking } from "@sweny-ai/providers/issue-tracking";
import { fileSourceControl } from "@sweny-ai/providers/source-control";
import type { SourceControlProvider } from "@sweny-ai/providers/source-control";
import type { CodingAgent, CodingAgentRunOptions } from "@sweny-ai/providers/coding-agent";
import type { ImplementConfig } from "./types.js";

/** Minimal mock coding agent — no external processes, configurable side-effects. */
function makeMockAgent(onRun?: (opts: CodingAgentRunOptions) => void | Promise<void>): CodingAgent {
  return {
    async install() {},
    async run(opts) {
      await onRun?.(opts);
      return 0;
    },
  };
}

// Prevent fileSourceControl from detecting the monorepo's git repo —
// this ensures all git operations in the file provider become no-ops.
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    execSync: (cmd: string, opts?: unknown) => {
      if (typeof cmd === "string" && cmd.startsWith("git")) {
        throw new Error("not a git repository (mocked)");
      }
      return actual.execSync(cmd as string, opts as Parameters<typeof actual.execSync>[1]);
    },
  };
});

// Mock prompts to avoid fs reads inside buildImplementPrompt
vi.mock("../triage/prompts.js", () => ({
  buildInvestigationPrompt: vi.fn().mockReturnValue("mock investigation prompt"),
  buildImplementPrompt: vi.fn().mockReturnValue("mock implement prompt"),
  buildPrDescriptionPrompt: vi.fn().mockReturnValue("mock pr description prompt"),
}));

const silentLogger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sweny-e2e-"));
  silentLogger.info.mockClear();
  silentLogger.debug.mockClear();
  silentLogger.warn.mockClear();
  silentLogger.error.mockClear();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/**
 * Creates an issue in the file provider and returns its identifier.
 * verifyAccess() must be called first to initialise the output directories.
 */
async function seedIssue(outputDir: string): Promise<string> {
  const tracker = fileIssueTracking({ outputDir, logger: silentLogger });
  await tracker.verifyAccess();
  const issue = await tracker.createIssue({
    title: "Fix the broken endpoint",
    description: "The /api/health endpoint returns 500.",
    projectId: "LOCAL",
    labelIds: [],
  });
  return issue.identifier;
}

function buildProviders(outputDir: string, agentOnRun?: () => void) {
  const registry = createProviderRegistry();

  registry.set("issueTracker", fileIssueTracking({ outputDir, logger: silentLogger }));
  registry.set("sourceControl", fileSourceControl({ outputDir, logger: silentLogger }));
  registry.set("codingAgent", makeMockAgent(agentOnRun));
  registry.set("notification", { send: vi.fn().mockResolvedValue(undefined) });

  return registry;
}

function buildConfig(issueIdentifier: string, outputDir: string): ImplementConfig {
  return {
    issueIdentifier,
    repository: "org/repo",
    dryRun: false,
    maxImplementTurns: 5,
    agentEnv: {},
    projectId: "LOCAL",
    stateInProgress: "in-progress",
    statePeerReview: "peer-review",
    analysisDir: path.join(outputDir, "analysis"),
  };
}

describe("implement workflow e2e (file providers + mock agent)", () => {
  it("verify-access succeeds and creates output directories", async () => {
    const issueId = await seedIssue(tmpDir);
    const providers = buildProviders(tmpDir);
    const config = buildConfig(issueId, tmpDir);

    const result = await runRecipe(implementRecipe, config, providers, { logger: silentLogger });

    const verifyStep = result.steps.find((s) => s.name === "verify-access");
    expect(verifyStep?.result.status).toBe("success");
  });

  it("create-issue step fetches the seeded issue by identifier", async () => {
    const issueId = await seedIssue(tmpDir);
    const providers = buildProviders(tmpDir);
    const config = buildConfig(issueId, tmpDir);

    const result = await runRecipe(implementRecipe, config, providers, { logger: silentLogger });

    const fetchStep = result.steps.find((s) => s.name === "create-issue");
    expect(fetchStep?.result.status).toBe("success");
    expect(fetchStep?.result.data?.issueIdentifier).toBe(issueId);
  });

  it("create-issue writes best-candidate.md to analysis dir", async () => {
    const issueId = await seedIssue(tmpDir);
    const providers = buildProviders(tmpDir);
    const config = buildConfig(issueId, tmpDir);

    await runRecipe(implementRecipe, config, providers, { logger: silentLogger });

    const analysisDir = path.join(tmpDir, "analysis");
    const bestCandidatePath = path.join(analysisDir, "best-candidate.md");
    expect(fs.existsSync(bestCandidatePath)).toBe(true);
    const content = fs.readFileSync(bestCandidatePath, "utf-8");
    expect(content).toContain(issueId);
  });

  it("implement-fix invokes the mock coding agent", async () => {
    const issueId = await seedIssue(tmpDir);
    const onRun = vi.fn();
    const providers = buildProviders(tmpDir, onRun);
    const config = buildConfig(issueId, tmpDir);

    await runRecipe(implementRecipe, config, providers, { logger: silentLogger });

    expect(onRun).toHaveBeenCalled();
    const [callOpts] = onRun.mock.calls[0];
    expect(callOpts.prompt).toBeTruthy();
    expect(callOpts.maxTurns).toBe(5);
  });

  it("workflow completes without error when no git repo (file provider skips git ops)", async () => {
    const issueId = await seedIssue(tmpDir);
    const providers = buildProviders(tmpDir);
    const config = buildConfig(issueId, tmpDir);

    // Should not throw
    const result = await runRecipe(implementRecipe, config, providers, { logger: silentLogger });

    // All learn steps should succeed; act steps may be skipped (no git changes)
    const verifyStep = result.steps.find((s) => s.name === "verify-access");
    const fetchStep = result.steps.find((s) => s.name === "create-issue");
    expect(verifyStep?.result.status).toBe("success");
    expect(fetchStep?.result.status).toBe("success");
    // Status is either completed or partial (act phase steps may be skipped)
    expect(["completed", "partial"]).toContain(result.status);
  });

  it("fails the workflow when the issue identifier does not exist", async () => {
    const providers = buildProviders(tmpDir);
    const config = buildConfig("LOCAL-999", tmpDir);

    const result = await runRecipe(implementRecipe, config, providers, { logger: silentLogger });

    // create-issue is in learn phase — failure aborts the workflow
    expect(result.status).toBe("failed");
    const fetchStep = result.steps.find((s) => s.name === "create-issue");
    expect(fetchStep?.result.status).toBe("failed");
  });

  it("implement-fix is skipped when fix-declined.md exists in analysis dir", async () => {
    const issueId = await seedIssue(tmpDir);

    // Agent writes fix-declined.md to signal the fix should be skipped
    const agentOnRun = async () => {
      const analysisDir = path.join(tmpDir, "analysis");
      fs.mkdirSync(analysisDir, { recursive: true });
      fs.writeFileSync(path.join(analysisDir, "fix-declined.md"), "Too risky to automate.");
    };

    const providers = buildProviders(tmpDir, agentOnRun);
    const config = buildConfig(issueId, tmpDir);

    const result = await runRecipe(implementRecipe, config, providers, { logger: silentLogger });

    const implementStep = result.steps.find((s) => s.name === "implement-fix");
    expect(implementStep?.result.status).toBe("skipped");
    expect(implementStep?.result.reason).toContain("Fix declined");
  });
});

// ── create-pr path coverage ───────────────────────────────────────────────────
//
// The file source control provider returns no commits when inGitRepo=false, so
// implement-fix always skips in the default setup. These tests inject a custom
// sourceControl that simulates having commits, letting implement-fix succeed and
// create-pr run with the real file provider's PR creation logic.

/**
 * Build a source control provider that wraps fileSourceControl but overrides the
 * git-state methods to simulate a branch with commits. createPullRequest still
 * delegates to the real file provider so we get a real .pr-N.md file on disk.
 */
function buildSourceControlWithCommits(outputDir: string): SourceControlProvider {
  const real = fileSourceControl({ outputDir, logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } });
  return {
    async verifyAccess() { return real.verifyAccess(); },
    async findExistingPr() { return null; },
    async hasNewCommits() { return true; },
    async hasChanges() { return false; },
    async getChangedFiles() { return ["src/checkout.ts"]; },
    async configureBotIdentity() {},
    async createBranch() {},
    async pushBranch() {},
    async resetPaths() {},
    async stageAndCommit() {},
    async createPullRequest(opts) { return real.createPullRequest(opts); },
    async listPullRequests(opts) { return real.listPullRequests(opts); },
    async dispatchWorkflow(opts) { return real.dispatchWorkflow(opts); },
  };
}

function buildProvidersWithCommits(outputDir: string) {
  const registry = createProviderRegistry();
  registry.set("issueTracker", fileIssueTracking({ outputDir, logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
  registry.set("sourceControl", buildSourceControlWithCommits(outputDir));
  registry.set("codingAgent", makeMockAgent());
  registry.set("notification", { send: vi.fn().mockResolvedValue(undefined) });
  return registry;
}

describe("implement workflow e2e — create-pr path", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sweny-e2e-pr-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("create-pr step completes with status success when implement-fix succeeds", async () => {
    const issueId = await seedIssue(tmpDir);
    const providers = buildProvidersWithCommits(tmpDir);
    const config = buildConfig(issueId, tmpDir);

    // Ensure prs dir is created (verifyAccess on sourceControl does this)
    await providers.get<SourceControlProvider>("sourceControl").verifyAccess();

    const result = await runRecipe(implementRecipe, config, providers, { logger: silentLogger });

    const implementStep = result.steps.find((s) => s.name === "implement-fix");
    expect(implementStep?.result.status).toBe("success");

    const createPrStep = result.steps.find((s) => s.name === "create-pr");
    expect(createPrStep?.result.status).toBe("success");
  });

  it("create-pr result data contains prUrl, prNumber, and issueIdentifier", async () => {
    const issueId = await seedIssue(tmpDir);
    const providers = buildProvidersWithCommits(tmpDir);
    const config = buildConfig(issueId, tmpDir);

    await providers.get<SourceControlProvider>("sourceControl").verifyAccess();

    const result = await runRecipe(implementRecipe, config, providers, { logger: silentLogger });

    const createPrStep = result.steps.find((s) => s.name === "create-pr");
    expect(createPrStep?.result.status).toBe("success");

    const data = createPrStep?.result.data as Record<string, unknown>;
    expect(data).toBeDefined();
    expect(typeof data.prUrl).toBe("string");
    expect(data.prUrl).toMatch(/^file:\/\//);   // fileSourceControl returns a local file URL
    expect(typeof data.prNumber).toBe("number");
    expect(data.issueIdentifier).toBe(issueId);
  });

  it("fileSourceControl writes a .md file to prs/ dir when PR is created", async () => {
    const issueId = await seedIssue(tmpDir);
    const providers = buildProvidersWithCommits(tmpDir);
    const config = buildConfig(issueId, tmpDir);

    await providers.get<SourceControlProvider>("sourceControl").verifyAccess();

    await runRecipe(implementRecipe, config, providers, { logger: silentLogger });

    const prsDir = path.join(tmpDir, "prs");
    const prFiles = fs.readdirSync(prsDir).filter((f) => f.endsWith(".md"));
    expect(prFiles.length).toBeGreaterThanOrEqual(1);

    const prContent = fs.readFileSync(path.join(prsDir, prFiles[0]!), "utf-8");
    expect(prContent).toContain(`fix(${issueId})`);
    expect(prContent).toContain("open");
  });

  it("notify step runs after create-pr completes", async () => {
    const issueId = await seedIssue(tmpDir);
    const providers = buildProvidersWithCommits(tmpDir);
    const config = buildConfig(issueId, tmpDir);

    await providers.get<SourceControlProvider>("sourceControl").verifyAccess();

    const result = await runRecipe(implementRecipe, config, providers, { logger: silentLogger });

    const notifyStep = result.steps.find((s) => s.name === "notify");
    expect(notifyStep).toBeDefined();
    expect(notifyStep?.result.status).toBe("success");

    // Workflow as a whole should be completed
    expect(result.status).toBe("completed");
  });
});
