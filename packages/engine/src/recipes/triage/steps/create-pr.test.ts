import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "fs";
import { createProviderRegistry } from "../../../runner.js";
import { createPr } from "./create-pr.js";
import { createCtx, silentLogger } from "../test-helpers.js";
import type { StepResult } from "../../../types.js";

vi.mock("fs");
vi.mock("../prompts.js", () => ({
  buildPrDescriptionPrompt: vi.fn().mockReturnValue("mock pr desc prompt"),
}));
vi.mock("@sweny/providers/issue-tracking", () => ({
  canLinkPr: vi.fn(),
}));

import { canLinkPr } from "@sweny/providers/issue-tracking";

describe("createPr", () => {
  const createPullRequest = vi.fn();
  const updateIssue = vi.fn().mockResolvedValue(undefined);
  const linkPr = vi.fn().mockResolvedValue(undefined);
  const install = vi.fn().mockResolvedValue(undefined);
  const run = vi.fn().mockResolvedValue(undefined);

  function buildRegistry(opts?: { withLinkPr?: boolean }) {
    const registry = createProviderRegistry();
    const issueTracker: Record<string, unknown> = { updateIssue };
    if (opts?.withLinkPr) {
      issueTracker.linkPr = linkPr;
    }
    registry.set("sourceControl", { createPullRequest });
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
    skipImplementResult?: boolean;
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
    return createCtx({ results, providers: buildRegistry({ withLinkPr: opts?.withLinkPr }) });
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    createPullRequest
      .mockReset()
      .mockResolvedValue({ number: 42, url: "https://github.com/org/repo/pull/42", state: "open", title: "fix" });
    updateIssue.mockReset().mockResolvedValue(undefined);
    linkPr.mockReset().mockResolvedValue(undefined);
    install.mockReset().mockResolvedValue(undefined);
    run.mockReset().mockResolvedValue(undefined);
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.readFileSync).mockReturnValue("");
    vi.mocked(canLinkPr).mockReturnValue(false);
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

  it('PR labels: ["agent", "triage", "needs-review"]', async () => {
    const ctx = buildCtx();
    await createPr(ctx);
    expect(createPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({ labels: ["agent", "triage", "needs-review"] }),
    );
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
});
