/**
 * #608: exact text and branches of the built-in allow-list gate and the
 * `permissions.allow` merge. A strict policy refuses on these strings, so they
 * are part of the contract. Lives in mutation/ so the Stryker run executes it.
 */
import { describe, expect, it } from "vitest";
import { policyGate } from "../../harness/policy.js";
import { buildNodePolicy, resolveNodePermissions } from "../../node-policy.js";
import type { HarnessCapabilities, NodePolicy } from "../../harness/types.js";

const base: NodePolicy = { readOnly: false, deny: [], egress: [], strict: false };

const caps: HarnessCapabilities = {
  structuredOutput: "prompt",
  toolTrace: "full",
  builtinDeny: "by-name",
  mcp: { inject: true, exclusive: "native" },
  sandbox: { fs: true, network: true },
  readOnly: "native",
  turnLimit: "native",
  usage: { tokens: false, costUsd: false, live: false },
  cancel: "kill",
  resume: false,
  nativeNone: true,
};

const UNENFORCED =
  "builtin allow-list: harness cannot limit the agent to the node's built-in tools; it keeps all of its own";
const DENY_LIST =
  "builtin allow-list: harness has no built-in tool allow-list; sweny turns off the built-ins it knows, " +
  "so one it does not know (a newer agent version) still reaches the agent";

describe("policyGate: builtin allow-list (#608)", () => {
  it("native: nothing to report", () => {
    expect(policyGate({ ...caps, builtinAllow: "native" }, base)).toStrictEqual({ degraded: [] });
  });

  it("deny-list: reported as wrapped, never refused", () => {
    const deny = { ...caps, builtinAllow: "deny-list" as const };
    expect(policyGate(deny, base)).toStrictEqual({ degraded: [DENY_LIST] });
    expect(policyGate(deny, { ...base, strict: true })).toStrictEqual({ degraded: [DENY_LIST] });
  });

  it("absent: unenforced, and strict refuses with the exact text", () => {
    expect(policyGate(caps, base)).toStrictEqual({ degraded: [UNENFORCED] });
    expect(policyGate(caps, { ...base, strict: true })).toStrictEqual({
      degraded: [UNENFORCED],
      refuse: `strict policy: ${UNENFORCED}`,
    });
  });

  it("comes after the other unenforced gaps in a refusal", () => {
    const r = policyGate(
      { ...caps, mcp: { inject: true, exclusive: "none" } },
      {
        ...base,
        exclusiveMcp: true,
        strict: true,
      },
    );
    expect(r.refuse).toBe(
      `strict policy: exclusive MCP: harness cannot keep the user's own MCP servers out of the run; ${UNENFORCED}`,
    );
  });

  it("read-only and native: none skip it on any harness", () => {
    expect(policyGate(caps, { ...base, readOnly: true })).toStrictEqual({ degraded: [] });
    expect(policyGate(caps, { ...base, nativeNone: true })).toStrictEqual({ degraded: [] });
    const deny = { ...caps, builtinAllow: "deny-list" as const };
    expect(policyGate(deny, { ...base, readOnly: true })).toStrictEqual({ degraded: [] });
    expect(policyGate(deny, { ...base, nativeNone: true })).toStrictEqual({ degraded: [] });
  });
});

describe("policyGate: allow a class the harness has no built-in for (#608)", () => {
  const native: HarnessCapabilities = { ...caps, builtinAllow: "native", builtinClasses: ["shell", "write"] };

  it("names every missing class, in order, as wrapped", () => {
    expect(policyGate(native, { ...base, allow: ["subagent", "shell", "net"], strict: true })).toStrictEqual({
      degraded: ["allow [subagent, net]: harness has no built-in tool of this class"],
    });
  });

  it("says nothing when every class exists, when classes are unknown, or for a read-only run", () => {
    expect(policyGate(native, { ...base, allow: ["shell"] })).toStrictEqual({ degraded: [] });
    expect(policyGate({ ...native, builtinClasses: undefined }, { ...base, allow: ["subagent"] })).toStrictEqual({
      degraded: [],
    });
    expect(policyGate(native, { ...base, readOnly: true, allow: ["subagent"] })).toStrictEqual({ degraded: [] });
    expect(policyGate(native, { ...base, allow: [] })).toStrictEqual({ degraded: [] });
  });
});

describe("permissions.allow merge (#608)", () => {
  it("unions and dedupes the workflow's and the node's, workflow first", () => {
    const r = resolveNodePermissions(
      { permissions: { access: "write", allow: ["subagent", "net"] } },
      { permissions: { access: "write", allow: ["shell", "subagent"] } },
    );
    expect(r).toStrictEqual({ access: "write", deny: [], strict: false, allow: ["shell", "subagent", "net"] });
  });

  it("leaves the key out when neither declares one", () => {
    expect(resolveNodePermissions({ permissions: "write" }, { permissions: "write" })).toStrictEqual({
      access: "write",
      deny: [],
      strict: false,
    });
  });

  it("buildNodePolicy: a write run keeps what deny does not remove, in order", () => {
    const p = buildNodePolicy({
      permissions: { access: "write", deny: ["net"], strict: false, allow: ["subagent", "net", "shell"] },
      dryRun: false,
    });
    expect(p).toStrictEqual({
      readOnly: false,
      deny: ["net"],
      allow: ["subagent", "shell"],
      egress: [],
      strict: false,
    });
  });

  it("buildNodePolicy: no key when nothing is left, on a read node, or in a dry run", () => {
    const perms = { access: "write" as const, deny: [], strict: false, allow: ["subagent" as const] };
    expect(buildNodePolicy({ permissions: { ...perms, deny: ["subagent"] }, dryRun: false })).not.toHaveProperty(
      "allow",
    );
    expect(buildNodePolicy({ permissions: { ...perms, access: "read" }, dryRun: false })).not.toHaveProperty("allow");
    expect(buildNodePolicy({ permissions: perms, dryRun: true })).not.toHaveProperty("allow");
    expect(buildNodePolicy({ permissions: { ...perms, allow: undefined }, dryRun: false })).not.toHaveProperty("allow");
  });
});
