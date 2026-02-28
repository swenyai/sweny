import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — vi.hoisted() ensures variables are available when vi.mock factories run
// ---------------------------------------------------------------------------

const fsMock = vi.hoisted(() => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock("fs", () => fsMock);

import type { ActionConfig } from "../../src/config.js";
import type { Providers } from "../../src/providers/index.js";
import type { InvestigationResult } from "../../src/phases/investigate.js";
import type { ImplementResult } from "../../src/phases/implement.js";
import { notify } from "../../src/phases/notify.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<ActionConfig> = {}): ActionConfig {
  return {
    anthropicApiKey: "",
    claudeOauthToken: "",
    observabilityProvider: "datadog",
    observabilityCredentials: { apiKey: "dd-api", appKey: "dd-app", site: "datadoghq.com" },
    issueTrackerProvider: "linear",
    linearApiKey: "lin_test",
    linearTeamId: "team-1",
    linearBugLabelId: "label-1",
    linearTriageLabelId: "label-2",
    linearStateBacklog: "state-1",
    linearStateInProgress: "state-2",
    linearStatePeerReview: "state-3",
    timeRange: "24h",
    severityFocus: "errors",
    serviceFilter: "my-service",
    investigationDepth: "standard",
    maxInvestigateTurns: 50,
    maxImplementTurns: 30,
    dryRun: false,
    noveltyMode: false,
    linearIssue: "",
    additionalInstructions: "",
    serviceMapPath: ".github/service-map.yml",
    githubToken: "ghp_test",
    botToken: "",
    repository: "org/repo",
    repositoryOwner: "org",
    ...overrides,
  };
}

function makeProviders(): Providers {
  return {
    observability: {
      verifyAccess: vi.fn(),
      queryLogs: vi.fn(),
      aggregate: vi.fn(),
    },
    issueTracker: {
      verifyAccess: vi.fn(),
      createIssue: vi.fn(),
      getIssue: vi.fn(),
      updateIssue: vi.fn(),
      searchIssues: vi.fn(),
      addComment: vi.fn(),
      linkPr: vi.fn(),
      listTriageHistory: vi.fn(),
    },
    sourceControl: {
      verifyAccess: vi.fn(),
      configureBotIdentity: vi.fn(),
      createBranch: vi.fn(),
      pushBranch: vi.fn(),
      hasChanges: vi.fn(),
      hasNewCommits: vi.fn(),
      getChangedFiles: vi.fn(),
      resetPaths: vi.fn(),
      stageAndCommit: vi.fn(),
      createPullRequest: vi.fn(),
      listPullRequests: vi.fn(),
      findExistingPr: vi.fn(),
      dispatchWorkflow: vi.fn(),
    },
    notification: {
      send: vi.fn().mockResolvedValue(undefined),
    },
    codingAgent: {
      install: vi.fn(),
      run: vi.fn(),
    },
  } as unknown as Providers;
}

function makeInvestigation(
  overrides: Partial<InvestigationResult> = {},
): InvestigationResult {
  return {
    issuesFound: true,
    bestCandidate: true,
    recommendation: "implement",
    existingIssue: "",
    targetRepo: "",
    shouldImplement: true,
    ...overrides,
  };
}

function makeImplementation(
  overrides: Partial<ImplementResult> = {},
): ImplementResult {
  return {
    issueIdentifier: "ENG-999",
    issueUrl: "https://linear.app/ENG-999",
    prUrl: "https://github.com/org/repo/pull/42",
    prNumber: 42,
    skipped: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("notify", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fsMock.existsSync.mockReturnValue(false);
    fsMock.readFileSync.mockReturnValue("");
  });

  it("sends notification with basic summary fields", async () => {
    const providers = makeProviders();

    await notify(makeConfig(), providers, makeInvestigation());

    expect(providers.notification.send).toHaveBeenCalledOnce();
    const payload = vi.mocked(providers.notification.send).mock.calls[0][0];
    expect(payload.title).toBe("SWEny Triage Summary");
    expect(payload.format).toBe("markdown");

    const body = payload.body;
    expect(body).toContain("**Run Date**:");
    expect(body).toContain("**Service Filter**: `my-service`");
    expect(body).toContain("**Time Range**: `24h`");
    expect(body).toContain("**Dry Run**: false");
    expect(body).toContain("**Recommendation**: implement");
  });

  it("includes Linear issue link when implementation has issueIdentifier", async () => {
    const providers = makeProviders();

    await notify(
      makeConfig(),
      providers,
      makeInvestigation(),
      makeImplementation({
        issueIdentifier: "ENG-777",
        issueUrl: "https://linear.app/ENG-777",
      }),
    );

    const body = vi.mocked(providers.notification.send).mock.calls[0][0].body;
    expect(body).toContain("[ENG-777](https://linear.app/ENG-777)");
  });

  it("omits Linear issue link when implementation has no issueIdentifier", async () => {
    const providers = makeProviders();

    await notify(
      makeConfig(),
      providers,
      makeInvestigation(),
      makeImplementation({ issueIdentifier: "", issueUrl: "" }),
    );

    const body = vi.mocked(providers.notification.send).mock.calls[0][0].body;
    expect(body).not.toContain("**Linear Issue**");
  });

  it("omits Linear issue link when no implementation provided", async () => {
    const providers = makeProviders();

    await notify(makeConfig(), providers, makeInvestigation());

    const body = vi.mocked(providers.notification.send).mock.calls[0][0].body;
    expect(body).not.toContain("**Linear Issue**");
  });

  // -------------------------------------------------------------------------
  // Status messages
  // -------------------------------------------------------------------------

  describe("status messages", () => {
    it("shows cross-repo dispatch message", async () => {
      const providers = makeProviders();

      await notify(
        makeConfig({ repository: "org/repo" }),
        providers,
        makeInvestigation({ targetRepo: "other-org/other-repo" }),
      );

      const body = vi.mocked(providers.notification.send).mock.calls[0][0].body;
      expect(body).toContain("Cross-repo dispatch");
      expect(body).toContain("other-org/other-repo");
    });

    it("shows skip message when recommendation is skip", async () => {
      const providers = makeProviders();

      await notify(
        makeConfig(),
        providers,
        makeInvestigation({ recommendation: "skip" }),
      );

      const body = vi.mocked(providers.notification.send).mock.calls[0][0].body;
      expect(body).toContain("**Skipped**: No novel issues found");
    });

    it("shows +1 existing message", async () => {
      const providers = makeProviders();

      await notify(
        makeConfig(),
        providers,
        makeInvestigation({ recommendation: "+1 existing ENG-123" }),
      );

      const body = vi.mocked(providers.notification.send).mock.calls[0][0].body;
      expect(body).toContain("+1 Existing");
      expect(body).toContain("Added occurrence to existing issue");
    });

    it("shows skip reason from implementation", async () => {
      const providers = makeProviders();

      await notify(
        makeConfig(),
        providers,
        makeInvestigation({ recommendation: "implement" }),
        makeImplementation({
          skipped: true,
          skipReason: "No code changes produced",
          prUrl: "",
        }),
      );

      const body = vi.mocked(providers.notification.send).mock.calls[0][0].body;
      expect(body).toContain("**Skipped**: No code changes produced");
    });

    it("shows success message with PR URL", async () => {
      const providers = makeProviders();

      await notify(
        makeConfig(),
        providers,
        makeInvestigation({ recommendation: "implement" }),
        makeImplementation({
          prUrl: "https://github.com/org/repo/pull/42",
          skipped: false,
        }),
      );

      const body = vi.mocked(providers.notification.send).mock.calls[0][0].body;
      expect(body).toContain("**Success**: New PR created");
      expect(body).toContain("https://github.com/org/repo/pull/42");
    });

    it("shows dry run message when dryRun is true", async () => {
      const providers = makeProviders();

      await notify(
        makeConfig({ dryRun: true }),
        providers,
        makeInvestigation({ recommendation: "implement" }),
      );

      const body = vi.mocked(providers.notification.send).mock.calls[0][0].body;
      expect(body).toContain("**Dry Run**: Analysis only");
    });
  });

  // -------------------------------------------------------------------------
  // Appendices
  // -------------------------------------------------------------------------

  describe("appendices", () => {
    it("appends investigation log when it exists", async () => {
      const providers = makeProviders();
      fsMock.existsSync.mockImplementation((p: string) => {
        if (p.endsWith("investigation-log.md")) return true;
        return false;
      });
      fsMock.readFileSync.mockImplementation((p: string) => {
        if (typeof p === "string" && p.endsWith("investigation-log.md")) {
          return "Step 1: Queried Datadog\nStep 2: Found errors";
        }
        return "";
      });

      await notify(makeConfig(), providers, makeInvestigation());

      const body = vi.mocked(providers.notification.send).mock.calls[0][0].body;
      expect(body).toContain("### Investigation Log");
      expect(body).toContain("Step 1: Queried Datadog");
    });

    it("appends issues report when it exists", async () => {
      const providers = makeProviders();
      fsMock.existsSync.mockImplementation((p: string) => {
        if (p.endsWith("issues-report.md")) return true;
        return false;
      });
      fsMock.readFileSync.mockImplementation((p: string) => {
        if (typeof p === "string" && p.endsWith("issues-report.md")) {
          return "Issue 1: TypeError in handler\nIssue 2: Null ref";
        }
        return "";
      });

      await notify(makeConfig(), providers, makeInvestigation());

      const body = vi.mocked(providers.notification.send).mock.calls[0][0].body;
      expect(body).toContain("### Issues Found");
      expect(body).toContain("Issue 1: TypeError in handler");
    });

    it("appends both investigation log and issues report", async () => {
      const providers = makeProviders();
      fsMock.existsSync.mockReturnValue(true);
      fsMock.readFileSync.mockImplementation((p: string) => {
        if (typeof p === "string" && p.endsWith("investigation-log.md")) {
          return "Log content";
        }
        if (typeof p === "string" && p.endsWith("issues-report.md")) {
          return "Report content";
        }
        return "";
      });

      await notify(makeConfig(), providers, makeInvestigation());

      const body = vi.mocked(providers.notification.send).mock.calls[0][0].body;
      expect(body).toContain("### Investigation Log");
      expect(body).toContain("Log content");
      expect(body).toContain("### Issues Found");
      expect(body).toContain("Report content");
    });

    it("omits appendices when files do not exist", async () => {
      const providers = makeProviders();
      fsMock.existsSync.mockReturnValue(false);

      await notify(makeConfig(), providers, makeInvestigation());

      const body = vi.mocked(providers.notification.send).mock.calls[0][0].body;
      expect(body).not.toContain("### Investigation Log");
      expect(body).not.toContain("### Issues Found");
    });
  });
});
