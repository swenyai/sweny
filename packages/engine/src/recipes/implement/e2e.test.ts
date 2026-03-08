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
import { createProviderRegistry } from "../../runner.js";
import { implementRecipe } from "./index.js";
import { fileIssueTracking } from "@sweny-ai/providers/issue-tracking";
import { fileSourceControl } from "@sweny-ai/providers/source-control";
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
