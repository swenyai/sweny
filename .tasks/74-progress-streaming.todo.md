# Add progress streaming to sweny_run_workflow

**Package:** `packages/mcp`
**Depends on:** Task 73 (publish)

## Goal

When `sweny_run_workflow` runs, pipe real-time progress from the CLI's `--stream` NDJSON output as MCP logging messages so the user sees which workflow node is executing instead of waiting in silence for 5+ minutes.

## Background

### CLI `--stream` flag

The `sweny` CLI supports `--stream` which writes NDJSON `ExecutionEvent` objects to stdout alongside the `--json` output. The event types are:

```ts
type ExecutionEvent =
  | { type: "workflow:start"; workflow: string }
  | { type: "node:enter"; node: string; instruction: string }
  | { type: "tool:call"; node: string; tool: string; input: unknown }
  | { type: "tool:result"; node: string; tool: string; output: unknown }
  | { type: "node:exit"; node: string; result: NodeResult }
  | { type: "node:progress"; node: string; message: string }
  | { type: "route"; from: string; to: string; reason: string }
  | { type: "workflow:end"; results: Record<string, NodeResult> };
```

When `--stream` and `--json` are both passed, each line of stdout is either an NDJSON event or the final JSON result (the last line).

### MCP logging API

The MCP SDK `McpServer` has:
```ts
server.sendLoggingMessage({
  level: "info",  // "debug" | "info" | "warning" | "error"
  data: "message string or object",
  logger: "sweny",  // optional logger name
});
```

Claude Code displays these as progress updates during long-running tool calls.

## What to change

### 1. `packages/mcp/src/handlers/run-workflow.ts`

Update the `runWorkflow` function to:

1. Add `--stream` to the CLI args (alongside `--json`)
2. Accept an optional `onProgress` callback
3. Parse each stdout line as NDJSON — if it parses and has a `type` field, it's a stream event. The final `workflow:end` event or non-NDJSON JSON blob is the result.
4. Call `onProgress` with human-readable messages for key events:
   - `node:enter` → `"Starting node: {node}"`
   - `node:exit` → `"Completed node: {node} ({status})"`
   - `tool:call` → `"Calling tool: {tool}"`
   - `node:progress` → `"{message}"`

Change the stdout handling from simple concatenation to line-by-line parsing:

```ts
let lastJsonLine = "";
let lines = "";

child.stdout.on("data", (chunk: Buffer) => {
  lines += chunk.toString();
  // Process complete lines
  const parts = lines.split("\n");
  lines = parts.pop()!; // keep incomplete last line
  for (const line of parts) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (event.type) {
        // Stream event — emit progress
        onProgress?.(event);
      }
      lastJsonLine = line; // always keep last valid JSON
    } catch {
      // Not JSON — append to output
      lastJsonLine = line;
    }
  }
});
```

On close, use `lastJsonLine` as the output (the final `--json` result).

### 2. `packages/mcp/src/tools.ts`

Update the `sweny_run_workflow` tool handler to pass the `server` reference and send logging messages:

```ts
async ({ workflow, input, cwd, dryRun }) => {
  const result = await runWorkflow({
    workflow, input, cwd, dryRun,
    onProgress: (event) => {
      let message: string;
      switch (event.type) {
        case "node:enter":
          message = `Starting: ${event.node}`;
          break;
        case "node:exit":
          message = `Done: ${event.node} (${event.result.status})`;
          break;
        case "node:progress":
          message = event.message;
          break;
        default:
          return; // skip tool:call, tool:result, etc.
      }
      server.sendLoggingMessage({ level: "info", data: message, logger: "sweny" });
    },
  });
  // ... return result
}
```

The `server` reference is already available in `registerTools(server)`.

### 3. Update `RunWorkflowInput` interface

Add optional `onProgress` callback:
```ts
export interface RunWorkflowInput {
  // ... existing fields
  onProgress?: (event: Record<string, unknown>) => void;
}
```

## Verification

```bash
cd packages/mcp
npm run typecheck
npm test
```

The existing tests should still pass — the `onProgress` callback is optional and the mock spawn tests don't use `--stream`.

Add a new test that verifies:
- `--stream` is added to CLI args
- NDJSON lines are parsed and `onProgress` is called
- The final JSON result is returned correctly even with interleaved stream events

## Acceptance criteria

- [ ] `--stream` flag added to CLI args
- [ ] NDJSON events parsed line-by-line from stdout
- [ ] `node:enter`, `node:exit`, `node:progress` sent as MCP logging messages
- [ ] Final JSON result still returned correctly
- [ ] Existing tests pass, new streaming test added
- [ ] Typecheck passes
