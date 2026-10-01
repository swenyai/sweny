/**
 * Edge assertions found by mutation testing: the exact degraded/refuse text and
 * the branch each opinion takes in harness/policy.ts. A strict policy refuses
 * on these strings, so they are part of the contract.
 */
import { describe, expect, it, vi } from "vitest";
import { budgetGate, nativeDenyClasses, policyGate, resolveHarnessPolicy } from "../../harness/policy.js";
import type { HarnessCapabilities, NodePolicy } from "../../harness/types.js";

const base: NodePolicy = { readOnly: false, deny: [], egress: [], strict: false };

const weak: HarnessCapabilities = {
  structuredOutput: "prompt",
  toolTrace: "skill-only",
  builtinDeny: "none",
  mcp: { inject: true, exclusive: "none" },
  sandbox: { fs: false, network: false },
  readOnly: "none",
  turnLimit: "none",
  usage: { tokens: false, costUsd: false, live: false },
  cancel: "kill",
  resume: false,
};

const contained: HarnessCapabilities = { ...weak, sandbox: { fs: true, network: true } };

describe("resolveHarnessPolicy", () => {
  it("trims and lowercases the explicit value", () => {
    expect(resolveHarnessPolicy({}, "  STRICT ")).toBe("strict");
    expect(resolveHarnessPolicy({ GITHUB_ACTIONS: "true" }, " Warn")).toBe("warn");
  });

  it("explicit beats the env var, which beats the default", () => {
    expect(resolveHarnessPolicy({ SWENY_HARNESS_POLICY: "strict" }, "warn")).toBe("warn");
    expect(resolveHarnessPolicy({ SWENY_HARNESS_POLICY: " STRICT " })).toBe("strict");
    expect(resolveHarnessPolicy({ SWENY_HARNESS_POLICY: "warn", GITHUB_ACTIONS: "true" })).toBe("warn");
  });

  it("defaults to strict only under GitHub Actions", () => {
    expect(resolveHarnessPolicy({ GITHUB_ACTIONS: "true" })).toBe("strict");
    expect(resolveHarnessPolicy({ GITHUB_ACTIONS: "false" })).toBe("warn");
    expect(resolveHarnessPolicy({})).toBe("warn");
  });

  it("warns once with the default named when the value is unknown", () => {
    const warn = vi.fn();
    expect(resolveHarnessPolicy({ GITHUB_ACTIONS: "true" }, "Bogus", { warn })).toBe("strict");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('harness policy "bogus" is not one of strict|warn; using strict');
    warn.mockClear();
    expect(resolveHarnessPolicy({}, "nope", { warn })).toBe("warn");
    expect(warn).toHaveBeenCalledWith('harness policy "nope" is not one of strict|warn; using warn');
  });

  it("does not warn for an empty value, and does not need a logger", () => {
    const warn = vi.fn();
    expect(resolveHarnessPolicy({}, "   ", { warn })).toBe("warn");
    expect(resolveHarnessPolicy({}, undefined, { warn })).toBe("warn");
    expect(warn).not.toHaveBeenCalled();
    expect(resolveHarnessPolicy({}, "bogus")).toBe("warn");
  });
});

describe("nativeDenyClasses", () => {
  it("by-name and by-class deny every class in stable order", () => {
    const all = ["shell", "write", "edit", "net", "subagent"];
    expect(nativeDenyClasses({ ...weak, builtinDeny: "by-name" })).toStrictEqual(all);
    expect(nativeDenyClasses({ ...weak, builtinDeny: "by-class" })).toStrictEqual(all);
  });

  it("shell-only denies just shell, none denies nothing", () => {
    expect(nativeDenyClasses({ ...weak, builtinDeny: "shell-only" })).toStrictEqual(["shell"]);
    expect(nativeDenyClasses({ ...weak, builtinDeny: "none" })).toStrictEqual([]);
  });

  it("adds denyClasses on top, in stable order without duplicates", () => {
    expect(
      nativeDenyClasses({ ...weak, builtinDeny: "shell-only", denyClasses: ["subagent", "net", "shell"] }),
    ).toStrictEqual(["shell", "net", "subagent"]);
    expect(nativeDenyClasses({ ...weak, builtinDeny: "none", denyClasses: ["net"] })).toStrictEqual(["net"]);
  });
});

describe("policyGate: read-only", () => {
  const entry = "read-only: harness cannot enforce it and no read-only mount is active";

  it("reports an unenforceable read-only, but not when native or mounted", () => {
    expect(policyGate(weak, { ...base, readOnly: true }).degraded).toStrictEqual([entry]);
    expect(policyGate({ ...weak, readOnly: "native" }, { ...base, readOnly: true }).degraded).toStrictEqual([]);
    expect(policyGate(weak, { ...base, readOnly: true }, { readOnlyMount: true }).degraded).toStrictEqual([]);
    expect(policyGate(weak, base).degraded).toStrictEqual([]);
  });

  it("a mount does not stop API writes: held write credentials still degrade (and refuse in strict)", () => {
    const held = {
      ...base,
      readOnly: true,
      agentCredentials: ["GITHUB_TOKEN", "LINEAR_API_KEY"],
    };
    const msg =
      "read-only: the agent process holds write credentials (GITHUB_TOKEN, LINEAR_API_KEY) and network access; " +
      "a read-only filesystem mount does not stop API writes";
    expect(policyGate(weak, held, { readOnlyMount: true }).degraded).toStrictEqual([msg]);
    expect(policyGate(weak, held).degraded).toStrictEqual([entry, msg]);
    expect(policyGate(weak, { ...held, strict: true }, { readOnlyMount: true }).refuse).toBe(`strict policy: ${msg}`);
  });

  it("credentials alone, without read-only or with native read-only, are not a gap", () => {
    expect(policyGate(weak, { ...base, agentCredentials: ["GITHUB_TOKEN"] }).degraded).toStrictEqual([]);
    expect(
      policyGate({ ...weak, readOnly: "native" }, { ...base, readOnly: true, agentCredentials: ["GITHUB_TOKEN"] })
        .degraded,
    ).toStrictEqual([]);
  });
});

describe("policyGate: deny", () => {
  it("names a harness that cannot deny built-in tools", () => {
    expect(policyGate(weak, { ...base, deny: ["write", "net"] }).degraded).toStrictEqual([
      "deny [write, net]: harness cannot deny built-in tools",
    ]);
  });

  it("names a shell-only harness", () => {
    const caps = { ...weak, builtinDeny: "shell-only" as const };
    expect(policyGate(caps, { ...base, deny: ["shell"] }).degraded).toStrictEqual([]);
    expect(policyGate(caps, { ...base, deny: ["shell", "write"] }).degraded).toStrictEqual([
      "deny [write]: harness can only deny the shell tool",
    ]);
  });

  it("lists what a harness can deny when it is a single non-shell class", () => {
    const caps = { ...weak, denyClasses: ["net" as const] };
    expect(policyGate(caps, { ...base, deny: ["write"] }).degraded).toStrictEqual([
      "deny [write]: harness can only deny [net]",
    ]);
  });

  it("lists what a harness can deny when it is several classes", () => {
    const caps = { ...weak, builtinDeny: "shell-only" as const, denyClasses: ["net" as const] };
    expect(policyGate(caps, { ...base, deny: ["write"] }).degraded).toStrictEqual([
      "deny [write]: harness can only deny [shell, net]",
    ]);
  });

  it("accepts every class on a by-name harness", () => {
    expect(
      policyGate({ ...weak, builtinDeny: "by-name" }, { ...base, deny: ["shell", "write", "edit", "net", "subagent"] })
        .degraded,
    ).toStrictEqual([]);
  });
});

describe("policyGate: native tool names", () => {
  it("cannot be honored by a harness with no built-in deny", () => {
    expect(policyGate(weak, { ...base, nativeDeny: ["Bash"] }).degraded).toStrictEqual([
      "disallowed_tools: harness cannot deny built-in tools",
    ]);
  });

  it("is unenforced on a by-class or shell-only harness, listing the names", () => {
    for (const builtinDeny of ["by-class", "shell-only"] as const) {
      expect(
        policyGate({ ...weak, builtinDeny }, { ...base, nativeDeny: ["Bash", "WebFetch"] }).degraded,
      ).toStrictEqual(["disallowed_tools [Bash, WebFetch]: harness has no tools by these names"]);
    }
  });

  it("is honored verbatim on a by-name harness, and an empty list is no opinion", () => {
    expect(policyGate({ ...weak, builtinDeny: "by-name" }, { ...base, nativeDeny: ["Bash"] }).degraded).toStrictEqual(
      [],
    );
    expect(policyGate(weak, { ...base, nativeDeny: [] }).degraded).toStrictEqual([]);
  });
});

describe("policyGate: egress", () => {
  const msg = "egress allowlist: harness has no network sandbox and no egress wrapper is active";

  it("degrades without a network sandbox or egress wrapper", () => {
    expect(policyGate(weak, { ...base, egress: ["api.example.com"] }).degraded).toStrictEqual([msg]);
  });

  it("is satisfied by a native network sandbox or an egress wrapper", () => {
    expect(
      policyGate({ ...weak, sandbox: { fs: false, network: true } }, { ...base, egress: ["a.test"] }).degraded,
    ).toStrictEqual([]);
    expect(policyGate(weak, { ...base, egress: ["a.test"] }, { egress: true }).degraded).toStrictEqual([]);
  });
});

describe("policyGate: staged write and sandbox", () => {
  const staged =
    "no push (staged run): blocked by env and git hooks only; with no sandbox a deliberate agent can undo them and push";
  const gap = "sandbox: harness has no native fs and network sandbox and no process sandbox wrapper is available";

  it("a staged run without a sandbox is unenforced, even on a contained harness", () => {
    expect(policyGate(weak, { ...base, stagedWrite: true }).degraded).toStrictEqual([staged]);
    expect(policyGate(contained, { ...base, stagedWrite: true }).degraded).toStrictEqual([staged]);
    expect(policyGate(contained, { ...base, stagedWrite: true, sandbox: "off" }).degraded).toStrictEqual([staged]);
  });

  it("a staged run is contained by native fs+network or a sandbox wrapper", () => {
    expect(policyGate(contained, { ...base, stagedWrite: true, sandbox: "auto" }).degraded).toStrictEqual([]);
    expect(policyGate(weak, { ...base, stagedWrite: true, sandbox: "auto" }, { sandbox: true }).degraded).toStrictEqual(
      [],
    );
  });

  it("fs alone or network alone is not containment", () => {
    for (const sandbox of [
      { fs: true, network: false },
      { fs: false, network: true },
    ]) {
      expect(policyGate({ ...weak, sandbox }, { ...base, stagedWrite: true, sandbox: "auto" }).degraded).toStrictEqual([
        staged,
        gap,
      ]);
    }
  });

  it("auto reports the gap but runs; off ignores it", () => {
    expect(policyGate(weak, { ...base, sandbox: "auto" })).toStrictEqual({ degraded: [gap] });
    expect(policyGate(weak, { ...base, sandbox: "off" })).toStrictEqual({ degraded: [] });
    expect(policyGate(weak, base)).toStrictEqual({ degraded: [] });
    expect(policyGate(contained, { ...base, sandbox: "auto" })).toStrictEqual({ degraded: [] });
    expect(policyGate(weak, { ...base, sandbox: "auto" }, { sandbox: true })).toStrictEqual({ degraded: [] });
  });

  it("strict sandbox refuses with install guidance, regardless of policy.strict", () => {
    expect(policyGate(weak, { ...base, sandbox: "strict" })).toStrictEqual({
      degraded: [gap],
      refuse:
        `strict sandbox (SWENY_SANDBOX=strict): ${gap}. Install srt ` +
        "(npm i -g @anthropic-ai/sandbox-runtime, plus bubblewrap, socat and ripgrep on Linux), " +
        "or set SWENY_SANDBOX=auto to run with a warning.",
    });
    expect(policyGate(contained, { ...base, sandbox: "strict" })).toStrictEqual({ degraded: [] });
    expect(policyGate(weak, { ...base, sandbox: "strict" }, { sandbox: true })).toStrictEqual({ degraded: [] });
  });
});

describe("policyGate: turn limit and strict refusal", () => {
  it("a watchdog keeps the limit: reported, never refused", () => {
    const r = policyGate({ ...weak, turnLimit: "watchdog" }, { ...base, strict: true, maxTurns: 5 });
    expect(r).toStrictEqual({
      degraded: ["max_turns: no native turn limit; sweny stops the run after 5 tool calls"],
    });
  });

  it("no limit and no watchdog is unenforced", () => {
    expect(policyGate(weak, { ...base, maxTurns: 5 }).degraded).toStrictEqual([
      "max_turns: harness has no turn limit and no watchdog",
    ]);
  });

  it("a native limit, or no limit asked for, is fine", () => {
    expect(policyGate({ ...weak, turnLimit: "native" }, { ...base, maxTurns: 5 }).degraded).toStrictEqual([]);
    expect(policyGate(weak, base).degraded).toStrictEqual([]);
  });

  it("strict joins every unenforced opinion, and lists wrapped ones after", () => {
    const r = policyGate(
      { ...weak, turnLimit: "watchdog" },
      { ...base, strict: true, readOnly: true, exclusiveMcp: true, maxTurns: 3 },
    );
    const a = "read-only: harness cannot enforce it and no read-only mount is active";
    const b = "exclusive MCP: harness cannot keep the user's own MCP servers out of the run";
    const w = "max_turns: no native turn limit; sweny stops the run after 3 tool calls";
    expect(r.degraded).toStrictEqual([a, b, w]);
    expect(r.refuse).toBe(`strict policy: ${a}; ${b}`);
  });

  it("does not refuse when strict is off", () => {
    expect(policyGate(weak, { ...base, readOnly: true }).refuse).toBeUndefined();
  });
});

describe("budgetGate", () => {
  const reports = { tokens: true, costUsd: true, live: true };

  it("is a no-op without limits", () => {
    expect(budgetGate(weak, {}, true)).toStrictEqual({ degraded: [] });
  });

  it("an unreportable unit is unenforced, named by unit", () => {
    const tokens = "budget_tokens: harness cannot report token usage, so this budget is not enforced";
    const cost = "budget_cost_usd: harness cannot report cost usage, so this budget is not enforced";
    expect(budgetGate(weak, { tokens: 10 }, false)).toStrictEqual({ degraded: [tokens] });
    expect(budgetGate(weak, { costUsd: 1 }, false)).toStrictEqual({ degraded: [cost] });
    expect(budgetGate(weak, { tokens: 10, costUsd: 1 }, false).degraded).toStrictEqual([tokens, cost]);
  });

  it("strict refuses on an unreportable unit", () => {
    const tokens = "budget_tokens: harness cannot report token usage, so this budget is not enforced";
    expect(budgetGate(weak, { tokens: 10 }, true)).toStrictEqual({
      degraded: [tokens],
      refuse: `strict policy: ${tokens}`,
    });
  });

  it("a unit reported live is fully enforced", () => {
    expect(budgetGate({ ...weak, usage: reports }, { tokens: 10, costUsd: 1 }, true)).toStrictEqual({ degraded: [] });
  });

  it("a unit reported only at node end is enforced between nodes: reported, never refused", () => {
    const caps = { ...weak, usage: { ...reports, live: false } };
    const msg = (units: string) =>
      `budget_live: harness reports ${units} only when a node ends; the budget is enforced between nodes, so a node can overrun before it is stopped`;
    expect(budgetGate(caps, { tokens: 10 }, true)).toStrictEqual({ degraded: [msg("tokens")] });
    expect(budgetGate(caps, { tokens: 10, costUsd: 1 }, false)).toStrictEqual({
      degraded: [msg("tokens and cost_usd")],
    });
  });

  it("liveUnits narrows which units arrive live", () => {
    const caps = { ...weak, usage: { ...reports, liveUnits: ["tokens" as const] } };
    expect(budgetGate(caps, { tokens: 10 }, true)).toStrictEqual({ degraded: [] });
    expect(budgetGate(caps, { costUsd: 1 }, true).degraded).toHaveLength(1);
    expect(budgetGate(caps, { costUsd: 1 }, true).degraded[0]).toContain("harness reports cost_usd only");
  });

  it("only budgeted units matter", () => {
    const caps = { ...weak, usage: { tokens: true, costUsd: false, live: true } };
    expect(budgetGate(caps, { tokens: 10 }, true)).toStrictEqual({ degraded: [] });
  });
});
