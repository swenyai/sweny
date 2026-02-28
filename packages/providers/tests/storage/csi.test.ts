import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { csiStorage } from "../../src/storage/csi.js";
import { FsSessionStore } from "../../src/storage/session/fs.js";
import { FsMemoryStore } from "../../src/storage/memory/fs.js";
import { FsWorkspaceStore } from "../../src/storage/workspace/fs.js";

describe("csiStorage", () => {
  it("returns a StorageProvider with three factory methods", () => {
    const mountPath = mkdtempSync(join(tmpdir(), "csi-test-"));
    const provider = csiStorage({ mountPath });

    expect(typeof provider.createSessionStore).toBe("function");
    expect(typeof provider.createMemoryStore).toBe("function");
    expect(typeof provider.createWorkspaceStore).toBe("function");
  });

  it("createSessionStore returns FsSessionStore", () => {
    const mountPath = mkdtempSync(join(tmpdir(), "csi-test-"));
    const store = csiStorage({ mountPath }).createSessionStore();
    expect(store).toBeInstanceOf(FsSessionStore);
  });

  it("createMemoryStore returns FsMemoryStore", () => {
    const mountPath = mkdtempSync(join(tmpdir(), "csi-test-"));
    const store = csiStorage({ mountPath }).createMemoryStore();
    expect(store).toBeInstanceOf(FsMemoryStore);
  });

  it("createWorkspaceStore returns FsWorkspaceStore", () => {
    const mountPath = mkdtempSync(join(tmpdir(), "csi-test-"));
    const store = csiStorage({ mountPath }).createWorkspaceStore();
    expect(store).toBeInstanceOf(FsWorkspaceStore);
  });

  it("throws when mountPath does not exist", () => {
    expect(() => csiStorage({ mountPath: "/nonexistent/mount/path" })).toThrow("CSI mount path does not exist");
  });

  it("uses mountPath as base directory", () => {
    const mountPath = mkdtempSync(join(tmpdir(), "csi-test-"));
    const provider = csiStorage({ mountPath });

    const session = provider.createSessionStore();
    const memory = provider.createMemoryStore();
    const workspace = provider.createWorkspaceStore();

    expect(session).toBeInstanceOf(FsSessionStore);
    expect(memory).toBeInstanceOf(FsMemoryStore);
    expect(workspace).toBeInstanceOf(FsWorkspaceStore);
  });
});
