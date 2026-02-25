import type { SessionStore } from "./session/types.js";
import type { MemoryStore } from "./memory/types.js";
import type { WorkspaceStore } from "./workspace/types.js";

export interface StorageProvider {
  createSessionStore(): SessionStore;
  createMemoryStore(): MemoryStore;
  createWorkspaceStore(): WorkspaceStore;
}

export { type SessionStore } from "./session/types.js";
export { type MemoryStore } from "./memory/types.js";
export { type WorkspaceStore } from "./workspace/types.js";
