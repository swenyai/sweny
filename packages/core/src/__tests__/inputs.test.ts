import { describe, it, expect } from "vitest";
import {
  validateRuntimeInput,
  summarizeInputShape,
  workflowInputsZ,
  WORKFLOW_INPUT_TYPES,
  type WorkflowInputs,
} from "../inputs.js";
import { workflowZ, parseWorkflow, workflowTypeZ } from "../schema.js";
import { execute } from "../executor.js";
import { buildStartRunPayload } from "../cli/cloud-lifecycle.js";
import type { Claude, Tool, Workflow } from "../types.js";

// ─── validateRuntimeInput ─────────────────────────────────────────

describe("validateRuntimeInput", () => {
  it("passes any object through when no inputs are declared (back-compat)", () => {
    const r = validateRuntimeInput(undefined, { foo: 1, bar: "x" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ foo: 1, bar: "x" });
  });

  it("accepts an empty object when no inputs are declared", () => {
    const r = validateRuntimeInput(undefined, null);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({});
  });

  it("rejects non-object input at the root", () => {
    const r = validateRuntimeInput(undefined, [1, 2, 3]);
    expect(r.ok).toBe(false);
  });

  it("validates string fields", () => {
    const declared: WorkflowInputs = { name: { type: "string", required: true } };
    const ok = validateRuntimeInput(declared, { name: "alice" });
    expect(ok.ok).toBe(true);
    const bad = validateRuntimeInput(declared, { name: 42 });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.errors[0].field).toBe("name");
      expect(bad.errors[0].message).toMatch(/string/);
    }
  });

  it("validates number / boolean / string[] fields", () => {
    const declared: WorkflowInputs = {
      n: { type: "number" },
      b: { type: "boolean" },
      arr: { type: "string[]" },
    };
    const good = validateRuntimeInput(declared, { n: 5, b: true, arr: ["a", "b"] });
    expect(good.ok).toBe(true);
    const bad = validateRuntimeInput(declared, { n: "5", b: "true", arr: [1] });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.errors.map((e) => e.field).sort()).toEqual(["arr", "b", "n"]);
    }
  });

  it("rejects NaN / Infinity for number type", () => {
    const declared: WorkflowInputs = { n: { type: "number" } };
    const nan = validateRuntimeInput(declared, { n: Number.NaN });
    expect(nan.ok).toBe(false);
    const inf = validateRuntimeInput(declared, { n: Number.POSITIVE_INFINITY });
    expect(inf.ok).toBe(false);
  });

  it("reports all missing required fields at once, not one at a time", () => {
    const declared: WorkflowInputs = {
      a: { type: "string", required: true },
      b: { type: "number", required: true },
      c: { type: "boolean" },
    };
    const r = validateRuntimeInput(declared, {});
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toHaveLength(2);
      expect(r.errors.map((e) => e.field).sort()).toEqual(["a", "b"]);
    }
  });

  it("applies defaults when the caller omits a field", () => {
    const declared: WorkflowInputs = {
      since: { type: "string", default: "HEAD~10" },
      draft: { type: "boolean", default: false },
    };
    const r = validateRuntimeInput(declared, {});
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ since: "HEAD~10", draft: false });
  });

  it("caller-provided value beats default", () => {
    const declared: WorkflowInputs = { since: { type: "string", default: "HEAD~10" } };
    const r = validateRuntimeInput(declared, { since: "v1.0.0" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.since).toBe("v1.0.0");
  });

  it("leaves optional fields unset when caller omits them and no default exists", () => {
    const declared: WorkflowInputs = { foo: { type: "string" } };
    const r = validateRuntimeInput(declared, {});
    expect(r.ok).toBe(true);
    if (r.ok) expect("foo" in r.value).toBe(false);
  });

  it("passes through undeclared keys for legacy CLI compat (dryRun, timeRange, ...)", () => {
    const declared: WorkflowInputs = { since: { type: "string" } };
    const r = validateRuntimeInput(declared, { since: "v1", dryRun: true, repository: "x/y" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.since).toBe("v1");
      expect(r.value.dryRun).toBe(true);
      expect(r.value.repository).toBe("x/y");
    }
  });

  it("enforces enum constraints", () => {
    const declared: WorkflowInputs = {
      severity: { type: "string", enum: ["low", "high"] },
    };
    const ok = validateRuntimeInput(declared, { severity: "low" });
    expect(ok.ok).toBe(true);
    const bad = validateRuntimeInput(declared, { severity: "critical" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors[0].message).toMatch(/one of/);
  });

  it("treats explicit null on optional field as missing → applies default", () => {
    const declared: WorkflowInputs = { foo: { type: "string", default: "fallback" } };
    const r = validateRuntimeInput(declared, { foo: null });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.foo).toBe("fallback");
  });
});

// ─── workflowInputsZ schema ──────────────────────────────────────

describe("workflowInputsZ", () => {
  it("accepts a valid declaration", () => {
    const parsed = workflowInputsZ.parse({
      since: { type: "string", description: "Lower bound", required: true },
      draft: { type: "boolean", default: false },
      labels: { type: "string[]", default: [] },
    });
    expect(parsed.since.required).toBe(true);
    expect(parsed.draft.default).toBe(false);
  });

  it("rejects unknown types", () => {
    expect(() => workflowInputsZ.parse({ x: { type: "date" } })).toThrow();
  });

  it("rejects a default whose type doesn't match the field type", () => {
    expect(() => workflowInputsZ.parse({ x: { type: "string", default: 42 } })).toThrow(/default/);
  });

  it("rejects enum values that don't match the field type", () => {
    expect(() => workflowInputsZ.parse({ x: { type: "string", enum: ["a", 5] } })).toThrow(/enum/);
  });

  it("rejects unknown keys on a field", () => {
    expect(() => workflowInputsZ.parse({ x: { type: "string", randoKey: true } })).toThrow();
  });

  it("rejects a field that declares both `required: true` and a `default`", () => {
    // The combination is incoherent: a default would either satisfy the
    // required check (making it vestigial) or never fire (making the
    // default dead code). Reject at parse time so authors fix the YAML.
    expect(() => workflowInputsZ.parse({ x: { type: "string", required: true, default: "fallback" } })).toThrow(
      /required.*default|default.*required/i,
    );
  });

  it("accepts `required: true` without a `default`", () => {
    const parsed = workflowInputsZ.parse({ x: { type: "string", required: true } });
    expect(parsed.x.required).toBe(true);
    expect(parsed.x.default).toBeUndefined();
  });

  it("accepts a `default` without `required: true`", () => {
    const parsed = workflowInputsZ.parse({ x: { type: "string", default: "fallback" } });
    expect(parsed.x.default).toBe("fallback");
    expect(parsed.x.required).toBeUndefined();
  });

  it("accepts `required: false` together with a `default` (false is the optional default)", () => {
    // Explicit `required: false` is the same as omitting it; the default
    // is permitted in that case because there's no conflict.
    const parsed = workflowInputsZ.parse({ x: { type: "string", required: false, default: "x" } });
    expect(parsed.x.required).toBe(false);
    expect(parsed.x.default).toBe("x");
  });

  it("covers every declared WORKFLOW_INPUT_TYPES value", () => {
    for (const t of WORKFLOW_INPUT_TYPES) {
      const parsed = workflowInputsZ.parse({ f: { type: t } });
      expect(parsed.f.type).toBe(t);
    }
  });
});

// ─── workflowZ integration ───────────────────────────────────────

describe("workflowZ with inputs", () => {
  it("accepts a workflow that declares inputs", () => {
    const parsed = workflowZ.parse({
      id: "release-notes",
      name: "Release Notes",
      entry: "discover",
      nodes: { discover: { name: "Discover", instruction: "Find tags" } },
      edges: [],
      inputs: {
        since_tag: { type: "string", required: true },
        until_tag: { type: "string", default: "HEAD" },
      },
    });
    expect(parsed.inputs?.since_tag.required).toBe(true);
    expect(parsed.inputs?.until_tag.default).toBe("HEAD");
  });

  it("parseWorkflow rejects malformed inputs blocks", () => {
    expect(() =>
      parseWorkflow({
        id: "x",
        name: "x",
        entry: "a",
        nodes: { a: { name: "A", instruction: "Do it" } },
        edges: [],
        inputs: { foo: { type: "json" } },
      }),
    ).toThrow();
  });

  it("existing workflows without an inputs block continue to parse", () => {
    const parsed = workflowZ.parse({
      id: "no-inputs",
      name: "No Inputs",
      entry: "a",
      nodes: { a: { name: "A", instruction: "x" } },
      edges: [],
    });
    expect(parsed.inputs).toBeUndefined();
  });
});

// ─── inputs × workflow_type composition ──────────────────────────
//
// Pins the contract documented in spec/src/content/docs/workflow.mdx
// under "Composition with workflow_type":
//
//   1. Any workflow type can declare inputs.
//   2. Inputs are additive, never inferred or replaced by the type.
//   3. No reserved field names per type.
//   4. Cloud renderers may display both surfaces; the runtime does not
//      couple them. The cloud start-run payload carries workflow_type
//      separately and never reads the declared inputs.

describe("inputs composition with workflow_type", () => {
  it("every workflow_type value accepts a declared inputs block", () => {
    // Iterate the canonical enum so adding a new type forces a decision
    // about whether the additive rule still applies.
    for (const type of workflowTypeZ.options) {
      const parsed = workflowZ.parse({
        id: `wf-${type}`,
        name: `WF ${type}`,
        entry: "a",
        workflow_type: type,
        nodes: { a: { name: "A", instruction: "x" } },
        edges: [],
        inputs: {
          since_tag: { type: "string", required: true },
          dry_run: { type: "boolean", default: false },
        },
      });
      expect(parsed.workflow_type).toBe(type);
      expect(parsed.inputs?.since_tag.required).toBe(true);
      expect(parsed.inputs?.dry_run.default).toBe(false);
    }
  });

  it("pr_review with inputs does not reserve or auto-inject field names", () => {
    // No input name (pull_request_url, repo, severity, etc.) is reserved
    // by the pr_review type. Author-declared fields ride alongside,
    // unchanged.
    const wf = parseWorkflow({
      id: "pr-review-with-inputs",
      name: "PR Review",
      entry: "review",
      workflow_type: "pr_review",
      nodes: { review: { name: "Review", instruction: "Review the diff" } },
      edges: [],
      inputs: {
        pull_request_url: { type: "string", required: true },
        severity_floor: { type: "string", enum: ["low", "medium", "high"], default: "low" },
      },
    });
    expect(wf.workflow_type).toBe("pr_review");
    expect(Object.keys(wf.inputs ?? {}).sort()).toEqual(["pull_request_url", "severity_floor"]);
    // Nothing implicit was injected.
    expect(Object.keys(wf.inputs ?? {})).not.toContain("pr_url");
    expect(Object.keys(wf.inputs ?? {})).not.toContain("repository");
  });

  it("declared inputs validate independently of workflow_type", () => {
    // Same caller input is validated identically whether the workflow is
    // typed as pr_review, monitor, or generic. The type does not change
    // required/default/enum semantics.
    const declared: WorkflowInputs = {
      target: { type: "string", required: true },
      retries: { type: "number", default: 0 },
    };
    const callerInput = { target: "v1.0.0" };
    const r = validateRuntimeInput(declared, callerInput);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ target: "v1.0.0", retries: 0 });
  });

  it("cloud start-run payload carries workflow_type but never the declared inputs", () => {
    // The cloud lifecycle ships workflow_type to route the renderer. It
    // does NOT read or forward the declared inputs (the values would be
    // sensitive; the shape is exposed elsewhere via summarizeInputShape).
    const wf: Pick<Workflow, "id" | "workflow_type"> = {
      id: "release-notes",
      workflow_type: "content_generation",
    };
    const payload = buildStartRunPayload(wf, { runUuid: "abc-123", env: {} });
    expect(payload.workflow_id).toBe("release-notes");
    expect(payload.workflow_type).toBe("content_generation");
    expect(payload).not.toHaveProperty("inputs");
    expect(payload).not.toHaveProperty("input");
  });

  it("absent workflow_type still accepts inputs (treated as generic)", () => {
    const wf = parseWorkflow({
      id: "no-type-but-inputs",
      name: "No Type",
      entry: "a",
      nodes: { a: { name: "A", instruction: "x" } },
      edges: [],
      inputs: {
        since: { type: "string", default: "HEAD~10" },
      },
    });
    expect(wf.workflow_type).toBeUndefined();
    expect(wf.inputs?.since.default).toBe("HEAD~10");
  });
});

// ─── summarizeInputShape ─────────────────────────────────────────

describe("summarizeInputShape", () => {
  it("returns declared types when an inputs contract exists", () => {
    const declared: WorkflowInputs = {
      since: { type: "string" },
      n: { type: "number" },
    };
    expect(summarizeInputShape(declared, { since: "v1", n: 5 })).toEqual({
      since: "string",
      n: "number",
    });
  });

  it("falls back to observed runtime types when no contract is declared", () => {
    expect(summarizeInputShape(undefined, { a: "x", b: 3, c: true, d: ["x"], e: null })).toEqual({
      a: "string",
      b: "number",
      c: "boolean",
      d: "string[]",
      e: "null",
    });
  });

  it("never includes values, only key + type", () => {
    const r = summarizeInputShape(undefined, { secret: "sk-xxx" });
    expect(JSON.stringify(r)).not.toContain("sk-xxx");
  });
});

// ─── End-to-end through executor ─────────────────────────────────

/** Minimal mock Claude that records the input it sees and returns nothing. */
function makeMockClaude(captured: { input?: unknown; conditions?: string[] }): Claude {
  return {
    async run({ context }) {
      captured.input = (context as Record<string, unknown>).input;
      return { status: "success", data: { ok: true }, toolCalls: [] };
    },
    async evaluate({ context, choices }) {
      // record the input snapshot at the routing decision point too
      captured.input = (context as Record<string, unknown>).input;
      captured.conditions = choices.map((c) => c.description);
      return choices[0].id;
    },
    async ask() {
      return "";
    },
  };
}

describe("executor with validated inputs", () => {
  it("makes input.since visible to the first node's context", async () => {
    const wf: Workflow = {
      id: "x",
      name: "x",
      description: "",
      entry: "n",
      nodes: { n: { name: "N", instruction: "do", skills: [] } },
      edges: [],
    };
    const captured: { input?: unknown } = {};
    const claude = makeMockClaude(captured);
    await execute(wf, { since: "v1.0.0" }, { skills: new Map(), claude });
    expect(captured.input).toEqual({ since: "v1.0.0" });
  });

  it("makes input.<field> visible to a conditional routing decision", async () => {
    const wf: Workflow = {
      id: "x",
      name: "x",
      description: "",
      entry: "n",
      nodes: {
        n: { name: "N", instruction: "do", skills: [] },
        a: { name: "A", instruction: "do", skills: [] },
        b: { name: "B", instruction: "do", skills: [] },
      },
      edges: [
        { from: "n", to: "a", when: "input.draft is true" },
        { from: "n", to: "b", when: "input.draft is false" },
      ],
    };
    const captured: { input?: unknown; conditions?: string[] } = {};
    const claude = makeMockClaude(captured);
    await execute(wf, { draft: true }, { skills: new Map(), claude });
    // The routing-decision call saw the same input bag.
    expect(captured.input).toEqual({ draft: true });
    // The condition text references input.draft, proving the path is plumbed.
    expect(captured.conditions?.some((c) => c.includes("input.draft"))).toBe(true);
  });
});
