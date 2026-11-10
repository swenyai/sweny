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

describe("sweny_validate", () => {
  it("accepts a valid workflow", async () => {
    const root = makeWorkspace();
    write(root, ".sweny/workflows/demo.yml", VALID_WORKFLOW);
    const client = await connect(root);

    const res = await call(client, "sweny_validate", { file: ".sweny/workflows/demo.yml" });

    expect(res.isError).toBe(false);
    expect(res.data.valid).toBe(true);
    expect(res.data.errors).toEqual([]);
    expect(res.data.workflow).toEqual({ id: "demo", name: "Demo", nodes: 2, edges: 1 });
    expect(res.summary).toContain("valid");
  });

  it("reports precise structural errors for an invalid workflow", async () => {
    const root = makeWorkspace();
    write(root, "bad.yml", INVALID_WORKFLOW);
    const client = await connect(root);

    const res = await call(client, "sweny_validate", { file: "bad.yml" });

    // An invalid workflow is a successful check with valid:false, not a tool failure.
    expect(res.isError).toBe(false);
    expect(res.data.valid).toBe(false);
    expect(res.data.errors).toEqual([
      { code: "UNKNOWN_EDGE_TARGET", message: 'Edge target "ghost" does not exist', nodeId: "ghost" },
    ]);
    expect(res.summary).toContain("1 validation error");
  });

  it("reports schema errors with the field path", async () => {
    const root = makeWorkspace();
    write(root, "noentry.yml", "id: x\nname: X\nnodes:\n  a: { name: A, instruction: x, skills: [] }\nedges: []\n");
    const client = await connect(root);

    const res = await call(client, "sweny_validate", { file: "noentry.yml" });

    expect(res.data.valid).toBe(false);
    expect(res.data.errors[0].code).toBe("SCHEMA");
    expect(res.data.errors[0].message).toContain("entry");
  });

  it("strips terminal escapes from error text (workflow files are agent-writable)", async () => {
    const root = makeWorkspace();
    // YAML double-quoted escapes: the parsed node id carries real ESC and BEL bytes.
    const hostile = '"gh\\u001b[31mo\\u001b]0;pwn\\u0007st"';
    write(root, "esc.yml", INVALID_WORKFLOW.replace("to: ghost", `to: ${hostile}`));
    const client = await connect(root);

    const res = await call(client, "sweny_validate", { file: "esc.yml" });

    expect(res.data.valid).toBe(false);
    expect(res.data.errors[0].code).toBe("UNKNOWN_EDGE_TARGET");
    expect(res.data.errors[0].message).not.toMatch(/[\u001b\u0007]/);
    expect(res.data.errors[0].nodeId).not.toMatch(/[\u001b\u0007]/);
    expect(res.data.errors[0].message).toContain("Edge target");
    expect(res.summary).not.toMatch(/[\u001b\u0007]/);
  });

  it("refuses a path that traverses out of the workspace root", async () => {
    const root = makeWorkspace();
    const outside = makeWorkspace();
    write(outside, "secret.yml", VALID_WORKFLOW);
    const client = await connect(root);

    const rel = path.relative(root, path.join(outside, "secret.yml"));
    const res = await call(client, "sweny_validate", { file: rel });

    expect(res.isError).toBe(true);
    expect(res.summary).toContain("outside the workspace root");
  });

  it("refuses an absolute path outside the workspace root", async () => {
    const root = makeWorkspace();
    const outside = makeWorkspace();
    const file = write(outside, "secret.yml", VALID_WORKFLOW);
    const client = await connect(root);

    const res = await call(client, "sweny_validate", { file });

    expect(res.isError).toBe(true);
    expect(res.summary).toContain("outside the workspace root");
  });

  it("refuses a symlink that escapes the workspace root", async () => {
    const root = makeWorkspace();
    const outside = makeWorkspace();
    const target = write(outside, "secret.yml", VALID_WORKFLOW);
    fs.symlinkSync(target, path.join(root, "link.yml"));
    const client = await connect(root);

    const res = await call(client, "sweny_validate", { file: "link.yml" });

    expect(res.isError).toBe(true);
    expect(res.summary).toContain("outside the workspace root");
  });

  it("refuses a file reached through a symlinked directory", async () => {
    const root = makeWorkspace();
    const outside = makeWorkspace();
    write(outside, "wf/secret.yml", VALID_WORKFLOW);
    fs.symlinkSync(path.join(outside, "wf"), path.join(root, "wf"));
    const client = await connect(root);

    const res = await call(client, "sweny_validate", { file: "wf/secret.yml" });

    expect(res.isError).toBe(true);
    expect(res.summary).toContain("outside the workspace root");
  });

  it("refuses files that are not workflow files (extension)", async () => {
    const root = makeWorkspace();
    write(root, ".env", "TOKEN=abc\n");
    const client = await connect(root);

    const res = await call(client, "sweny_validate", { file: ".env" });

    expect(res.isError).toBe(true);
    expect(res.summary).toContain(".yml, .yaml or .json");
  });

  it("reports a missing file as a tool error", async () => {
    const client = await connect(makeWorkspace());

    const res = await call(client, "sweny_validate", { file: "nope.yml" });

    expect(res.isError).toBe(true);
    expect(res.summary).toContain("not found");
  });

  it("rejects a missing file argument at the schema", async () => {
    const client = await connect(makeWorkspace());
    expect(await refusedBySchema(client, "sweny_validate", {})).toBe(true);
  });
});
