import { describe, it, expect } from "vitest";
import { policyGate } from "./policy.js";
import { CLAUDE_CODE_CAPABILITIES } from "./capabilities.js";
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
});
