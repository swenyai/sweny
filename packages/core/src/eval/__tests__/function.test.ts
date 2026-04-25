import { describe, expect, it } from "vitest";
import { checkAllToolsCalled, checkAnyToolCalled, checkNoToolCalled, evaluateFunctionRule } from "../function.js";
import { buildToolAliases } from "../../skills/index.js";
import { github } from "../../skills/github.js";
import { linear } from "../../skills/linear.js";
import type { Skill, ToolCall } from "../../types.js";

const firstPartyAliases = buildToolAliases([linear, github]);

const tc = (tool: string, output?: unknown): ToolCall => ({ tool, input: {}, output });
const errOut = { error: "boom" };

const ok = (tool: string, output?: unknown): ToolCall => ({ tool, input: {}, output, status: "success" });
const err = (tool: string, output?: unknown): ToolCall => ({ tool, input: {}, output, status: "error" });

describe("checkAnyToolCalled", () => {
  it("passes when one of the named tools succeeded", () => {
    expect(checkAnyToolCalled(["a", "b"], [tc("a", { ok: true })])).toBeNull();
  });

  it("passes when one succeeded among others", () => {
    expect(checkAnyToolCalled(["a"], [tc("x"), tc("a", { ok: true }), tc("y")])).toBeNull();
  });

  it("fails when only an unrelated tool was called", () => {
    const e = checkAnyToolCalled(["a", "b"], [tc("x")]);
    expect(e).toMatch(/any_tool_called.*required one of \[a, b\].*called.*x/);
  });

  it("fails when the required tool errored", () => {
    const e = checkAnyToolCalled(["a"], [tc("a", errOut)]);
    expect(e).toMatch(/any_tool_called/);
  });

  it("reports 'none' when no tools were called", () => {
    const e = checkAnyToolCalled(["a"], []);
    expect(e).toMatch(/called: \[none\]/);
  });

  it("does not count a tool with status:error toward any_tool_called", () => {
    const e = checkAnyToolCalled(["a"], [err("a")]);
    expect(e).toMatch(/any_tool_called/);
  });

  it("honors explicit status:error over a success-looking output", () => {
    const e = checkAnyToolCalled(["a"], [err("a", { data: "ok" })]);
    expect(e).toMatch(/any_tool_called/);
  });

  it("honors explicit status:success over an error-looking output", () => {
    expect(checkAnyToolCalled(["a"], [ok("a", { error: null, data: "fine" })])).toBeNull();
  });
});

describe("checkAllToolsCalled", () => {
  it("passes when every named tool succeeded", () => {
    expect(checkAllToolsCalled(["a", "b"], [tc("a", { ok: true }), tc("b", { ok: true })])).toBeNull();
  });

  it("passes when extras were also called", () => {
    expect(checkAllToolsCalled(["a"], [tc("a", { ok: true }), tc("x"), tc("y")])).toBeNull();
  });

  it("fails when a required tool was never called", () => {
    const e = checkAllToolsCalled(["a", "b"], [tc("a", { ok: true })]);
    expect(e).toMatch(/all_tools_called.*missing.*\[b\]/);
  });

  it("fails when a required tool only errored", () => {
    const e = checkAllToolsCalled(["a", "b"], [tc("a", { ok: true }), tc("b", errOut)]);
    expect(e).toMatch(/all_tools_called.*missing.*\[b\]/);
  });

  it("honors explicit status:error for all_tools_called", () => {
    const e = checkAllToolsCalled(["a", "b"], [ok("a"), err("b")]);
    expect(e).toMatch(/all_tools_called.*missing.*\[b\]/);
  });

  it("honors explicit status:success even with no output", () => {
    expect(checkAllToolsCalled(["a", "b"], [ok("a"), ok("b")])).toBeNull();
  });
});

describe("checkNoToolCalled", () => {
  it("passes when none of the named tools were called", () => {
    expect(checkNoToolCalled(["a", "b"], [tc("x"), tc("y")])).toBeNull();
  });

  it("passes when toolCalls is empty", () => {
    expect(checkNoToolCalled(["a"], [])).toBeNull();
  });

  it("fails when a forbidden tool was called successfully", () => {
    const e = checkNoToolCalled(["force_push"], [tc("force_push", { ok: true })]);
    expect(e).toMatch(/no_tool_called.*forbidden.*\[force_push\]/);
  });

  it("fails when a forbidden tool was called even with error", () => {
    const e = checkNoToolCalled(["force_push"], [tc("force_push", errOut)]);
    expect(e).toMatch(/no_tool_called/);
  });
});

describe("tool-alias expansion (MCP ↔ first-party skill tools)", () => {
  describe("no aliases passed — strict name equality", () => {
    it("returns a failure when only an MCP-named call is present", () => {
      const e = checkAnyToolCalled(["linear_create_issue"], [tc("save_issue", { ok: true })]);
      expect(e).toMatch(/any_tool_called/);
    });

    it("unaliased names still match themselves", () => {
      expect(checkAnyToolCalled(["a", "b"], [tc("a", { ok: true })])).toBeNull();
      expect(checkAnyToolCalled(["a"], [tc("different", { ok: true })])).toMatch(/any_tool_called/);
    });
  });

  describe("Linear skill aliases", () => {
    it("linear_search_issues is satisfied by Linear MCP list_issues", () => {
      expect(
        checkAnyToolCalled(["linear_search_issues"], [tc("list_issues", { ok: true })], firstPartyAliases),
      ).toBeNull();
    });

    it("linear_create_issue is satisfied by Linear MCP save_issue", () => {
      expect(
        checkAnyToolCalled(["linear_create_issue"], [tc("save_issue", { ok: true })], firstPartyAliases),
      ).toBeNull();
    });

    it("linear_update_issue is satisfied by Linear MCP save_issue", () => {
      expect(
        checkAnyToolCalled(["linear_update_issue"], [tc("save_issue", { ok: true })], firstPartyAliases),
      ).toBeNull();
    });

    it("linear_add_comment is satisfied by Linear MCP save_comment", () => {
      expect(
        checkAnyToolCalled(["linear_add_comment"], [tc("save_comment", { ok: true })], firstPartyAliases),
      ).toBeNull();
    });

    it("the reverse direction also matches: MCP name required, first-party called", () => {
      expect(
        checkAnyToolCalled(["list_issues"], [tc("linear_search_issues", { ok: true })], firstPartyAliases),
      ).toBeNull();
    });
  });

  describe("GitHub skill aliases", () => {
    it("github_add_comment is satisfied by GitHub MCP add_issue_comment", () => {
      expect(
        checkAnyToolCalled(["github_add_comment"], [tc("add_issue_comment", { ok: true })], firstPartyAliases),
      ).toBeNull();
    });

    it("github_create_pr is satisfied by GitHub MCP create_pull_request", () => {
      expect(
        checkAnyToolCalled(["github_create_pr"], [tc("create_pull_request", { ok: true })], firstPartyAliases),
      ).toBeNull();
    });

    it("github_create_issue is satisfied by GitHub MCP create_issue", () => {
      expect(
        checkAnyToolCalled(["github_create_issue"], [tc("create_issue", { ok: true })], firstPartyAliases),
      ).toBeNull();
    });

    it("github_search_issues is satisfied by GitHub MCP search_issues", () => {
      expect(
        checkAnyToolCalled(["github_search_issues"], [tc("search_issues", { ok: true })], firstPartyAliases),
      ).toBeNull();
    });
  });

  describe("intentionally-ambiguous names remain strict", () => {
    it("get_issue does not satisfy a linear_get_issue or github_get_issue rule", () => {
      expect(checkAnyToolCalled(["linear_get_issue"], [tc("get_issue", { ok: true })], firstPartyAliases)).toMatch(
        /any_tool_called/,
      );
      expect(checkAnyToolCalled(["github_get_issue"], [tc("get_issue", { ok: true })], firstPartyAliases)).toMatch(
        /any_tool_called/,
      );
    });
  });

  describe("regression: real Triage create_issue call pattern", () => {
    const triageCreateIssueRequirement = [
      "linear_create_issue",
      "github_create_issue",
      "linear_search_issues",
      "github_search_issues",
      "linear_add_comment",
      "github_add_comment",
    ];

    it("passes with the real tool call sequence from the failing production run", () => {
      const calls = [
        tc("ToolSearch"),
        tc("get_issue", { ok: true }),
        tc("list_comments", { ok: true }),
        tc("save_comment", { ok: true }),
      ];
      expect(checkAnyToolCalled(triageCreateIssueRequirement, calls, firstPartyAliases)).toBeNull();
    });

    it("passes the investigate-node tool pattern (list_issues satisfies linear_search_issues)", () => {
      const calls = [tc("ToolSearch"), tc("list_issues", { ok: true }), tc("get_issue", { ok: true })];
      expect(checkAnyToolCalled(["linear_search_issues", "github_search_issues"], calls, firstPartyAliases)).toBeNull();
    });
  });

  describe("all_tools_called uses aliases", () => {
    it("satisfies each required tool via its MCP equivalent", () => {
      const calls = [tc("list_issues", { ok: true }), tc("save_issue", { ok: true })];
      expect(checkAllToolsCalled(["linear_search_issues", "linear_create_issue"], calls, firstPartyAliases)).toBeNull();
    });

    it("reports the missing canonical name when no alias fires", () => {
      const e = checkAllToolsCalled(
        ["linear_search_issues", "linear_create_issue"],
        [tc("list_issues", { ok: true })],
        firstPartyAliases,
      );
      expect(e).toMatch(/all_tools_called.*missing.*linear_create_issue/);
    });
  });

  describe("no_tool_called uses aliases", () => {
    it("flags a forbidden first-party call via its MCP equivalent", () => {
      const e = checkNoToolCalled(["linear_create_issue"], [tc("save_issue", { ok: true })], firstPartyAliases);
      expect(e).toMatch(/no_tool_called.*forbidden.*linear_create_issue/);
    });
  });
});

describe("buildToolAliases", () => {
  const mkSkill = (id: string, aliases: Record<string, string[]>): Skill => ({
    id,
    name: id,
    description: id,
    category: "general",
    config: {},
    tools: [],
    instruction: "stub",
    mcpAliases: aliases,
  });

  it("produces a symmetric equivalence group", () => {
    const table = buildToolAliases([mkSkill("a", { canonical: ["alias"] })]);
    expect(table.get("canonical")).toEqual(new Set(["canonical", "alias"]));
    expect(table.get("alias")).toEqual(new Set(["canonical", "alias"]));
  });

  it("returns undefined for names with no declared aliases (caller falls back to equality)", () => {
    const table = buildToolAliases([]);
    expect(table.get("anything")).toBeUndefined();
  });

  it("drops MCP names claimed by more than one skill (ambiguity guard)", () => {
    const warnings: string[] = [];
    const logger = {
      info: () => undefined,
      warn: (m: string) => warnings.push(m),
      error: () => undefined,
      debug: () => undefined,
    };
    const table = buildToolAliases(
      [mkSkill("linear", { linear_get_issue: ["get_issue"] }), mkSkill("github", { github_get_issue: ["get_issue"] })],
      logger,
    );
    expect(table.get("get_issue")).toBeUndefined();
    expect(table.get("linear_get_issue")).toBeUndefined();
    expect(table.get("github_get_issue")).toBeUndefined();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/get_issue.*multiple skills.*linear.*github/);
  });

  it("self-aliases are ignored", () => {
    const table = buildToolAliases([mkSkill("a", { same: ["same"] })]);
    expect(table.get("same")).toBeUndefined();
  });

  it("unions multiple aliases for the same canonical name into one group", () => {
    const table = buildToolAliases([mkSkill("a", { canonical: ["alias_a", "alias_b"] })]);
    expect(table.get("canonical")).toEqual(new Set(["canonical", "alias_a", "alias_b"]));
    expect(table.get("alias_a")).toEqual(new Set(["canonical", "alias_a", "alias_b"]));
    expect(table.get("alias_b")).toEqual(new Set(["canonical", "alias_a", "alias_b"]));
  });
});

describe("isErrorOutput tolerance for null/false sentinels", () => {
  it("treats {error: null} as success", () => {
    expect(checkAnyToolCalled(["save"], [tc("save", { ok: true, error: null })])).toBeNull();
  });

  it("treats {error: false} as success", () => {
    expect(checkAnyToolCalled(["save"], [tc("save", { ok: true, error: false })])).toBeNull();
  });

  it("treats {error: undefined} as success", () => {
    expect(checkAnyToolCalled(["save"], [tc("save", { ok: true, error: undefined })])).toBeNull();
  });

  it("treats {error: 0} as failure (zero is truthy under our 'presence of error' contract)", () => {
    expect(checkAnyToolCalled(["save"], [tc("save", { ok: true, error: 0 })])).not.toBeNull();
  });

  it("treats {error: 'boom'} as failure", () => {
    expect(checkAnyToolCalled(["save"], [tc("save", { error: "boom" })])).not.toBeNull();
  });
});

describe("isErrorOutput against non-object output", () => {
  it("treats string output as success (no error key possible)", () => {
    expect(checkAnyToolCalled(["save"], [tc("save", "ok")])).toBeNull();
  });

  it("treats number output as success", () => {
    expect(checkAnyToolCalled(["save"], [tc("save", 42)])).toBeNull();
  });

  it("treats undefined output (no result reported) as success", () => {
    expect(checkAnyToolCalled(["save"], [tc("save")])).toBeNull();
  });
});

describe("tool-call message parity", () => {
  it("checkAllToolsCalled includes the called: tail", () => {
    const e = checkAllToolsCalled(["save", "send"], [tc("save", { ok: true }), tc("log")]);
    expect(e).toMatch(/missing successful calls to \[send\]/);
    expect(e).toMatch(/called: \[save, log\]/);
  });

  it("checkNoToolCalled includes the called: tail", () => {
    const e = checkNoToolCalled(["force_push"], [tc("force_push"), tc("log")]);
    expect(e).toMatch(/forbidden tools were invoked: \[force_push\]/);
    expect(e).toMatch(/called: \[force_push, log\]/);
  });
});

describe("evaluateFunctionRule", () => {
  it("returns pass:true on an empty rule", () => {
    expect(evaluateFunctionRule({}, [])).toEqual({ pass: true });
  });

  it("returns pass:true when every check passes", () => {
    const verdict = evaluateFunctionRule({ all_tools_called: ["a"], no_tool_called: ["force_push"] }, [
      tc("a", { ok: true }),
    ]);
    expect(verdict).toEqual({ pass: true });
  });

  it("aggregates multiple failing checks into one reasoning string", () => {
    const verdict = evaluateFunctionRule(
      {
        any_tool_called: ["create_pr"],
        no_tool_called: ["force_push"],
      },
      [tc("force_push", { ok: true })],
    );
    expect(verdict.pass).toBe(false);
    expect(verdict.reasoning).toMatch(/any_tool_called/);
    expect(verdict.reasoning).toMatch(/no_tool_called/);
  });

  it("ignores value-rule fields if they leak into a function rule (silent)", () => {
    const verdict = evaluateFunctionRule(
      {
        any_tool_called: ["a"],
        output_required: ["should_be_ignored"],
      } as Parameters<typeof evaluateFunctionRule>[0],
      [tc("a", { ok: true })],
    );
    expect(verdict.pass).toBe(true);
  });
});
