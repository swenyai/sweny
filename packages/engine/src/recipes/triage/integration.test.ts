import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "node:fs";
import { runRecipe, createProviderRegistry } from "../../runner-recipe.js";
import { triageRecipe } from "./index.js";
import { defaultConfig, silentLogger } from "./test-helpers.js";
import type { TriageConfig } from "./types.js";
import type { ProviderRegistry, WorkflowResult } from "../../types.js";

// ---------------------------------------------------------------------------
// Mock fs globally — many steps read/write files
// ---------------------------------------------------------------------------

vi.mock("fs");

// Mock prompts module to avoid fs reads inside buildInvestigationPrompt
vi.mock("./prompts.js", () => ({
  buildInvestigationPrompt: vi.fn().mockReturnValue("mock investigation prompt"),
  buildImplementPrompt: vi.fn().mockReturnValue("mock implement prompt"),
  buildPrDescriptionPrompt: vi.fn().mockReturnValue("mock pr description prompt"),
}));

// Mock service-map to avoid fs reads inside parseServiceMap
vi.mock("./service-map.js", () => ({
  parseServiceMap: vi.fn().mockReturnValue({ services: [] }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Standard mock issue returned by the issue tracker. */
const mockIssue = {
  id: "issue-id-1",
  identifier: "ENG-100",
  title: "Test issue title",
  url: "https://tracker.example.com/ENG-100",
  branchName: "eng-100-fix",
};

/** Standard mock PR returned by source control. */
const mockPr = {
  number: 42,
  url: "https://github.com/org/repo/pull/42",
  state: "open" as const,
  title: "fix(ENG-100): test issue title",
};

function createMockProviders(): ProviderRegistry {
  const registry = createProviderRegistry();

  registry.set("observability", {
    verifyAccess: vi.fn().mockResolvedValue(undefined),
    queryLogs: vi.fn().mockResolvedValue([]),
    aggregate: vi.fn().mockResolvedValue([]),
    getAgentEnv: vi.fn().mockReturnValue({}),
    getPromptInstructions: vi.fn().mockReturnValue("mock observability instructions"),
  });

  registry.set("issueTracker", {
    verifyAccess: vi.fn().mockResolvedValue(undefined),
    createIssue: vi.fn().mockResolvedValue(mockIssue),
    getIssue: vi.fn().mockResolvedValue(mockIssue),
    updateIssue: vi.fn().mockResolvedValue(undefined),
    searchIssues: vi.fn().mockResolvedValue([]),
    addComment: vi.fn().mockResolvedValue(undefined),
    linkPr: vi.fn().mockResolvedValue(undefined),
    searchIssuesByLabel: vi.fn().mockResolvedValue([]),
  });

  registry.set("sourceControl", {
    verifyAccess: vi.fn().mockResolvedValue(undefined),
    configureBotIdentity: vi.fn().mockResolvedValue(undefined),
    createBranch: vi.fn().mockResolvedValue(undefined),
    pushBranch: vi.fn().mockResolvedValue(undefined),
    hasChanges: vi.fn().mockResolvedValue(false),
    hasNewCommits: vi.fn().mockResolvedValue(true),
    getChangedFiles: vi.fn().mockResolvedValue(["src/fix.ts"]),
    resetPaths: vi.fn().mockResolvedValue(undefined),
    stageAndCommit: vi.fn().mockResolvedValue(undefined),
    createPullRequest: vi.fn().mockResolvedValue(mockPr),
    findExistingPr: vi.fn().mockResolvedValue(null),
    dispatchWorkflow: vi.fn().mockResolvedValue(undefined),
    listPullRequests: vi.fn().mockResolvedValue([]),
  });

  registry.set("notification", {
    send: vi.fn().mockResolvedValue(undefined),
  });

  registry.set("codingAgent", {
    install: vi.fn().mockResolvedValue(undefined),
    run: vi.fn().mockResolvedValue(0),
  });

  return registry;
}

function getProvider<T>(registry: ProviderRegistry, key: string): T {
  return registry.get<T>(key);
}

/** Configure fs mocks to simulate investigation output files. */
function mockFsForInvestigation(
  recommendation: string,
  options?: {
    bestCandidateExists?: boolean;
    issuesReportExists?: boolean;
    targetRepo?: string;
    bestCandidateContent?: string;
    prDescriptionExists?: boolean;
    fixDeclinedExists?: boolean;
    investigationLogExists?: boolean;
  },
): void {
  const bestCandidateExists = options?.bestCandidateExists ?? true;
  const issuesReportExists = options?.issuesReportExists ?? true;
  const prDescriptionExists = options?.prDescriptionExists ?? false;
  const fixDeclinedExists = options?.fixDeclinedExists ?? false;
  const investigationLogExists = options?.investigationLogExists ?? false;

  const bestCandidateContent =
    options?.bestCandidateContent ??
    [
      `# Test issue title`,
      `RECOMMENDATION: ${recommendation}`,
      options?.targetRepo ? `TARGET_REPO: ${options.targetRepo}` : "",
      "",
      "## Analysis",
      "Some analysis details here.",
    ]
      .filter(Boolean)
      .join("\n");

  vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
  vi.mocked(fs.writeFileSync).mockReturnValue(undefined);

  vi.mocked(fs.existsSync).mockImplementation((p) => {
    const path = String(p);
    if (path.includes("best-candidate.md")) return bestCandidateExists;
    if (path.includes("issues-report.md")) return issuesReportExists;
    if (path.includes("pr-description.md")) return prDescriptionExists;
    if (path.includes("fix-declined.md")) return fixDeclinedExists;
    if (path.includes("investigation-log.md")) return investigationLogExists;
    if (path.includes("service-map")) return false;
    return false;
  });

  vi.mocked(fs.readFileSync).mockImplementation((p) => {
    const path = String(p);
    if (path.includes("best-candidate.md")) return bestCandidateContent;
    if (path.includes("issues-report.md")) return "## Issues Report\n- Issue 1";
    if (path.includes("pr-description.md")) return "## PR Description\nAutomated fix";
    if (path.includes("investigation-log.md")) return "## Investigation Log\nStep 1...";
    return "";
  });
}

function stepResult(result: WorkflowResult, stepName: string) {
  return result.steps.find((s) => s.name === stepName);
}

// ---------------------------------------------------------------------------
// Integration Tests
// ---------------------------------------------------------------------------

describe("triage recipe integration", () => {
  let providers: ProviderRegistry;
  let config: TriageConfig;

  beforeEach(() => {
    vi.restoreAllMocks();
    providers = createMockProviders();
    config = { ...defaultConfig };
  });

  // =========================================================================
  // 1. Full successful triage run (dry-run)
  // =========================================================================

  it("completes a full dry-run: learn succeeds, novelty-gate routes to notify", async () => {
    config.dryRun = true;
    mockFsForInvestigation("implement");

    const result = await runRecipe(triageRecipe, config, providers, {
      logger: silentLogger,
    });

    // Overall status
    expect(result.status).toBe("completed");

    // Learn phase — all succeed (3 nodes)
    expect(stepResult(result, "verify-access")?.result.status).toBe("success");
    expect(stepResult(result, "build-context")?.result.status).toBe("success");
    expect(stepResult(result, "investigate")?.result.status).toBe("success");

    // novelty-gate routes to notify (outcome: "skip")
    expect(stepResult(result, "novelty-gate")?.result.status).toBe("success");
    expect(stepResult(result, "novelty-gate")?.result.data).toMatchObject({
      action: "dry-run",
      outcome: "skip",
    });

    // create-issue, cross-repo-check, implement-fix, create-pr are NOT visited
    expect(stepResult(result, "create-issue")).toBeUndefined();
    expect(stepResult(result, "cross-repo-check")).toBeUndefined();
    expect(stepResult(result, "implement-fix")).toBeUndefined();
    expect(stepResult(result, "create-pr")).toBeUndefined();

    // Report phase — notify runs
    expect(stepResult(result, "notify")?.result.status).toBe("success");

    // Verify notification was sent with dry run context
    const notification = getProvider<{ send: ReturnType<typeof vi.fn> }>(providers, "notification");
    expect(notification.send).toHaveBeenCalledTimes(1);
    const sentPayload = notification.send.mock.calls[0][0];
    expect(sentPayload.body).toContain("Dry Run");
    expect(sentPayload.body).toContain("true");

    // Duration should be populated
    expect(result.duration).toBeGreaterThanOrEqual(0);
  });

  // =========================================================================
  // 2. Skip recommendation flow
  // =========================================================================

  it("handles skip recommendation: novelty-gate routes to notify", async () => {
    mockFsForInvestigation("skip");

    const result = await runRecipe(triageRecipe, config, providers, {
      logger: silentLogger,
    });

    expect(result.status).toBe("completed");

    // Learn phase — all succeed
    expect(stepResult(result, "verify-access")?.result.status).toBe("success");
    expect(stepResult(result, "build-context")?.result.status).toBe("success");
    expect(stepResult(result, "investigate")?.result.status).toBe("success");

    // novelty-gate routes to notify via outcome: "skip"
    expect(stepResult(result, "novelty-gate")?.result.status).toBe("success");
    expect(stepResult(result, "novelty-gate")?.result.data).toMatchObject({
      action: "skip",
      outcome: "skip",
      recommendation: "skip",
    });

    // Intermediate act steps not visited
    expect(stepResult(result, "create-issue")).toBeUndefined();
    expect(stepResult(result, "cross-repo-check")).toBeUndefined();
    expect(stepResult(result, "implement-fix")).toBeUndefined();
    expect(stepResult(result, "create-pr")).toBeUndefined();

    // Report phase — notify runs
    expect(stepResult(result, "notify")?.result.status).toBe("success");

    // Verify notification mentions skip
    const notification = getProvider<{ send: ReturnType<typeof vi.fn> }>(providers, "notification");
    const sentPayload = notification.send.mock.calls[0][0];
    expect(sentPayload.body).toContain("Skipped");
    expect(sentPayload.body).toContain("No novel issues found");
  });

  // =========================================================================
  // 3. +1 existing issue flow
  // =========================================================================

  it("handles +1 existing issue: adds comment, routes to notify", async () => {
    mockFsForInvestigation("+1 existing ENG-123");

    const issueTracker = getProvider<{
      getIssue: ReturnType<typeof vi.fn>;
      addComment: ReturnType<typeof vi.fn>;
    }>(providers, "issueTracker");
    issueTracker.getIssue.mockResolvedValue({
      id: "existing-id",
      identifier: "ENG-123",
      title: "Existing issue",
      url: "https://tracker.example.com/ENG-123",
      branchName: "eng-123-fix",
    });

    const result = await runRecipe(triageRecipe, config, providers, {
      logger: silentLogger,
    });

    expect(result.status).toBe("completed");

    // Learn phase
    expect(stepResult(result, "verify-access")?.result.status).toBe("success");
    expect(stepResult(result, "build-context")?.result.status).toBe("success");
    expect(stepResult(result, "investigate")?.result.status).toBe("success");

    // novelty-gate adds comment and routes to notify
    expect(stepResult(result, "novelty-gate")?.result.status).toBe("success");
    expect(stepResult(result, "novelty-gate")?.result.data).toMatchObject({
      action: "+1",
      outcome: "skip",
      issueIdentifier: "ENG-123",
    });

    // Verify getIssue and addComment were called by novelty-gate
    expect(issueTracker.getIssue).toHaveBeenCalledWith("ENG-123");
    expect(issueTracker.addComment).toHaveBeenCalledWith("existing-id", expect.stringContaining("+1 detected on"));

    // Intermediate act steps not visited
    expect(stepResult(result, "create-issue")).toBeUndefined();
    expect(stepResult(result, "cross-repo-check")).toBeUndefined();
    expect(stepResult(result, "implement-fix")).toBeUndefined();
    expect(stepResult(result, "create-pr")).toBeUndefined();

    // Report phase — notify runs
    expect(stepResult(result, "notify")?.result.status).toBe("success");

    // Verify notification mentions +1
    const notification = getProvider<{ send: ReturnType<typeof vi.fn> }>(providers, "notification");
    const sentPayload = notification.send.mock.calls[0][0];
    expect(sentPayload.body).toContain("+1 Existing");
  });

  // =========================================================================
  // 4. Verify-access failure aborts workflow
  // =========================================================================

  it("aborts workflow when verify-access fails", async () => {
    mockFsForInvestigation("implement");

    // Make observability.verifyAccess throw
    const observability = getProvider<{ verifyAccess: ReturnType<typeof vi.fn> }>(providers, "observability");
    observability.verifyAccess.mockRejectedValue(new Error("Datadog API key invalid"));

    const result = await runRecipe(triageRecipe, config, providers, {
      logger: silentLogger,
    });

    // Workflow should be failed (critical node failure aborts everything)
    expect(result.status).toBe("failed");

    // verify-access should have failed
    expect(stepResult(result, "verify-access")?.result.status).toBe("failed");
    expect(stepResult(result, "verify-access")?.result.reason).toBe("Datadog API key invalid");

    // Only dedup-check (succeeds) + verify-access (fails) should have run
    expect(result.steps).toHaveLength(2);

    // Verify no other providers were called
    const issueTracker = getProvider<{ verifyAccess: ReturnType<typeof vi.fn> }>(providers, "issueTracker");
    expect(issueTracker.verifyAccess).not.toHaveBeenCalled();

    const codingAgent = getProvider<{ install: ReturnType<typeof vi.fn> }>(providers, "codingAgent");
    expect(codingAgent.install).not.toHaveBeenCalled();

    const notification = getProvider<{ send: ReturnType<typeof vi.fn> }>(providers, "notification");
    expect(notification.send).not.toHaveBeenCalled();
  });

  // =========================================================================
  // 5. Full implement flow (happy path)
  // =========================================================================

  it("runs all 9 steps through full implement flow with PR creation", async () => {
    mockFsForInvestigation("implement", {
      prDescriptionExists: true,
    });

    const issueTracker = getProvider<{
      searchIssues: ReturnType<typeof vi.fn>;
      createIssue: ReturnType<typeof vi.fn>;
    }>(providers, "issueTracker");
    // No existing issues found — force creation of a new one
    issueTracker.searchIssues.mockResolvedValue([]);
    issueTracker.createIssue.mockResolvedValue(mockIssue);

    const sourceControl = getProvider<{
      findExistingPr: ReturnType<typeof vi.fn>;
      hasNewCommits: ReturnType<typeof vi.fn>;
      getChangedFiles: ReturnType<typeof vi.fn>;
      createPullRequest: ReturnType<typeof vi.fn>;
    }>(providers, "sourceControl");
    sourceControl.findExistingPr.mockResolvedValue(null);
    sourceControl.hasNewCommits.mockResolvedValue(true);
    sourceControl.getChangedFiles.mockResolvedValue(["src/fix.ts"]);
    sourceControl.createPullRequest.mockResolvedValue(mockPr);

    const result = await runRecipe(triageRecipe, config, providers, {
      logger: silentLogger,
    });

    // Overall status
    expect(result.status).toBe("completed");

    // All 9 steps should be present
    expect(result.steps).toHaveLength(10);

    // Verify step order matches the recipe definition
    const stepNames = result.steps.map((s) => s.name);
    expect(stepNames).toEqual([
      "dedup-check",
      "verify-access",
      "build-context",
      "investigate",
      "novelty-gate",
      "create-issue",
      "cross-repo-check",
      "implement-fix",
      "create-pr",
      "notify",
    ]);

    // All steps should succeed
    for (const step of result.steps) {
      expect(step.result.status).toBe("success");
    }

    // Verify phase assignments
    expect(stepResult(result, "verify-access")?.phase).toBe("learn");
    expect(stepResult(result, "build-context")?.phase).toBe("learn");
    expect(stepResult(result, "investigate")?.phase).toBe("learn");
    expect(stepResult(result, "novelty-gate")?.phase).toBe("act");
    expect(stepResult(result, "create-issue")?.phase).toBe("act");
    expect(stepResult(result, "cross-repo-check")?.phase).toBe("act");
    expect(stepResult(result, "implement-fix")?.phase).toBe("act");
    expect(stepResult(result, "create-pr")?.phase).toBe("act");
    expect(stepResult(result, "notify")?.phase).toBe("report");

    // Verify data propagation: investigate → novelty-gate
    expect(stepResult(result, "novelty-gate")?.result.data).toMatchObject({
      action: "implement",
      outcome: "implement",
    });

    // Verify data propagation: create-issue → implement-fix → create-pr
    expect(stepResult(result, "create-issue")?.result.data).toMatchObject({
      issueId: mockIssue.id,
      issueIdentifier: mockIssue.identifier,
      issueUrl: mockIssue.url,
    });

    expect(stepResult(result, "implement-fix")?.result.data).toMatchObject({
      branchName: expect.any(String),
      hasCodeChanges: true,
    });

    expect(stepResult(result, "create-pr")?.result.data).toMatchObject({
      issueIdentifier: mockIssue.identifier,
      issueUrl: mockIssue.url,
      prUrl: mockPr.url,
      prNumber: mockPr.number,
    });

    // Verify PR data propagates to notification
    const notification = getProvider<{ send: ReturnType<typeof vi.fn> }>(providers, "notification");
    expect(notification.send).toHaveBeenCalledTimes(1);
    const sentPayload = notification.send.mock.calls[0][0];
    expect(sentPayload.body).toContain(mockPr.url);
    expect(sentPayload.body).toContain("Success");
    expect(sentPayload.body).toContain(mockIssue.identifier);

    // Verify coding agent was invoked for investigation, implementation, and PR description
    const codingAgent = getProvider<{ run: ReturnType<typeof vi.fn> }>(providers, "codingAgent");
    expect(codingAgent.run).toHaveBeenCalledTimes(3);

    // Verify issue was created (not just searched)
    expect(issueTracker.createIssue).toHaveBeenCalledTimes(1);

    // Verify PR was created with correct branch
    expect(sourceControl.createPullRequest).toHaveBeenCalledTimes(1);
    expect(sourceControl.createPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        head: expect.any(String),
        base: "main",
        labels: expect.arrayContaining(["triage"]),
      }),
    );
  });
});
