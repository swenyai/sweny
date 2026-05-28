import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { listWorkflows, resolveCustomWorkflowFile } from "../handlers/list-workflows.js";

const CUSTOM_WORKFLOW_YAML = `
id: my-custom
name: My Custom Workflow
description: A test custom workflow
entry: start
nodes:
  start:
    name: Start
    instruction: Do the thing
    skills: []
  finish:
    name: Finish
    instruction: Wrap up
    skills: []
edges:
  - from: start
    to: finish
`;

function freshDir(name: string): string {
  const dir = path.join(tmpdir(), `sweny-mcp-test-${name}-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tempDirs.length = 0;
});

describe("listWorkflows", () => {
  it("returns built-in workflows", async () => {
    const results = await listWorkflows(process.cwd());

    const ids = results.map((r) => r.id);
    expect(ids).toContain("triage");
    expect(ids).toContain("implement");
    expect(ids).toContain("seed-content");

    for (const wf of results.filter((r) => r.source === "builtin")) {
      expect(wf.name).toBeTruthy();
      expect(wf.description).toBeTruthy();
      expect(wf.nodeCount).toBeGreaterThan(0);
      expect(typeof wf.runnable).toBe("boolean");
    }

    const byId = Object.fromEntries(results.map((r) => [r.id, r.runnable]));
    expect(byId.triage).toBe(true);
    expect(byId.implement).toBe(true);
    // seed-content has no CLI run path → listed but not runnable
    expect(byId["seed-content"]).toBe(false);
  });

  it("handles nonexistent directory gracefully", async () => {
    const results = await listWorkflows("/nonexistent/path/that/does/not/exist");

    // Should still return built-ins without throwing
    expect(results.length).toBeGreaterThanOrEqual(3);
    expect(results.every((r) => r.source === "builtin")).toBe(true);
  });

  it("finds custom workflows in .sweny/workflows/", async () => {
    const dir = freshDir("custom-wf");
    tempDirs.push(dir);

    const workflowDir = path.join(dir, ".sweny", "workflows");
    fs.mkdirSync(workflowDir, { recursive: true });
    fs.writeFileSync(path.join(workflowDir, "custom.yml"), CUSTOM_WORKFLOW_YAML);

    const results = await listWorkflows(dir);
    const custom = results.find((r) => r.id === "my-custom");

    expect(custom).toBeDefined();
    expect(custom!.source).toBe("custom");
    expect(custom!.name).toBe("My Custom Workflow");
    expect(custom!.nodeCount).toBe(2);
    // Custom workflows are runnable via the file-run path.
    expect(custom!.runnable).toBe(true);
  });

  it("skips invalid workflow files without crashing", async () => {
    const dir = freshDir("invalid-wf");
    tempDirs.push(dir);

    const workflowDir = path.join(dir, ".sweny", "workflows");
    fs.mkdirSync(workflowDir, { recursive: true });
    fs.writeFileSync(path.join(workflowDir, "bad.yml"), "this is not valid workflow yaml");

    const results = await listWorkflows(dir);
    // Should return built-ins, skip the bad file
    expect(results.length).toBeGreaterThanOrEqual(3);
    expect(results.every((r) => r.source === "builtin")).toBe(true);
  });
});

describe("resolveCustomWorkflowFile", () => {
  it("resolves a custom workflow id to its file path under .sweny/workflows/", async () => {
    const dir = freshDir("resolve-wf");
    tempDirs.push(dir);

    const workflowDir = path.join(dir, ".sweny", "workflows");
    fs.mkdirSync(workflowDir, { recursive: true });
    // File name (custom.yml) deliberately differs from the workflow id (my-custom)
    // to prove resolution is by parsed id, not file name.
    fs.writeFileSync(path.join(workflowDir, "custom.yml"), CUSTOM_WORKFLOW_YAML);

    const resolved = await resolveCustomWorkflowFile(dir, "my-custom");
    expect(resolved).toBe(path.join(workflowDir, "custom.yml"));
  });

  it("returns null for an unknown workflow id", async () => {
    const dir = freshDir("resolve-missing");
    tempDirs.push(dir);
    fs.mkdirSync(path.join(dir, ".sweny", "workflows"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".sweny", "workflows", "custom.yml"), CUSTOM_WORKFLOW_YAML);

    expect(await resolveCustomWorkflowFile(dir, "nope")).toBeNull();
  });

  it("returns null when .sweny/workflows/ does not exist", async () => {
    expect(await resolveCustomWorkflowFile("/nonexistent/path/xyz", "my-custom")).toBeNull();
  });

  it("only ever returns a path inside .sweny/workflows/", async () => {
    const dir = freshDir("resolve-constrained");
    tempDirs.push(dir);
    const workflowDir = path.join(dir, ".sweny", "workflows");
    fs.mkdirSync(workflowDir, { recursive: true });
    fs.writeFileSync(path.join(workflowDir, "custom.yml"), CUSTOM_WORKFLOW_YAML);

    const resolved = await resolveCustomWorkflowFile(dir, "my-custom");
    expect(resolved).not.toBeNull();
    expect(resolved!.startsWith(path.resolve(workflowDir) + path.sep)).toBe(true);
  });
});
