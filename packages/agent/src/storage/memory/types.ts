export interface MemoryEntry {
  id: string;
  text: string;
  createdAt: string;
}

export interface UserMemory {
  entries: MemoryEntry[];
}

export interface MemoryStore {
  getMemories(userId: string): Promise<UserMemory>;
  addEntry(userId: string, text: string): Promise<MemoryEntry>;
  removeEntry(userId: string, entryId: string): Promise<boolean>;
  clearMemories(userId: string): Promise<void>;
}
