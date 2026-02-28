# Task 20 — Tests for Built-in Plugins (memory + workspace)

## Objective

Add unit tests for `memoryPlugin()` (3 tools) and `workspacePlugin()` (6 tools). Both are untested.

## Files Under Test

### 1. `packages/agent/src/plugins/memory/index.ts` (106 lines)

Factory function `memoryPlugin()` returns a `ToolPlugin` with:
- **name**: `"memory"`
- **createTools(ctx)**: returns 3 `AgentTool[]`:
  - `memory_save` — calls `store.addEntry(userId, text)`, returns success with id
  - `memory_list` — calls `store.getMemories(userId)`, formats entries as list
  - `memory_remove` — calls `store.removeEntry(userId, entryId)`, returns success/not found
- **systemPromptSection()**: returns memory instructions string
- All tools wrap errors in `{ isError: true }` responses

### 2. `packages/agent/src/plugins/workspace/index.ts` (163 lines)

Factory function `workspacePlugin()` returns a `ToolPlugin` with:
- **name**: `"workspace"`
- **createTools(ctx)**: returns 6 `AgentTool[]`:
  - `workspace_list` — calls `store.getManifest(userId)`, returns JSON manifest
  - `workspace_read` — calls `store.readFile(userId, path)`, returns content
  - `workspace_write` — `confirm=false` returns preview; `confirm=true` calls `store.writeFile()`
  - `workspace_delete` — `confirm=false` returns preview; `confirm=true` calls `store.deleteFile()`
  - `workspace_reset` — `confirm=false` returns preview with file count; `confirm=true` calls `store.reset()`
  - `workspace_download_url` — calls `store.getDownloadUrl(userId, path)`, returns URL
- **systemPromptSection()**: returns workspace instructions string
- All tools wrap errors in `{ isError: true }` responses

## Key Types

```ts
// PluginContext — what createTools receives
interface PluginContext {
  user: UserIdentity;
  storage: { memory: MemoryStore; workspace: WorkspaceStore };
  config: Record<string, unknown>;
  logger: Logger;
}

// AgentTool execute() return type
{ content: [{ type: "text", text: string }], isError?: boolean }

// MemoryStore
interface MemoryStore {
  getMemories(userId: string): Promise<UserMemory>;
  addEntry(userId: string, text: string): Promise<MemoryEntry>;
  removeEntry(userId: string, entryId: string): Promise<boolean>;
  clearMemories(userId: string): Promise<void>;
}

// WorkspaceStore
interface WorkspaceStore {
  getManifest(userId: string): Promise<WorkspaceManifest>;
  readFile(userId: string, path: string): Promise<string>;
  writeFile(userId: string, path: string, content: string, description?: string): Promise<WorkspaceFile>;
  deleteFile(userId: string, path: string): Promise<boolean>;
  reset(userId: string): Promise<void>;
  getDownloadUrl(userId: string, path: string): Promise<string>;
}
```

## Test Files to Create

- `packages/agent/tests/plugins/memory.test.ts`
- `packages/agent/tests/plugins/workspace.test.ts`

## Test Cases — Memory Plugin

1. `memoryPlugin()` returns plugin with name `"memory"`
2. `createTools()` returns 3 tools
3. `memory_save` — calls `store.addEntry()` with userId and text, returns success message
4. `memory_save` — returns `isError: true` when store throws
5. `memory_list` — returns formatted list when entries exist
6. `memory_list` — returns "No memories saved" when empty
7. `memory_list` — returns `isError: true` when store throws
8. `memory_remove` — calls `store.removeEntry()`, returns success
9. `memory_remove` — returns `isError: true` when entry not found (removeEntry returns false)
10. `systemPromptSection()` — returns non-empty string containing "memory"

## Test Cases — Workspace Plugin

1. `workspacePlugin()` returns plugin with name `"workspace"`
2. `createTools()` returns 6 tools
3. `workspace_list` — returns JSON manifest
4. `workspace_read` — returns file content
5. `workspace_write` (confirm=false) — returns preview with path and size, does NOT call store
6. `workspace_write` (confirm=true) — calls `store.writeFile()`, returns success
7. `workspace_delete` (confirm=false) — returns preview, does NOT call store
8. `workspace_delete` (confirm=true) — calls `store.deleteFile()`, returns success
9. `workspace_delete` (confirm=true) — returns `isError: true` when file not found
10. `workspace_reset` (confirm=false) — returns preview with file count
11. `workspace_reset` (confirm=true) — calls `store.reset()`
12. `workspace_download_url` — returns URL from store
13. All tools return `isError: true` on exception
14. `systemPromptSection()` — returns non-empty string containing "workspace"

## Mock Strategy

Create mock `PluginContext` with `vi.fn()` mocks for all store methods. Execute each tool by finding it by name in the returned array and calling `tool.execute(args)`.

## Verification

1. `npm test --workspace=packages/agent` — new tests pass
2. `npm test` — all tests pass
