import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "node:fs";
import { createProviderRegistry } from "../../../runner-recipe.js";
import { implementFix } from "./implement-fix.js";
import { createCtx } from "../test-helpers.js";
import type { StepResult } from "../../../types.js";

vi.mock("fs");
vi.mock("../prompts.js", () => ({
  buildImplementPrompt: vi.fn().mockReturnValue("mock implement prompt"),
  issueTrackerLabel: vi.fn().mockReturnValue("Issue Tracker"),
}));

describe("implementFix", () => {
  const findExistingPr = vi.fn();
  const configureBotIdentity = vi.fn().mockResolvedValue(undefined);
  const createBranch = vi.fn().mockResolvedValue(undefined);
  const resetPaths = vi.fn().mockResolvedValue(undefined);
  const pushBranch = vi.fn().mockResolvedValue(undefined);
  const hasNewCommits = vi.fn();
  const hasChanges = vi.fn();
  const stageAndCommit = vi.fn().mockResolvedValue(undefined);
  const getChangedFiles = vi.fn().mockResolvedValue(["file.ts"]);
  const install = vi.fn().mockResolvedValue(undefined);
  const run = vi.fn().mockResolvedValue(undefined);

  function buildRegistry() {
    const registry = createProviderRegistry();
    registry.set("sourceControl", {
      findExistingPr,
      configureBotIdentity,
      createBranch,
      resetPaths,
      pushBranch,
      hasNewCommits,
      hasChanges,
      stageAndCommit,
      getChangedFiles,
    });
    registry.set("codingAgent", { install, run });
    return registry;
  }

  function buildCtx(opts?: { issueIdentifier?: string; issueBranchName?: string; config?: Record<string, unknown> }) {
    const results = new Map<string, StepResult>();
    results.set("create-issue", {
      status: "success",
      data: {
        issueId: "id-1",
        issueIdentifier: opts?.issueIdentifier ?? "ENG-1",
        issueTitle: "Test Issue",
        issueUrl: "https://example.com/ENG-1",
        issueBranchName: opts?.issueBranchName,
      },
    });
    return createCtx({ results, providers: buildRegistry(), config: opts?.config });
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    findExistingPr.mockReset().mockResolvedValue(null);
    configureBotIdentity.mockReset().mockResolvedValue(undefined);
    createBranch.mockReset().mockResolvedValue(undefined);
    resetPaths.mockReset().mockResolvedValue(undefined);
    pushBranch.mockReset().mockResolvedValue(undefined);
    hasNewCommits.mockReset().mockResolvedValue(true);
    hasChanges.mockReset().mockResolvedValue(false);
    stageAndCommit.mockReset().mockResolvedValue(undefined);
    getChangedFiles.mockReset().mockResolvedValue(["file.ts"]);
    install.mockReset().mockResolvedValue(undefined);
    run.mockReset().mockResolvedValue(undefined);
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.readFileSync).mockReturnValue("");
  });

  it("existing open PR returns skip with PR URL", async () => {
    findExistingPr.mockResolvedValue({ url: "https://github.com/org/repo/pull/42", state: "open" });
    const ctx = buildCtx();
    const result = await implementFix(ctx);
    expect(result.status).toBe("skipped");
    expect(result.reason).toContain("https://github.com/org/repo/pull/42");
    expect(result.data?.existingPrUrl).toBe("https://github.com/org/repo/pull/42");
  });

  it("merged PR with issueOverride continues implementation", async () => {
    findExistingPr.mockResolvedValue({ url: "https://github.com/org/repo/pull/10", state: "merged" });
    hasNewCommits.mockResolvedValue(true);
    const ctx = buildCtx({ config: { issueOverride: "ENG-1" } });
    const result = await implementFix(ctx);
    expect(result.status).toBe("success");
    expect(install).toHaveBeenCalled();
  });

  it("branch from issueBranchName strips user prefix", async () => {
    hasNewCommits.mockResolvedValue(true);
    const ctx = buildCtx({ issueBranchName: "user/eng-1-fix-auth" });
    await implementFix(ctx);
    expect(createBranch).toHaveBeenCalledWith("eng-1-fix-auth");
  });

  it("fallback branch name when no issueBranchName", async () => {
    hasNewCommits.mockResolvedValue(true);
    const ctx = buildCtx({ issueIdentifier: "ENG-42" });
    await implementFix(ctx);
    expect(createBranch).toHaveBeenCalledWith("eng-42-triage-fix");
  });

  it("configures bot identity and resets workflow paths", async () => {
    hasNewCommits.mockResolvedValue(true);
    const ctx = buildCtx();
    await implementFix(ctx);
    expect(configureBotIdentity).toHaveBeenCalled();
    expect(resetPaths).toHaveBeenCalledWith([".github/workflows/"]);
  });

  it("installs and runs coding agent", async () => {
    hasNewCommits.mockResolvedValue(true);
    const ctx = buildCtx({ config: { maxImplementTurns: 25, agentEnv: { KEY: "val" } } });
    await implementFix(ctx);
    expect(install).toHaveBeenCalled();
    expect(run).toHaveBeenCalledWith({
      prompt: "mock implement prompt",
      maxTurns: 25,
      env: { KEY: "val" },
    });
  });

  it("fix-declined.md exists returns skip", async () => {
    vi.mocked(fs.existsSync).mockImplementation((p) => String(p).includes("fix-declined.md"));
    vi.mocked(fs.readFileSync).mockReturnValue("Not confident in fix");
    const ctx = buildCtx();
    const result = await implementFix(ctx);
    expect(result.status).toBe("skipped");
    expect(result.reason).toContain("Fix declined");
  });

  it("has new commits pushes and returns success", async () => {
    hasNewCommits.mockResolvedValue(true);
    const ctx = buildCtx();
    const result = await implementFix(ctx);
    expect(result.status).toBe("success");
    expect(pushBranch).toHaveBeenCalled();
    expect(result.data?.hasCodeChanges).toBe(true);
  });

  it("no commits + uncommitted changes creates fallback commit and pushes", async () => {
    hasNewCommits.mockResolvedValue(false);
    hasChanges.mockResolvedValue(true);
    const ctx = buildCtx();
    const result = await implementFix(ctx);
    expect(result.status).toBe("success");
    expect(stageAndCommit).toHaveBeenCalledWith(expect.stringContaining("automated fix from log analysis"));
    expect(pushBranch).toHaveBeenCalled();
  });

  it("no commits + no changes returns skip 'No code changes'", async () => {
    hasNewCommits.mockResolvedValue(false);
    hasChanges.mockResolvedValue(false);
    const ctx = buildCtx();
    const result = await implementFix(ctx);
    expect(result.status).toBe("skipped");
    expect(result.reason).toContain("No code changes");
    expect(pushBranch).not.toHaveBeenCalled();
  });
});
