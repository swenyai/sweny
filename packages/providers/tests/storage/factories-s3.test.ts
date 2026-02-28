import { describe, it, expect } from "vitest";
import { s3Storage } from "../../src/storage/s3.js";
import { S3SessionStore } from "../../src/storage/session/s3.js";
import { S3MemoryStore } from "../../src/storage/memory/s3.js";
import { S3WorkspaceStore } from "../../src/storage/workspace/s3.js";

describe("s3Storage", () => {
  it("returns a StorageProvider with three factory methods", () => {
    const provider = s3Storage({ bucket: "my-bucket" });

    expect(typeof provider.createSessionStore).toBe("function");
    expect(typeof provider.createMemoryStore).toBe("function");
    expect(typeof provider.createWorkspaceStore).toBe("function");
  });

  it("createSessionStore returns S3SessionStore", () => {
    const provider = s3Storage({ bucket: "my-bucket" });
    const store = provider.createSessionStore();
    expect(store).toBeInstanceOf(S3SessionStore);
  });

  it("createMemoryStore returns S3MemoryStore", () => {
    const provider = s3Storage({ bucket: "my-bucket" });
    const store = provider.createMemoryStore();
    expect(store).toBeInstanceOf(S3MemoryStore);
  });

  it("createWorkspaceStore returns S3WorkspaceStore", () => {
    const provider = s3Storage({ bucket: "my-bucket" });
    const store = provider.createWorkspaceStore();
    expect(store).toBeInstanceOf(S3WorkspaceStore);
  });

  it("creates new instances on each call (not singletons)", () => {
    const provider = s3Storage({ bucket: "my-bucket" });
    const a = provider.createSessionStore();
    const b = provider.createSessionStore();
    expect(a).not.toBe(b);
  });
});
