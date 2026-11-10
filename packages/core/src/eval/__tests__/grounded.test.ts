// output_grounded (#580). Assertions pin exact reasoning strings so the
// module holds the mutation floor (it is in stryker.config.json's mutate list).

import { describe, expect, it } from "vitest";
import {
  containsToken,
  evaluateGroundedRule,
  normalizeQuote,
  normalizeUrl,
  type GroundingEvidence,
} from "../grounded.js";
import type { OutputGroundedRule, ToolCall } from "../../types.js";

const ok = (tool: string, output: unknown): ToolCall => ({ tool, input: {}, output, status: "success" });
const err = (tool: string, output: unknown): ToolCall => ({ tool, input: {}, output, status: "error" });
const bare = (tool: string, output: unknown): ToolCall => ({ tool, input: {}, output });

const ev = (toolCalls: ToolCall[], context?: Record<string, unknown>): GroundingEvidence => ({
  toolCalls,
  ...(context ? { context } : {}),
});

const run = (rule: OutputGroundedRule, data: unknown, evidence: GroundingEvidence) =>
  evaluateGroundedRule(rule, data, evidence);

/** The reasoning, or "PASS" when the rule passed. */
const why = (rule: OutputGroundedRule, data: unknown, evidence: GroundingEvidence): string => {
  const v = run(rule, data, evidence);
  if (v.pass) {
    expect(v).toEqual({ pass: true });
    return "PASS";
  }
  return v.reasoning!;
};

const ALL = "tool outputs, inputs, prior context";
const ids = (list: string, n = 1, evidence = ALL) =>
  `output_grounded: ${n} value(s) not grounded (evidence: ${evidence}): ${list}`;

describe("normalizeUrl", () => {
  it("lowercases scheme and host, drops the default port, fragment and trailing slash", () => {
    expect(normalizeUrl("HTTPS://Example.COM:443/a/b/?q=1#frag")).toBe("https://example.com/a/b?q=1");
  });
  it("keeps a non-default port and the path's case", () => {
    expect(normalizeUrl("http://E.com:8080/X")).toBe("http://e.com:8080/X");
  });
  it("drops every trailing slash, and the root path", () => {
    expect(normalizeUrl("https://e.com/a//")).toBe("https://e.com/a");
    expect(normalizeUrl(" https://e.com/ ")).toBe("https://e.com");
  });
  it("returns a non-URL trimmed", () => {
    expect(normalizeUrl(" not a url ")).toBe("not a url");
  });
});

describe("containsToken", () => {
  it("matches a whole token", () => {
    expect(containsToken("ENG-12", "ENG-12")).toBe(true);
    expect(containsToken("a ENG-12 b", "ENG-12")).toBe(true);
    expect(containsToken("(ENG-12)", "ENG-12")).toBe(true);
  });
  it("refuses a word character or dash against either edge", () => {
    expect(containsToken("xENG-12", "ENG-12")).toBe(false);
    expect(containsToken("_ENG-12", "ENG-12")).toBe(false);
    expect(containsToken("-ENG-12", "ENG-12")).toBe(false);
    expect(containsToken("ENG-123", "ENG-12")).toBe(false);
    expect(containsToken("ENG-12-", "ENG-12")).toBe(false);
    expect(containsToken("ENG-12x", "ENG-12")).toBe(false);
  });
  it("keeps looking past a partial match", () => {
    expect(containsToken("ENG-123 ENG-12", "ENG-12")).toBe(true);
  });
  it("needs no boundary on an edge that is not a word character", () => {
    expect(containsToken("a#12", "#12")).toBe(true);
    expect(containsToken("12.x", "12.")).toBe(true);
    expect(containsToken("a12.", "12.")).toBe(false);
    expect(containsToken("#12a", "#12")).toBe(false);
  });
  it("finds nothing in an empty string", () => {
    expect(containsToken("", "x")).toBe(false);
  });
});

describe("normalizeQuote", () => {
  it("exact keeps every byte", () => {
    expect(normalizeQuote("  a  b ", "exact")).toBe("  a  b ");
  });
  it("trim (the default) drops only the ends", () => {
    expect(normalizeQuote("  a  b ", "trim")).toBe("a  b");
    expect(normalizeQuote("  a  b ", undefined)).toBe("a  b");
  });
  it("collapse turns every whitespace run into one space and trims", () => {
    expect(normalizeQuote(" a \t\n b ", "collapse")).toBe("a b");
  });
});

describe("ids: found by a tool", () => {
  it("passes a URL a tool returned", () => {
    expect(
      why(
        {},
        { s: "See https://github.com/acme/api/pull/12 now" },
        ev([ok("gh", { u: "https://github.com/acme/api/pull/12" })]),
      ),
    ).toBe("PASS");
  });

  it("passes an http URL", () => {
    expect(why({}, { u: "http://e.com/a" }, ev([ok("t", "http://e.com/a")]))).toBe("PASS");
  });

  it("passes an issue key a tool returned", () => {
    expect(why({}, { s: "Linked to ENG-482." }, ev([ok("t", { issues: [{ identifier: "ENG-482" }] })]))).toBe("PASS");
  });

  it("passes a ref a tool returned as text, in any case", () => {
    expect(why({}, { r: "acme/api#77" }, ev([ok("t", "Found Acme/Api#77: crash")]))).toBe("PASS");
  });

  it("grounds an owner/repo#N ref by the issue or pull URL a tool returned", () => {
    const tools = [ok("gh", ["https://github.com/acme/api/pull/12", "https://github.com/acme/api/issues/13"])];
    expect(why({}, { refs: ["acme/api#12", "Acme/API#13"] }, ev(tools))).toBe("PASS");
  });

  it("grounds by an object key, and by a number", () => {
    expect(why({}, { s: "ENG-1" }, ev([ok("t", { "ENG-1": {} })]))).toBe("PASS");
    expect(why({ ids: ["n"] }, { n: "55" }, ev([ok("t", { id: 55 })]))).toBe("PASS");
  });

  it("reads a cyclic tool output once", () => {
    const out: Record<string, unknown> = { key: "ENG-1" };
    out.self = out;
    expect(why({}, { s: "ENG-1" }, ev([ok("t", out)]))).toBe("PASS");
  });

  it("passes when the output cites nothing", () => {
    expect(why({}, { s: "nothing to cite", n: 4821, b: true, z: null }, ev([]))).toBe("PASS");
  });
});

describe("ids: invented", () => {
  it("names the value and its path", () => {
    const data = {
      items: [{ url: "https://github.com/acme/api/pull/12" }, { url: "https://github.com/acme/api/pull/99" }],
    };
    expect(why({}, data, ev([ok("gh", { u: "https://github.com/acme/api/pull/12" })]))).toBe(
      ids('items[1].url "https://github.com/acme/api/pull/99"'),
    );
  });

  it("fails an http URL no tool returned", () => {
    expect(why({}, { u: "http://e.com/b" }, ev([ok("t", "http://e.com/a")]))).toBe(ids('u "http://e.com/b"'));
  });

  it("fails an issue key a longer key does not ground", () => {
    expect(why({}, { note: "Fixes ENG-9" }, ev([ok("t", "ENG-90")]))).toBe(ids('note "ENG-9"'));
  });

  it("fails a ref no tool returned", () => {
    expect(why({}, { r: "acme/api#78" }, ev([ok("t", "acme/api#77")]))).toBe(ids('r "acme/api#78"'));
  });

  it("does not ground a ref by a URL on a longer path or a nested repo", () => {
    expect(why({}, { r: "acme/api#12" }, ev([ok("t", "https://github.com/acme/api/pull/12/files")]))).toBe(
      ids('r "acme/api#12"'),
    );
    expect(why({}, { r: "acme/api#12" }, ev([ok("t", "https://github.com/x/acme/api/pull/12")]))).toBe(
      ids('r "acme/api#12"'),
    );
    expect(why({}, { r: "acme/api#12" }, ev([ok("t", "https://github.com/acme/api/commits/12")]))).toBe(
      ids('r "acme/api#12"'),
    );
  });

  it("checks an id inside a URL once, as the URL", () => {
    expect(
      why({}, { note: "see https://linear.app/a/issue/ENG-5/t" }, ev([ok("t", "https://linear.app/a/issue/ENG-6/t")])),
    ).toBe(ids('note "https://linear.app/a/issue/ENG-5/t"'));
  });

  it("lists each value once per path, and again on another path", () => {
    expect(why({}, { a: "ENG-1 and ENG-1", b: "ENG-1" }, ev([]))).toBe(ids('a "ENG-1"; b "ENG-1"', 2));
  });

  it("lists at most 8 and counts the rest", () => {
    const keys = Array.from({ length: 10 }, (_, i) => `K${i}-1`);
    const listed = keys
      .slice(0, 8)
      .map((k, i) => `s[${i}] "${k}"`)
      .join("; ");
    expect(why({}, { s: keys }, ev([]))).toBe(ids(`${listed}; and 2 more`, 10));
    const eight = keys.slice(0, 8);
    expect(why({}, { s: eight }, ev([]))).toBe(ids(listed, 8));
  });

  it("shortens a long value to 120 characters", () => {
    const long = "x".repeat(121);
    expect(why({ ids: ["v"] }, { v: long }, ev([]))).toBe(ids(`v "${"x".repeat(119)}…"`));
    const fits = "y".repeat(120);
    expect(why({ ids: ["v"] }, { v: fits }, ev([]))).toBe(ids(`v "${fits}"`));
  });
});

describe("ids: what is not evidence", () => {
  const url = "https://e.com/tickets/5";
  const failed = ids(`u "${url}"`);

  it("a call with status error, whatever its output", () => {
    expect(why({}, { u: url }, ev([err("t", { data: url })]))).toBe(failed);
  });
  it("a call with no status and an error output", () => {
    expect(why({}, { u: url }, ev([bare("t", { error: url })]))).toBe(failed);
  });
  it("but a call with no status and a normal output counts", () => {
    expect(why({}, { u: url }, ev([bare("t", { data: url })]))).toBe("PASS");
  });
  it("and status success wins over an error-looking output", () => {
    expect(why({}, { u: url }, ev([ok("t", { error: url })]))).toBe("PASS");
  });
  it("a tool's input", () => {
    expect(why({}, { u: url }, ev([{ tool: "t", input: { url }, output: "nope", status: "success" }]))).toBe(failed);
  });
  it("an array index", () => {
    expect(why({ ids: ["n"] }, { n: 0 }, ev([ok("t", ["a"])]))).toBe(ids('n "0"'));
  });
});

describe("ids: inputs and prior context", () => {
  const ctx = {
    input: { ticket: "OPS-7" },
    triage: { link: "https://app.example.com/t/8" },
  };

  it("accepts input and context ids by default", () => {
    expect(why({}, { a: "OPS-7", b: "https://app.example.com/t/8" }, ev([], ctx))).toBe("PASS");
  });

  it("inputs: false rejects input-only ids", () => {
    expect(why({ inputs: false }, { a: "OPS-7" }, ev([], ctx))).toBe(
      ids('a "OPS-7"', 1, "tool outputs, prior context"),
    );
    expect(why({ inputs: false }, { b: "https://app.example.com/t/8" }, ev([], ctx))).toBe("PASS");
  });

  it("context: false rejects context-only ids", () => {
    expect(why({ context: false }, { b: "https://app.example.com/t/8" }, ev([], ctx))).toBe(
      ids('b "https://app.example.com/t/8"', 1, "tool outputs, inputs"),
    );
    expect(why({ context: false }, { a: "OPS-7" }, ev([], ctx))).toBe("PASS");
  });

  it("both off leaves only tool outputs", () => {
    expect(why({ inputs: false, context: false }, { a: "OPS-7" }, ev([ok("t", "OPS-8")], ctx))).toBe(
      ids('a "OPS-7"', 1, "tool outputs"),
    );
  });

  it("never counts the node's own earlier visit", () => {
    const v = run({}, { u: "OPS-9" }, { toolCalls: [], context: { input: {}, self: { u: "OPS-9" } }, nodeId: "self" });
    expect(v).toEqual({ pass: false, reasoning: ids('u "OPS-9"') });
    const other = run(
      {},
      { u: "OPS-9" },
      { toolCalls: [], context: { input: {}, prior: { u: "OPS-9" } }, nodeId: "self" },
    );
    expect(other).toEqual({ pass: true });
  });
});

describe("ids: stale (opt-in)", () => {
  const stale = (label: string) =>
    ids(`${label} (stale: this node's tools returned other ids of its kind, not this one)`);
  const ctx = { input: { tickets: ["OPS-7", "OPS-8"] } };
  const listing = [ok("open_tickets", [{ key: "OPS-8" }, { key: "OPS-9" }])];

  it("is off by default", () => {
    expect(why({}, { todo: ["OPS-7", "OPS-8"] }, ev(listing, ctx))).toBe("PASS");
  });

  it("fails an input id the tool's listing of its kind left out", () => {
    expect(why({ stale: true }, { todo: ["OPS-7", "OPS-8"] }, ev(listing, ctx))).toBe(stale('todo[0] "OPS-7"'));
  });

  it("does not call an id stale when no tool returned its kind", () => {
    expect(why({ stale: true }, { todo: ["OPS-7"] }, ev([ok("t", "ENG-1")], ctx))).toBe("PASS");
  });

  it("groups URLs by collection", () => {
    const input = { input: { pr: "https://github.com/acme/api/pull/3" } };
    expect(
      why(
        { stale: true },
        { pr: "https://github.com/acme/api/pull/3" },
        ev([ok("t", "https://github.com/acme/api/pull/4")], input),
      ),
    ).toBe(stale('pr "https://github.com/acme/api/pull/3"'));
    expect(
      why(
        { stale: true },
        { pr: "https://github.com/acme/api/pull/3" },
        ev([ok("t", "https://github.com/acme/web/pull/4")], input),
      ),
    ).toBe("PASS");
  });

  it("gives a bare origin no kind", () => {
    const input = { input: { site: "https://e.com" } };
    expect(why({ stale: true }, { site: "https://e.com" }, ev([ok("t", "https://other.com")], input))).toBe("PASS");
  });

  it("groups refs by repo, in any case", () => {
    const input = { input: { r: "acme/api#3" } };
    expect(why({ stale: true }, { r: "acme/api#3" }, ev([ok("t", "Acme/API#4")], input))).toBe(stale('r "acme/api#3"'));
    expect(why({ stale: true }, { r: "acme/api#3" }, ev([ok("t", "acme/web#4")], input))).toBe("PASS");
  });

  it("groups custom-pattern ids by pattern", () => {
    const input = { input: { t: "T5" } };
    expect(why({ stale: true, patterns: ["T\\d+"] }, { t: "T5" }, ev([ok("t", "T6")], input))).toBe(stale('t "T5"'));
  });

  it("classifies whole values at ids paths when they have a kind", () => {
    const input = { input: { t: "OPS-7", n: 7 } };
    expect(why({ stale: true, ids: ["t"] }, { t: "OPS-7" }, ev([ok("t", "OPS-8")], input))).toBe(stale('t "OPS-7"'));
    expect(why({ stale: true, ids: ["n"] }, { n: 7 }, ev([ok("t", { id: 8 })], input))).toBe("PASS");
  });
});

describe("ids: URL normalization", () => {
  it("ignores a trailing slash, host case and the fragment", () => {
    expect(why({}, { u: "https://e.com/docs/" }, ev([ok("t", "https://e.com/docs")]))).toBe("PASS");
    expect(why({}, { u: "https://E.com/a" }, ev([ok("t", "https://e.com/a")]))).toBe("PASS");
    expect(why({}, { u: "https://e.com/a" }, ev([ok("t", "https://e.com/a#x")]))).toBe("PASS");
  });

  it("keeps the path case-sensitive", () => {
    expect(why({}, { u: "https://e.com/Docs" }, ev([ok("t", "https://e.com/docs")]))).toBe(
      ids('u "https://e.com/Docs"'),
    );
  });

  it("strips sentence punctuation after a URL, not dots inside it", () => {
    expect(why({}, { s: "Read https://e.com/a." }, ev([ok("t", "(https://e.com/a)")]))).toBe("PASS");
    expect(why({}, { s: "Really https://e.com/a?!" }, ev([ok("t", "https://e.com/a")]))).toBe("PASS");
    expect(why({ allow: ["https://e.com/file.txt"] }, { s: "https://e.com/file.txt" }, ev([]))).toBe("PASS");
  });
});

describe("ids: issue-key and ref shapes", () => {
  it("needs a 2 to 10 character uppercase prefix", () => {
    expect(why({}, { s: "A-1 eng-1 ABCDEFGHIJK-1 ENG- X-ENG-1 ENG-1-2 ENG-1a" }, ev([]))).toBe("PASS");
    expect(why({}, { s: "AB-1" }, ev([]))).toBe(ids('s "AB-1"'));
    expect(why({}, { s: "ABCDEFGHIJ-1" }, ev([]))).toBe(ids('s "ABCDEFGHIJ-1"'));
    expect(why({}, { s: "A2-10" }, ev([]))).toBe(ids('s "A2-10"'));
  });

  it("does not take a ref inside a path or followed by a word", () => {
    expect(why({}, { s: "x/acme/api#7 acme/api#7x" }, ev([]))).toBe("PASS");
    expect(why({}, { s: "a.b/c-d#10" }, ev([]))).toBe(ids('s "a.b/c-d#10"'));
  });
});

describe("ids: paths", () => {
  it("names concrete indexes in nested arrays", () => {
    const data = { grid: [["https://e.com/1"], ["https://e.com/2", "https://e.com/3"]] };
    expect(why({}, data, ev([ok("t", ["https://e.com/1", "https://e.com/2"])]))).toBe(
      ids('grid[1][1] "https://e.com/3"'),
    );
  });

  it("quotes keys that are not identifiers", () => {
    expect(why({}, { "a b": "ENG-1", x: { "a-b": "ENG-2" } }, ev([]))).toBe(
      ids('["a b"] "ENG-1"; x["a-b"] "ENG-2"', 2),
    );
  });

  it("scans only the configured paths, with or without a prefix", () => {
    const data = { items: [{ url: "https://e.com/1", note: "https://made.up/x" }], meta: { link: "ENG-5" } };
    const tools = ev([ok("t", "https://e.com/1")]);
    expect(why({ paths: ["items[*].url"] }, data, tools)).toBe("PASS");
    expect(why({ paths: ["any:items[*].url"] }, data, tools)).toBe("PASS");
    expect(why({ paths: ["all:items[*].note"] }, data, tools)).toBe(ids('items[0].note "https://made.up/x"'));
    expect(why({ paths: ["meta.link"] }, data, tools)).toBe(ids('meta.link "ENG-5"'));
  });

  it("has nothing to check where a path does not resolve", () => {
    const data = { items: [{ url: "ENG-1" }], one: { url: "ENG-2" }, nul: null, s: "ENG-3" };
    expect(why({ paths: ["nope", "one[*].url", "items.url", "nul.x", "s.x"], ids: ["also.nope"] }, data, ev([]))).toBe(
      "PASS",
    );
  });

  it("fails a malformed path", () => {
    expect(why({ paths: ["items[0]"] }, { items: [] }, ev([]))).toBe("output_grounded: malformed path 'items[0]'");
    expect(why({ ids: ["a..b"] }, {}, ev([]))).toBe("output_grounded: malformed path 'a..b'");
  });

  it("checks whole values at ids paths: strings trimmed, numbers, not booleans or blanks", () => {
    const data = { items: [{ t: 4821 }, { t: " 4822 " }, { t: true }, { t: "  " }] };
    expect(why({ ids: ["items[*].t"] }, data, ev([ok("t", { rows: [{ id: 4821 }] })]))).toBe(ids('items[1].t "4822"'));
  });

  it("does not ground a whole value by a longer number", () => {
    expect(why({ ids: ["id"] }, { id: 48 }, ev([ok("t", { id: 4821 })]))).toBe(ids('id "48"'));
  });

  it("does not scan numbers for patterns", () => {
    expect(why({ patterns: ["\\d+"] }, { n: 12345 }, ev([]))).toBe("PASS");
  });
});

describe("ids: allow, patterns, tools", () => {
  it("allows listed constants, URLs compared normalized", () => {
    expect(
      why({ allow: ["https://Docs.sweny.ai/nodes/", "SEC-1"] }, { s: "https://docs.sweny.ai/nodes SEC-1" }, ev([])),
    ).toBe("PASS");
  });

  it("checks only the named built-ins", () => {
    const data = { s: "ENG-1 https://made.up/x acme/api#1" };
    expect(why({ patterns: ["url"] }, data, ev([]))).toBe(ids('s "https://made.up/x"'));
    expect(why({ patterns: ["issue_key"] }, data, ev([]))).toBe(ids('s "ENG-1"'));
    expect(why({ patterns: ["github_ref"] }, data, ev([]))).toBe(ids('s "acme/api#1"'));
    expect(why({ patterns: [] }, data, ev([]))).toBe("PASS");
  });

  it("masks URLs even when the url pattern is off", () => {
    expect(why({ patterns: ["issue_key"] }, { s: "https://linear.app/a/issue/ENG-5/t" }, ev([]))).toBe("PASS");
  });

  it("takes a custom regex's first group, else the whole match, and skips empty matches", () => {
    expect(why({ patterns: ["ticket (\\d+)"] }, { s: "ticket 55" }, ev([ok("t", { id: 55 })]))).toBe("PASS");
    expect(why({ patterns: ["ticket (\\d+)"] }, { s: "ticket 56" }, ev([ok("t", { id: 55 })]))).toBe(ids('s "56"'));
    expect(why({ patterns: ["T\\d+"] }, { s: "T5 and T6" }, ev([ok("t", "T5")]))).toBe(ids('s "T6"'));
    expect(why({ patterns: ["q*"] }, { s: "abc" }, ev([]))).toBe("PASS");
  });

  it("matches non-word-edged custom ids without a boundary", () => {
    expect(why({ patterns: ["#\\d+"] }, { s: "#12" }, ev([ok("t", "x#12")]))).toBe("PASS");
  });

  it("fails an invalid or oversized custom pattern", () => {
    expect(why({ patterns: ["(unclosed"] }, { s: "x" }, ev([]))).toMatch(
      /^output_grounded: invalid pattern \/\(unclosed\/: Invalid regular expression/,
    );
    expect(why({ patterns: ["a".repeat(1001)] }, { s: "x" }, ev([]))).toBe(
      "output_grounded: invalid pattern: regex source exceeds 1000 characters",
    );
    expect(why({ patterns: ["a".repeat(1000)] }, { s: "x" }, ev([]))).toBe("PASS");
  });

  it("counts only the named tools, alias-expanded", () => {
    const calls = [ok("bash", "echo https://e.com/9"), ok("fetch_ticket", "https://e.com/1")];
    expect(why({ tools: ["fetch_ticket"] }, { u: "https://e.com/1" }, ev(calls))).toBe("PASS");
    expect(why({ tools: ["fetch_ticket"] }, { u: "https://e.com/9" }, ev(calls))).toBe(ids('u "https://e.com/9"'));
    const aliases = new Map([["get_pr", new Set(["pull_request_read"])]]);
    const v = run(
      { tools: ["get_pr"] },
      { u: "https://e.com/1" },
      { toolCalls: [ok("pull_request_read", "https://e.com/1")], aliases },
    );
    expect(v).toEqual({ pass: true });
  });
});

describe("quotes", () => {
  const patch = "@@ -1,3 +1,4 @@\n   name: deploy\n+  api-key: ${{ secrets.TOKEN }}\n-  uses: acme/deploy@v2\n";
  const pr = [ok("github_get_pr_patches", { files: [{ path: "ci.yml", patch }] }), ok("other", "uses: acme/deploy@v3")];
  const q = (whitespace?: "exact" | "trim" | "collapse", tools: string[] | null = ["github_get_pr_patches"]) => ({
    patterns: [],
    quotes: [{ path: "notes[*].quote", ...(tools ? { tools } : {}), ...(whitespace ? { whitespace } : {}) }],
  });
  const missing = (list: string, mode = "trim", n = 1, from = "github_get_pr_patches") =>
    `output_grounded: ${n} quote(s) not found verbatim in ${from} output (whitespace: ${mode}): ${list}`;

  it("passes a line copied from the named tool's output", () => {
    const data = { notes: [{ quote: "api-key: ${{ secrets.TOKEN }}" }, { quote: "  uses: acme/deploy@v2  " }] };
    expect(why(q(), data, ev(pr))).toBe("PASS");
  });

  it("fails a quote the named tool did not return, even if another tool did", () => {
    const data = { notes: [{ quote: "uses: acme/deploy@v2" }, { quote: "uses: acme/deploy@v3" }] };
    expect(why(q(), data, ev(pr))).toBe(missing('notes[1].quote "uses: acme/deploy@v3"'));
  });

  it("exact compares every byte", () => {
    const data = { notes: [{ quote: "name: deploy " }] };
    expect(why(q("exact"), data, ev(pr))).toBe(missing('notes[0].quote "name: deploy "', "exact"));
    expect(why(q("exact"), { notes: [{ quote: "  name: deploy\n" }] }, ev(pr))).toBe("PASS");
    expect(why(q("trim"), data, ev(pr))).toBe("PASS");
  });

  it("collapse treats any whitespace run as one space, on both sides", () => {
    const tools = [ok("github_get_pr_patches", "a\t\tb\n  c")];
    expect(why(q("collapse"), { notes: [{ quote: " a b  c" }] }, ev(tools))).toBe("PASS");
    expect(why(q("trim"), { notes: [{ quote: "a b c" }] }, ev(tools))).toBe(missing('notes[0].quote "a b c"'));
  });

  it("fails an empty or blank quote", () => {
    expect(why(q(), { notes: [{ quote: "   " }] }, ev(pr))).toBe(missing('notes[0].quote "   " (empty)'));
    expect(why(q("exact"), { notes: [{ quote: "" }] }, ev(pr))).toBe(missing('notes[0].quote "" (empty)', "exact"));
  });

  it("does not span two strings of the output", () => {
    const tools = [ok("github_get_pr_patches", ["api-key:", " x"])];
    expect(why(q(), { notes: [{ quote: "api-key: x" }] }, ev(tools))).toBe(missing('notes[0].quote "api-key: x"'));
  });

  it("never comes from the input or context", () => {
    expect(why(q(), { notes: [{ quote: "only in input" }] }, ev([], { input: { s: "only in input" } }))).toBe(
      missing('notes[0].quote "only in input"'),
    );
  });

  it("reads numbers on both sides", () => {
    expect(why(q(), { notes: [{ quote: 42 }] }, ev([ok("github_get_pr_patches", { n: 42 })]))).toBe("PASS");
  });

  it("ignores failed calls", () => {
    expect(why(q(), { notes: [{ quote: "x" }] }, ev([err("github_get_pr_patches", "x")]))).toBe(
      missing('notes[0].quote "x"'),
    );
  });

  it("defaults to the rule's tools, then to any tool", () => {
    const data = { notes: [{ quote: "uses: acme/deploy@v3" }] };
    expect(why({ ...q(undefined, null), tools: ["other"] }, data, ev(pr))).toBe("PASS");
    expect(why({ ...q(undefined, null), tools: ["github_get_pr_patches"] }, data, ev(pr))).toBe(
      missing('notes[0].quote "uses: acme/deploy@v3"'),
    );
    expect(why(q(undefined, null), data, ev(pr))).toBe("PASS");
    expect(why(q(undefined, null), { notes: [{ quote: "nowhere" }] }, ev(pr))).toBe(
      missing('notes[0].quote "nowhere"', "trim", 1, "any tool's"),
    );
  });

  it("expands aliases and names every listed tool", () => {
    const aliases = new Map([["get_patches", new Set(["github_get_pr_patches"])]]);
    const rule = { patterns: [], quotes: [{ path: "q", tools: ["get_patches", "x"] }] };
    expect(run(rule, { q: "name: deploy" }, { toolCalls: pr, aliases })).toEqual({ pass: true });
    expect(run(rule, { q: "nope" }, { toolCalls: pr, aliases })).toEqual({
      pass: false,
      reasoning: missing('q "nope"', "trim", 1, "get_patches, x"),
    });
  });

  it("has nothing to check where the path does not resolve, and fails a malformed one", () => {
    expect(why(q(), { other: 1 }, ev(pr))).toBe("PASS");
    expect(why({ patterns: [], quotes: [{ path: "a[1]" }] }, {}, ev(pr))).toBe(
      "output_grounded: malformed path 'a[1]'",
    );
  });

  it("reports ids first, then each quote group", () => {
    const rule: OutputGroundedRule = {
      quotes: [
        { path: "a", tools: ["github_get_pr_patches"] },
        { path: "b", tools: ["other"], whitespace: "exact" },
      ],
    };
    expect(why(rule, { a: "zzz", b: "yyy", s: "ENG-1" }, ev(pr))).toBe(
      `${ids('s "ENG-1"')} | ${missing('a "zzz"')} | ${missing('b "yyy"', "exact", 1, "other")}`.replace(
        / \| output_grounded: /g,
        " | ",
      ),
    );
  });
});
