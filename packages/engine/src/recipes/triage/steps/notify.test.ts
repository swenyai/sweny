import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "node:fs";
import { createProviderRegistry } from "../../../runner-recipe.js";
import { sendNotification } from "../../../nodes/notify.js";
import { createCtx } from "../test-helpers.js";
import type { StepResult } from "../../../types.js";
import type { InvestigationResult } from "../types.js";

vi.mock("fs");

function investigationData(overrides?: Partial<InvestigationResult>): Record<string, unknown> {
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

describe("sendNotification", () => {
  const send = vi.fn().mockResolvedValue(undefined);

  function buildCtx(stepResults?: Record<string, StepResult>) {
    const results = new Map(Object.entries(stepResults ?? {}));
    const registry = createProviderRegistry();
    registry.set("notification", { send });
    return createCtx({ results, providers: registry });
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    send.mockClear();
    vi.mocked(fs.existsSync).mockReturnValue(false);
  });

  it("sends a basic summary with investigation result", async () => {
    const ctx = buildCtx({
      investigate: { status: "success", data: investigationData({ recommendation: "implement" }) },
    });

    const result = await sendNotification(ctx);

    expect(result.status).toBe("success");
    expect(send).toHaveBeenCalledOnce();
    const payload = send.mock.calls[0][0];
    expect(payload.title).toBe("SWEny Triage Summary");
    expect(payload.body).toContain("**Recommendation**: implement");
    expect(payload.body).toContain("**Service Filter**: `api-*`");
    expect(payload.format).toBe("markdown");
    // Structured fields
    expect(payload.status).toBe("info");
    expect(payload.fields).toBeDefined();
    expect(payload.fields.some((f: { label: string }) => f.label === "Recommendation")).toBe(true);
    expect(payload.fields.some((f: { label: string }) => f.label === "Service Filter")).toBe(true);
  });

  it("includes PR URL when PR was created", async () => {
    const ctx = buildCtx({
      investigate: { status: "success", data: investigationData() },
      "create-pr": {
        status: "success",
        data: {
          issueIdentifier: "ENG-100",
          issueUrl: "https://linear.app/ENG-100",
          prUrl: "https://github.com/org/repo/pull/42",
          prNumber: 42,
        },
      },
    });

    await sendNotification(ctx);

    const payload = send.mock.calls[0][0];
    expect(payload.body).toContain("**Issue**: [ENG-100](https://linear.app/ENG-100)");
    expect(payload.body).toContain("Success");
    // Structured fields
    expect(payload.status).toBe("success");
    expect(payload.summary).toContain("PR created");
    expect(payload.links).toContainEqual(expect.objectContaining({ label: "Issue: ENG-100" }));
    expect(payload.links).toContainEqual(expect.objectContaining({ label: "PR #42" }));
  });

  it("shows cross-repo dispatch status", async () => {
    const ctx = buildCtx({
      investigate: { status: "success", data: investigationData() },
      "cross-repo-check": { status: "success", data: { dispatched: true, targetRepo: "org/other-repo" } },
    });

    await sendNotification(ctx);

    const payload = send.mock.calls[0][0];
    expect(payload.body).toContain("Cross-repo dispatch");
    expect(payload.body).toContain("org/other-repo");
    expect(payload.status).toBe("info");
    expect(payload.summary).toContain("org/other-repo");
  });

  it("shows skip status when recommendation is skip", async () => {
    const ctx = buildCtx({
      investigate: { status: "success", data: investigationData({ recommendation: "skip" }) },
    });

    await sendNotification(ctx);

    const payload = send.mock.calls[0][0];
    expect(payload.body).toContain("Skipped");
    expect(payload.status).toBe("skipped");
    expect(payload.summary).toContain("No novel issues found");
  });

  it("shows +1 existing status", async () => {
    const ctx = buildCtx({
      investigate: { status: "success", data: investigationData({ recommendation: "+1 existing ENG-200" }) },
    });

    await sendNotification(ctx);

    const payload = send.mock.calls[0][0];
    expect(payload.body).toContain("+1 Existing");
    expect(payload.status).toBe("info");
    expect(payload.summary).toContain("+1 Existing");
  });

  it("shows dry run status", async () => {
    const ctx = buildCtx({
      investigate: { status: "success", data: investigationData() },
    });
    ctx.config.dryRun = true;

    await sendNotification(ctx);

    const payload = send.mock.calls[0][0];
    expect(payload.body).toContain("Dry Run");
    expect(payload.status).toBe("info");
    expect(payload.summary).toContain("Dry Run");
  });

  it("shows implement-fix skip reason", async () => {
    const ctx = buildCtx({
      investigate: { status: "success", data: investigationData() },
      "implement-fix": { status: "skipped", reason: "Fix declined: not confident" },
    });

    await sendNotification(ctx);

    const payload = send.mock.calls[0][0];
    expect(payload.body).toContain("Fix declined: not confident");
    expect(payload.status).toBe("skipped");
    expect(payload.summary).toContain("Fix declined: not confident");
  });

  it("appends investigation log when file exists", async () => {
    vi.mocked(fs.existsSync).mockImplementation((p) => p === ".github/triage-analysis/investigation-log.md");
    vi.mocked(fs.readFileSync).mockReturnValue("## Log Entry\nFound 3 errors in service-api");

    const ctx = buildCtx({
      investigate: { status: "success", data: investigationData() },
    });

    await sendNotification(ctx);

    const payload = send.mock.calls[0][0];
    expect(payload.body).toContain("Investigation Log");
    expect(payload.body).toContain("Found 3 errors in service-api");
    // Also present as a structured section
    expect(payload.sections).toContainEqual(expect.objectContaining({ title: "Investigation Log" }));
  });

  it("appends issues report when file exists", async () => {
    vi.mocked(fs.existsSync).mockImplementation((p) => p === ".github/triage-analysis/issues-report.md");
    vi.mocked(fs.readFileSync).mockReturnValue("## Issue 1\nNull pointer in auth handler");

    const ctx = buildCtx({
      investigate: { status: "success", data: investigationData() },
    });

    await sendNotification(ctx);

    const payload = send.mock.calls[0][0];
    expect(payload.body).toContain("Issues Found");
    expect(payload.body).toContain("Null pointer in auth handler");
    // Also present as a structured section
    expect(payload.sections).toContainEqual(expect.objectContaining({ title: "Issues Found" }));
  });

  it("shows dispatch-failed status as warning", async () => {
    const ctx = buildCtx({
      investigate: { status: "success", data: investigationData() },
      "cross-repo-check": {
        status: "success",
        data: { outcome: "dispatch-failed", dispatched: false, targetRepo: "org/unreachable-repo" },
      },
    });

    await sendNotification(ctx);

    const payload = send.mock.calls[0][0];
    expect(payload.status).toBe("warning");
    expect(payload.summary).toContain("dispatch failed");
    expect(payload.summary).toContain("org/unreachable-repo");
  });

  it("appends both log files when both exist", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation((p) => {
      if (String(p).includes("investigation-log")) return "Investigation details";
      if (String(p).includes("issues-report")) return "Issues found";
      return "";
    });

    const ctx = buildCtx({
      investigate: { status: "success", data: investigationData() },
    });

    await sendNotification(ctx);

    const payload = send.mock.calls[0][0];
    expect(payload.sections).toHaveLength(2);
    expect(payload.sections[0].title).toBe("Investigation Log");
    expect(payload.sections[1].title).toBe("Issues Found");
  });

  it("falls back to issue data when no PR data exists", async () => {
    const ctx = buildCtx({
      investigate: { status: "success", data: investigationData() },
      "create-issue": {
        status: "success",
        data: {
          issueId: "id-1",
          issueIdentifier: "ENG-300",
          issueTitle: "Test",
          issueUrl: "https://linear.app/ENG-300",
        },
      },
    });

    await sendNotification(ctx);

    const body = send.mock.calls[0][0].body;
    expect(body).toContain("**Issue**: [ENG-300](https://linear.app/ENG-300)");
  });
});
