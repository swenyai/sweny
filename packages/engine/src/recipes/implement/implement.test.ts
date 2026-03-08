import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "node:fs";
import { runRecipe } from "../../runner-recipe.js";
import { createProviderRegistry } from "../../runner-recipe.js";
import { implementRecipe } from "./index.js";
import { fetchIssue } from "./steps/fetch-issue.js";
import { verifyAccess } from "./steps/verify-access.js";
import type { ImplementConfig } from "./types.js";
import type { ProviderRegistry, WorkflowContext } from "../../types.js";

vi.mock("fs");

vi.mock("../triage/prompts.js", () => ({
  buildInvestigationPrompt: vi.fn().mockReturnValue("mock prompt"),
  buildImplementPrompt: vi.fn().mockReturnValue("mock implement prompt"),
  buildPrDescriptionPrompt: vi.fn().mockReturnValue("mock pr desc prompt"),
}));

const silentLogger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };

const defaultConfig: ImplementConfig = {
  issueIdentifier: "ENG-123",
  repository: "org/repo",
  dryRun: false,
  maxImplementTurns: 10,
  agentEnv: {},
  projectId: "proj-1",
  stateInProgress: "state-progress",
  statePeerReview: "state-review",
};

const mockIssue = {
  id: "issue-id-1",
  identifier: "ENG-123",
  title: "Fix the bug",
  url: "https://linear.app/org/issue/ENG-123",
  branchName: "eng-123-fix-the-bug",
  description: "The thing is broken.",
};

const mockPr = {
  number: 42,
  url: "https://github.com/org/repo/pull/42",
  state: "open" as const,
  title: "fix(ENG-123): Fix the bug",
};

function createMockProviders(): ProviderRegistry {
  const registry = createProviderRegistry();

  registry.set("issueTracker", {
    verifyAccess: vi.fn().mockResolvedValue(undefined),
    getIssue: vi.fn().mockResolvedValue(mockIssue),
    createIssue: vi.fn(),
    updateIssue: vi.fn().mockResolvedValue(undefined),
    listIssues: vi.fn().mockResolvedValue([]),
  });

  registry.set("sourceControl", {
    verifyAccess: vi.fn().mockResolvedValue(undefined),
    createBranch: vi.fn().mockResolvedValue(undefined),
    configureBotIdentity: vi.fn().mockResolvedValue(undefined),
    resetPaths: vi.fn().mockResolvedValue(undefined),
    findExistingPr: vi.fn().mockResolvedValue(null),
    createPr: vi.fn().mockResolvedValue(mockPr),
    pushBranch: vi.fn().mockResolvedValue(undefined),
    hasNewCommits: vi.fn().mockResolvedValue(true),
    getChangedFiles: vi.fn().mockResolvedValue(["src/file.ts"]),
    hasChanges: vi.fn().mockResolvedValue(false),
    getDefaultBranch: vi.fn().mockResolvedValue("main"),
  });

  registry.set("codingAgent", {
    install: vi.fn().mockResolvedValue(undefined),
    run: vi.fn().mockResolvedValue({ output: "done", exitCode: 0 }),
  });

  registry.set("notification", {
    send: vi.fn().mockResolvedValue(undefined),
  });

  return registry;
}

describe("implement workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const fsMock = vi.mocked(fs);
    fsMock.mkdirSync = vi.fn().mockReturnValue(undefined);
    fsMock.writeFileSync = vi.fn();
    // fix-declined.md does not exist → implement proceeds
    fsMock.existsSync = vi.fn().mockReturnValue(false);
    fsMock.readFileSync = vi.fn().mockReturnValue("");
  });

  it("fetches issue via create-issue step and calls getIssue with the right identifier", async () => {
    const providers = createMockProviders();
    const issueTracker = providers.get<{ getIssue: ReturnType<typeof vi.fn> }>("issueTracker");

    const result = await runRecipe(implementRecipe, defaultConfig, providers, { logger: silentLogger });

    expect(issueTracker.getIssue).toHaveBeenCalledWith("ENG-123");
    // All learn steps passed, so at least learn phase is done
    const createIssueStep = result.steps.find((s) => s.name === "create-issue");
    expect(createIssueStep?.result.status).toBe("success");
    expect(createIssueStep?.result.data?.issueIdentifier).toBe("ENG-123");
  });

  it("skips create-pr when implement-fix is skipped due to existing PR", async () => {
    const providers = createMockProviders();
    const sourceControl = providers.get<{ findExistingPr: ReturnType<typeof vi.fn> }>("sourceControl");
    sourceControl.findExistingPr.mockResolvedValue({ ...mockPr, state: "open" });

    const result = await runRecipe(implementRecipe, defaultConfig, providers, { logger: silentLogger });

    const implementStep = result.steps.find((s) => s.name === "implement-fix");
    const prStep = result.steps.find((s) => s.name === "create-pr");
    expect(implementStep?.result.status).toBe("skipped");
    expect(prStep?.result.status).toBe("skipped");
  });

  it("fails workflow with status 'failed' when fetch-issue throws", async () => {
    const providers = createMockProviders();
    const issueTracker = providers.get<{ getIssue: ReturnType<typeof vi.fn> }>("issueTracker");
    issueTracker.getIssue.mockRejectedValue(new Error("Issue not found"));

    const result = await runRecipe(implementRecipe, defaultConfig, providers, { logger: silentLogger });

    // create-issue is in the learn phase → failure aborts the workflow
    expect(result.status).toBe("failed");
  });
});

describe("fetchIssue step", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const fsMock = vi.mocked(fs);
    fsMock.mkdirSync = vi.fn().mockReturnValue(undefined);
    fsMock.writeFileSync = vi.fn();
  });

  it("writes a best-candidate.md file with issue details", async () => {
    const providers = createMockProviders();
    const ctx: WorkflowContext<ImplementConfig> = {
      config: defaultConfig,
      logger: silentLogger,
      results: new Map(),
      providers,
    };

    const result = await fetchIssue(ctx);

    expect(result.status).toBe("success");
    expect(result.data?.issueIdentifier).toBe("ENG-123");
    expect(vi.mocked(fs).writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining("best-candidate.md"),
      expect.stringContaining("ENG-123"),
    );
  });
});

describe("verifyAccess step (implement)", () => {
  it("verifies issueTracker and sourceControl", async () => {
    const providers = createMockProviders();
    const ctx: WorkflowContext<ImplementConfig> = {
      config: defaultConfig,
      logger: silentLogger,
      results: new Map(),
      providers,
    };

    const result = await verifyAccess(ctx);

    expect(result.status).toBe("success");
    const issueTracker = providers.get<{ verifyAccess: ReturnType<typeof vi.fn> }>("issueTracker");
    const sourceControl = providers.get<{ verifyAccess: ReturnType<typeof vi.fn> }>("sourceControl");
    expect(issueTracker.verifyAccess).toHaveBeenCalled();
    expect(sourceControl.verifyAccess).toHaveBeenCalled();
  });
});
