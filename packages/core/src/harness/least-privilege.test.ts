/**
 * Least-privilege built-ins on every harness (#608, parity with #606 for
 * Claude Code).
 *
 * - `permissions.allow` (portable tool classes) is the one way a node opts
 *   into a built-in its policy leaves out (today: `subagent`). Deny wins, and
 *   a read node cannot allow anything.
 * - The gate reports, for a write node, a harness that cannot limit the agent
 *   to the policy's built-ins: `builtinAllow: "native"` (Claude Code `tools`,
 *   pi `--tools`) reports nothing; `"deny-list"` (Codex: no built-in allow-list
 *   exists, sweny turns off what it knows) is reported and never refused; a
 *   harness with neither (ACP) is unenforced, so strict refuses the node.
 */
import { describe, it, expect } from "vitest";
import { nodePermissionsZ, validateWorkflow, workflowJsonSchema } from "../schema.js";
import { buildNodePolicy, resolveNodePermissions } from "../node-policy.js";
import { policyGate } from "./policy.js";
import { ACP_CAPABILITIES, CLAUDE_CODE_CAPABILITIES, CODEX_CAPABILITIES, PI_CAPABILITIES } from "./capabilities.js";
import type { NodePolicy } from "./types.js";
import type { Workflow } from "../types.js";
import { MockHarness } from "../testing.js";
import { createReplayHarness } from "../cli/try.js";

const write: NodePolicy = { readOnly: false, deny: [], egress: [], strict: false };
const allowGaps = (d: string[]) => d.filter((x) => x.startsWith("builtin allow-list"));

describe("permissions.allow: the schema field", () => {
  it("parses a list of tool classes, alone or with access and deny", () => {
    expect(nodePermissionsZ.parse({ allow: ["subagent"] })).toEqual({ allow: ["subagent"] });
    expect(nodePermissionsZ.parse({ access: "write", allow: ["subagent"], deny: ["net"] })).toEqual({
      access: "write",
      allow: ["subagent"],
      deny: ["net"],
    });
  });

  it("rejects an empty list and a name that is not a tool class", () => {
    expect(() => nodePermissionsZ.parse({ allow: [] })).toThrow();
    expect(() => nodePermissionsZ.parse({ allow: ["Task"] })).toThrow();
  });

  it("is in the published JSON schema with the tool class enum", () => {
    const perms = (workflowJsonSchema as unknown as { $defs: Record<string, any> }).$defs.Permissions;
    const obj = perms.oneOf.find((o: { type?: string }) => o.type === "object");
    expect(obj.properties.allow).toMatchObject({
      type: "array",
      minItems: 1,
      items: { type: "string", enum: ["shell", "write", "edit", "net", "subagent"] },
    });
  });

  const wf = (nodePerms: unknown, wfPerms?: unknown): Workflow =>
    ({
      id: "w",
      name: "w",
      description: "",
      entry: "a",
      spec_version: "2",
      ...(wfPerms !== undefined ? { permissions: wfPerms } : {}),
      nodes: { a: { name: "a", instruction: "x", skills: [], permissions: nodePerms } },
      edges: [],
    }) as unknown as Workflow;

  it("a read node that allows a built-in fails validation (read grants none)", () => {
    const errors = validateWorkflow(wf({ allow: ["subagent"] }));
    expect(errors.map((e) => e.code)).toContain("PERMISSION_ALLOW_READ");
    expect(errors.find((e) => e.code === "PERMISSION_ALLOW_READ")?.nodeId).toBe("a");
  });

  it("a read workflow that allows a built-in fails validation too, with no node named", () => {
    const errors = validateWorkflow(wf({ access: "read" }, { access: "read", allow: ["subagent"] }));
    const e = errors.find((x) => x.code === "PERMISSION_ALLOW_READ");
    expect(e).toBeDefined();
    expect(e?.nodeId).toBeUndefined();
    expect(validateWorkflow(wf({ access: "write" }, { access: "write", allow: ["subagent"] }))).toEqual([]);
    // No declared access: not a ceiling, so a write node can use the workflow's allow.
    expect(validateWorkflow(wf({ access: "write" }, { allow: ["subagent"] }))).toEqual([]);
  });

  it("a write node may allow one", () => {
    expect(validateWorkflow(wf({ access: "write", allow: ["subagent"] }))).toEqual([]);
  });
});

describe("permissions.allow: resolve and compile", () => {
  it("unions the workflow's and the node's allow, absent when neither declares one", () => {
    const node = { permissions: { access: "write" as const, allow: ["subagent" as const] } };
    expect(resolveNodePermissions(node, { permissions: "write" }).allow).toEqual(["subagent"]);
    expect(
      resolveNodePermissions({ permissions: "write" }, { permissions: { access: "write", allow: ["subagent"] } }).allow,
    ).toEqual(["subagent"]);
    expect(resolveNodePermissions({ permissions: "write" }, {})).not.toHaveProperty("allow");
  });

  it("reaches the node policy of a write node, minus every denied class", () => {
    const p = buildNodePolicy({
      permissions: { access: "write", deny: [], strict: false, allow: ["subagent", "net"] },
      dryRun: false,
    });
    expect(p.allow).toEqual(["subagent", "net"]);
    const denied = buildNodePolicy({
      permissions: { access: "write", deny: ["subagent"], strict: false, allow: ["subagent"] },
      dryRun: false,
    });
    expect(denied).not.toHaveProperty("allow");
  });

  it("never reaches a read-only run (read access or a dry run)", () => {
    const read = buildNodePolicy({
      permissions: { access: "read", deny: [], strict: false, allow: ["subagent"] },
      dryRun: false,
    });
    expect(read).not.toHaveProperty("allow");
    const dry = buildNodePolicy({
      permissions: { access: "write", deny: [], strict: false, allow: ["subagent"] },
      dryRun: true,
    });
    expect(dry).not.toHaveProperty("allow");
  });
});

describe("policyGate: the built-in allow-list", () => {
  it("declares how each harness limits a node's built-ins", () => {
    expect(CLAUDE_CODE_CAPABILITIES.builtinAllow).toBe("native");
    expect(PI_CAPABILITIES.builtinAllow).toBe("native");
    expect(CODEX_CAPABILITIES.builtinAllow).toBe("deny-list");
    expect(ACP_CAPABILITIES.builtinAllow).toBeUndefined();
  });

  it("the mock and replay harnesses declare a native allow-list, so strict never refuses them for it", () => {
    const mock = new MockHarness({ responses: {} } as never);
    const replay = createReplayHarness({ nodes: {} } as never, { paceMs: 0 });
    for (const caps of [mock.capabilities, replay.capabilities]) {
      expect(caps.builtinAllow).toBe("native");
      expect(policyGate(caps, { ...write, strict: true }).refuse ?? "").not.toMatch(/builtin allow-list/);
    }
  });

  it("a native allow-list harness reports nothing for a write node", () => {
    expect(allowGaps(policyGate(CLAUDE_CODE_CAPABILITIES, write).degraded)).toEqual([]);
    expect(allowGaps(policyGate(PI_CAPABILITIES, write).degraded)).toEqual([]);
  });

  it("codex: reported for a write node, never refused, even under strict", () => {
    const warn = policyGate(CODEX_CAPABILITIES, write);
    expect(allowGaps(warn.degraded)).toHaveLength(1);
    expect(warn.refuse).toBeUndefined();
    const strict = policyGate(CODEX_CAPABILITIES, { ...write, strict: true });
    expect(allowGaps(strict.degraded)).toHaveLength(1);
    expect(strict.refuse).toBeUndefined();
  });

  it("ACP: unenforced for a write node, so strict refuses it and names the gap", () => {
    const warn = policyGate(ACP_CAPABILITIES, write);
    expect(allowGaps(warn.degraded)).toHaveLength(1);
    expect(warn.refuse).toBeUndefined();
    const strict = policyGate(ACP_CAPABILITIES, { ...write, strict: true });
    expect(strict.refuse).toMatch(/strict policy: .*builtin allow-list/);
  });

  it("is not reported for a read-only node (the read-only check covers it) or with native: none", () => {
    for (const caps of [CODEX_CAPABILITIES, ACP_CAPABILITIES]) {
      expect(allowGaps(policyGate(caps, { ...write, readOnly: true }).degraded)).toEqual([]);
      expect(allowGaps(policyGate(caps, { ...write, nativeNone: true }).degraded)).toEqual([]);
    }
  });

  it("an allowed class the harness has no built-in for is reported, never refused", () => {
    const r = policyGate(PI_CAPABILITIES, { ...write, allow: ["subagent"], strict: true });
    expect(r.degraded).toContain("allow [subagent]: harness has no built-in tool of this class");
    expect(r.refuse).toBeUndefined();
    expect(policyGate(CLAUDE_CODE_CAPABILITIES, { ...write, allow: ["subagent"], strict: true })).toEqual({
      degraded: [],
    });
  });
});
