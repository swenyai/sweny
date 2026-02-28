import { describe, it, expect, vi, beforeEach } from "vitest";
import { createProviderRegistry } from "../../../runner.js";
import { buildContext } from "./build-context.js";
import { createCtx, silentLogger } from "../test-helpers.js";

describe("buildContext", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("includes triage history when tracker supports it", async () => {
    const issueTracker = {
      listTriageHistory: vi.fn().mockResolvedValue([
        { identifier: "ENG-1", state: "Done", title: "Fix auth", url: "https://linear.app/ENG-1" },
        { identifier: "ENG-2", state: "In Progress", title: "Fix logging", url: "https://linear.app/ENG-2" },
      ]),
    };
    const sourceControl = {
      listPullRequests: vi.fn().mockResolvedValue([]),
    };
    const registry = createProviderRegistry();
    registry.set("issueTracker", issueTracker);
    registry.set("sourceControl", sourceControl);
    const ctx = createCtx({ providers: registry });

    const result = await buildContext(ctx);

    expect(result.status).toBe("success");
    const content = result.data?.knownIssuesContent as string;
    expect(content).toContain("ENG-1");
    expect(content).toContain("ENG-2");
    expect(content).toContain("Fix auth");
    expect(issueTracker.listTriageHistory).toHaveBeenCalledWith("proj-1", "label-triage", 30);
  });

  it("shows fallback when tracker lacks triage history capability", async () => {
    const issueTracker = {
      // No listTriageHistory method — canListTriageHistory returns false
    };
    const sourceControl = {
      listPullRequests: vi.fn().mockResolvedValue([]),
    };
    const registry = createProviderRegistry();
    registry.set("issueTracker", issueTracker);
    registry.set("sourceControl", sourceControl);
    const ctx = createCtx({ providers: registry });

    const result = await buildContext(ctx);

    const content = result.data?.knownIssuesContent as string;
    expect(content).toContain("Issue tracker does not support triage history");
  });

  it("categorizes PRs by state", async () => {
    const issueTracker = {};
    const sourceControl = {
      listPullRequests: vi.fn().mockResolvedValue([
        { number: 10, title: "Fix A", url: "https://github.com/org/repo/pull/10", state: "merged" },
        { number: 11, title: "Fix B", url: "https://github.com/org/repo/pull/11", state: "open" },
        { number: 12, title: "Fix C", url: "https://github.com/org/repo/pull/12", state: "closed" },
      ]),
    };
    const registry = createProviderRegistry();
    registry.set("issueTracker", issueTracker);
    registry.set("sourceControl", sourceControl);
    const ctx = createCtx({ providers: registry });

    const result = await buildContext(ctx);

    const content = result.data?.knownIssuesContent as string;
    expect(content).toContain("### Merged (fixed)");
    expect(content).toContain("PR #10: Fix A");
    expect(content).toContain("### Open (in progress)");
    expect(content).toContain("PR #11: Fix B");
    expect(content).toContain("### Closed (failed attempts)");
    expect(content).toContain("PR #12: Fix C");
  });

  it("handles triage history fetch error gracefully", async () => {
    const issueTracker = {
      listTriageHistory: vi.fn().mockRejectedValue(new Error("API timeout")),
    };
    const sourceControl = {
      listPullRequests: vi.fn().mockResolvedValue([]),
    };
    const registry = createProviderRegistry();
    registry.set("issueTracker", issueTracker);
    registry.set("sourceControl", sourceControl);
    const ctx = createCtx({ providers: registry });

    const result = await buildContext(ctx);

    expect(result.status).toBe("success");
    const content = result.data?.knownIssuesContent as string;
    expect(content).toContain("Failed to fetch triage history");
    expect(silentLogger.warn).toHaveBeenCalledWith(expect.stringContaining("API timeout"));
  });

  it("handles PR fetch error gracefully", async () => {
    const issueTracker = {};
    const sourceControl = {
      listPullRequests: vi.fn().mockRejectedValue(new Error("GitHub down")),
    };
    const registry = createProviderRegistry();
    registry.set("issueTracker", issueTracker);
    registry.set("sourceControl", sourceControl);
    const ctx = createCtx({ providers: registry });

    const result = await buildContext(ctx);

    expect(result.status).toBe("success");
    const content = result.data?.knownIssuesContent as string;
    expect(content).toContain("Failed to fetch triage PRs");
  });

  it("shows empty state when no issues or PRs found", async () => {
    const issueTracker = {
      listTriageHistory: vi.fn().mockResolvedValue([]),
    };
    const sourceControl = {
      listPullRequests: vi.fn().mockResolvedValue([]),
    };
    const registry = createProviderRegistry();
    registry.set("issueTracker", issueTracker);
    registry.set("sourceControl", sourceControl);
    const ctx = createCtx({ providers: registry });

    const result = await buildContext(ctx);

    const content = result.data?.knownIssuesContent as string;
    expect(content).toContain("No triage-labeled issues found");
    expect(content).toContain("_None_");
  });
});
