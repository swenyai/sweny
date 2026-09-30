/**
 * #365: least-privilege nodes and safe outputs, end to end through execute().
 *
 * The agent here is a mock that tries to write: it calls every tool it was
 * handed and requests writes through emit_output. The gate is that a declared
 * output reaches the external system only through the write stage, and a
 * read-only node never sees a write tool, an external MCP server, or a write
 * built-in. None of this depends on the harness, so a mock proves it.
 */
import { describe, it, expect, vi } from "vitest";
import { execute } from "../executor.js";
import { createSkillMap } from "../skills/index.js";
import { CLAUDE_CODE_CAPABILITIES } from "../harness/capabilities.js";
import type { AgentHarness, HarnessRunResult } from "../harness/types.js";
import type { Claude, NodeResult, Skill, Tool, Workflow } from "../types.js";

type RunOpts = Parameters<Claude["run"]>[0];

const silent = { info() {}, warn() {}, error() {}, debug() {} };

/** A github-shaped skill whose write handler records calls instead of calling the API. */
function fakeGithub(
  writes: { tool: string; input: Record<string, unknown>; during: boolean }[],
  state: { inRun: boolean },
) {
  const tool = (name: string, access: "read" | "write"): Tool => ({
    name,
    description: name,
    input_schema: { type: "object" },
    access,
    handler: async (input) => {
      if (access === "write") writes.push({ tool: name, input, during: state.inRun });
      return name === "github_create_issue" ? { number: 42 } : { ok: true };
    },
  });
  const skill: Skill = {
    id: "github",
    name: "GitHub",
    description: "",
    category: "git",
    config: {},
    tools: [
      tool("github_get_issue", "read"),
      tool("github_create_issue", "write"),
      tool("github_add_comment", "write"),
    ],
    mcp: { type: "http", url: "https://example.test/mcp" },
  };
  return skill;
}

/**
 * A worst-case agent: calls every tool it was handed with `{}`, then asks for
 * each write in `emit` (in order, one list per attempt).
 */
function writingAgent(emit: Record<string, unknown>[][], data: Record<string, unknown>[] = []) {
  const runs: RunOpts[] = [];
  const state = { inRun: false };
  const claude: Claude = {
    async run(opts) {
      const attempt = runs.length;
      runs.push(opts);
      state.inRun = true;
      try {
        for (const t of opts.tools) {
          if (t.name !== "emit_output") await t.handler({}, { config: {}, logger: silent });
        }
        const emitter = opts.tools.find((t) => t.name === "emit_output");
        for (const e of emit[attempt] ?? []) await emitter?.handler(e, { config: {}, logger: silent });
      } finally {
        state.inRun = false;
      }
      return { status: "success", data: data[attempt] ?? { summary: "ok" }, toolCalls: [] } as NodeResult;
    },
    async evaluate() {
      throw new Error("no routing in these tests");
    },
    async ask() {
      return "";
    },
  };
  return { claude, runs, state };
}

function wf(node: Partial<Workflow["nodes"][string]>, top: Partial<Workflow> = {}): Workflow {
  return {
    id: "so",
    name: "Safe outputs",
    description: "",
    entry: "report",
    nodes: { report: { name: "Report", instruction: "Report the crash", skills: ["github"], ...node } },
    edges: [],
    ...top,
  };
}

async function run(workflow: Workflow, emit: Record<string, unknown>[][], extra: Record<string, unknown> = {}) {
  const writes: { tool: string; input: Record<string, unknown>; during: boolean }[] = [];
  const agent = writingAgent(emit, (extra.data as Record<string, unknown>[]) ?? []);
  const skills = createSkillMap([fakeGithub(writes, agent.state)]);
  const { results } = await execute(workflow, (extra.input as object) ?? {}, {
    skills,
    claude: agent.claude,
    config: {},
    logger: silent,
    env: { GITHUB_REPOSITORY: "acme/api" },
    ...(extra.options as object),
  });
  return { results, writes, runs: agent.runs };
}

const ISSUE = { type: "issue", title: "Crash on start", body: "Stack trace" };

describe("safe outputs through execute() (#365)", () => {
  it("a node with outputs is read-only: no write tool, no skill MCP, read-only policy, plus emit_output", async () => {
    const { runs } = await run(wf({ outputs: [{ type: "issue" }] }), [[]]);
    const opts = runs[0];
    expect(opts.tools.map((t) => t.name)).toEqual(["github_get_issue", "emit_output"]);
    expect(opts.mcpServers).toBeUndefined();
    expect(opts.readOnly).toBe(true);
    expect(opts.policy).toMatchObject({ readOnly: true, deny: [], strict: false });
    expect(opts.instruction).toContain("## Outputs");
  });

  it("a declared output is applied only by the write stage, after the agent finished", async () => {
    const { results, writes } = await run(
      wf({ outputs: [{ type: "issue", title_prefix: "[sweny] ", labels: ["sweny"] }] }),
      [[ISSUE]],
    );
    expect(writes).toEqual([
      {
        tool: "github_create_issue",
        input: { repo: "acme/api", title: "[sweny] Crash on start", body: "Stack trace", labels: ["sweny"] },
        during: false,
      },
    ]);
    expect(results.get("report")!.outputs).toEqual([
      { type: "issue", status: "applied", via: "github", target: "acme/api", ref: 42 },
    ]);
    expect(results.get("report")!.status).toBe("success");
  });

  it("writes beyond the cap and undeclared types are refused, never written", async () => {
    const { results, writes } = await run(wf({ outputs: [{ type: "issue" }] }), [
      [ISSUE, { ...ISSUE, title: "Second" }, { type: "comment", body: "x", number: "1" }],
    ]);
    expect(writes).toHaveLength(1);
    // The tool itself refuses the second issue and the comment, so only one intent is recorded.
    expect(results.get("report")!.outputs).toHaveLength(1);
  });

  it("only the final attempt's intents apply after an eval retry", async () => {
    const { writes, runs } = await run(
      wf({
        outputs: [{ type: "issue" }],
        eval: [{ name: "has_ok", kind: "value", rule: { output_required: ["ok"] } }],
        retry: { max: 1 },
      }),
      [[{ ...ISSUE, title: "stale" }], [{ ...ISSUE, title: "fresh" }]],
      { data: [{ summary: "first" }, { summary: "second", ok: true }] },
    );
    expect(runs).toHaveLength(2);
    expect(writes.map((w) => w.input.title)).toEqual(["fresh"]);
  });

  it("a failed node applies nothing", async () => {
    const { results, writes } = await run(
      wf({
        outputs: [{ type: "issue" }],
        eval: [{ name: "has_ok", kind: "value", rule: { output_required: ["ok"] } }],
      }),
      [[ISSUE]],
    );
    expect(results.get("report")!.status).toBe("failed");
    expect(writes).toEqual([]);
    expect(results.get("report")!.outputs).toEqual([
      { type: "issue", status: "skipped", reason: "node did not succeed" },
    ]);
  });

  it("dry run stages: nothing written, receipts say staged", async () => {
    const { results, writes } = await run(wf({ outputs: [{ type: "issue" }] }), [[ISSUE]], {
      input: { dryRun: true },
    });
    expect(writes).toEqual([]);
    expect(results.get("report")!.outputs).toEqual([
      { type: "issue", status: "staged", via: "github", target: "acme/api" },
    ]);
  });

  it("--stage and safe_outputs.staged preview without writing", async () => {
    const a = await run(wf({ outputs: [{ type: "issue" }] }), [[ISSUE]], { options: { stageOutputs: true } });
    expect(a.writes).toEqual([]);
    expect(a.results.get("report")!.outputs![0].status).toBe("staged");

    const b = await run(wf({ outputs: [{ type: "issue" }] }, { safe_outputs: { staged: true } }), [[ISSUE]]);
    expect(b.writes).toEqual([]);
    expect(b.results.get("report")!.outputs![0].status).toBe("staged");
  });

  it("an untrusted actor writes nothing", async () => {
    const { results, writes } = await run(
      wf({ outputs: [{ type: "issue" }] }, { safe_outputs: { trusted_actors: ["octocat"] } }),
      [[ISSUE]],
      { options: { actor: { login: "mallory" } } },
    );
    expect(writes).toEqual([]);
    expect(results.get("report")!.outputs![0]).toMatchObject({ status: "refused", reason: "actor not trusted" });
  });

  it("an output with no configured skill fails before any model call (unless staged)", async () => {
    const workflow = wf({ skills: [], outputs: [{ type: "pr" }] });
    const agent = writingAgent([[]]);
    await expect(
      execute(workflow, {}, { skills: new Map(), claude: agent.claude, config: {}, logger: silent }),
    ).rejects.toThrow(/declares outputs \[pr\] but no configured skill/);
    expect(agent.runs).toHaveLength(0);
  });
});

describe("node permissions through execute() (#365)", () => {
  it("unchanged when nothing is declared: write tools, skill MCP, no readOnly, no emit_output", async () => {
    const { runs } = await run(wf({}), [[]]);
    const opts = runs[0];
    expect(opts.tools.map((t) => t.name)).toEqual(["github_get_issue", "github_create_issue", "github_add_comment"]);
    expect(Object.keys(opts.mcpServers ?? {})).toEqual(["github"]);
    expect(opts.readOnly).toBeUndefined();
    expect(opts.policy).toMatchObject({ readOnly: false, deny: [], strict: false });
  });

  it("permissions: read withholds every write tool and never reaches a write handler", async () => {
    const { runs, writes } = await run(wf({ permissions: "read" }), [[]]);
    expect(runs[0].tools.map((t) => t.name)).toEqual(["github_get_issue"]);
    expect(runs[0].mcpServers).toBeUndefined();
    expect(runs[0].readOnly).toBe(true);
    expect(writes).toEqual([]);
  });

  it("the workflow's permissions are the default for every node", async () => {
    const { runs } = await run(wf({}, { permissions: "read" }), [[]]);
    expect(runs[0].readOnly).toBe(true);
  });

  it("outputs plus explicit permissions: write keeps the write tools and adds emit_output", async () => {
    const { runs } = await run(wf({ permissions: "write", outputs: [{ type: "issue" }] }), [[]]);
    expect(runs[0].tools.map((t) => t.name)).toContain("github_create_issue");
    expect(runs[0].tools.map((t) => t.name)).toContain("emit_output");
    expect(runs[0].readOnly).toBeUndefined();
  });

  it("deny and strict are inherited from the workflow and merged with the node's", async () => {
    const { runs } = await run(
      wf({ permissions: { deny: ["net"] } }, { permissions: { deny: ["shell"], strict: true } }),
      [[]],
    );
    expect(runs[0].policy?.deny.sort()).toEqual(["net", "shell"]);
    expect(runs[0].policy?.strict).toBe(true);
  });

  it("a node asking for write under a read workflow fails at load", async () => {
    const agent = writingAgent([[]]);
    await expect(
      execute(
        wf({ permissions: "write" }, { permissions: "read" }),
        {},
        {
          skills: new Map(),
          claude: agent.claude,
          config: {},
          logger: silent,
        },
      ),
    ).rejects.toThrow(/PERMISSION_CEILING/);
    expect(agent.runs).toHaveLength(0);
  });

  it("a strict policy the harness cannot enforce is refused before any model call, and fail_soft cannot soften it", async () => {
    const harnessRun = vi.fn(async (): Promise<HarnessRunResult> => {
      throw new Error("must not run");
    });
    const harness: AgentHarness = {
      id: "mock",
      capabilities: { ...CLAUDE_CODE_CAPABILITIES, builtinDeny: "none" },
      async preflight() {
        return { ok: true, version: "test" };
      },
      run: harnessRun,
      async complete() {
        return null;
      },
    };
    const { results } = await execute(
      wf({ skills: [], permissions: { deny: ["shell"], strict: true }, fail_soft: true }),
      {},
      { skills: new Map(), harness, config: {}, logger: silent },
    );
    expect(harnessRun).not.toHaveBeenCalled();
    expect(results.get("report")!.status).toBe("failed");
    expect(String(results.get("report")!.data.error)).toMatch(/strict policy/);
  });
});
