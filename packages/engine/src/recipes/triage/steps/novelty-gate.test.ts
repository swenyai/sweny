import { describe, it, expect, vi, beforeEach } from "vitest";
import { createProviderRegistry } from "../../../runner.js";
import { noveltyGate } from "./novelty-gate.js";
import { createCtx, silentLogger } from "../test-helpers.js";
import type { InvestigationResult } from "../types.js";

function investigationResult(overrides?: Partial<InvestigationResult>): InvestigationResult {
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

describe("noveltyGate", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns outcome: skip in dry run mode", async () => {
    const investigation = investigationResult();
    const results = new Map([
      ["investigate", { status: "success" as const, data: investigation as unknown as Record<string, unknown> }],
    ]);
    const registry = createProviderRegistry();
    registry.set("issueTracker", { getIssue: vi.fn(), addComment: vi.fn() });
    const ctx = createCtx({ config: { dryRun: true }, results, providers: registry });

    const result = await noveltyGate(ctx);

    expect(result.status).toBe("success");
    expect(result.data?.action).toBe("dry-run");
    expect(result.data?.outcome).toBe("skip");
    expect(ctx.skipPhase).not.toHaveBeenCalled();
  });

  it("returns outcome: skip when recommendation is 'skip'", async () => {
    const investigation = investigationResult({ recommendation: "skip", shouldImplement: false });
    const results = new Map([
      ["investigate", { status: "success" as const, data: investigation as unknown as Record<string, unknown> }],
    ]);
    const registry = createProviderRegistry();
    registry.set("issueTracker", { getIssue: vi.fn(), addComment: vi.fn() });
    const ctx = createCtx({ results, providers: registry });

    const result = await noveltyGate(ctx);

    expect(result.status).toBe("success");
    expect(result.data?.action).toBe("skip");
    expect(result.data?.outcome).toBe("skip");
    expect(ctx.skipPhase).not.toHaveBeenCalled();
  });

  it("adds +1 comment and returns outcome: skip for existing issue", async () => {
    const investigation = investigationResult({
      recommendation: "+1 existing ENG-123",
      existingIssue: "ENG-123",
      shouldImplement: false,
    });
    const results = new Map([
      ["investigate", { status: "success" as const, data: investigation as unknown as Record<string, unknown> }],
    ]);
    const getIssue = vi.fn().mockResolvedValue({ id: "issue-id-1", identifier: "ENG-123" });
    const addComment = vi.fn().mockResolvedValue(undefined);
    const registry = createProviderRegistry();
    registry.set("issueTracker", { getIssue, addComment });
    const ctx = createCtx({ results, providers: registry });

    const result = await noveltyGate(ctx);

    expect(result.status).toBe("success");
    expect(result.data?.action).toBe("+1");
    expect(result.data?.outcome).toBe("skip");
    expect(result.data?.issueIdentifier).toBe("ENG-123");
    expect(getIssue).toHaveBeenCalledWith("ENG-123");
    expect(addComment).toHaveBeenCalledWith("issue-id-1", expect.stringContaining("+1 detected on"));
    expect(ctx.skipPhase).not.toHaveBeenCalled();
  });

  it("handles +1 comment failure gracefully", async () => {
    const investigation = investigationResult({
      recommendation: "+1 existing ENG-456",
      existingIssue: "ENG-456",
      shouldImplement: false,
    });
    const results = new Map([
      ["investigate", { status: "success" as const, data: investigation as unknown as Record<string, unknown> }],
    ]);
    const getIssue = vi.fn().mockRejectedValue(new Error("not found"));
    const registry = createProviderRegistry();
    registry.set("issueTracker", { getIssue, addComment: vi.fn() });
    const ctx = createCtx({ results, providers: registry });

    const result = await noveltyGate(ctx);

    // Should still succeed — failure to add comment is non-fatal
    expect(result.status).toBe("success");
    expect(result.data?.action).toBe("+1");
    expect(silentLogger.warn).toHaveBeenCalledWith(expect.stringContaining("Failed to add occurrence"));
  });

  it("returns outcome: implement when recommendation is 'implement'", async () => {
    const investigation = investigationResult({ recommendation: "implement" });
    const results = new Map([
      ["investigate", { status: "success" as const, data: investigation as unknown as Record<string, unknown> }],
    ]);
    const registry = createProviderRegistry();
    registry.set("issueTracker", { getIssue: vi.fn(), addComment: vi.fn() });
    const ctx = createCtx({ results, providers: registry });

    const result = await noveltyGate(ctx);

    expect(result.status).toBe("success");
    expect(result.data?.action).toBe("implement");
    expect(result.data?.outcome).toBe("implement");
    expect(ctx.skipPhase).not.toHaveBeenCalled();
  });

  it("fails when investigation result is missing", async () => {
    const registry = createProviderRegistry();
    registry.set("issueTracker", { getIssue: vi.fn(), addComment: vi.fn() });
    const ctx = createCtx({ providers: registry });

    const result = await noveltyGate(ctx);

    expect(result.status).toBe("failed");
    expect(result.reason).toBe("No investigation result available");
    expect(ctx.skipPhase).not.toHaveBeenCalled();
  });

  it("handles +1 with no existing issue identifier", async () => {
    const investigation = investigationResult({
      recommendation: "+1 existing",
      existingIssue: "",
      shouldImplement: false,
    });
    const results = new Map([
      ["investigate", { status: "success" as const, data: investigation as unknown as Record<string, unknown> }],
    ]);
    const getIssue = vi.fn();
    const registry = createProviderRegistry();
    registry.set("issueTracker", { getIssue, addComment: vi.fn() });
    const ctx = createCtx({ results, providers: registry });

    const result = await noveltyGate(ctx);

    expect(result.status).toBe("success");
    expect(result.data?.action).toBe("+1");
    // Should NOT attempt to fetch issue when existingIssue is empty
    expect(getIssue).not.toHaveBeenCalled();
  });
});
