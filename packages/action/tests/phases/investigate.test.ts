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

import * as core from "@actions/core";
import type { ActionConfig } from "../../src/config.js";
import type { Providers } from "../../src/providers/index.js";
import { investigate } from "../../src/phases/investigate.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<ActionConfig> = {}): ActionConfig {
  return {
    anthropicApiKey: "sk-test",
    claudeOauthToken: "",
    observabilityProvider: "datadog",
    observabilityCredentials: {
      apiKey: "dd-api",
      appKey: "dd-app",
      site: "datadoghq.com",
    },
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

function makeProviders(overrides: Partial<Providers> = {}): Providers {
  return {
    observability: {
      verifyAccess: vi.fn().mockResolvedValue(undefined),
      queryLogs: vi.fn().mockResolvedValue([]),
      aggregate: vi.fn().mockResolvedValue([]),
      getAgentEnv: vi.fn().mockReturnValue({
        DD_API_KEY: "dd-api",
        DD_APP_KEY: "dd-app",
        DD_SITE: "datadoghq.com",
      }),
      getPromptInstructions: vi.fn().mockReturnValue("### Datadog Logs API\nMock instructions"),
    },
    issueTracker: {
      verifyAccess: vi.fn().mockResolvedValue(undefined),
      createIssue: vi.fn(),
      getIssue: vi.fn(),
      updateIssue: vi.fn(),
      searchIssues: vi.fn(),
      addComment: vi.fn(),
      linkPr: vi.fn(),
      listTriageHistory: vi.fn().mockResolvedValue([]),
    },
    sourceControl: {
      verifyAccess: vi.fn().mockResolvedValue(undefined),
      configureBotIdentity: vi.fn(),
      createBranch: vi.fn(),
      pushBranch: vi.fn(),
      hasChanges: vi.fn(),
      hasNewCommits: vi.fn(),
      getChangedFiles: vi.fn(),
      resetPaths: vi.fn(),
      stageAndCommit: vi.fn(),
      createPullRequest: vi.fn(),
      listPullRequests: vi.fn().mockResolvedValue([]),
      findExistingPr: vi.fn(),
      dispatchWorkflow: vi.fn(),
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("investigate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: service-map.yml does not exist
    fsMock.existsSync.mockReturnValue(false);
    fsMock.readFileSync.mockReturnValue("");
  });

  // -------------------------------------------------------------------------
  // Orchestration
  // -------------------------------------------------------------------------

  it("installs coding agent and verifies provider access", async () => {
    const providers = makeProviders();

    await investigate(makeConfig(), providers);

    expect(providers.codingAgent.install).toHaveBeenCalledOnce();
    expect(providers.observability.verifyAccess).toHaveBeenCalledOnce();
    expect(providers.issueTracker.verifyAccess).toHaveBeenCalledOnce();
  });

  it("creates analysis directory", async () => {
    const providers = makeProviders();

    await investigate(makeConfig(), providers);

    expect(fsMock.mkdirSync).toHaveBeenCalledWith(".github/triage-analysis", { recursive: true });
  });

  it("calls codingAgent.run with correct maxTurns and env", async () => {
    const providers = makeProviders();
    const config = makeConfig({
      maxInvestigateTurns: 42,
      anthropicApiKey: "sk-ant-test",
      claudeOauthToken: "",
    });

    await investigate(config, providers);

    expect(providers.codingAgent.run).toHaveBeenCalledOnce();
    const runCall = vi.mocked(providers.codingAgent.run).mock.calls[0][0];
    expect(runCall.maxTurns).toBe(42);
    expect(runCall.env).toMatchObject({
      DD_API_KEY: "dd-api",
      DD_APP_KEY: "dd-app",
      DD_SITE: "datadoghq.com",
      LINEAR_API_KEY: "lin_test",
      LINEAR_TEAM_ID: "team-1",
      LINEAR_BUG_LABEL_ID: "label-1",
      ANTHROPIC_API_KEY: "sk-ant-test",
    });
    // No CLAUDE_CODE_OAUTH_TOKEN when empty
    expect(runCall.env).not.toHaveProperty("CLAUDE_CODE_OAUTH_TOKEN");
  });

  it("passes claudeOauthToken when provided", async () => {
    const providers = makeProviders();
    const config = makeConfig({
      anthropicApiKey: "",
      claudeOauthToken: "oauth-tok",
    });

    await investigate(config, providers);

    const runCall = vi.mocked(providers.codingAgent.run).mock.calls[0][0];
    expect(runCall.env).toHaveProperty("CLAUDE_CODE_OAUTH_TOKEN", "oauth-tok");
    expect(runCall.env).not.toHaveProperty("ANTHROPIC_API_KEY");
  });

  // -------------------------------------------------------------------------
  // parseInvestigationResults
  // -------------------------------------------------------------------------

  describe("parseInvestigationResults", () => {
    it("returns skip when no best-candidate.md exists", async () => {
      const providers = makeProviders();
      // existsSync: analysis dir mkdirSync doesn't use it, but parseInvestigationResults does
      fsMock.existsSync.mockReturnValue(false);

      const result = await investigate(makeConfig(), providers);

      expect(result.recommendation).toBe("skip");
      expect(result.shouldImplement).toBe(false);
      expect(result.bestCandidate).toBe(false);
      expect(result.existingIssue).toBe("");
      expect(result.targetRepo).toBe("");
    });

    it("defaults to 'implement' when best-candidate.md exists but has no RECOMMENDATION line", async () => {
      const providers = makeProviders();

      fsMock.existsSync.mockImplementation((p: string) => {
        if (p.endsWith("best-candidate.md")) return true;
        return false;
      });
      fsMock.readFileSync.mockImplementation((p: string) => {
        if (typeof p === "string" && p.endsWith("best-candidate.md")) {
          return "# Some Title\n\nSome analysis content without recommendation";
        }
        return "";
      });

      const result = await investigate(makeConfig(), providers);

      expect(result.recommendation).toBe("implement");
      expect(result.shouldImplement).toBe(true);
      expect(result.bestCandidate).toBe(true);
    });

    it("parses RECOMMENDATION: implement", async () => {
      const providers = makeProviders();

      fsMock.existsSync.mockImplementation((p: string) => {
        if (p.endsWith("best-candidate.md")) return true;
        return false;
      });
      fsMock.readFileSync.mockImplementation((p: string) => {
        if (typeof p === "string" && p.endsWith("best-candidate.md")) {
          return "# Fix Null Guard\nRECOMMENDATION: implement\n\nDetails...";
        }
        return "";
      });

      const result = await investigate(makeConfig(), providers);

      expect(result.recommendation).toBe("implement");
      expect(result.shouldImplement).toBe(true);
    });

    it("parses RECOMMENDATION: skip", async () => {
      const providers = makeProviders();

      fsMock.existsSync.mockImplementation((p: string) => {
        if (p.endsWith("best-candidate.md")) return true;
        return false;
      });
      fsMock.readFileSync.mockImplementation((p: string) => {
        if (typeof p === "string" && p.endsWith("best-candidate.md")) {
          return "# Analysis\nRECOMMENDATION: skip\nNot worth fixing.";
        }
        return "";
      });

      const result = await investigate(makeConfig(), providers);

      expect(result.recommendation).toBe("skip");
      expect(result.shouldImplement).toBe(false);
    });

    it("parses RECOMMENDATION: +1 existing ENG-456", async () => {
      const providers = makeProviders();

      fsMock.existsSync.mockImplementation((p: string) => {
        if (p.endsWith("best-candidate.md")) return true;
        return false;
      });
      fsMock.readFileSync.mockImplementation((p: string) => {
        if (typeof p === "string" && p.endsWith("best-candidate.md")) {
          return "# Duplicate Issue\nRECOMMENDATION: +1 existing ENG-456\nSame root cause.";
        }
        return "";
      });

      const result = await investigate(makeConfig(), providers);

      expect(result.recommendation).toBe("+1 existing ENG-456");
      expect(result.existingIssue).toBe("ENG-456");
      expect(result.shouldImplement).toBe(false);
    });

    it("extracts TARGET_REPO from best-candidate.md", async () => {
      const providers = makeProviders();

      fsMock.existsSync.mockImplementation((p: string) => {
        if (p.endsWith("best-candidate.md")) return true;
        return false;
      });
      fsMock.readFileSync.mockImplementation((p: string) => {
        if (typeof p === "string" && p.endsWith("best-candidate.md")) {
          return ["# Fix Bug", "RECOMMENDATION: implement", "TARGET_REPO: other-org/other-repo"].join("\n");
        }
        return "";
      });

      const result = await investigate(makeConfig(), providers);

      expect(result.targetRepo).toBe("other-org/other-repo");
      expect(result.recommendation).toBe("implement");
      expect(result.shouldImplement).toBe(true);
    });

    it("sets issuesFound when issues-report.md exists", async () => {
      const providers = makeProviders();

      fsMock.existsSync.mockImplementation((p: string) => {
        if (p.endsWith("issues-report.md")) return true;
        if (p.endsWith("best-candidate.md")) return true;
        return false;
      });
      fsMock.readFileSync.mockImplementation((p: string) => {
        if (typeof p === "string" && p.endsWith("best-candidate.md")) {
          return "# Bug\nRECOMMENDATION: implement";
        }
        return "";
      });

      const result = await investigate(makeConfig(), providers);

      expect(result.issuesFound).toBe(true);
      expect(result.bestCandidate).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // buildKnownIssuesContext
  // -------------------------------------------------------------------------

  describe("buildKnownIssuesContext", () => {
    it("writes known-issues-context.md with triage history and PRs", async () => {
      const providers = makeProviders();
      vi.mocked(providers.issueTracker.listTriageHistory).mockResolvedValue([
        {
          identifier: "ENG-100",
          title: "Previous bug",
          state: "Done",
          stateType: "completed",
          url: "https://linear.app/ENG-100",
          descriptionSnippet: null,
          fingerprint: null,
          createdAt: "2026-02-01",
          labels: ["triage"],
        },
      ]);
      vi.mocked(providers.sourceControl.listPullRequests).mockResolvedValue([
        { number: 10, title: "Fix foo", url: "https://github.com/pr/10", state: "merged" },
        { number: 11, title: "Fix bar", url: "https://github.com/pr/11", state: "open" },
        { number: 12, title: "Fix baz", url: "https://github.com/pr/12", state: "closed" },
      ]);

      await investigate(makeConfig(), providers);

      // Verify known-issues-context.md was written
      expect(fsMock.writeFileSync).toHaveBeenCalled();
      const writeCall = fsMock.writeFileSync.mock.calls.find(
        (c: string[]) => typeof c[0] === "string" && c[0].endsWith("known-issues-context.md"),
      );
      expect(writeCall).toBeDefined();
      const content = writeCall![1] as string;

      // Has Linear issues section with the entry
      expect(content).toContain("ENG-100");
      expect(content).toContain("Previous bug");

      // Has GitHub PRs sections
      expect(content).toContain("### Merged (fixed)");
      expect(content).toContain("PR #10");
      expect(content).toContain("### Open (in progress)");
      expect(content).toContain("PR #11");
      expect(content).toContain("### Closed (failed attempts)");
      expect(content).toContain("PR #12");
    });

    it("handles empty triage history gracefully", async () => {
      const providers = makeProviders();
      vi.mocked(providers.issueTracker.listTriageHistory).mockResolvedValue([]);
      vi.mocked(providers.sourceControl.listPullRequests).mockResolvedValue([]);

      await investigate(makeConfig(), providers);

      const writeCall = fsMock.writeFileSync.mock.calls.find(
        (c: string[]) => typeof c[0] === "string" && c[0].endsWith("known-issues-context.md"),
      );
      const content = writeCall![1] as string;

      expect(content).toContain("_No triage-labeled Linear issues found in last 30 days_");
      expect(content).toContain("_None_");
    });

    it("handles listTriageHistory failure with warning", async () => {
      const providers = makeProviders();
      vi.mocked(providers.issueTracker.listTriageHistory).mockRejectedValue(new Error("API error"));
      vi.mocked(providers.sourceControl.listPullRequests).mockResolvedValue([]);

      await investigate(makeConfig(), providers);

      expect(core.warning).toHaveBeenCalledWith(expect.stringContaining("Failed to fetch Linear triage history"));

      const writeCall = fsMock.writeFileSync.mock.calls.find(
        (c: string[]) => typeof c[0] === "string" && c[0].endsWith("known-issues-context.md"),
      );
      const content = writeCall![1] as string;
      expect(content).toContain("_Failed to fetch Linear triage history_");
    });

    it("handles listPullRequests failure with warning", async () => {
      const providers = makeProviders();
      vi.mocked(providers.issueTracker.listTriageHistory).mockResolvedValue([]);
      vi.mocked(providers.sourceControl.listPullRequests).mockRejectedValue(new Error("GH error"));

      await investigate(makeConfig(), providers);

      expect(core.warning).toHaveBeenCalledWith(expect.stringContaining("Failed to fetch GitHub triage PRs"));
    });
  });
});
