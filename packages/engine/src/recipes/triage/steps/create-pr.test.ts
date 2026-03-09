import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "node:fs";
import { createProviderRegistry } from "../../../runner-recipe.js";
import { createPr } from "./create-pr.js";
import { createCtx, silentLogger } from "../test-helpers.js";
import type { StepResult } from "../../../types.js";

vi.mock("fs");
vi.mock("../prompts.js", () => ({
  buildPrDescriptionPrompt: vi.fn().mockReturnValue("mock pr desc prompt"),
  issueLink: vi.fn().mockReturnValue("[IDENTIFIER](https://issue.url)"),
}));
vi.mock("@sweny-ai/providers/issue-tracking", () => ({
  canLinkPr: vi.fn(),
}));
vi.mock("../../../nodes/risk-assessor.js", () => ({
  assessRisk: vi.fn().mockReturnValue({ level: "low", reasons: [] }),
}));

import { canLinkPr } from "@sweny-ai/providers/issue-tracking";
import { assessRisk } from "../../../nodes/risk-assessor.js";

describe("createPr", () => {
  const createPullRequest = vi.fn();
  const getChangedFiles = vi.fn().mockResolvedValue([]);
  const enableAutoMerge = vi.fn().mockResolvedValue(undefined);
  const updateIssue = vi.fn().mockResolvedValue(undefined);
  const linkPr = vi.fn().mockResolvedValue(undefined);
  const install = vi.fn().mockResolvedValue(undefined);
  const run = vi.fn().mockResolvedValue(undefined);

  function buildRegistry(opts?: { withLinkPr?: boolean; withAutoMerge?: boolean }) {
    const registry = createProviderRegistry();
    const issueTracker: Record<string, unknown> = { updateIssue };
    if (opts?.withLinkPr) {
      issueTracker.linkPr = linkPr;
    }
    const sourceControl: Record<string, unknown> = { createPullRequest, getChangedFiles };
    if (opts?.withAutoMerge !== false) {
      sourceControl.enableAutoMerge = enableAutoMerge;
    }
    registry.set("sourceControl", sourceControl);
    registry.set("issueTracker", issueTracker);
    registry.set("codingAgent", { install, run });
    return registry;
  }

  function buildCtx(opts?: {
    implementStatus?: "success" | "skipped";
    implementReason?: string;
    issueId?: string;
    issueIdentifier?: string;
    issueTitle?: string;
    issueUrl?: string;
    branchName?: string;
    withLinkPr?: boolean;
    withAutoMerge?: boolean;
    skipImplementResult?: boolean;
    reviewMode?: "auto" | "review";
  }) {
    const results = new Map<string, StepResult>();
    results.set("create-issue", {
      status: "success",
      data: {
        issueId: opts?.issueId ?? "id-1",
        issueIdentifier: opts?.issueIdentifier ?? "ENG-1",
        issueTitle: opts?.issueTitle ?? "Fix auth bug",
        issueUrl: opts?.issueUrl ?? "https://example.com/ENG-1",
      },
    });
    if (!opts?.skipImplementResult) {
      results.set("implement-fix", {
        status: opts?.implementStatus ?? "success",
        reason: opts?.implementReason,
        data: { branchName: opts?.branchName ?? "eng-1-triage-fix", hasCodeChanges: true },
      });
    }
    return createCtx({
      results,
      providers: buildRegistry({ withLinkPr: opts?.withLinkPr, withAutoMerge: opts?.withAutoMerge }),
      config: opts?.reviewMode ? { reviewMode: opts.reviewMode } : undefined,
    });
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    createPullRequest
      .mockReset()
      .mockResolvedValue({ number: 42, url: "https://github.com/org/repo/pull/42", state: "open", title: "fix" });
    getChangedFiles.mockReset().mockResolvedValue([]);
    enableAutoMerge.mockReset().mockResolvedValue(undefined);
    updateIssue.mockReset().mockResolvedValue(undefined);
    linkPr.mockReset().mockResolvedValue(undefined);
    install.mockReset().mockResolvedValue(undefined);
    run.mockReset().mockResolvedValue(undefined);
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.readFileSync).mockReturnValue("");
    vi.mocked(canLinkPr).mockReturnValue(false);
    vi.mocked(assessRisk).mockReturnValue({ level: "low", reasons: [] });
  });

  it("skip when implement-fix was skipped", async () => {
    const ctx = buildCtx({ implementStatus: "skipped", implementReason: "Fix declined" });
    const result = await createPr(ctx);
    expect(result.status).toBe("skipped");
    expect(result.reason).toContain("Fix declined");
    expect(createPullRequest).not.toHaveBeenCalled();
  });

  it("skip when implement-fix not in results", async () => {
    const ctx = buildCtx({ skipImplementResult: true });
    const result = await createPr(ctx);
    expect(result.status).toBe("skipped");
    expect(result.reason).toContain("No implementation to create PR for");
  });

  it("PR description from file", async () => {
    vi.mocked(fs.existsSync).mockImplementation((p) => String(p).includes("pr-description.md"));
    vi.mocked(fs.readFileSync).mockReturnValue("## Custom PR Description\nDetails here");
    const ctx = buildCtx();
    await createPr(ctx);
    expect(createPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({ body: "## Custom PR Description\nDetails here" }),
    );
  });

  it("PR description fallback when file missing", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const ctx = buildCtx();
    await createPr(ctx);
    expect(createPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.stringContaining("Automated Fix from SWEny Triage") }),
    );
  });

  it("PR title format: fix(IDENTIFIER): title-lowercase", async () => {
    const ctx = buildCtx({ issueIdentifier: "ENG-99", issueTitle: "Fix Auth Bug" });
    await createPr(ctx);
    expect(createPullRequest).toHaveBeenCalledWith(expect.objectContaining({ title: "fix(ENG-99): fix auth bug" }));
  });

  it('PR labels: ["agent", "triage", "needs-review"] by default', async () => {
    const ctx = buildCtx();
    await createPr(ctx);
    expect(createPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({ labels: ["agent", "triage", "needs-review"] }),
    );
  });

  it("uses custom baseBranch from config", async () => {
    const ctx = buildCtx();
    ctx.config.baseBranch = "develop";
    await createPr(ctx);
    expect(createPullRequest).toHaveBeenCalledWith(expect.objectContaining({ base: "develop" }));
  });

  it("uses custom prLabels from config", async () => {
    const ctx = buildCtx();
    ctx.config.prLabels = ["custom-label"];
    await createPr(ctx);
    expect(createPullRequest).toHaveBeenCalledWith(expect.objectContaining({ labels: ["custom-label"] }));
  });

  it("linkPr called when canLinkPr returns true", async () => {
    vi.mocked(canLinkPr).mockReturnValue(true);
    const ctx = buildCtx({ withLinkPr: true, issueId: "id-1" });
    await createPr(ctx);
    expect(linkPr).toHaveBeenCalledWith("id-1", "https://github.com/org/repo/pull/42", 42);
  });

  it("linkPr failure is non-fatal", async () => {
    vi.mocked(canLinkPr).mockReturnValue(true);
    linkPr.mockRejectedValue(new Error("link failed"));
    const ctx = buildCtx({ withLinkPr: true, issueId: "id-1" });
    const result = await createPr(ctx);
    expect(result.status).toBe("success");
    expect(silentLogger.warn).toHaveBeenCalledWith(expect.stringContaining("Failed to link PR"));
  });

  it("updateIssue called with statePeerReview", async () => {
    const ctx = buildCtx({ issueId: "id-1" });
    await createPr(ctx);
    expect(updateIssue).toHaveBeenCalledWith("id-1", { stateId: "state-review" });
  });

  it("updateIssue failure is non-fatal", async () => {
    updateIssue.mockRejectedValue(new Error("update failed"));
    const ctx = buildCtx({ issueId: "id-1" });
    const result = await createPr(ctx);
    expect(result.status).toBe("success");
    expect(silentLogger.warn).toHaveBeenCalledWith(expect.stringContaining("Failed to update issue state"));
  });

  it("returns correct data (issueIdentifier, issueUrl, prUrl, prNumber)", async () => {
    createPullRequest.mockResolvedValue({
      number: 77,
      url: "https://github.com/org/repo/pull/77",
      state: "open",
      title: "fix",
    });
    const ctx = buildCtx({ issueIdentifier: "ENG-5", issueUrl: "https://example.com/ENG-5" });
    const result = await createPr(ctx);
    expect(result.status).toBe("success");
    expect(result.data).toEqual({
      issueIdentifier: "ENG-5",
      issueUrl: "https://example.com/ENG-5",
      prUrl: "https://github.com/org/repo/pull/77",
      prNumber: 77,
    });
  });

  it("calls enableAutoMerge when reviewMode=auto and risk is low", async () => {
    vi.mocked(assessRisk).mockReturnValue({ level: "low", reasons: [] });
    const ctx = buildCtx({ reviewMode: "auto" });
    await createPr(ctx);
    expect(enableAutoMerge).toHaveBeenCalledWith(42);
  });

  it("does NOT call enableAutoMerge when reviewMode=auto and risk is high", async () => {
    vi.mocked(assessRisk).mockReturnValue({
      level: "high",
      reasons: ["High-risk file: src/migrations/001.sql"],
    });
    const ctx = buildCtx({ reviewMode: "auto" });
    await createPr(ctx);
    expect(enableAutoMerge).not.toHaveBeenCalled();
    expect(silentLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Auto-merge disabled due to high-risk changes"),
    );
  });

  it("does NOT call enableAutoMerge when reviewMode=review", async () => {
    const ctx = buildCtx({ reviewMode: "review" });
    await createPr(ctx);
    expect(enableAutoMerge).not.toHaveBeenCalled();
  });

  it("does NOT call enableAutoMerge when reviewMode is not set", async () => {
    const ctx = buildCtx();
    await createPr(ctx);
    expect(enableAutoMerge).not.toHaveBeenCalled();
  });

  it("does NOT call enableAutoMerge when provider does not implement it", async () => {
    const ctx = buildCtx({ reviewMode: "auto", withAutoMerge: false });
    await createPr(ctx);
    expect(enableAutoMerge).not.toHaveBeenCalled();
  });

  it("does not throw when getChangedFiles rejects", async () => {
    getChangedFiles.mockRejectedValue(new Error("git error"));
    const ctx = buildCtx({ reviewMode: "auto" });
    await expect(createPr(ctx)).resolves.toMatchObject({ status: "success" });
    // Falls back to [] → low risk → auto-merge proceeds
    expect(enableAutoMerge).toHaveBeenCalledWith(42);
  });

  it("does not fail PR creation when enableAutoMerge rejects", async () => {
    enableAutoMerge.mockRejectedValue(new Error("auto-merge not allowed"));
    const ctx = buildCtx({ reviewMode: "auto" });
    // enableAutoMerge throws but createPr should not propagate it
    await expect(createPr(ctx)).resolves.toMatchObject({ status: "success" });
  });
});
