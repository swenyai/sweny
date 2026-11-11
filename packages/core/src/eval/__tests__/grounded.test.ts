// output_grounded (#580). Assertions pin exact reasoning strings so the
// module holds the mutation floor (it is in stryker.config.json's mutate list).

import { describe, expect, it } from "vitest";
import {
  containsToken,
  evaluateGroundedRule,
  isEvidenceTool,
  namesCall,
  normalizeQuote,
  normalizeUrl,
  NOT_EVIDENCE_TOOLS,
  type GroundingEvidence,
} from "../grounded.js";
import { EMIT_OUTPUT_TOOL } from "../../safe-outputs.js";
import type { OutputGroundedRule, ToolCall } from "../../types.js";

const ok = (tool: string, output: unknown, extra: Partial<ToolCall> = {}): ToolCall => ({
  tool,
  input: {},
  output,
  status: "success",
  ...extra,
});
const err = (tool: string, output: unknown): ToolCall => ({ tool, input: {}, output, status: "error" });
const bare = (tool: string, output: unknown): ToolCall => ({ tool, input: {}, output });

const ev = (toolCalls: ToolCall[], context?: Record<string, unknown>): GroundingEvidence => ({
  toolCalls,
  ...(context ? { context } : {}),
});

const run = (rule: OutputGroundedRule, data: unknown, evidence: GroundingEvidence) =>
  evaluateGroundedRule(rule, data, evidence);

/** "PASS", "PASS: <warning>", or the failure reasoning. */
const why = (rule: OutputGroundedRule, data: unknown, evidence: GroundingEvidence): string => {
  const v = run(rule, data, evidence);
  if (v.pass) return v.reasoning === undefined ? "PASS" : `PASS: ${v.reasoning}`;
  return v.reasoning!;
};

/** Issue keys are off by default; these specs turn them on. */
const KEYS: OutputGroundedRule = { patterns: ["url", "github_ref", "issue_key"] };
const ALL = "tool outputs, instruction, inputs, prior context";
const ids = (list: string, n = 1, evidence = ALL) =>
  `output_grounded: ${n} value(s) not grounded (evidence: ${evidence}): ${list}`;

describe("normalizeUrl", () => {
  it("lowercases scheme and host, drops the default port and trailing slash, keeps the fragment", () => {
    expect(normalizeUrl("HTTPS://Example.COM:443/a/b/?q=1#Frag")).toBe("https://example.com/a/b?q=1#Frag");
  });
  it("keeps a non-default port and the path's case", () => {
    expect(normalizeUrl("http://E.com:8080/X")).toBe("http://e.com:8080/X");
  });
  it("drops every trailing slash, and the root path", () => {
    expect(normalizeUrl("https://e.com/a//")).toBe("https://e.com/a");
    expect(normalizeUrl(" https://e.com/ ")).toBe("https://e.com");
  });
  it("gives a scheme-less GitHub or Atlassian link https", () => {
    expect(normalizeUrl("GitHub.com/acme/api/")).toBe("https://github.com/acme/api");
    expect(normalizeUrl("acme.atlassian.net/browse/OPS-1")).toBe("https://acme.atlassian.net/browse/OPS-1");
  });
  it("returns anything else trimmed", () => {
    expect(normalizeUrl(" not a url ")).toBe("not a url");
    expect(normalizeUrl("ENG-1")).toBe("ENG-1");
    expect(normalizeUrl("example.com/a")).toBe("example.com/a");
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

describe("which tools are evidence", () => {
  it("a skill tool by its declared access", () => {
    const access = new Map([
      ["get_t", "read" as const],
      ["make_t", "write" as const],
    ]);
    expect(isEvidenceTool(ok("get_t", 1), access)).toBe(true);
    expect(isEvidenceTool(ok("make_t", 1), access)).toBe(false);
    // Access wins over the name: a read skill tool whose name sounds like a write.
    expect(isEvidenceTool(ok("save_view", 1), new Map([["save_view", "read" as const]]))).toBe(true);
  });

  it("never a shell, subagent, file writer or the safe-output tool", () => {
    for (const t of ["Bash", "shell", "Task", "Agent", "Write", "Edit", "MultiEdit", "apply_patch", "TodoWrite"]) {
      expect(isEvidenceTool(ok(t, 1))).toBe(false);
    }
    expect(NOT_EVIDENCE_TOOLS.has(EMIT_OUTPUT_TOOL)).toBe(true);
    expect(isEvidenceTool(ok(EMIT_OUTPUT_TOOL, 1))).toBe(false);
  });

  it("a built-in reader, or an MCP tool whose name does not say it writes", () => {
    for (const t of ["Read", "Grep", "WebFetch", "web_search", "get_issue", "list_issues", "get_settings"]) {
      expect(isEvidenceTool(ok(t, 1, { server: "linear" }))).toBe(true);
      expect(isEvidenceTool(ok(t, 1))).toBe(true);
    }
  });

  it("not a tool whose name says it writes, sends or runs", () => {
    for (const t of ["save_issue", "create-page", "add_comment", "post", "run_query", "echo", "issue_update"]) {
      expect(isEvidenceTool(ok(t, 1, { server: "x" }))).toBe(false);
    }
  });

  it("an MCP tool named like a built-in is judged by name only", () => {
    expect(isEvidenceTool(ok("Bash", 1, { server: "ops" }))).toBe(true);
    expect(isEvidenceTool(ok("get_t", 1, { server: "x" }), new Map([["get_t", "write" as const]]))).toBe(true);
  });

  it("sweny-core counts as sweny's own", () => {
    expect(isEvidenceTool(ok("make_t", 1, { server: "sweny-core" }), new Map([["make_t", "write" as const]]))).toBe(
      false,
    );
  });
});

describe("namesCall", () => {
  it("a bare name for sweny's own and built-in tools", () => {
    expect(namesCall("get_issue", ok("get_issue", 1))).toBe(true);
    expect(namesCall("get_issue", ok("get_issue", 1, { server: "sweny-core" }))).toBe(true);
    expect(namesCall("get_issue", ok("list_issues", 1))).toBe(false);
  });
  it("server/tool or mcp__server__tool for an MCP tool, never the bare name", () => {
    const c = ok("get_issue", 1, { server: "linear" });
    expect(namesCall("get_issue", c)).toBe(false);
    expect(namesCall("linear/get_issue", c)).toBe(true);
    expect(namesCall("mcp__linear__get_issue", c)).toBe(true);
    expect(namesCall("evil/get_issue", c)).toBe(false);
    expect(namesCall("mcp__evil__get_issue", c)).toBe(false);
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

  it("passes an http URL, in any case", () => {
    expect(why({}, { u: "HTTP://e.com/a" }, ev([ok("t", "http://e.com/a")]))).toBe("PASS");
  });

  it("passes a scheme-less link the tool returned with a scheme, and the reverse", () => {
    expect(why({}, { s: "github.com/acme/api/pull/3" }, ev([ok("t", "https://github.com/acme/api/pull/3")]))).toBe(
      "PASS",
    );
    expect(why({}, { s: "https://github.com/acme/api/pull/3" }, ev([ok("t", "see github.com/acme/api/pull/3.")]))).toBe(
      "PASS",
    );
  });

  it("passes an issue key a tool returned", () => {
    expect(why(KEYS, { s: "Linked to ENG-482." }, ev([ok("t", { issues: [{ identifier: "ENG-482" }] })]))).toBe("PASS");
  });

  it("passes a ref a tool returned as text, in any case", () => {
    expect(why({}, { r: "acme/api#77" }, ev([ok("t", "Found Acme/Api#77: crash")]))).toBe("PASS");
  });

  it("grounds an owner/repo#N ref by the issue or pull URL a tool returned", () => {
    const tools = [ok("gh", ["https://github.com/acme/api/pull/12", "https://github.com/acme/api/issues/13#top"])];
    expect(why({}, { refs: ["acme/api#12", "Acme/API#13"] }, ev(tools))).toBe("PASS");
  });

  it("grounds a scanned id by an object key", () => {
    expect(why(KEYS, { s: "ENG-1" }, ev([ok("t", { "ENG-1": {} })]))).toBe("PASS");
  });

  it("reads a cyclic tool output once", () => {
    const out: Record<string, unknown> = { key: "ENG-1" };
    out.self = out;
    expect(why(KEYS, { s: "ENG-1" }, ev([ok("t", out)]))).toBe("PASS");
  });

  it("passes when the output cites nothing", () => {
    expect(why(KEYS, { s: "nothing to cite", n: 4821, b: true, z: null }, ev([]))).toBe("PASS");
  });

  it("does not check issue keys in prose by default", () => {
    expect(why({}, { s: "UTF-8, SHA-256, ISO-8601 and ENG-404" }, ev([]))).toBe("PASS");
  });
});

describe("ids: the author's own text", () => {
  it("grounds what the instruction, rules or context sources gave", () => {
    const evidence: GroundingEvidence = {
      toolCalls: [],
      authored: ["See https://docs.example.com/runbook", "", "OPS-3"],
    };
    expect(run(KEYS, { s: "https://docs.example.com/runbook OPS-3" }, evidence)).toEqual({ pass: true });
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

  it("fails an upper-case scheme and a scheme-less link no tool returned", () => {
    expect(why({}, { u: "HTTPS://e.com/b" }, ev([ok("t", "http://e.com/b")]))).toBe(ids('u "HTTPS://e.com/b"'));
    expect(why({}, { s: "(github.com/acme/api/pull/9)" }, ev([]))).toBe(ids('s "github.com/acme/api/pull/9"'));
    expect(why({}, { s: "x.acme.atlassian.net/browse/OPS-1 user@github.com/x" }, ev([]))).toBe("PASS");
  });

  it("fails a fragment the tool never returned", () => {
    const tools = ev([ok("t", "https://github.com/acme/api/issues/12#top")]);
    expect(why({}, { u: "https://github.com/acme/api/issues/12#issuecomment-9" }, tools)).toBe(
      ids('u "https://github.com/acme/api/issues/12#issuecomment-9"'),
    );
    expect(why({}, { u: "https://github.com/acme/api/issues/12#top" }, tools)).toBe("PASS");
  });

  it("checks the ids inside a URL as well as the URL", () => {
    expect(
      why(KEYS, { s: "https://seen.example/x#,ENG-999,acme/api#5" }, ev([ok("t", "https://seen.example/x")])),
    ).toBe(ids('s "https://seen.example/x#,ENG-999,acme/api#5"; s "acme/api#5"; s "ENG-999"', 3));
    expect(why({ patterns: ["issue_key"] }, { s: "https://linear.app/a/issue/ENG-5/t" }, ev([]))).toBe(
      ids('s "ENG-5"'),
    );
  });

  it("fails an issue key a longer key does not ground", () => {
    expect(why(KEYS, { note: "Fixes ENG-9" }, ev([ok("t", "ENG-90")]))).toBe(ids('note "ENG-9"'));
  });

  it("fails a ref no tool returned", () => {
    expect(why({}, { r: "acme/api#78" }, ev([ok("t", "acme/api#77")]))).toBe(ids('r "acme/api#78"'));
  });

  it("does not ground a ref by a URL on a longer path or a nested repo", () => {
    for (const url of [
      "https://github.com/acme/api/pull/12/files",
      "https://github.com/x/acme/api/pull/12",
      "https://github.com/acme/api/commits/12",
    ]) {
      expect(why({}, { r: "acme/api#12" }, ev([ok("t", url)]))).toBe(ids('r "acme/api#12"'));
    }
  });

  it("lists each value once per path, and again on another path", () => {
    expect(why(KEYS, { a: "ENG-1 and ENG-1", b: "ENG-1" }, ev([]))).toBe(ids('a "ENG-1"; b "ENG-1"', 2));
  });

  it("lists at most 8 and counts the rest", () => {
    const keys = Array.from({ length: 10 }, (_, i) => `K${i}-1`);
    const listed = keys
      .slice(0, 8)
      .map((k, i) => `s[${i}] "${k}"`)
      .join("; ");
    expect(why(KEYS, { s: keys }, ev([]))).toBe(ids(`${listed}; and 2 more`, 10));
    expect(why(KEYS, { s: keys.slice(0, 8) }, ev([]))).toBe(ids(listed, 8));
  });

  it("shortens a long value to 120 characters", () => {
    expect(why({ ids: ["v"] }, { v: "x".repeat(121) }, ev([]))).toBe(ids(`v "${"x".repeat(119)}…"`));
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
  it("a shell, or a write tool echoing its input", () => {
    expect(why({}, { u: url }, ev([ok("Bash", url)]))).toBe(failed);
    expect(why({}, { u: url }, ev([ok("save_issue", { url }, { server: "linear" })]))).toBe(failed);
    expect(
      run({}, { u: url }, { toolCalls: [ok("mk", url)], toolAccess: new Map([["mk", "write" as const]]) }),
    ).toEqual({
      pass: false,
      reasoning: failed,
    });
  });
  it("but any tool the rule names", () => {
    expect(why({ tools: ["Bash"] }, { u: url }, ev([ok("Bash", url)]))).toBe("PASS");
  });
  it("an array index", () => {
    expect(why({ ids: ["n"] }, { n: 0 }, ev([ok("t", ["a"])]))).toBe(ids('n "0"'));
  });
});

describe("ids: whole values at ids paths", () => {
  it("a number must equal a whole evidence value", () => {
    expect(why({ ids: ["n"] }, { n: "55" }, ev([ok("t", { id: 55 })]))).toBe("PASS");
    expect(why({ ids: ["n"] }, { n: 48 }, ev([ok("t", { id: " 48 " })]))).toBe("PASS");
    expect(why({ ids: ["n"] }, { n: 48 }, ev([ok("t", { note: "PR 48 merged" })]))).toBe(ids('n "48"'));
    expect(why({ ids: ["n"] }, { n: -1.5 }, ev([ok("t", { note: "-1.5 x" })]))).toBe(ids('n "-1.5"'));
    expect(why({ ids: ["n"] }, { n: 48 }, ev([ok("t", { id: 4821 })]))).toBe(ids('n "48"'));
  });

  it("other values match as a token inside an evidence value", () => {
    expect(why({ ids: ["t"] }, { t: "OPS-7" }, ev([ok("t", { note: "fix OPS-7 now" })]))).toBe("PASS");
    expect(why({ ids: ["t"] }, { t: "4821x" }, ev([ok("t", { note: "id 4821x" })]))).toBe("PASS");
  });

  it("never an object key", () => {
    expect(why({ ids: ["t"] }, { t: "4821" }, ev([ok("t", { "4821": { ok: true } })]))).toBe(ids('t "4821"'));
    expect(why({ ids: ["t"] }, { t: "OPS-7" }, ev([ok("t", { "OPS-7": 1 })]))).toBe(ids('t "OPS-7"'));
  });

  it("checks strings trimmed and numbers, not booleans or blanks", () => {
    const data = { items: [{ t: 4821 }, { t: " 4822 " }, { t: true }, { t: "  " }] };
    expect(why({ ids: ["items[*].t"] }, data, ev([ok("t", { rows: [{ id: 4821 }] })]))).toBe(ids('items[1].t "4822"'));
    expect(why({ ids: ["t"] }, { t: "  " }, ev([]))).toBe("PASS");
  });

  it("checks a whole value as itself, not as the URL inside it", () => {
    expect(why({ patterns: [], ids: ["u"] }, { u: "https://e.com/a." }, ev([ok("t", ["https://e.com/a"])]))).toBe(
      ids('u "https://e.com/a."'),
    );
  });
});

describe("ids: inputs and prior context", () => {
  const ctx = {
    input: { ticket: "OPS-7" },
    triage: { link: "https://app.example.com/t/8" },
  };

  it("accepts input and context ids by default", () => {
    expect(why(KEYS, { a: "OPS-7", b: "https://app.example.com/t/8" }, ev([], ctx))).toBe("PASS");
  });

  it("inputs: false rejects input-only ids", () => {
    expect(why({ ...KEYS, inputs: false }, { a: "OPS-7" }, ev([], ctx))).toBe(
      ids('a "OPS-7"', 1, "tool outputs, instruction, prior context"),
    );
    expect(why({ inputs: false }, { b: "https://app.example.com/t/8" }, ev([], ctx))).toBe("PASS");
  });

  it("context: false rejects context-only ids", () => {
    expect(why({ context: false }, { b: "https://app.example.com/t/8" }, ev([], ctx))).toBe(
      ids('b "https://app.example.com/t/8"', 1, "tool outputs, instruction, inputs"),
    );
    expect(why({ ...KEYS, context: false }, { a: "OPS-7" }, ev([], ctx))).toBe("PASS");
  });

  it("both off leaves tool outputs and the instruction", () => {
    expect(why({ ...KEYS, inputs: false, context: false }, { a: "OPS-7" }, ev([ok("t", "OPS-8")], ctx))).toBe(
      ids('a "OPS-7"', 1, "tool outputs, instruction"),
    );
  });

  it("never counts the node's own earlier visit", () => {
    const v = run(
      KEYS,
      { u: "OPS-9" },
      { toolCalls: [], context: { input: {}, self: { u: "OPS-9" } }, nodeId: "self" },
    );
    expect(v).toEqual({ pass: false, reasoning: ids('u "OPS-9"') });
    const other = run(
      KEYS,
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
    expect(why(KEYS, { todo: ["OPS-7", "OPS-8"] }, ev(listing, ctx))).toBe("PASS");
  });

  it("fails an input id the tool's listing of its kind left out", () => {
    expect(why({ ...KEYS, stale: true }, { todo: ["OPS-7", "OPS-8"] }, ev(listing, ctx))).toBe(
      stale('todo[0] "OPS-7"'),
    );
  });

  it("does not call an id stale when no tool returned its kind", () => {
    expect(why({ ...KEYS, stale: true }, { todo: ["OPS-7"] }, ev([ok("t", "ENG-1")], ctx))).toBe("PASS");
  });

  it("groups URLs by collection, fragment aside", () => {
    const input = { input: { pr: "https://github.com/acme/api/pull/3" } };
    const pr = { pr: "https://github.com/acme/api/pull/3" };
    expect(why({ stale: true }, pr, ev([ok("t", "https://github.com/acme/api/pull/4#x")], input))).toBe(
      stale('pr "https://github.com/acme/api/pull/3"'),
    );
    expect(why({ stale: true }, pr, ev([ok("t", "https://github.com/acme/web/pull/4")], input))).toBe("PASS");
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

  it("never runs a custom pattern over tool output, so custom ids are never stale", () => {
    const input = { input: { t: "T5" } };
    expect(why({ stale: true, patterns: ["T\\d+"] }, { t: "T5" }, ev([ok("t", "T6")], input))).toBe("PASS");
  });

  it("classifies a whole value by the built-ins, with the scan off", () => {
    const input = { input: { t: "OPS-7", n: 7 } };
    expect(why({ stale: true, patterns: [], ids: ["t"] }, { t: "OPS-7" }, ev([ok("t", "OPS-8")], input))).toBe(
      stale('t "OPS-7"'),
    );
    expect(why({ stale: true, ids: ["n"] }, { n: 7 }, ev([ok("t", { id: 8 })], input))).toBe("PASS");
  });
});

describe("ids: URL normalization", () => {
  it("ignores a trailing slash and host case; a link without a fragment is grounded by its page", () => {
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
    expect(why({}, { s: "Really https://e.com/a!!" }, ev([ok("t", "https://e.com/a")]))).toBe("PASS");
    expect(why({}, { u: "https://e.com/a" }, ev([ok("t", "See https://e.com/a.")]))).toBe("PASS");
    expect(why({ allow: ["https://e.com/file.txt"] }, { s: "https://e.com/file.txt" }, ev([]))).toBe("PASS");
  });
});

describe("ids: issue-key and ref shapes", () => {
  it("needs a 2 to 10 character uppercase prefix", () => {
    expect(why(KEYS, { s: "A-1 eng-1 ABCDEFGHIJK-1 ENG- X-ENG-1 ENG-1-2 ENG-1a" }, ev([]))).toBe("PASS");
    expect(why(KEYS, { s: "AB-1" }, ev([]))).toBe(ids('s "AB-1"'));
    expect(why(KEYS, { s: "ABCDEFGHIJ-1" }, ev([]))).toBe(ids('s "ABCDEFGHIJ-1"'));
    expect(why(KEYS, { s: "A2-10" }, ev([]))).toBe(ids('s "A2-10"'));
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
    expect(why(KEYS, { "a b": "ENG-1", x: { "a-b": "ENG-2" } }, ev([]))).toBe(
      ids('["a b"] "ENG-1"; x["a-b"] "ENG-2"', 2),
    );
  });

  it("scans only the configured paths, with or without a prefix", () => {
    const data = { items: [{ url: "https://e.com/1", note: "https://made.up/x" }], meta: { link: "ENG-5" } };
    const tools = ev([ok("t", "https://e.com/1")]);
    expect(why({ paths: ["items[*].url"] }, data, tools)).toBe("PASS");
    expect(why({ paths: ["any:items[*].url"] }, data, tools)).toBe("PASS");
    expect(why({ paths: ["all:items[*].note"] }, data, tools)).toBe(ids('items[0].note "https://made.up/x"'));
    expect(why({ ...KEYS, paths: ["meta.link"] }, data, tools)).toBe(ids('meta.link "ENG-5"'));
  });

  it("warns, and passes, where a configured path resolves to nothing", () => {
    const data = { items: [{ url: "ENG-1" }], one: { url: "ENG-2" }, nul: null, s: "ENG-3", none: [] };
    expect(
      why(
        { ...KEYS, paths: ["nope", "one[*].url", "items.url", "nul.x", "s.x", "none[*]"], ids: ["also.nope"] },
        data,
        ev([]),
      ),
    ).toBe("PASS: output_grounded: warning: nothing at nope, one[*].url, items.url, nul.x, s.x, none[*], also.nope");
  });

  it("adds the warning after a failure", () => {
    expect(why({ ids: ["a", "b"] }, { a: "Q-1" }, ev([]))).toBe(`${ids('a "Q-1"')} | warning: nothing at b`);
  });

  it("reads an all:/any: prefix only at the start, and segments only as identifiers", () => {
    expect(why({ paths: ["a.all:b"] }, { a: { b: "ENG-1" } }, ev([]))).toBe(
      "output_grounded: malformed path 'a.all:b'",
    );
    expect(why({ paths: ["1a"] }, { a: "ENG-1" }, ev([]))).toBe("output_grounded: malformed path '1a'");
  });

  it("fails a malformed path", () => {
    expect(why({ paths: ["items[0]"] }, { items: [] }, ev([]))).toBe("output_grounded: malformed path 'items[0]'");
    expect(why({ ids: ["a..b"] }, {}, ev([]))).toBe("output_grounded: malformed path 'a..b'");
  });

  it("does not scan numbers for patterns", () => {
    expect(why({ patterns: ["\\d+"] }, { n: 12345 }, ev([]))).toBe("PASS");
  });
});

describe("ids: allow, patterns, tools", () => {
  it("allows listed constants, URLs compared normalized", () => {
    expect(
      why(
        { ...KEYS, allow: ["https://Docs.sweny.ai/nodes/", "SEC-1"] },
        { s: "https://docs.sweny.ai/nodes SEC-1" },
        ev([]),
      ),
    ).toBe("PASS");
  });

  it("checks only the named built-ins", () => {
    const data = { s: "ENG-1 https://made.up/x acme/api#1" };
    expect(why({ patterns: ["url"] }, data, ev([]))).toBe(ids('s "https://made.up/x"'));
    expect(why({ patterns: ["issue_key"] }, data, ev([]))).toBe(ids('s "ENG-1"'));
    expect(why({ patterns: ["github_ref"] }, data, ev([]))).toBe(ids('s "acme/api#1"'));
    expect(why({ patterns: [] }, data, ev([]))).toBe("PASS");
  });

  it("grounds only a ref candidate by a ref, never a custom id that looks like one", () => {
    expect(why({ patterns: ["\\w+/\\w+#\\d+"] }, { s: "acme/api#1" }, ev([ok("t", "Acme/Api#1")]))).toBe(
      ids('s "acme/api#1"'),
    );
  });

  it("reads no evidence from nulls, booleans or empty objects", () => {
    expect(why({ patterns: ["here"] }, { s: "here" }, ev([ok("t", { a: null, b: [true], c: {} })]))).toBe(
      ids('s "here"'),
    );
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

  it("counts only the named tools, MCP tools by server", () => {
    const calls = [ok("bash", "echo https://e.com/9"), ok("fetch_ticket", "https://e.com/1")];
    expect(why({ tools: ["fetch_ticket"] }, { u: "https://e.com/1" }, ev(calls))).toBe("PASS");
    expect(why({ tools: ["fetch_ticket"] }, { u: "https://e.com/9" }, ev(calls))).toBe(ids('u "https://e.com/9"'));
    const mcp = [ok("get_issue", "https://e.com/2", { server: "evil" })];
    expect(why({ tools: ["get_issue"] }, { u: "https://e.com/2" }, ev(mcp))).toBe(ids('u "https://e.com/2"'));
    expect(why({ tools: ["evil/get_issue"] }, { u: "https://e.com/2" }, ev(mcp))).toBe("PASS");
  });
});

describe("quotes", () => {
  const patch = "@@ -1,3 +1,4 @@\n   name: deploy\n+  api-key: ${{ secrets.TOKEN }}\n-  uses: acme/deploy@v2\n";
  const pr = [ok("github_get_pr_patches", { files: [{ path: "ci.yml", patch }] }), ok("other", "uses: acme/deploy@v3")];
  const q = (
    whitespace?: "exact" | "trim" | "collapse",
    tools: string[] | null = ["github_get_pr_patches"],
  ): OutputGroundedRule => ({
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
    const tools = [ok("github_get_pr_patches", "alpha\t\tbeta\n  gamma")];
    expect(why(q("collapse"), { notes: [{ quote: " alpha beta  gamma" }] }, ev(tools))).toBe("PASS");
    expect(why(q("trim"), { notes: [{ quote: "alpha beta gamma" }] }, ev(tools))).toBe(
      missing('notes[0].quote "alpha beta gamma"'),
    );
  });

  it("fails an empty, blank or short quote", () => {
    expect(why(q(), { notes: [{ quote: "   " }] }, ev(pr))).toBe(missing('notes[0].quote "   " (empty)'));
    expect(why(q("exact"), { notes: [{ quote: "" }] }, ev(pr))).toBe(missing('notes[0].quote "" (empty)', "exact"));
    expect(why(q(), { notes: [{ quote: " deploy " }] }, ev(pr))).toBe(
      missing('notes[0].quote " deploy " (shorter than 8 characters)'),
    );
    // 8 characters is enough; 7 is not (exact mode counts the whitespace).
    expect(why(q("exact"), { notes: [{ quote: "eploy\n+ " }] }, ev(pr))).toBe("PASS");
    expect(why(q("exact"), { notes: [{ quote: "ploy\n+ " }] }, ev(pr))).toBe(
      missing('notes[0].quote "ploy\\n+ " (shorter than 8 characters)', "exact"),
    );
  });

  it("takes a configured minimum length", () => {
    const rule = (min_length: number): OutputGroundedRule => ({ patterns: [], quotes: [{ path: "q", min_length }] });
    expect(why(rule(3), { q: "abc" }, ev([ok("t", "xabcx")]))).toBe("PASS");
    expect(why(rule(3), { q: "ab" }, ev([ok("t", "xabx")]))).toBe(
      'output_grounded: 1 quote(s) not found verbatim in any read tool\'s output (whitespace: trim): q "ab" (shorter than 3 characters)',
    );
  });

  it("does not span two strings of the output", () => {
    const tools = [ok("github_get_pr_patches", ["api-key:", " x"])];
    expect(why(q(), { notes: [{ quote: "api-key: x" }] }, ev(tools))).toBe(missing('notes[0].quote "api-key: x"'));
  });

  it("never comes from the input, context or the instruction", () => {
    const evidence: GroundingEvidence = {
      toolCalls: [],
      context: { input: { s: "only in input" } },
      authored: ["only in input"],
    };
    expect(why(q(), { notes: [{ quote: "only in input" }] }, evidence)).toBe(missing('notes[0].quote "only in input"'));
  });

  it("does not take a quote from an object key, a null or a boolean", () => {
    expect(
      why(
        { patterns: [], quotes: [{ path: "q" }] },
        { q: "apiKeyName" },
        ev([ok("t", { apiKeyName: null, x: [false] })]),
      ),
    ).toBe(
      'output_grounded: 1 quote(s) not found verbatim in any read tool\'s output (whitespace: trim): q "apiKeyName"',
    );
  });

  it("checks numbers on both sides", () => {
    expect(why(q(), { notes: [{ quote: 12345678 }] }, ev([ok("github_get_pr_patches", { n: 12345678 })]))).toBe("PASS");
    expect(why(q(), { notes: [{ quote: 12345679 }] }, ev([ok("github_get_pr_patches", { n: 12345678 })]))).toBe(
      missing('notes[0].quote "12345679"'),
    );
  });

  it("ignores failed calls and, by default, tools that are not readers", () => {
    expect(why(q(), { notes: [{ quote: "x-ray vision" }] }, ev([err("github_get_pr_patches", "x-ray vision")]))).toBe(
      missing('notes[0].quote "x-ray vision"'),
    );
    expect(why(q(undefined, null), { notes: [{ quote: "x-ray vision" }] }, ev([ok("Bash", "x-ray vision")]))).toBe(
      missing('notes[0].quote "x-ray vision"', "trim", 1, "any read tool's"),
    );
  });

  it("defaults to the rule's tools, then to any read tool", () => {
    const data = { notes: [{ quote: "uses: acme/deploy@v3" }] };
    expect(why({ ...q(undefined, null), tools: ["other"] }, data, ev(pr))).toBe("PASS");
    expect(why({ ...q(undefined, null), tools: ["github_get_pr_patches"] }, data, ev(pr))).toBe(
      missing('notes[0].quote "uses: acme/deploy@v3"'),
    );
    expect(why(q(undefined, null), data, ev(pr))).toBe("PASS");
    expect(why(q(undefined, null), { notes: [{ quote: "nowhere at all" }] }, ev(pr))).toBe(
      missing('notes[0].quote "nowhere at all"', "trim", 1, "any read tool's"),
    );
  });

  it("names MCP tools by server and lists every named tool", () => {
    const calls = [ok("get_patch", patch, { server: "gh" })];
    const rule = (tools: string[]): OutputGroundedRule => ({ patterns: [], quotes: [{ path: "q", tools }] });
    expect(why(rule(["gh/get_patch"]), { q: "name: deploy" }, ev(calls))).toBe("PASS");
    expect(why(rule(["get_patch", "x"]), { q: "name: deploy" }, ev(calls))).toBe(
      missing('q "name: deploy"', "trim", 1, "get_patch, x"),
    );
  });

  it("warns where the path resolves to nothing, and fails a malformed one", () => {
    expect(why(q(), { other: 1 }, ev(pr))).toBe("PASS: output_grounded: warning: nothing at notes[*].quote");
    expect(why({ patterns: [], quotes: [{ path: "a[1]" }] }, {}, ev(pr))).toBe(
      "output_grounded: malformed path 'a[1]'",
    );
  });

  it("reports ids first, then each quote group", () => {
    const rule: OutputGroundedRule = {
      patterns: ["issue_key"],
      quotes: [
        { path: "a", tools: ["github_get_pr_patches"] },
        { path: "b", tools: ["other"], whitespace: "exact" },
      ],
    };
    expect(why(rule, { a: "zzz zzz zzz", b: "yyy yyy yyy", s: "ENG-1" }, ev(pr))).toBe(
      `${ids('s "ENG-1"')} | ${missing('a "zzz zzz zzz"')} | ${missing('b "yyy yyy yyy"', "exact", 1, "other")}`.replace(
        / \| output_grounded: /g,
        " | ",
      ),
    );
  });
});
