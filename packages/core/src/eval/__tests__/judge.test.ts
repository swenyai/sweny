import { describe, expect, it, vi } from "vitest";
import { buildJudgePrompt, evaluateJudge, parseJudgeResponse } from "../judge.js";
import type { Claude, Evaluator, NodeResult, ToolCall } from "../../types.js";

const tc = (tool: string, input: unknown = {}, output?: unknown, status?: "success" | "error"): ToolCall => ({
  tool,
  input,
  output,
  status,
});

const result = (data: Record<string, unknown> = {}, toolCalls: ToolCall[] = []): NodeResult => ({
  status: "success",
  data,
  toolCalls,
});

function makeClaude(askResponses: Array<string | Error>): Claude {
  let i = 0;
  return {
    run: async () => ({ status: "success", data: {}, toolCalls: [] }),
    evaluate: async () => "x",
    ask: vi.fn(async () => {
      const r = askResponses[i++] ?? "";
      if (r instanceof Error) throw r;
      return r;
    }),
  };
}

describe("buildJudgePrompt", () => {
  it("includes the rubric, data, and tool-call summary", () => {
    const ev: Evaluator = {
      name: "x",
      kind: "judge",
      rubric: "Does the result include a PR URL?",
      pass_when: "yes",
    };
    const r = result({ prUrl: "https://example.com/pr/1" }, [
      tc("github_create_pr", { title: "fix" }, { ok: true }, "success"),
    ]);
    const p = buildJudgePrompt(ev, r);
    expect(p).toContain("Does the result include a PR URL?");
    expect(p).toContain("https://example.com/pr/1");
    expect(p).toContain("github_create_pr");
    expect(p).toContain("VERDICT: <yes|no>");
    expect(p).toContain("REASONING:");
  });

  it("handles a missing rubric gracefully", () => {
    const ev: Evaluator = { name: "x", kind: "judge" };
    expect(buildJudgePrompt(ev, result())).toContain("(no rubric provided)");
  });

  it("uses pass_when in the verdict format hint", () => {
    const ev: Evaluator = { name: "x", kind: "judge", rubric: "ok?", pass_when: "approve" };
    const p = buildJudgePrompt(ev, result());
    expect(p).toContain("VERDICT: <approve|not_approve>");
  });

  it("renders empty tool-call list as a placeholder", () => {
    const ev: Evaluator = { name: "x", kind: "judge", rubric: "r" };
    const p = buildJudgePrompt(ev, result({}, []));
    expect(p).toContain("(no tools were called)");
  });

  it("caps long tool input/output previews", () => {
    const ev: Evaluator = { name: "x", kind: "judge", rubric: "r" };
    const longString = "a".repeat(500);
    const p = buildJudgePrompt(ev, result({}, [tc("t", { x: longString }, { y: longString })]));
    // Should contain ellipsis since values exceed 200 chars
    expect(p).toContain("…");
  });

  it("infers status from output shape when status field is absent (legacy ToolCall)", () => {
    const ev: Evaluator = { name: "x", kind: "judge", rubric: "r" };
    const p = buildJudgePrompt(ev, result({}, [tc("t", {}, { error: "boom" })]));
    expect(p).toContain("[error]");
  });
});

describe("parseJudgeResponse", () => {
  it("extracts verdict and reasoning", () => {
    const r = parseJudgeResponse("VERDICT: yes\nREASONING: All checks pass.");
    expect(r.verdict).toBe("yes");
    expect(r.reasoning).toBe("All checks pass.");
  });

  it("normalizes verdict to lowercase", () => {
    expect(parseJudgeResponse("VERDICT: YES\nREASONING: x").verdict).toBe("yes");
    expect(parseJudgeResponse("VERDICT: No\nREASONING: x").verdict).toBe("no");
  });

  it("tolerates leading/trailing whitespace and extra blank lines", () => {
    const r = parseJudgeResponse("  VERDICT: yes  \n\n  REASONING: spaced  \n");
    expect(r.verdict).toBe("yes");
    expect(r.reasoning).toBe("spaced");
  });

  it("captures multi-line reasoning", () => {
    const r = parseJudgeResponse("VERDICT: yes\nREASONING: line one\nline two\nline three");
    expect(r.reasoning).toContain("line one");
    expect(r.reasoning).toContain("line three");
  });

  it("returns null verdict when the marker is absent", () => {
    const r = parseJudgeResponse("just some prose without markers");
    expect(r.verdict).toBeNull();
  });

  it("returns the verdict even when reasoning is missing", () => {
    const r = parseJudgeResponse("VERDICT: yes");
    expect(r.verdict).toBe("yes");
    expect(r.reasoning).toBeNull();
  });
});

describe("evaluateJudge", () => {
  const baseEv: Evaluator = { name: "judged", kind: "judge", rubric: "is it good?", pass_when: "yes" };
  const baseOpts = { model: "claude-haiku-4-5" };

  it("returns pass:true when the verdict matches pass_when", async () => {
    const claude = makeClaude(["VERDICT: yes\nREASONING: looks fine"]);
    const out = await evaluateJudge(baseEv, result(), claude, baseOpts);
    expect(out.pass).toBe(true);
    expect(out.reasoning).toBe("looks fine");
  });

  it("returns pass:false when the verdict does not match pass_when", async () => {
    const claude = makeClaude(["VERDICT: no\nREASONING: missing field"]);
    const out = await evaluateJudge(baseEv, result(), claude, baseOpts);
    expect(out.pass).toBe(false);
    expect(out.reasoning).toBe("missing field");
  });

  it("honors a custom pass_when token", async () => {
    const ev: Evaluator = { ...baseEv, pass_when: "approve" };
    const claude = makeClaude(["VERDICT: approve\nREASONING: good"]);
    const out = await evaluateJudge(ev, result(), claude, baseOpts);
    expect(out.pass).toBe(true);
  });

  it("retries once on parse failure and uses the second response", async () => {
    const claude = makeClaude(["garbage with no verdict marker", "VERDICT: yes\nREASONING: ok"]);
    const out = await evaluateJudge(baseEv, result(), claude, baseOpts);
    expect(out.pass).toBe(true);
    expect(out.reasoning).toBe("ok");
    expect((claude.ask as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });

  it("returns pass:false with a 'judge parse failure' reasoning after two unparseable responses", async () => {
    const claude = makeClaude(["nonsense one", "nonsense two"]);
    const out = await evaluateJudge(baseEv, result(), claude, baseOpts);
    expect(out.pass).toBe(false);
    expect(out.reasoning).toMatch(/judge parse failure/);
  });

  it("retries when claude.ask throws", async () => {
    const claude = makeClaude([new Error("network blip"), "VERDICT: yes\nREASONING: ok"]);
    const out = await evaluateJudge(baseEv, result(), claude, baseOpts);
    expect(out.pass).toBe(true);
  });

  it("returns parse-failure when claude.ask throws on both attempts", async () => {
    const claude = makeClaude([new Error("blip 1"), new Error("blip 2")]);
    const out = await evaluateJudge(baseEv, result(), claude, baseOpts);
    expect(out.pass).toBe(false);
    expect(out.reasoning).toMatch(/judge parse failure/);
  });

  it("passes the resolved model down to claude.ask", async () => {
    const claude = makeClaude(["VERDICT: yes\nREASONING: ok"]);
    await evaluateJudge(baseEv, result(), claude, { model: "claude-sonnet-4-6" });
    const callArg = (claude.ask as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArg.model).toBe("claude-sonnet-4-6");
  });

  it("includes the rubric and data in the instruction sent to claude.ask", async () => {
    const claude = makeClaude(["VERDICT: yes\nREASONING: ok"]);
    const ev: Evaluator = { name: "x", kind: "judge", rubric: "RUBRIC_MARKER" };
    await evaluateJudge(ev, result({ payload: "DATA_MARKER" }), claude, baseOpts);
    const callArg = (claude.ask as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArg.instruction).toContain("RUBRIC_MARKER");
    expect(callArg.instruction).toContain("DATA_MARKER");
  });

  it("returns reasoning unchanged (no truncation here; cap is applied at the dispatcher)", async () => {
    const longReasoning = "a".repeat(800);
    const claude = makeClaude([`VERDICT: yes\nREASONING: ${longReasoning}`]);
    const out = await evaluateJudge(baseEv, result(), claude, baseOpts);
    expect(out.reasoning?.length).toBe(800);
  });
});
