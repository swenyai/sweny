---
title: Built-in Plugins
description: Memory, workspace, and HTTP plugins included with the SWEny agent.
---

The agent ships with two built-in plugins and one example plugin. Add them to your config:

```typescript
import { memoryPlugin, workspacePlugin } from "@sweny-ai/agent";

export default defineConfig({
  // ...
  plugins: [memoryPlugin(), workspacePlugin()],
});
```

## memoryPlugin()

Persistent cross-session memory. The agent can save, list, and remove notes that survive across conversations.

### Tools

| Tool | Parameters | Description |
|------|-----------|-------------|
| `memory_save` | `text: string` | Save a note that persists across sessions |
| `memory_list` | (none) | List all saved memory entries with IDs and timestamps |
| `memory_remove` | `entryId: string` | Remove a memory entry by ID |

### System prompt

```
## Memory
You have access to persistent memory tools. Use `memory_save` to remember important context,
preferences, or frequently-used information across sessions.
Use `memory_list` to recall saved notes and `memory_remove` to clean up stale entries.
```

## workspacePlugin()

Per-user file storage. The agent can create, read, and manage files in an isolated workspace. Destructive operations (write, delete, reset) require `confirm=true` to execute — without it, the tool returns a preview of what would happen.

### Tools

| Tool | Parameters | Description |
|------|-----------|-------------|
| `workspace_list` | (none) | List all files with paths, sizes, and descriptions |
| `workspace_read` | `path: string` | Read a file's content |
| `workspace_write` | `path, content, description?, confirm` | Write a file (preview unless `confirm=true`) |
| `workspace_delete` | `path, confirm` | Delete a file (preview unless `confirm=true`) |
| `workspace_reset` | `confirm` | Clear entire workspace (preview unless `confirm=true`) |
| `workspace_download_url` | `path: string` | Get a pre-signed download URL (valid 1 hour) |

### Confirm pattern

The write, delete, and reset tools use a two-step confirmation pattern. When `confirm` is `false` (the default), the tool returns a preview showing what would happen. The agent then calls the same tool with `confirm=true` to execute.

This gives the model a chance to verify the operation before committing, and produces a natural conversational flow where the user sees what's about to happen.

### System prompt

```
## Workspace
You have a per-user file workspace. Use workspace tools to save investigation results,
generated reports, code snippets, or any artifacts the user might want to download or reference later.
Always use confirm=true for write/delete/reset operations after previewing.
```

## httpPlugin() (example)

An example plugin demonstrating host allowlisting. Not included by default — copy it from the examples directory or write your own.

```typescript
import { httpPlugin } from "./examples/http-plugin/index.js";

export default defineConfig({
  // ...
  plugins: [
    memoryPlugin(),
    workspacePlugin(),
    httpPlugin({ allowedHosts: ["api.example.com", "api.internal.corp"] }),
  ],
});
```

### Tools

| Tool | Parameters | Description |
|------|-----------|-------------|
| `http_request` | `method, url, headers?, body?` | Make an HTTP request with optional host filtering |

### Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `allowedHosts` | `string[]` | `[]` (all allowed) | Hostnames the tool is permitted to reach |

When `allowedHosts` is set, requests to unlisted hosts return an error. When empty or omitted, all hosts are allowed. See [Plugin System](/agent/plugins/) for the full source code.
