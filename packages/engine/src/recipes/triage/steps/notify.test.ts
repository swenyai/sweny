import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "fs";
import { createProviderRegistry } from "../../../runner.js";
import { sendNotification } from "./notify.js";
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

    const body = send.mock.calls[0][0].body;
    expect(body).toContain("**Issue**: [ENG-100](https://linear.app/ENG-100)");
    expect(body).toContain("**Success**: New PR created - https://github.com/org/repo/pull/42");
  });

  it("shows cross-repo dispatch status", async () => {
    const ctx = buildCtx({
      investigate: { status: "success", data: investigationData() },
      "cross-repo-check": { status: "success", data: { dispatched: true, targetRepo: "org/other-repo" } },
    });

    await sendNotification(ctx);

    const body = send.mock.calls[0][0].body;
    expect(body).toContain("**Cross-repo dispatch**");
    expect(body).toContain("org/other-repo");
  });

  it("shows skip status when recommendation is skip", async () => {
    const ctx = buildCtx({
      investigate: { status: "success", data: investigationData({ recommendation: "skip" }) },
    });

    await sendNotification(ctx);

    const body = send.mock.calls[0][0].body;
    expect(body).toContain("**Skipped**: No novel issues found");
  });

  it("shows +1 existing status", async () => {
    const ctx = buildCtx({
      investigate: { status: "success", data: investigationData({ recommendation: "+1 existing ENG-200" }) },
    });

    await sendNotification(ctx);

    const body = send.mock.calls[0][0].body;
    expect(body).toContain("**+1 Existing**: Added occurrence to existing issue");
  });

  it("shows dry run status", async () => {
    const ctx = buildCtx({
      investigate: { status: "success", data: investigationData() },
    });
    ctx.config.dryRun = true;

    await sendNotification(ctx);

    const body = send.mock.calls[0][0].body;
    expect(body).toContain("**Dry Run**: true");
    expect(body).toContain("**Dry Run**: Analysis only");
  });

  it("shows implement-fix skip reason", async () => {
    const ctx = buildCtx({
      investigate: { status: "success", data: investigationData() },
      "implement-fix": { status: "skipped", reason: "Fix declined: not confident" },
    });

    await sendNotification(ctx);

    const body = send.mock.calls[0][0].body;
    expect(body).toContain("**Skipped**: Fix declined: not confident");
  });

  it("appends investigation log when file exists", async () => {
    vi.mocked(fs.existsSync).mockImplementation((p) => p === ".github/triage-analysis/investigation-log.md");
    vi.mocked(fs.readFileSync).mockReturnValue("## Log Entry\nFound 3 errors in service-api");

    const ctx = buildCtx({
      investigate: { status: "success", data: investigationData() },
    });

    await sendNotification(ctx);

    const body = send.mock.calls[0][0].body;
    expect(body).toContain("### Investigation Log");
    expect(body).toContain("Found 3 errors in service-api");
  });

  it("appends issues report when file exists", async () => {
    vi.mocked(fs.existsSync).mockImplementation((p) => p === ".github/triage-analysis/issues-report.md");
    vi.mocked(fs.readFileSync).mockReturnValue("## Issue 1\nNull pointer in auth handler");

    const ctx = buildCtx({
      investigate: { status: "success", data: investigationData() },
    });

    await sendNotification(ctx);

    const body = send.mock.calls[0][0].body;
    expect(body).toContain("### Issues Found");
    expect(body).toContain("Null pointer in auth handler");
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
