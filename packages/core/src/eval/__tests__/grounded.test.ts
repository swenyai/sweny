import { describe, expect, it } from "vitest";
import { evaluateGroundedRule, normalizeUrl, type GroundingEvidence } from "../grounded.js";
import type { OutputGroundedRule, ToolCall } from "../../types.js";

const ok = (tool: string, output: unknown): ToolCall => ({ tool, input: {}, output, status: "success" });
const err = (tool: string, output: unknown): ToolCall => ({ tool, input: {}, output, status: "error" });

const evidence = (toolCalls: ToolCall[], context?: Record<string, unknown>): GroundingEvidence => ({
  toolCalls,
  ...(context ? { context } : {}),
});

const run = (rule: OutputGroundedRule, data: Record<string, unknown>, ev: GroundingEvidence) =>
  evaluateGroundedRule(rule, data, ev);

describe("output_grounded: found by a tool", () => {
  it("passes when every URL in the output came back from a tool", () => {
    const v = run(
      {},
      { summary: "See https://github.com/acme/api/pull/12 for the fix." },
      evidence([ok("github_get_pr", { html_url: "https://github.com/acme/api/pull/12", number: 12 })]),
    );
    expect(v).toEqual({ pass: true });
  });

  it("passes when an issue key in prose was in a tool output", () => {
    const v = run(
      {},
      { note: "Linked to ENG-482 and done." },
      evidence([ok("linear_search", { issues: [{ identifier: "ENG-482", title: "x" }] })]),
    );
    expect(v.pass).toBe(true);
  });

  it("passes when a tool returned the ref as text (MCP string output)", () => {
    const v = run({}, { ref: "acme/api#77" }, evidence([ok("search", "Found acme/api#77: crash on boot")]));
    expect(v.pass).toBe(true);
  });

  it("grounds an owner/repo#N ref by the issue or pull URL a tool returned", () => {
    const v = run(
      {},
      { refs: ["acme/api#12", "Acme/API#13"] },
      evidence([
        ok("gh", {
          items: [
            { html_url: "https://github.com/acme/api/pull/12" },
            { html_url: "https://github.com/acme/api/issues/13" },
          ],
        }),
      ]),
    );
    expect(v.pass).toBe(true);
  });

  it("passes with no ids in the output at all", () => {
    expect(run({}, { summary: "nothing to cite" }, evidence([])).pass).toBe(true);
  });
});

describe("output_grounded: invented ids", () => {
  it("fails on a URL no tool returned, naming the value and its path", () => {
    const v = run(
      {},
      { items: [{ url: "https://github.com/acme/api/pull/12" }, { url: "https://github.com/acme/api/pull/99" }] },
      evidence([ok("gh", { html_url: "https://github.com/acme/api/pull/12" })]),
    );
    expect(v.pass).toBe(false);
    expect(v.reasoning).toMatch(/^output_grounded:/);
    expect(v.reasoning).toContain('items[1].url "https://github.com/acme/api/pull/99"');
    expect(v.reasoning).not.toContain("items[0].url");
  });

  it("fails on an issue key no tool returned", () => {
    const v = run({}, { note: "Fixes ENG-9" }, evidence([ok("linear_search", { issues: [{ identifier: "ENG-90" }] })]));
    expect(v.pass).toBe(false);
    expect(v.reasoning).toContain('note "ENG-9"');
  });

  it("does not ground a key by a longer key that contains it", () => {
    const v = run({}, { key: "ENG-12" }, evidence([ok("t", "ENG-123 and XENG-12")]));
    expect(v.pass).toBe(false);
  });

  it("does not count a failed tool call as evidence", () => {
    const v = run(
      {},
      { url: "https://example.com/tickets/5" },
      evidence([err("fetch", { error: "404 for https://example.com/tickets/5" })]),
    );
    expect(v.pass).toBe(false);
  });

  it("does not count a tool's input as evidence", () => {
    const v = run(
      {},
      { url: "https://example.com/tickets/5" },
      evidence([
        { tool: "fetch", input: { url: "https://example.com/tickets/5" }, output: "not found", status: "success" },
      ]),
    );
    expect(v.pass).toBe(false);
  });

  it("checks a URL inside a URL-bearing prose field once, as a URL", () => {
    const v = run(
      {},
      { note: "see https://linear.app/acme/issue/ENG-5/title" },
      evidence([ok("t", { url: "https://linear.app/acme/issue/ENG-6/title" })]),
    );
    expect(v.pass).toBe(false);
    // Reported once as the URL, not again as the key embedded in it.
    expect(v.reasoning).toContain('"https://linear.app/acme/issue/ENG-5/title"');
    expect(v.reasoning).not.toContain('"ENG-5"');
  });
});

describe("output_grounded: inputs and prior context", () => {
  const ctx = {
    input: { ticket: "OPS-7", link: "https://app.example.com/t/7" },
    triage: { data_url: "https://app.example.com/t/8", evals: {} },
  };

  it("accepts ids from the workflow inputs by default", () => {
    const v = run({}, { cites: ["OPS-7", "https://app.example.com/t/7"] }, evidence([], ctx));
    expect(v.pass).toBe(true);
  });

  it("rejects input-only ids when inputs: false", () => {
    const v = run({ inputs: false }, { cites: ["OPS-7"] }, evidence([], ctx));
    expect(v.pass).toBe(false);
    expect(v.reasoning).toContain('cites[0] "OPS-7"');
  });

  it("accepts ids from prior-node context by default", () => {
    expect(run({}, { u: "https://app.example.com/t/8" }, evidence([], ctx)).pass).toBe(true);
  });

  it("rejects context-only ids when context: false", () => {
    expect(run({ context: false }, { u: "https://app.example.com/t/8" }, evidence([], ctx)).pass).toBe(false);
  });

  it("names the evidence it searched in the failure", () => {
    const v = run({ inputs: false }, { u: "https://nowhere.example/x" }, evidence([], ctx));
    expect(v.reasoning).toMatch(/tool outputs or prior context/);
    expect(v.reasoning).not.toMatch(/inputs/);
  });

  it("ignores the evaluated node's own earlier visit in the context", () => {
    const v = evaluateGroundedRule(
      {},
      { u: "https://app.example.com/t/9" },
      { toolCalls: [], context: { input: {}, self: { u: "https://app.example.com/t/9" } }, nodeId: "self" },
    );
    expect(v.pass).toBe(false);
  });
});

describe("output_grounded: stale ids (opt-in)", () => {
  // The input names OPS-7, but this node's tool listed OPS tickets and OPS-7
  // was not among them (closed since the input was built).
  const ctx = { input: { tickets: ["OPS-7", "OPS-8"] } };
  const listing = [ok("tickets_open", { open: [{ key: "OPS-8" }, { key: "OPS-9" }] })];

  it("allows an input id the tool output contradicts when stale is off (default)", () => {
    expect(run({}, { todo: ["OPS-7", "OPS-8"] }, evidence(listing, ctx)).pass).toBe(true);
  });

  it("fails it when stale: true", () => {
    const v = run({ stale: true }, { todo: ["OPS-7", "OPS-8"] }, evidence(listing, ctx));
    expect(v.pass).toBe(false);
    expect(v.reasoning).toContain('todo[0] "OPS-7"');
    expect(v.reasoning).toMatch(/stale/);
    expect(v.reasoning).not.toContain('"OPS-8"');
  });

  it("does not call an input id stale when no tool returned ids of its kind", () => {
    const v = run({ stale: true }, { todo: ["OPS-7"] }, evidence([ok("other", { keys: ["ENG-1"] })], ctx));
    expect(v.pass).toBe(true);
  });

  it("treats URLs in the same collection as the same kind", () => {
    const v = run(
      { stale: true },
      { pr: "https://github.com/acme/api/pull/3" },
      evidence([ok("gh_list", ["https://github.com/acme/api/pull/4"])], {
        input: { pr: "https://github.com/acme/api/pull/3" },
      }),
    );
    expect(v.pass).toBe(false);
  });
});

describe("output_grounded: URL normalization", () => {
  it("ignores a trailing slash", () => {
    const v = run({}, { u: "https://example.com/docs/" }, evidence([ok("t", "https://example.com/docs")]));
    expect(v.pass).toBe(true);
  });

  it("ignores the case of the host", () => {
    const v = run(
      {},
      { u: "https://GitHub.com/acme/api/pull/1" },
      evidence([ok("t", "https://github.com/acme/api/pull/1")]),
    );
    expect(v.pass).toBe(true);
  });

  it("keeps the path case-sensitive", () => {
    const v = run({}, { u: "https://example.com/Docs" }, evidence([ok("t", "https://example.com/docs")]));
    expect(v.pass).toBe(false);
  });

  it("strips sentence punctuation after a URL in prose", () => {
    const v = run({}, { s: "Read https://example.com/a." }, evidence([ok("t", "(https://example.com/a)")]));
    expect(v.pass).toBe(true);
  });

  it("normalizeUrl lowercases scheme and host, drops the default port, fragment and trailing slash", () => {
    expect(normalizeUrl("HTTPS://Example.COM:443/a/b/?q=1#frag")).toBe("https://example.com/a/b?q=1");
    expect(normalizeUrl("https://example.com/")).toBe("https://example.com");
    expect(normalizeUrl("not a url")).toBe("not a url");
  });
});

describe("output_grounded: nested arrays and paths", () => {
  it("walks arrays of arrays and names the concrete index path", () => {
    const v = run(
      {},
      { grid: [["https://e.com/1"], ["https://e.com/2", "https://e.com/3"]] },
      evidence([ok("t", ["https://e.com/1", "https://e.com/2"])]),
    );
    expect(v.pass).toBe(false);
    expect(v.reasoning).toContain('grid[1][1] "https://e.com/3"');
  });

  it("scans only the configured paths", () => {
    const v = run(
      { paths: ["items[*].url"] },
      { items: [{ url: "https://e.com/1", note: "https://made.up/x" }], footer: "https://made.up/y" },
      evidence([ok("t", "https://e.com/1")]),
    );
    expect(v.pass).toBe(true);
  });

  it("checks whole values at ids paths, numbers included", () => {
    const data = { items: [{ ticket_id: 4821 }, { ticket_id: "4822" }] };
    const v = run({ ids: ["items[*].ticket_id"] }, data, evidence([ok("t", { rows: [{ id: 4821 }] })]));
    expect(v.pass).toBe(false);
    expect(v.reasoning).toContain('items[1].ticket_id "4822"');
    expect(v.reasoning).not.toContain("items[0]");
  });

  it("does not ground a whole-value id by a longer number", () => {
    const v = run({ ids: ["id"] }, { id: 48 }, evidence([ok("t", { id: 4821 })]));
    expect(v.pass).toBe(false);
  });

  it("treats a missing configured path as nothing to check", () => {
    expect(run({ paths: ["nope"], ids: ["also.nope"] }, { a: 1 }, evidence([])).pass).toBe(true);
  });

  it("fails on a malformed path rather than passing silently", () => {
    const v = run({ paths: ["items[0]"] }, { items: [] }, evidence([]));
    expect(v.pass).toBe(false);
    expect(v.reasoning).toMatch(/items\[0\]/);
  });
});

describe("output_grounded: allow-list, patterns and tools", () => {
  it("allows listed constants, URLs normalized", () => {
    const v = run(
      { allow: ["https://docs.sweny.ai/nodes/", "SEC-1"] },
      { s: "See https://docs.sweny.ai/nodes and SEC-1" },
      evidence([]),
    );
    expect(v.pass).toBe(true);
  });

  it("uses only the named patterns when patterns is set", () => {
    // url only: the issue key is not checked.
    expect(run({ patterns: ["url"] }, { s: "ENG-1" }, evidence([])).pass).toBe(true);
    expect(run({ patterns: ["issue_key"] }, { s: "https://made.up" }, evidence([])).pass).toBe(true);
  });

  it("accepts a custom regex pattern and uses its first group when present", () => {
    const rule: OutputGroundedRule = { patterns: ["ticket (\\d+)"] };
    expect(run(rule, { s: "ticket 55 is done" }, evidence([ok("t", { id: 55 })])).pass).toBe(true);
    const v = run(rule, { s: "ticket 56 is done" }, evidence([ok("t", { id: 55 })]));
    expect(v.pass).toBe(false);
    expect(v.reasoning).toContain('s "56"');
  });

  it("fails clearly on an invalid custom pattern", () => {
    const v = run({ patterns: ["(unclosed"] }, { s: "x" }, evidence([]));
    expect(v.pass).toBe(false);
    expect(v.reasoning).toMatch(/invalid pattern/);
  });

  it("counts only the named tools' outputs when tools is set", () => {
    const calls = [ok("bash", "echo https://e.com/9"), ok("fetch_ticket", "https://e.com/1")];
    expect(run({ tools: ["fetch_ticket"] }, { u: "https://e.com/1" }, evidence(calls)).pass).toBe(true);
    expect(run({ tools: ["fetch_ticket"] }, { u: "https://e.com/9" }, evidence(calls)).pass).toBe(false);
  });

  it("expands tool aliases for tools", () => {
    const aliases = new Map([["github_get_pr", new Set(["github_get_pr", "pull_request_read"])]]);
    const v = evaluateGroundedRule(
      { tools: ["github_get_pr"] },
      { u: "https://github.com/a/b/pull/1" },
      { toolCalls: [ok("pull_request_read", { url: "https://github.com/a/b/pull/1" })], aliases },
    );
    expect(v.pass).toBe(true);
  });

  it("reports each offending value once per path", () => {
    const v = run({}, { s: "ENG-1 and ENG-1 again" }, evidence([]));
    expect(v.reasoning!.match(/ENG-1/g)).toHaveLength(1);
  });
});
