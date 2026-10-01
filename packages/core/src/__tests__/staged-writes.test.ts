/**
 * --stage stops sweny's own write tools, not just the agent's git push.
 *
 * A write node that loads the github skill and calls `github_create_pr`
 * directly must not push a branch or call the API in a staged run: write
 * tools are withheld, and the tool dispatcher refuses any write handler
 * that still reaches it. Tool handlers get the run's cwd and a pusher bound
 * to it (never process.cwd()). No network, no LLM calls.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { execute, guardStagedWrite } from "../executor.js";
import { createSkillMap } from "../skills/index.js";
import { github } from "../skills/github.js";
import type { Claude, Skill, ToolContext, Workflow } from "../types.js";

type Seen = { tools: string[]; result?: unknown; error?: string };

/** An agent that calls `toolName` with `args` when the node offers it. */
function agentCalling(toolName: string, args: unknown) {
  const seen: Seen[] = [];
  const claude: Claude = {
    async run(opts) {
      const entry: Seen = { tools: opts.tools.map((t) => t.name) };
      seen.push(entry);
      const t = opts.tools.find((x) => x.name === toolName);
      if (t) {
        try {
          entry.result = await t.handler(args, {} as ToolContext);
        } catch (err) {
          entry.error = err instanceof Error ? err.message : String(err);
        }
      }
      return { status: "success", data: {}, toolCalls: [] };
    },
    async evaluate(opts) {
      return opts.choices[0].id;
    },
    async ask() {
      return "";
    },
  };
  return { claude, seen };
}

const wf = (skills: string[], staged?: boolean): Workflow => ({
  id: "t",
  name: "T",
  description: "",
  entry: "a",
  edges: [],
  ...(staged ? { safe_outputs: { staged: true } } : {}),
  nodes: { a: { name: "A", instruction: "Open the PR.", skills } },
});

const PR_ARGS = { repo: "owner/repo", title: "t", head: "off-1-fix" };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a staged run cannot write through sweny's own tools", () => {
  it.each([
    ["--stage", {}, { stageOutputs: true }, false],
    ["safe_outputs.staged", {}, {}, true],
    ["dry run", { dryRun: true }, {}, false],
  ])("%s: a write node calling github_create_pr pushes nothing and calls no API", async (_l, input, over, staged) => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      throw new Error("no API call may happen in a staged run");
    });
    const { claude, seen } = agentCalling("github_create_pr", PR_ARGS);
    await execute(wf(["github"], staged), input, {
      skills: createSkillMap([github]),
      claude,
      config: { GITHUB_TOKEN: "x" },
      ...over,
    });
    expect(seen).toHaveLength(1);
    // Withheld: no write tool reaches the agent.
    expect(seen[0].tools).not.toContain("github_create_pr");
    for (const name of seen[0].tools) {
      expect(github.tools.find((t) => t.name === name)?.access, name).toBe("read");
    }
    expect(seen[0].result).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("control: a normal write node is offered github_create_pr", async () => {
    const { claude, seen } = agentCalling("none", {});
    await execute(wf(["github"]), {}, { skills: createSkillMap([github]), claude, config: { GITHUB_TOKEN: "x" } });
    expect(seen[0].tools).toContain("github_create_pr");
  });

  it("the dispatcher refuses a write or unclassified handler in a staged run, before it runs", () => {
    expect(() => guardStagedWrite({ name: "github_create_pr", access: "write" }, true)).toThrow(/staged/);
    expect(() => guardStagedWrite({ name: "mystery" }, true)).toThrow(/staged/);
    expect(() => guardStagedWrite({ name: "github_get_issue", access: "read" }, true)).not.toThrow();
    expect(() => guardStagedWrite({ name: "github_create_pr", access: "write" }, false)).not.toThrow();
  });
});

describe("tool handlers run against the run's checkout (#473)", () => {
  it("ToolContext carries ExecuteOptions.cwd, staged and a bound pusher", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "sweny-ctx-"));
    try {
      let ctx: ToolContext | undefined;
      const probe: Skill = {
        id: "probe",
        name: "Probe",
        description: "records its context",
        category: "general",
        config: {},
        tools: [
          {
            name: "probe_write",
            access: "write",
            description: "records ctx",
            input_schema: { type: "object", properties: {} },
            handler: async (_input, c) => {
              ctx = c;
              return { ok: true };
            },
          },
        ],
      };
      const { claude, seen } = agentCalling("probe_write", {});
      await execute(wf(["probe"]), {}, { skills: createSkillMap([probe]), claude, cwd: dir });
      expect(seen[0].error).toBeUndefined();
      expect(path.resolve(process.cwd())).not.toBe(path.resolve(dir));
      expect(ctx?.cwd).toBe(dir);
      expect(ctx?.staged).toBe(false);
      expect(typeof ctx?.pushBranch).toBe("function");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
