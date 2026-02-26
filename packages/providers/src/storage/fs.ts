import type { StorageProvider } from "./types.js";
import { FsSessionStore } from "./session/fs.js";
import { FsMemoryStore } from "./memory/fs.js";
import { FsWorkspaceStore } from "./workspace/fs.js";

export function fsStorage(opts: { baseDir: string }): StorageProvider {
  return {
    createSessionStore: () => new FsSessionStore(opts.baseDir),
    createMemoryStore: () => new FsMemoryStore(opts.baseDir),
    createWorkspaceStore: () => new FsWorkspaceStore(opts.baseDir),
  };
}
