import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "fs";
import { createProviderRegistry } from "../../../runner.js";
import { investigate } from "./investigate.js";
import { createCtx } from "../test-helpers.js";
import type { StepResult } from "../../../types.js";

vi.mock("fs");
vi.mock("../prompts.js", () => ({
  buildInvestigationPrompt: vi.fn().mockReturnValue("mock investigation prompt"),
}));

describe("investigate", () => {
  const install = vi.fn().mockResolvedValue(undefined);
  const run = vi.fn().mockResolvedValue(undefined);
  const observability = { verifyAccess: vi.fn() };
  const codingAgent = { install, run };

  function buildCtx(overrides?: { knownIssuesContent?: string; config?: Record<string, unknown> }) {
    const results = new Map<string, StepResult>();
    if (overrides?.knownIssuesContent !== undefined) {
      results.set("build-context", {
        status: "success",
        data: { knownIssuesContent: overrides.knownIssuesContent },
      });
    }
    const registry = createProviderRegistry();
    registry.set("observability", observability);
    registry.set("codingAgent", codingAgent);
    return createCtx({ results, providers: registry, config: overrides?.config });
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    install.mockResolvedValue(undefined);
    run.mockResolvedValue(undefined);
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
    vi.mocked(fs.writeFileSync).mockReturnValue(undefined);
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.readFileSync).mockReturnValue("");
  });

  it("creates analysis directory", async () => {
    const ctx = buildCtx();
    await investigate(ctx);
    expect(fs.mkdirSync).toHaveBeenCalledWith(".github/triage-analysis", { recursive: true });
  });

  it("installs coding agent", async () => {
    const ctx = buildCtx();
    await investigate(ctx);
    expect(install).toHaveBeenCalled();
  });

  it("writes known-issues context file", async () => {
    const ctx = buildCtx({ knownIssuesContent: "## Known Issues\n- ENG-1" });
    await investigate(ctx);
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining("known-issues-context.md"),
      "## Known Issues\n- ENG-1",
    );
  });

  it("calls codingAgent.run with correct maxTurns and env", async () => {
    const ctx = buildCtx({ config: { maxInvestigateTurns: 15, agentEnv: { FOO: "bar" } } });
    await investigate(ctx);
    expect(run).toHaveBeenCalledWith({
      prompt: "mock investigation prompt",
      maxTurns: 15,
      env: { FOO: "bar" },
    });
  });

  it("parses: no best-candidate file returns skip", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const ctx = buildCtx();
    const result = await investigate(ctx);
    expect(result.status).toBe("success");
    expect(result.data?.recommendation).toBe("skip");
    expect(result.data?.shouldImplement).toBe(false);
    expect(result.data?.bestCandidate).toBe(false);
  });

  it("parses: RECOMMENDATION implement", async () => {
    vi.mocked(fs.existsSync).mockImplementation((p) => {
      return String(p).includes("best-candidate.md");
    });
    vi.mocked(fs.readFileSync).mockReturnValue("# Fix\nRECOMMENDATION: implement\nSome details");
    const ctx = buildCtx();
    const result = await investigate(ctx);
    expect(result.data?.recommendation).toBe("implement");
    expect(result.data?.shouldImplement).toBe(true);
  });

  it("parses: RECOMMENDATION skip", async () => {
    vi.mocked(fs.existsSync).mockImplementation((p) => {
      return String(p).includes("best-candidate.md");
    });
    vi.mocked(fs.readFileSync).mockReturnValue("# Analysis\nRECOMMENDATION: skip\n");
    const ctx = buildCtx();
    const result = await investigate(ctx);
    expect(result.data?.recommendation).toBe("skip");
    expect(result.data?.shouldImplement).toBe(false);
  });

  it("parses: RECOMMENDATION +1 existing ENG-456", async () => {
    vi.mocked(fs.existsSync).mockImplementation((p) => {
      return String(p).includes("best-candidate.md");
    });
    vi.mocked(fs.readFileSync).mockReturnValue("# Analysis\nRECOMMENDATION: +1 existing ENG-456\n");
    const ctx = buildCtx();
    const result = await investigate(ctx);
    expect(result.data?.recommendation).toBe("+1 existing ENG-456");
    expect(result.data?.existingIssue).toBe("ENG-456");
    expect(result.data?.shouldImplement).toBe(false);
  });

  it("parses: TARGET_REPO extraction", async () => {
    vi.mocked(fs.existsSync).mockImplementation((p) => {
      return String(p).includes("best-candidate.md");
    });
    vi.mocked(fs.readFileSync).mockReturnValue("# Fix\nRECOMMENDATION: implement\nTARGET_REPO: other-org/other-repo\n");
    const ctx = buildCtx();
    const result = await investigate(ctx);
    expect(result.data?.targetRepo).toBe("other-org/other-repo");
  });

  it("parses: issues-report.md sets issuesFound", async () => {
    vi.mocked(fs.existsSync).mockImplementation((p) => {
      return String(p).includes("issues-report.md");
    });
    const ctx = buildCtx();
    const result = await investigate(ctx);
    expect(result.data?.issuesFound).toBe(true);
  });

  it("default recommendation when no RECOMMENDATION line", async () => {
    vi.mocked(fs.existsSync).mockImplementation((p) => {
      return String(p).includes("best-candidate.md");
    });
    vi.mocked(fs.readFileSync).mockReturnValue("# Fix\nSome analysis without recommendation");
    const ctx = buildCtx();
    const result = await investigate(ctx);
    expect(result.data?.recommendation).toBe("implement");
    expect(result.data?.shouldImplement).toBe(true);
  });
});
