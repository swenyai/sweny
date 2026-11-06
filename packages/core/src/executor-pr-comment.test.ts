import { describe, expect, it, vi } from "vitest";
import { execute } from "./executor.js";
import type { Claude, Skill, ToolContext, Workflow } from "./types.js";

describe("PR surface runtime context", () => {
  it.each([true, false])("uses the identified PR without changing ordinary issue runs (PR=%s)", async (onPr) => {
    const handler = vi.fn(async (_input: unknown, _ctx: ToolContext) => ({ id: 9, swenyCommentStatus: "unchanged" }));
    const github: Skill = {
      id: "github", name: "GitHub", description: "", category: "git", config: {},
      tools: [{ name: "github_add_comment", description: "", access: "write", input_schema: {}, handler }],
    };
    const workflow: Workflow = {
      id: "review", name: "Review", description: "", entry: "review", workflow_type: "pr_review",
      permissions: "read", safe_outputs: { allow: ["comment"] },
      nodes: { review: { name: "Review", instruction: "Review", skills: ["github"], outputs: [{ type: "comment", number: 2 }] } },
      edges: [],
    };
    const claude: Claude = {
      async run(opts) {
        await opts.tools.find((t) => t.name === "emit_output")!.handler({ type: "comment", body: "Finding" }, {} as ToolContext);
        return { status: "success", data: {}, toolCalls: [] };
      },
      async ask() { return ""; },
      async evaluate() { return null; },
    };
    await execute(workflow, onPr ? { repo: "o/r", pr_number: 2 } : {}, {
      claude, skills: new Map([["github", github]]), config: {},
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      env: { GITHUB_REPOSITORY: "o/r", GITHUB_RUN_ID: "123" },
    });
    const context = handler.mock.calls[0][1];
    if (onPr) {
      expect(context.prComment).toEqual({
        workflowId: "review", repo: "o/r", number: 2,
        receiptUrl: "https://github.com/o/r/actions/runs/123",
      });
    } else {
      expect(context.prComment).toBeUndefined();
    }
  });
});
