import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  INVALID_WORKFLOW,
  VALID_WORKFLOW,
  call,
  cleanupWorkspaces,
  connect,
  makeWorkspace,
  refusedBySchema,
  write,
} from "./helpers.js";

afterEach(cleanupWorkspaces);

describe("sweny_diagram", () => {
  it("renders a workflow file as Mermaid", async () => {
    const root = makeWorkspace();
    write(root, ".sweny/workflows/demo.yml", VALID_WORKFLOW);
    const client = await connect(root);

    const res = await call(client, "sweny_diagram", { file: ".sweny/workflows/demo.yml" });

    expect(res.isError).toBe(false);
    expect(res.data.workflow).toEqual({ id: "demo", name: "Demo" });
    expect(res.data.direction).toBe("TB");
    expect(res.data.nodes).toBe(2);
    expect(res.data.edges).toBe(1);
    expect(res.data.mermaid).toMatch(/^graph TB\n/);
    expect(res.data.mermaid).toContain("start");
    expect(res.data.mermaid).toContain("finish");
    expect(res.data.mermaid).not.toContain("```");
    expect(res.summary).toContain("demo");
    expect(res.summary).toContain("2 nodes");
  });

  it("renders a built-in workflow by name", async () => {
    const client = await connect(makeWorkspace());

    const res = await call(client, "sweny_diagram", { file: "triage", direction: "LR" });

    expect(res.isError).toBe(false);
    expect(res.data.workflow.id).toBe("triage");
    expect(res.data.mermaid).toMatch(/^graph LR\n/);
  });

  it("fences the diagram when block is true", async () => {
    const root = makeWorkspace();
    write(root, "wf.yml", VALID_WORKFLOW);
    const client = await connect(root);

    const res = await call(client, "sweny_diagram", { file: "wf.yml", block: true });

    expect(res.data.mermaid.startsWith("```mermaid\n")).toBe(true);
    expect(res.data.mermaid.trimEnd().endsWith("```")).toBe(true);
  });

  it("adds a title header when asked", async () => {
    const root = makeWorkspace();
    write(root, "wf.yml", VALID_WORKFLOW);
    const client = await connect(root);

    const res = await call(client, "sweny_diagram", { file: "wf.yml", title: "My flow" });

    expect(res.data.mermaid.startsWith("---\ntitle: My flow\n---\n")).toBe(true);
  });

  it("returns the validation errors for a workflow that does not validate", async () => {
    const root = makeWorkspace();
    write(root, "bad.yml", INVALID_WORKFLOW);
    const client = await connect(root);

    const res = await call(client, "sweny_diagram", { file: "bad.yml" });

    expect(res.isError).toBe(true);
    expect(res.data.errors[0].code).toBe("UNKNOWN_EDGE_TARGET");
  });

  it("rejects an unknown direction at the schema", async () => {
    const root = makeWorkspace();
    write(root, "wf.yml", VALID_WORKFLOW);
    const client = await connect(root);

    expect(await refusedBySchema(client, "sweny_diagram", { file: "wf.yml", direction: "UP" })).toBe(true);
  });

  it("never writes a file (read-only tool)", async () => {
    const root = makeWorkspace();
    write(root, "wf.yml", VALID_WORKFLOW);
    const client = await connect(root);
    await call(client, "sweny_diagram", { file: "wf.yml" });
    expect(fs.readdirSync(root)).toEqual(["wf.yml"]);
  });

  it("refuses path traversal, absolute paths and symlink escapes", async () => {
    const root = makeWorkspace();
    const outside = makeWorkspace();
    const target = write(outside, "secret.yml", VALID_WORKFLOW);
    fs.symlinkSync(target, path.join(root, "link.yml"));
    const client = await connect(root);

    for (const file of [path.relative(root, target), target, "link.yml", "../../etc/passwd.yml"]) {
      const res = await call(client, "sweny_diagram", { file });
      expect(res.isError, file).toBe(true);
      expect(res.summary, file).toMatch(/outside the workspace root|not found/);
    }
  });
});
