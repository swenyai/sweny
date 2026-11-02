import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseWorkflow } from "../schema.js";
import { buildNodePolicy, resolveNodePermissions } from "../node-policy.js";
import { policyGate } from "./policy.js";
import { CLAUDE_CODE_CAPABILITIES, CODEX_CAPABILITIES } from "./capabilities.js";
import type { NodePolicy } from "./types.js";

// permissions.native: none. One policy value that gives a node's agent no
// built-in tools (SDK `tools: []`) and no settings sources (`settingSources: []`).

const wf = (permissions: unknown, nodePermissions?: unknown) => ({
  id: "t",
  name: "t",
  entry: "a",
  nodes: {
    a: { name: "a", instruction: "do it", skills: [], ...(nodePermissions ? { permissions: nodePermissions } : {}) },
  },
  edges: [],
  ...(permissions ? { permissions } : {}),
});

describe("permissions.native schema", () => {
  it("accepts native: none and native: default, alone or with access and strict", () => {
    expect(() => parseWorkflow(wf(undefined, { native: "none" }))).not.toThrow();
    expect(() => parseWorkflow(wf(undefined, { access: "read", strict: true, native: "none" }))).not.toThrow();
    expect(() => parseWorkflow(wf({ native: "default" }))).not.toThrow();
  });
  it("refuses any other native value and any unknown key", () => {
    expect(() => parseWorkflow(wf(undefined, { native: "some" }))).toThrow();
    expect(() => parseWorkflow(wf(undefined, { natives: "none" }))).toThrow();
  });
});

describe("permissions.native resolution", () => {
  it("is none when the node or the workflow says none, and default otherwise", () => {
    const w = parseWorkflow(wf({ native: "none" }, { access: "read" }));
    expect(resolveNodePermissions(w.nodes.a, w).native).toBe("none");
    const n = parseWorkflow(wf(undefined, { native: "none" }));
    expect(resolveNodePermissions(n.nodes.a, n).native).toBe("none");
    const d = parseWorkflow(wf(undefined, { access: "read" }));
    expect(resolveNodePermissions(d.nodes.a, d).native).toBeUndefined();
  });
  it("a node cannot lift a workflow none", () => {
    const w = parseWorkflow(wf({ native: "none" }, { native: "default" }));
    expect(resolveNodePermissions(w.nodes.a, w).native).toBe("none");
  });
  it("buildNodePolicy carries nativeNone only for none", () => {
    const base = { dryRun: false };
    const none = buildNodePolicy({ ...base, permissions: { access: "read", deny: [], strict: true, native: "none" } });
    expect(none.nativeNone).toBe(true);
    const dflt = buildNodePolicy({
      ...base,
      permissions: { access: "read", deny: [], strict: true, native: "default" },
    });
    expect("nativeNone" in dflt).toBe(false);
  });
});

describe("policyGate and native none", () => {
  const none: NodePolicy = { readOnly: true, deny: [], egress: [], strict: true, nativeNone: true };
  it("Claude Code honors it: no degraded entry, no refusal", () => {
    expect(policyGate(CLAUDE_CODE_CAPABILITIES, none)).toEqual({ degraded: [] });
  });
  it("a harness that cannot honor it degrades in warn and refuses in strict", () => {
    const warn = policyGate(CODEX_CAPABILITIES, { ...none, strict: false });
    expect(warn.refuse).toBeUndefined();
    expect(warn.degraded.join(" ")).toContain("native none");
    const strict = policyGate(CODEX_CAPABILITIES, none);
    expect(strict.refuse).toContain("native none");
  });
});

describe("ClaudeCodeHarness and native none", () => {
  let mockQuery: ReturnType<typeof vi.fn>;
  let mod: typeof import("./claude-code.js");
  const logger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() });
  const stream = () =>
    (async function* () {
      yield { type: "result", subtype: "success", result: "done" };
    })();
  beforeEach(async () => {
    mockQuery = vi.fn();
    vi.doMock("@anthropic-ai/claude-agent-sdk", () => ({
      query: mockQuery,
      createSdkMcpServer: vi.fn().mockReturnValue({ type: "sdk", name: "sweny-core" }),
      tool: vi.fn(),
    }));
    vi.stubEnv("SWENY_SANDBOX", "off");
    mod = await import("./claude-code.js");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
  });
  const policy = (over: Partial<NodePolicy> = {}): NodePolicy => ({
    readOnly: false,
    deny: [],
    egress: [],
    strict: false,
    ...over,
  });

  it("the node query carries tools: [] and settingSources: [] with the value set, and no tools key without it", async () => {
    mockQuery.mockReturnValue(stream());
    const h = new mod.ClaudeCodeHarness({ logger: logger() });
    await h.run({ instruction: "x", context: {}, tools: [], policy: policy({ nativeNone: true }) });
    const withNone = mockQuery.mock.calls[0][0].options;
    expect(withNone.tools).toEqual([]);
    expect(withNone.settingSources).toEqual([]);
    mockQuery.mockReturnValue(stream());
    await h.run({ instruction: "x", context: {}, tools: [], policy: policy() });
    const without = mockQuery.mock.calls[1][0].options;
    expect("tools" in without).toBe(false);
    // settingSources: [] is every node's default since #497; native none adds only tools: [].
    expect(without.settingSources).toEqual([]);
  });
});
