import { describe, it, expect, vi, beforeEach } from "vitest";
import { createProviderRegistry } from "../../../runner.js";
import { crossRepoCheck } from "./cross-repo-check.js";
import { createCtx, silentLogger } from "../test-helpers.js";
import type { StepResult } from "../../../types.js";

describe("crossRepoCheck", () => {
  const dispatchWorkflow = vi.fn().mockResolvedValue(undefined);
  const updateIssue = vi.fn().mockResolvedValue(undefined);

  function buildRegistry() {
    const registry = createProviderRegistry();
    registry.set("sourceControl", { dispatchWorkflow });
    registry.set("issueTracker", { updateIssue });
    return registry;
  }

  function buildCtx(opts?: { targetRepo?: string; issueId?: string; issueIdentifier?: string; repository?: string }) {
    const results = new Map<string, StepResult>();
    results.set("investigate", {
      status: "success",
      data: {
        targetRepo: opts?.targetRepo ?? "",
        issuesFound: true,
        bestCandidate: true,
        recommendation: "implement",
        existingIssue: "",
        shouldImplement: true,
      },
    });
    if (opts?.issueId !== undefined) {
      results.set("create-issue", {
        status: "success",
        data: {
          issueId: opts.issueId,
          issueIdentifier: opts.issueIdentifier ?? "ENG-1",
          issueTitle: "Test",
          issueUrl: "https://example.com/ENG-1",
        },
      });
    }
    return createCtx({
      results,
      providers: buildRegistry(),
      config: opts?.repository ? { repository: opts.repository } : undefined,
    });
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    dispatchWorkflow.mockReset().mockResolvedValue(undefined);
    updateIssue.mockReset().mockResolvedValue(undefined);
  });

  it("same repo returns outcome: local and dispatched: false, no dispatch call", async () => {
    const ctx = buildCtx({ targetRepo: "org/repo", repository: "org/repo" });
    const result = await crossRepoCheck(ctx);
    expect(result.status).toBe("success");
    expect(result.data?.dispatched).toBe(false);
    expect(result.data?.outcome).toBe("local");
    expect(dispatchWorkflow).not.toHaveBeenCalled();
  });

  it("empty targetRepo returns outcome: local and dispatched: false", async () => {
    const ctx = buildCtx({ targetRepo: "" });
    const result = await crossRepoCheck(ctx);
    expect(result.status).toBe("success");
    expect(result.data?.dispatched).toBe(false);
    expect(result.data?.outcome).toBe("local");
    expect(dispatchWorkflow).not.toHaveBeenCalled();
  });

  it("different repo dispatches workflow with correct params and returns outcome: dispatched", async () => {
    const ctx = buildCtx({
      targetRepo: "other-org/other-repo",
      issueId: "issue-1",
      issueIdentifier: "ENG-5",
    });
    const result = await crossRepoCheck(ctx);
    expect(result.status).toBe("success");
    expect(result.data?.dispatched).toBe(true);
    expect(result.data?.outcome).toBe("dispatched");
    expect(result.data?.targetRepo).toBe("other-org/other-repo");
    expect(dispatchWorkflow).toHaveBeenCalledWith({
      targetRepo: "other-org/other-repo",
      workflow: "SWEny Triage",
      inputs: {
        linear_issue: "ENG-5",
        dispatched_from: "org/repo",
        novelty_mode: "false",
      },
    });
    expect(ctx.skipPhase).not.toHaveBeenCalled();
  });

  it("cross-repo adds comment to issue via updateIssue", async () => {
    const ctx = buildCtx({
      targetRepo: "other-org/other-repo",
      issueId: "issue-1",
      issueIdentifier: "ENG-5",
    });
    await crossRepoCheck(ctx);
    expect(updateIssue).toHaveBeenCalledWith("issue-1", {
      comment: expect.stringContaining("other-org/other-repo"),
    });
  });

  it("dispatch failure still succeeds and warns", async () => {
    dispatchWorkflow.mockRejectedValue(new Error("dispatch failed"));
    const ctx = buildCtx({ targetRepo: "other-org/other-repo", issueId: "issue-1" });
    const result = await crossRepoCheck(ctx);
    expect(result.status).toBe("success");
    expect(result.data?.dispatched).toBe(true);
    expect(silentLogger.warn).toHaveBeenCalledWith(expect.stringContaining("dispatch failed"));
  });

  it("missing issue data: dispatch still works with empty string for linear_issue", async () => {
    const ctx = buildCtx({ targetRepo: "other-org/other-repo" });
    const result = await crossRepoCheck(ctx);
    expect(result.status).toBe("success");
    expect(dispatchWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        inputs: expect.objectContaining({ linear_issue: "" }),
      }),
    );
  });
});
