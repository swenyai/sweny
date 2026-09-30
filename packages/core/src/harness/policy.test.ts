import { describe, it, expect, vi } from "vitest";
import { nativeDenyClasses, policyGate, resolveHarnessPolicy, isToolClass } from "./policy.js";
import { CLAUDE_CODE_CAPABILITIES, CODEX_CAPABILITIES } from "./capabilities.js";
import type { HarnessCapabilities, NodePolicy } from "./types.js";

const base: NodePolicy = { readOnly: false, deny: [], egress: [], strict: false };

const weak: HarnessCapabilities = {
  structuredOutput: "prompt",
  toolTrace: "skill-only",
  builtinDeny: "none",
  mcp: { inject: true, exclusive: "none" },
  sandbox: { fs: false, network: false },
  readOnly: "none",
  turnLimit: "watchdog",
  usage: { tokens: false, costUsd: false, live: false },
  cancel: "kill",
  resume: false,
};

describe("policyGate", () => {
  describe("Claude Code is always a no-op", () => {
    const policies: NodePolicy[] = [
      base,
      { ...base, readOnly: true },
      { ...base, deny: ["shell", "write", "edit", "net", "subagent"] },
      { ...base, nativeDeny: ["Bash", "WebFetch"] },
      { ...base, egress: ["api.github.com", "sentry.io"] },
      { readOnly: true, deny: ["shell"], nativeDeny: ["Write"], egress: ["x.test"], strict: true },
    ];
    it.each(policies.map((p, i) => [i, p] as const))("policy #%i gives degraded [] and no refusal", (_i, policy) => {
      expect(policyGate(CLAUDE_CODE_CAPABILITIES, policy)).toEqual({ degraded: [] });
    });
  });

  describe("a weak harness", () => {
    it("degrades, never refuses, in warn mode", () => {
      const r = policyGate(weak, {
        readOnly: true,
        deny: ["write"],
        nativeDeny: ["Bash"],
        egress: ["x.test"],
        strict: false,
      });
      expect(r.refuse).toBeUndefined();
      expect(r.degraded).toHaveLength(4);
    });

    it("refuses in strict mode and names the opinions", () => {
      const r = policyGate(weak, { ...base, readOnly: true, strict: true });
      expect(r.refuse).toMatch(/strict policy: read-only/);
      expect(r.degraded).toHaveLength(1);
    });

    it("a wrapper satisfies the opinion it covers", () => {
      const policy: NodePolicy = { readOnly: true, deny: [], egress: ["x.test"], strict: true };
      expect(policyGate(weak, policy, { readOnlyMount: true, egress: true })).toEqual({ degraded: [] });
      expect(policyGate(weak, policy, { readOnlyMount: true }).refuse).toMatch(/egress/);
    });

    it("shell-only deny maps shell and degrades the rest", () => {
      const caps: HarnessCapabilities = { ...weak, builtinDeny: "shell-only" };
      expect(policyGate(caps, { ...base, deny: ["shell"] })).toEqual({ degraded: [] });
      const r = policyGate(caps, { ...base, deny: ["shell", "write", "edit"] });
      expect(r.degraded).toEqual(["deny [write, edit]: harness can only deny the shell tool"]);
    });
  });

  describe("X cells in the enforcement matrix (harness-design section 3)", () => {
    const codexLike: HarnessCapabilities = { ...weak, builtinDeny: "shell-only", readOnly: "native" };
    const cells: [string, HarnessCapabilities, NodePolicy][] = [
      ["codex: deny write", codexLike, { ...base, deny: ["write"] }],
      ["codex: deny edit", codexLike, { ...base, deny: ["edit"] }],
      ["codex: deny net", codexLike, { ...base, deny: ["net"] }],
      ["codex: deny subagent", codexLike, { ...base, deny: ["subagent"] }],
      ["acp-generic: deny shell (no built-in deny)", weak, { ...base, deny: ["shell"] }],
      ["acp-generic: nativeDeny passthrough", weak, { ...base, nativeDeny: ["Bash"] }],
      ["acp-generic: read-only", weak, { ...base, readOnly: true }],
      ["pi: sandbox egress", weak, { ...base, egress: ["api.github.com"] }],
    ];

    it.each(cells)("%s: degraded in warn, refuse in strict", (_name, caps, policy) => {
      const warn = policyGate(caps, { ...policy, strict: false });
      expect(warn.degraded.length).toBeGreaterThan(0);
      expect(warn.refuse).toBeUndefined();
      const strict = policyGate(caps, { ...policy, strict: true });
      expect(strict.refuse).toMatch(/^strict policy: /);
      expect(strict.degraded).toEqual(warn.degraded);
    });
  });

  describe("Codex, as declared (#331)", () => {
    it("denies shell, net and subagent natively; write and edit are X", () => {
      expect(nativeDenyClasses(CODEX_CAPABILITIES)).toEqual(["shell", "net", "subagent"]);
      expect(nativeDenyClasses(CLAUDE_CODE_CAPABILITIES)).toEqual(["shell", "write", "edit", "net", "subagent"]);
      expect(policyGate(CODEX_CAPABILITIES, { ...base, deny: ["shell", "net", "subagent"] })).toEqual({ degraded: [] });
      for (const c of ["write", "edit"] as const) {
        const strict = policyGate(CODEX_CAPABILITIES, { ...base, deny: [c], strict: true });
        expect(strict.refuse).toMatch(new RegExp(`deny \\[${c}\\]`));
      }
    });

    it("a watchdog turn limit is reported but never refused", () => {
      const r = policyGate(CODEX_CAPABILITIES, { ...base, maxTurns: 20, strict: true });
      expect(r.refuse).toBeUndefined();
      expect(r.degraded).toEqual(["max_turns: no native turn limit; sweny stops the run after 20 tool calls"]);
      // No limit at all is refused under strict.
      const none = policyGate({ ...weak, turnLimit: "none" }, { ...base, maxTurns: 5, strict: true });
      expect(none.refuse).toMatch(/max_turns/);
      // Claude Code's native limit: nothing to say.
      expect(policyGate(CLAUDE_CODE_CAPABILITIES, { ...base, maxTurns: 5 })).toEqual({ degraded: [] });
    });

    it("native tool names a harness does not have are unenforced", () => {
      const r = policyGate(CODEX_CAPABILITIES, { ...base, nativeDeny: ["FancyTool"], strict: true });
      expect(r.refuse).toMatch(/disallowed_tools \[FancyTool\]/);
    });

    it("per-host egress is X for codex (network is one switch)", () => {
      const r = policyGate(CODEX_CAPABILITIES, { ...base, egress: ["api.github.com"], strict: true });
      expect(r.refuse).toMatch(/egress allowlist/);
      expect(policyGate(CODEX_CAPABILITIES, { ...base, egress: ["x"] }, { egress: true })).toEqual({ degraded: [] });
    });
  });

  it("isToolClass", () => {
    expect(isToolClass("write")).toBe(true);
    expect(isToolClass("github_create_pr")).toBe(false);
  });
});

describe("resolveHarnessPolicy", () => {
  it("explicit wins, then SWENY_HARNESS_POLICY, then strict in GitHub Actions and warn elsewhere", () => {
    expect(resolveHarnessPolicy({ GITHUB_ACTIONS: "true" }, "warn")).toBe("warn");
    expect(resolveHarnessPolicy({ SWENY_HARNESS_POLICY: "strict" })).toBe("strict");
    expect(resolveHarnessPolicy({ GITHUB_ACTIONS: "true" })).toBe("strict");
    expect(resolveHarnessPolicy({})).toBe("warn");
  });

  it("warns on an unknown value and uses the default", () => {
    const warn = vi.fn();
    expect(resolveHarnessPolicy({}, "loose", { warn })).toBe("warn");
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/"loose" is not one of strict\|warn/));
  });
});
