import { describe, it, expect } from "vitest";
import { bindBuiltinWorkflow, readGaps, type BuiltinProviders } from "./builtin-workflows.js";
import { triageWorkflow, implementWorkflow } from "../workflows/index.js";
import { validateWorkflow } from "../schema.js";
import { resolveNodePermissions } from "../node-policy.js";

const GITHUB: BuiltinProviders = {
  issueTracker: "github-issues",
  sourceControl: "github",
  observability: ["sentry"],
  repository: "acme/api",
};
const LINEAR: BuiltinProviders = { ...GITHUB, issueTracker: "linear" };

describe("bindBuiltinWorkflow (#365)", () => {
  it("GitHub issues: every output is pinned to github and the repo, analysis stays read-only, no notes", () => {
    const { workflow, notes } = bindBuiltinWorkflow(triageWorkflow, GITHUB);
    expect(notes).toEqual([]);
    for (const o of workflow.nodes.create_issue.outputs!)
      expect(o).toMatchObject({ via: "github", target: "acme/api" });
    expect(workflow.nodes.skip.outputs![0]).toMatchObject({ via: "github", target: "acme/api" });
    expect(workflow.nodes.create_pr.outputs![0]).toMatchObject({ via: "github", target: "acme/api" });
    for (const id of ["gather", "investigate", "create_issue", "skip"]) {
      expect(resolveNodePermissions(workflow.nodes[id], workflow).access, id).toBe("read");
    }
    expect(validateWorkflow(workflow)).toEqual([]);
  });

  it("Linear: issues and comments go through linear, the PR through github", () => {
    const { workflow, notes } = bindBuiltinWorkflow(triageWorkflow, LINEAR);
    expect(notes).toEqual([]);
    for (const o of workflow.nodes.create_issue.outputs!) {
      expect(o.via).toBe("linear");
      // The Linear team comes from the agent (linear_list_teams), as before.
      expect(o.target).toBeUndefined();
    }
    expect(workflow.nodes.create_pr.outputs![0]).toMatchObject({ via: "github", target: "acme/api" });
  });

  it("Jira: tracker writes and reads fall back to the pre-#365 shape, with notes", () => {
    const { workflow, notes } = bindBuiltinWorkflow(triageWorkflow, { ...GITHUB, issueTracker: "jira" });
    const create = workflow.nodes.create_issue;
    expect(create.outputs).toBeUndefined();
    expect(create.permissions).toBe("write");
    // Keeps its own write tools (issue, comment, reopen), never a PR.
    expect(create.tools!.deny).toContain("github_create_pr");
    expect(create.tools!.deny).not.toContain("linear_create_issue");
    expect(create.tools!.deny).not.toContain("github_add_comment");
    expect(workflow.nodes.skip.outputs).toBeUndefined();
    expect(workflow.nodes.skip.tools!.deny).toContain("github_create_issue");
    expect(workflow.nodes.skip.tools!.deny).not.toContain("linear_update_issue");

    const gather = workflow.nodes.gather;
    expect(gather.permissions).toEqual({ access: "write", deny: ["write", "edit"] });
    expect(gather.tools!.deny).toEqual(
      expect.arrayContaining(["github_create_issue", "github_create_pr", "linear_create_issue", "linear_add_comment"]),
    );
    // The PR is still a safe output: GitHub is the source control.
    expect(workflow.nodes.create_pr.outputs![0].via).toBe("github");
    expect(notes).toHaveLength(2);
    expect(notes.join("\n")).toMatch(/jira/);
    expect(validateWorkflow(workflow)).toEqual([]);
  });

  it("an observability provider with no skill keeps shell access for analysis only", () => {
    const { workflow, notes } = bindBuiltinWorkflow(triageWorkflow, { ...LINEAR, observability: ["loki"] });
    expect(workflow.nodes.gather.permissions).toMatchObject({ access: "write" });
    expect(workflow.nodes.investigate.permissions).toMatchObject({ access: "write" });
    // Writes still go through safe outputs.
    expect(workflow.nodes.create_issue.outputs![0].via).toBe("linear");
    expect(notes).toEqual([
      "gather, investigate run write-capable (file edits and write tools still denied): a read-only step cannot reach loki",
    ]);
  });

  it("GitLab: the PR node writes through its own tools", () => {
    const { workflow } = bindBuiltinWorkflow(implementWorkflow, { ...GITHUB, sourceControl: "gitlab" });
    expect(workflow.nodes.create_pr.outputs).toBeUndefined();
    expect(workflow.nodes.create_pr.permissions).toBe("write");
    expect(workflow.nodes.create_pr.tools!.deny).not.toContain("github_create_pr");
    expect(workflow.nodes.analyze.permissions).toMatchObject({ access: "write", deny: ["write", "edit"] });
  });

  it("implement: the skip comment keeps its pin to the run's issue", () => {
    const { workflow } = bindBuiltinWorkflow(implementWorkflow, LINEAR);
    expect(workflow.nodes.skip.outputs![0]).toEqual({
      type: "comment",
      max: 1,
      number: { input: "issueIdentifier" },
      via: "linear",
    });
  });

  it("never mutates the bundled workflow", () => {
    const before = JSON.stringify(triageWorkflow);
    bindBuiltinWorkflow(triageWorkflow, { ...GITHUB, issueTracker: "jira", observability: ["loki"] });
    bindBuiltinWorkflow(triageWorkflow, LINEAR);
    expect(JSON.stringify(triageWorkflow)).toBe(before);
  });

  it("readGaps names what a read-only step cannot reach", () => {
    expect(readGaps(GITHUB)).toEqual([]);
    expect(readGaps({ ...GITHUB, observability: ["file", "datadog", "betterstack"] })).toEqual([]);
    expect(readGaps({ ...GITHUB, userMcpServers: ["x"], workspaceTools: ["slack"] })).toEqual([
      "user MCP servers",
      "workspace tools",
    ]);
    expect(readGaps({ ...GITHUB, sourceControl: "file", issueTracker: "file" })).toEqual(["file source control"]);
  });
});
