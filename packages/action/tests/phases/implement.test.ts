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

vi.mock("@actions/core", () => ({
  startGroup: vi.fn(),
  endGroup: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  notice: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
  setOutput: vi.fn(),
  setFailed: vi.fn(),
}));

vi.mock("fs", () => fsMock);

import type { ActionConfig } from "../../src/config.js";
import type { Providers } from "../../src/providers/index.js";
import type { InvestigationResult } from "../../src/phases/investigate.js";
import { implement } from "../../src/phases/implement.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<ActionConfig> = {}): ActionConfig {
  return {
    anthropicApiKey: "sk-test",
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

function makeProviders(overrides?: Record<string, unknown>): Providers {
  return {
    observability: {
      verifyAccess: vi.fn().mockResolvedValue(undefined),
      queryLogs: vi.fn().mockResolvedValue([]),
      aggregate: vi.fn().mockResolvedValue([]),
    },
    issueTracker: {
      verifyAccess: vi.fn().mockResolvedValue(undefined),
      createIssue: vi.fn().mockResolvedValue({
        id: "issue-id-1",
        identifier: "ENG-999",
        title: "Test issue",
        url: "https://linear.app/ENG-999",
        branchName: "",
      }),
      getIssue: vi.fn().mockResolvedValue({
        id: "issue-id-1",
        identifier: "ENG-999",
        title: "Test issue",
        url: "https://linear.app/ENG-999",
        branchName: "",
      }),
      updateIssue: vi.fn().mockResolvedValue(undefined),
      searchIssues: vi.fn().mockResolvedValue([]),
      addComment: vi.fn().mockResolvedValue(undefined),
      linkPr: vi.fn().mockResolvedValue(undefined),
      listTriageHistory: vi.fn().mockResolvedValue([]),
    },
    sourceControl: {
      verifyAccess: vi.fn().mockResolvedValue(undefined),
      configureBotIdentity: vi.fn().mockResolvedValue(undefined),
      createBranch: vi.fn().mockResolvedValue(undefined),
      pushBranch: vi.fn().mockResolvedValue(undefined),
      hasChanges: vi.fn().mockResolvedValue(false),
      hasNewCommits: vi.fn().mockResolvedValue(true),
      getChangedFiles: vi.fn().mockResolvedValue(["src/fix.ts"]),
      resetPaths: vi.fn().mockResolvedValue(undefined),
      stageAndCommit: vi.fn().mockResolvedValue(undefined),
      createPullRequest: vi.fn().mockResolvedValue({
        number: 42,
        url: "https://github.com/org/repo/pull/42",
        state: "open",
        title: "fix(ENG-999): test fix",
      }),
      listPullRequests: vi.fn().mockResolvedValue([]),
      findExistingPr: vi.fn().mockResolvedValue(null),
      dispatchWorkflow: vi.fn().mockResolvedValue(undefined),
    },
    notification: {
      send: vi.fn().mockResolvedValue(undefined),
    },
    codingAgent: {
      install: vi.fn().mockResolvedValue(undefined),
      run: vi.fn().mockResolvedValue(0),
    },
    ...overrides,
  } as unknown as Providers;
}

function makeInvestigation(overrides: Partial<InvestigationResult> = {}): InvestigationResult {
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("implement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: best-candidate.md exists, others do not
    fsMock.existsSync.mockImplementation((p: string) => {
      if (p.endsWith("best-candidate.md")) return true;
      return false;
    });
    fsMock.readFileSync.mockImplementation((p: string) => {
      if (typeof p === "string" && p.endsWith("best-candidate.md")) {
        return "# Null Guard in EmitsEvent Decorator\n\nDetails...";
      }
      return "";
    });
  });

  // -------------------------------------------------------------------------
  // Skip gate
  // -------------------------------------------------------------------------

  describe("skip gate", () => {
    it("returns early with skipReason when recommendation is 'skip'", async () => {
      const result = await implement(
        makeConfig(),
        makeProviders(),
        makeInvestigation({ recommendation: "skip", shouldImplement: false }),
      );

      expect(result.skipped).toBe(true);
      expect(result.skipReason).toContain("skip");
      expect(result.issueIdentifier).toBe("");
    });

    it("is case-insensitive for skip detection", async () => {
      const result = await implement(
        makeConfig(),
        makeProviders(),
        makeInvestigation({ recommendation: "SKIP", shouldImplement: false }),
      );

      expect(result.skipped).toBe(true);
      expect(result.skipReason).toContain("skip");
    });
  });

  // -------------------------------------------------------------------------
  // +1 existing gate
  // -------------------------------------------------------------------------

  describe("+1 existing gate", () => {
    it("adds comment to existing issue and returns early", async () => {
      const providers = makeProviders();

      const result = await implement(
        makeConfig(),
        providers,
        makeInvestigation({
          recommendation: "+1 existing ENG-123",
          existingIssue: "ENG-123",
          shouldImplement: false,
        }),
      );

      expect(result.skipped).toBe(true);
      expect(result.skipReason).toContain("+1 existing ENG-123");
      expect(result.issueIdentifier).toBe("ENG-123");
      expect(providers.issueTracker.getIssue).toHaveBeenCalledWith("ENG-123");
      expect(providers.issueTracker.addComment).toHaveBeenCalledWith(
        "issue-id-1",
        expect.stringContaining("+1 detected on"),
      );
    });

    it("handles addComment failure gracefully", async () => {
      const providers = makeProviders();
      vi.mocked(providers.issueTracker.addComment).mockRejectedValue(new Error("API error"));

      const result = await implement(
        makeConfig(),
        providers,
        makeInvestigation({
          recommendation: "+1 existing ENG-123",
          existingIssue: "ENG-123",
        }),
      );

      expect(result.skipped).toBe(true);
      expect(result.issueIdentifier).toBe("ENG-123");
    });

    it("skips comment when no existingIssue identifier provided", async () => {
      const providers = makeProviders();

      const result = await implement(
        makeConfig(),
        providers,
        makeInvestigation({
          recommendation: "+1 existing",
          existingIssue: "",
        }),
      );

      expect(result.skipped).toBe(true);
      expect(providers.issueTracker.getIssue).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Title extraction
  // -------------------------------------------------------------------------

  describe("title extraction", () => {
    it("extracts heading from best-candidate.md", async () => {
      const providers = makeProviders();

      await implement(makeConfig(), providers, makeInvestigation());

      // searchIssues is called with the extracted title
      expect(providers.issueTracker.searchIssues).toHaveBeenCalledWith(
        expect.objectContaining({
          query: "Null Guard in EmitsEvent Decorator",
        }),
      );
    });

    it("strips backticks from title", async () => {
      fsMock.readFileSync.mockImplementation((p: string) => {
        if (typeof p === "string" && p.endsWith("best-candidate.md")) {
          return "# Fix `extractUser` in `EmitsEvent` Decorator\n\nDetails";
        }
        return "";
      });
      const providers = makeProviders();

      await implement(makeConfig(), providers, makeInvestigation());

      expect(providers.issueTracker.searchIssues).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.not.stringContaining("`"),
        }),
      );
    });

    it("strips 'Best Candidate Fix:' boilerplate from title", async () => {
      fsMock.readFileSync.mockImplementation((p: string) => {
        if (typeof p === "string" && p.endsWith("best-candidate.md")) {
          return "# Best Candidate Fix: Null Guard\n\nDetails";
        }
        return "";
      });
      const providers = makeProviders();

      await implement(makeConfig(), providers, makeInvestigation());

      expect(providers.issueTracker.searchIssues).toHaveBeenCalledWith(
        expect.objectContaining({
          query: "Null Guard",
        }),
      );
    });

    it("caps title at 100 characters", async () => {
      const longTitle = "A".repeat(150);
      fsMock.readFileSync.mockImplementation((p: string) => {
        if (typeof p === "string" && p.endsWith("best-candidate.md")) {
          return `# ${longTitle}\n\nDetails`;
        }
        return "";
      });
      const providers = makeProviders();

      await implement(makeConfig(), providers, makeInvestigation());

      const call = vi.mocked(providers.issueTracker.searchIssues).mock.calls[0][0];
      expect(call.query.length).toBeLessThanOrEqual(100);
    });

    it("uses default title when no heading found", async () => {
      fsMock.readFileSync.mockImplementation((p: string) => {
        if (typeof p === "string" && p.endsWith("best-candidate.md")) {
          return "No heading here, just content";
        }
        return "";
      });
      const providers = makeProviders();

      await implement(makeConfig(), providers, makeInvestigation());

      expect(providers.issueTracker.searchIssues).toHaveBeenCalledWith(
        expect.objectContaining({
          query: "SWEny Triage: Automated bug fix",
        }),
      );
    });

    it("skips title extraction when linearIssue is provided", async () => {
      const providers = makeProviders();
      const config = makeConfig({ linearIssue: "ENG-500" });

      await implement(config, providers, makeInvestigation());

      // getIssue is called instead of searchIssues
      expect(providers.issueTracker.getIssue).toHaveBeenCalledWith("ENG-500");
      expect(providers.issueTracker.searchIssues).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Issue creation
  // -------------------------------------------------------------------------

  describe("issue creation", () => {
    it("creates new Linear issue when no search results", async () => {
      const providers = makeProviders();
      vi.mocked(providers.issueTracker.searchIssues).mockResolvedValue([]);

      await implement(makeConfig(), providers, makeInvestigation());

      expect(providers.issueTracker.createIssue).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Null Guard in EmitsEvent Decorator",
          projectId: "team-1",
          labels: ["label-1", "label-2"],
          priority: 2,
          stateId: "state-1",
        }),
      );
    });

    it("reuses existing issue when search returns results", async () => {
      const providers = makeProviders();
      vi.mocked(providers.issueTracker.searchIssues).mockResolvedValue([
        {
          id: "existing-id",
          identifier: "ENG-200",
          title: "Existing bug",
          url: "https://linear.app/ENG-200",
          branchName: "",
        },
      ]);

      const result = await implement(makeConfig(), providers, makeInvestigation());

      expect(providers.issueTracker.createIssue).not.toHaveBeenCalled();
      expect(providers.issueTracker.addComment).toHaveBeenCalledWith(
        "existing-id",
        expect.stringContaining("+1 detected on"),
      );
      expect(result.issueIdentifier).toBe("ENG-200");
    });
  });

  // -------------------------------------------------------------------------
  // Cross-repo dispatch
  // -------------------------------------------------------------------------

  describe("cross-repo dispatch", () => {
    it("dispatches workflow when targetRepo differs from current repo", async () => {
      const providers = makeProviders();
      const investigation = makeInvestigation({
        targetRepo: "other-org/other-repo",
      });

      const result = await implement(makeConfig({ repository: "org/repo" }), providers, investigation);

      expect(providers.sourceControl.dispatchWorkflow).toHaveBeenCalledWith(
        expect.objectContaining({
          targetRepo: "other-org/other-repo",
          workflow: "SWEny Triage",
          inputs: expect.objectContaining({
            linear_issue: "ENG-999",
            dispatched_from: "org/repo",
          }),
        }),
      );
      expect(result.skipped).toBe(true);
      expect(result.skipReason).toContain("Cross-repo dispatch");
      expect(result.issueIdentifier).toBe("ENG-999");
    });

    it("continues locally when targetRepo matches current repo", async () => {
      const providers = makeProviders();

      const result = await implement(
        makeConfig({ repository: "org/repo" }),
        providers,
        makeInvestigation({ targetRepo: "org/repo" }),
      );

      expect(providers.sourceControl.dispatchWorkflow).not.toHaveBeenCalled();
      expect(result.skipped).toBe(false);
    });

    it("continues locally when targetRepo is empty", async () => {
      const providers = makeProviders();

      const result = await implement(makeConfig(), providers, makeInvestigation({ targetRepo: "" }));

      expect(providers.sourceControl.dispatchWorkflow).not.toHaveBeenCalled();
      expect(result.skipped).toBe(false);
    });

    it("handles dispatch failure gracefully", async () => {
      const providers = makeProviders();
      vi.mocked(providers.sourceControl.dispatchWorkflow).mockRejectedValue(new Error("dispatch failed"));

      const result = await implement(
        makeConfig({ repository: "org/repo" }),
        providers,
        makeInvestigation({ targetRepo: "other-org/other-repo" }),
      );

      // Still returns a cross-repo dispatch result
      expect(result.skipped).toBe(true);
      expect(result.skipReason).toContain("Cross-repo dispatch");
    });
  });

  // -------------------------------------------------------------------------
  // Existing PR check
  // -------------------------------------------------------------------------

  describe("existing PR check", () => {
    it("skips implementation when an existing open PR is found", async () => {
      const providers = makeProviders();
      vi.mocked(providers.sourceControl.findExistingPr).mockResolvedValue({
        number: 20,
        url: "https://github.com/org/repo/pull/20",
        state: "open",
        title: "fix: existing",
      });

      const result = await implement(makeConfig(), providers, makeInvestigation());

      expect(result.skipped).toBe(true);
      expect(result.skipReason).toContain("Existing PR found");
      expect(result.prUrl).toBe("https://github.com/org/repo/pull/20");
      // Should not proceed to branch creation
      expect(providers.sourceControl.createBranch).not.toHaveBeenCalled();
    });

    it("skips implementation when an existing merged PR is found (no linearIssue)", async () => {
      const providers = makeProviders();
      vi.mocked(providers.sourceControl.findExistingPr).mockResolvedValue({
        number: 21,
        url: "https://github.com/org/repo/pull/21",
        state: "merged",
        title: "fix: merged",
      });

      const result = await implement(makeConfig(), providers, makeInvestigation());

      expect(result.skipped).toBe(true);
      expect(result.skipReason).toContain("Existing PR found");
    });

    it("ignores merged PR when linearIssue is explicitly provided", async () => {
      const providers = makeProviders();
      vi.mocked(providers.sourceControl.findExistingPr).mockResolvedValue({
        number: 21,
        url: "https://github.com/org/repo/pull/21",
        state: "merged",
        title: "fix: merged",
      });

      const result = await implement(makeConfig({ linearIssue: "ENG-500" }), providers, makeInvestigation());

      // Should proceed with implementation (merged PR ignored due to linearIssue)
      expect(result.skipped).toBe(false);
      expect(providers.sourceControl.createBranch).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Fix declined
  // -------------------------------------------------------------------------

  describe("fix declined", () => {
    it("returns early when fix-declined.md exists", async () => {
      const providers = makeProviders();

      fsMock.existsSync.mockImplementation((p: string) => {
        if (p.endsWith("fix-declined.md")) return true;
        if (p.endsWith("best-candidate.md")) return true;
        return false;
      });
      fsMock.readFileSync.mockImplementation((p: string) => {
        if (typeof p === "string" && p.endsWith("fix-declined.md")) {
          return "Too complex to safely fix automatically.";
        }
        if (typeof p === "string" && p.endsWith("best-candidate.md")) {
          return "# Title\nDetails";
        }
        return "";
      });

      const result = await implement(makeConfig(), providers, makeInvestigation());

      expect(result.skipped).toBe(true);
      expect(result.skipReason).toContain("Fix declined");
      expect(result.issueIdentifier).toBe("ENG-999");
      // Should not push branch or create PR
      expect(providers.sourceControl.pushBranch).not.toHaveBeenCalled();
      expect(providers.sourceControl.createPullRequest).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Code changes check
  // -------------------------------------------------------------------------

  describe("code changes check", () => {
    it("returns early when no code changes and no uncommitted changes", async () => {
      const providers = makeProviders();
      vi.mocked(providers.sourceControl.hasNewCommits).mockResolvedValue(false);
      vi.mocked(providers.sourceControl.hasChanges).mockResolvedValue(false);

      const result = await implement(makeConfig(), providers, makeInvestigation());

      expect(result.skipped).toBe(true);
      expect(result.skipReason).toContain("No code changes");
      expect(providers.sourceControl.pushBranch).not.toHaveBeenCalled();
    });

    it("creates fallback commit when uncommitted changes exist", async () => {
      const providers = makeProviders();
      vi.mocked(providers.sourceControl.hasNewCommits).mockResolvedValue(false);
      vi.mocked(providers.sourceControl.hasChanges).mockResolvedValue(true);

      const result = await implement(makeConfig(), providers, makeInvestigation());

      expect(providers.sourceControl.stageAndCommit).toHaveBeenCalledWith(expect.stringContaining("automated fix"));
      expect(result.skipped).toBe(false);
      expect(providers.sourceControl.pushBranch).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // PR creation flow
  // -------------------------------------------------------------------------

  describe("PR creation flow", () => {
    it("creates branch, pushes, generates description, and creates PR", async () => {
      const providers = makeProviders();

      const result = await implement(makeConfig(), providers, makeInvestigation());

      // Branch creation
      expect(providers.sourceControl.configureBotIdentity).toHaveBeenCalled();
      expect(providers.sourceControl.createBranch).toHaveBeenCalledWith("eng-999-triage-fix");
      expect(providers.sourceControl.resetPaths).toHaveBeenCalledWith([".github/workflows/"]);

      // Implementation
      expect(providers.codingAgent.install).toHaveBeenCalled();
      expect(providers.codingAgent.run).toHaveBeenCalledTimes(2); // implement + PR description

      // Push and PR
      expect(providers.sourceControl.pushBranch).toHaveBeenCalledWith("eng-999-triage-fix");
      expect(providers.sourceControl.createPullRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          head: "eng-999-triage-fix",
          base: "main",
          labels: ["agent", "triage", "needs-review"],
        }),
      );

      // Linear updates
      expect(providers.issueTracker.linkPr).toHaveBeenCalledWith(
        "issue-id-1",
        "https://github.com/org/repo/pull/42",
        42,
      );
      expect(providers.issueTracker.updateIssue).toHaveBeenCalledWith(
        "issue-id-1",
        expect.objectContaining({ stateId: "state-3" }),
      );

      expect(result.skipped).toBe(false);
      expect(result.prUrl).toBe("https://github.com/org/repo/pull/42");
      expect(result.prNumber).toBe(42);
      expect(result.issueIdentifier).toBe("ENG-999");
    });

    it("uses Linear branchName when available (strips user prefix)", async () => {
      const providers = makeProviders();
      vi.mocked(providers.issueTracker.createIssue).mockResolvedValue({
        id: "issue-id-1",
        identifier: "ENG-999",
        title: "Test issue",
        url: "https://linear.app/ENG-999",
        branchName: "nate/eng-999-my-branch",
      });

      await implement(makeConfig(), providers, makeInvestigation());

      expect(providers.sourceControl.createBranch).toHaveBeenCalledWith("eng-999-my-branch");
    });

    it("reads pr-description.md for PR body when it exists", async () => {
      const providers = makeProviders();

      fsMock.existsSync.mockImplementation((p: string) => {
        if (p.endsWith("pr-description.md")) return true;
        if (p.endsWith("best-candidate.md")) return true;
        return false;
      });
      fsMock.readFileSync.mockImplementation((p: string) => {
        if (typeof p === "string" && p.endsWith("pr-description.md")) {
          return "## Custom PR Body\n\nGenerated description";
        }
        if (typeof p === "string" && p.endsWith("best-candidate.md")) {
          return "# Title\nRECOMMENDATION: implement";
        }
        return "";
      });

      await implement(makeConfig(), providers, makeInvestigation());

      expect(providers.sourceControl.createPullRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          body: "## Custom PR Body\n\nGenerated description",
        }),
      );
    });

    it("uses fallback PR body when pr-description.md does not exist", async () => {
      const providers = makeProviders();
      // No pr-description.md
      fsMock.existsSync.mockImplementation((p: string) => {
        if (p.endsWith("best-candidate.md")) return true;
        return false;
      });

      await implement(makeConfig(), providers, makeInvestigation());

      expect(providers.sourceControl.createPullRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining("Automated Fix from SWEny Triage"),
        }),
      );
    });

    it("handles linkPr failure gracefully", async () => {
      const providers = makeProviders();
      vi.mocked(providers.issueTracker.linkPr).mockRejectedValue(new Error("link failed"));

      // Should not throw
      const result = await implement(makeConfig(), providers, makeInvestigation());
      expect(result.skipped).toBe(false);
      expect(result.prNumber).toBe(42);
    });

    it("handles updateIssue failure for state change gracefully", async () => {
      const providers = makeProviders();
      vi.mocked(providers.issueTracker.updateIssue).mockRejectedValue(new Error("update failed"));

      const result = await implement(makeConfig(), providers, makeInvestigation());
      expect(result.skipped).toBe(false);
      expect(result.prNumber).toBe(42);
    });
  });
});
