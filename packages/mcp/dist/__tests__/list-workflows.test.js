import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { listWorkflows } from "../handlers/list-workflows.js";
function freshDir(name) {
    const dir = path.join(tmpdir(), `sweny-mcp-test-${name}-${Date.now()}`);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}
const tempDirs = [];
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
        }
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
        const workflowYaml = `
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
        fs.writeFileSync(path.join(workflowDir, "custom.yml"), workflowYaml);
        const results = await listWorkflows(dir);
        const custom = results.find((r) => r.id === "my-custom");
        expect(custom).toBeDefined();
        expect(custom.source).toBe("custom");
        expect(custom.name).toBe("My Custom Workflow");
        expect(custom.nodeCount).toBe(2);
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
