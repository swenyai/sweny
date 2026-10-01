/**
 * #474: quiet weeks. weekly-digest and dependency-drift skip delivery when
 * there is nothing worth reporting. The decision is a deterministic `when`
 * expression (#461) over declared counts: no model call chooses the branch.
 */
import { describe, it, expect } from "vitest";
import { parse } from "yaml";
import { PACK_TEMPLATES } from "../cli/packs.js";
import { execute } from "../executor.js";
import { parseWorkflow, validateWorkflow } from "../schema.js";
import { createSkillMap } from "../skills/index.js";
import type { Claude, Logger, NodeResult } from "../types.js";

const silent: Logger = { info() {}, warn() {}, error() {}, debug() {} };

function load(id: string) {
  return parseWorkflow(parse(PACK_TEMPLATES.find((t) => t.id === id)!.yaml));
}

/** Minimal data satisfying a node's declared `required` fields (types only). */
function fill(schema: any): unknown {
  switch (schema?.type) {
    case "number":
      return 0;
    case "boolean":
      return false;
    case "array":
      return [];
    case "object":
      return Object.fromEntries((schema.required ?? []).map((k: string) => [k, fill(schema.properties?.[k])]));
    default:
      return schema?.enum?.[0] ?? "x";
  }
}

/** Canned data per node; refuses any model-chosen route. Returns the nodes that ran. */
async function route(id: string, data: Record<string, Record<string, unknown>>) {
  const wf = load(id);
  // Routing is under test, not the gates or skill wiring: drop those from the clone.
  for (const n of Object.values(wf.nodes)) {
    n.skills = [];
    delete n.eval;
    delete n.tools;
  }
  const ran: string[] = [];
  const claude: Claude = {
    async run(opts): Promise<NodeResult> {
      const node =
        Object.entries(wf.nodes).find(([, n]) => opts.instruction.includes(n.instruction.trim().split("\n")[0]))?.[0] ??
        "?";
      ran.push(node);
      const base = fill(wf.nodes[node]?.output) as Record<string, unknown>;
      return { status: "success", data: { ...base, ...(data[node] ?? {}) }, toolCalls: [] };
    },
    async evaluate() {
      throw new Error("routing must not call the model");
    },
    async ask() {
      return "";
    },
  };
  await execute(wf, {}, { skills: createSkillMap([]), claude, config: {}, logger: silent });
  return ran;
}

const stats = (commits: number, prs: number, opened: number, closed: number) => ({
  headline: "h",
  quiet_week: commits + prs + opened + closed === 0,
  stats: { commits, prs_merged: prs, issues_opened: opened, issues_closed: closed },
  risky_files: [],
  watch_next: [],
});

describe("weekly-digest quiet weeks (#474)", () => {
  it("validates with the quiet branch", () => {
    expect(validateWorkflow(load("weekly-digest"))).toEqual([]);
    const edges = load("weekly-digest").edges.filter((e) => e.from === "analyze");
    expect(edges.map((e) => e.to).sort()).toEqual(["publish", "quiet"]);
  });

  it("all-zero counts skip delivery", async () => {
    const ran = await route("weekly-digest", { analyze: stats(0, 0, 0, 0) });
    expect(ran).toEqual(["collect", "analyze", "quiet"]);
  });

  for (const [label, s] of [
    ["commits", stats(3, 0, 0, 0)],
    ["merged PRs", stats(0, 1, 0, 0)],
    ["issues opened", stats(0, 0, 2, 0)],
    ["issues closed", stats(0, 0, 0, 1)],
  ] as const) {
    it(`any activity (${label}) delivers`, async () => {
      const ran = await route("weekly-digest", { analyze: s });
      expect(ran).toEqual(["collect", "analyze", "publish"]);
    });
  }
});

describe("dependency-drift quiet weeks (#474)", () => {
  const assess = (action: "file" | "none") => ({
    action,
    actionable: [],
    drift: [],
    deferred_count: 0,
  });

  it("validates with the quiet branch", () => {
    expect(validateWorkflow(load("dependency-drift"))).toEqual([]);
    const edges = load("dependency-drift").edges.filter((e) => e.from === "assess");
    expect(edges.map((e) => e.to).sort()).toEqual(["file-issue", "quiet"]);
  });

  it("nothing actionable skips the issue step", async () => {
    const ran = await route("dependency-drift", { assess: assess("none") });
    expect(ran).toEqual(["inventory", "advisories", "assess", "quiet"]);
  });

  it("something actionable files", async () => {
    const ran = await route("dependency-drift", { assess: assess("file") });
    expect(ran).toEqual(["inventory", "advisories", "assess", "file-issue"]);
  });
});

describe("pr-risk-review is not quiet-routed (#474)", () => {
  it("every PR gets its comment", () => {
    for (const e of load("pr-risk-review").edges) expect(e.when).toBeUndefined();
  });
});

describe("the quiet node delivers nothing", () => {
  for (const id of ["weekly-digest", "dependency-drift"]) {
    it(`${id}: quiet is read-only, tool-free, and sends nothing`, () => {
      const q = load(id).nodes.quiet;
      expect(q.permissions).toBe("read");
      expect(q.skills ?? []).toEqual([]);
      expect(q.outputs ?? []).toEqual([]);
    });
  }
});
