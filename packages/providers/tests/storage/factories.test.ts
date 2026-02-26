import { describe, it, expect } from "vitest";
import { fsStorage } from "../../src/storage/fs.js";
import { FsSessionStore } from "../../src/storage/session/fs.js";
import { FsMemoryStore } from "../../src/storage/memory/fs.js";
import { FsWorkspaceStore } from "../../src/storage/workspace/fs.js";

describe("fsStorage", () => {
  it("returns a StorageProvider with three factory methods", () => {
    const provider = fsStorage({ baseDir: "/tmp/test" });

    expect(typeof provider.createSessionStore).toBe("function");
    expect(typeof provider.createMemoryStore).toBe("function");
    expect(typeof provider.createWorkspaceStore).toBe("function");
  });

  it("createSessionStore returns FsSessionStore", () => {
    const provider = fsStorage({ baseDir: "/tmp/test" });
    const store = provider.createSessionStore();
    expect(store).toBeInstanceOf(FsSessionStore);
  });

  it("createMemoryStore returns FsMemoryStore", () => {
    const provider = fsStorage({ baseDir: "/tmp/test" });
    const store = provider.createMemoryStore();
    expect(store).toBeInstanceOf(FsMemoryStore);
  });

  it("createWorkspaceStore returns FsWorkspaceStore", () => {
    const provider = fsStorage({ baseDir: "/tmp/test" });
    const store = provider.createWorkspaceStore();
    expect(store).toBeInstanceOf(FsWorkspaceStore);
  });
});
