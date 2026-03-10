# Task: Add `onEvent` streaming to coding agent providers

**Repo:** `/Users/nate/src/swenyai/sweny`
**Package:** `packages/providers` → `@sweny-ai/providers`
**Changeset bump:** `minor` (new additive option, no breaking changes)

## Context

The `CodingAgent` interface currently has:

```ts
interface CodingAgent {
  install(): Promise<void>;
  run(opts: CodingAgentRunOptions): Promise<number>;
}

interface CodingAgentRunOptions {
  prompt: string;
  maxTurns: number;
  env?: Record<string, string>;
}
```

`run()` returns only an exit code. The cloud worker (`swenyai/cloud`) cannot see what
the agent is doing in real time — no tool calls, no text output, nothing until the job
finishes. This task adds an optional `onEvent` callback to each provider's *constructor
config* (not to `CodingAgentRunOptions`) so callers can receive streaming events without
changing the `CodingAgent` interface contract.

The cloud worker will use this to push real-time progress events to Redis (in a separate task).

## What to build

### 1. Define `AgentEvent` type in `packages/providers/src/coding-agent/types.ts`

Add after the existing interfaces:

```ts
/** A real-time event emitted by a coding agent provider during run(). */
export type AgentEvent =
  | { type: "text"; text: string }
  | { type: "tool_call"; tool: string; input: unknown }
  | { type: "tool_result"; tool: string; success: boolean; output: string }
  | { type: "thinking"; text: string }
  | { type: "error"; message: string };

/** Callback signature for receiving agent events. */
export type AgentEventHandler = (event: AgentEvent) => void | Promise<void>;
```

Do NOT change `CodingAgent` or `CodingAgentRunOptions`. The `onEvent` is a provider
config option, not part of the interface.

### 2. Update `packages/providers/src/coding-agent/claude-code.ts`

Add `onEvent?: AgentEventHandler` to `ClaudeCodeConfig`.

Claude Code CLI supports `--output-format stream-json` which writes NDJSON to stdout.
Each line is one of:

```jsonc
// assistant text or tool_use content block
{"type":"assistant","message":{"content":[{"type":"text","text":"..."}]}}
{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"ls"}}]}}
// tool result
{"type":"tool","tool_use_id":"...","content":[{"type":"text","text":"exit 0\n..."}]}
// thinking (extended thinking mode)
{"type":"assistant","message":{"content":[{"type":"thinking","thinking":"..."}]}}
```

When `onEvent` is provided:
1. Add `"--output-format", "stream-json"` to the args
2. Capture stdout line-by-line (use `child.stdout` via `stdio: ["ignore", "pipe", "pipe"]`)
3. For each line, try `JSON.parse()` — skip lines that aren't valid JSON
4. Map parsed events to `AgentEvent` and call `onEvent`:
   - `assistant` message with `type: "text"` content → emit `{ type: "text", text }`
   - `assistant` message with `type: "tool_use"` content → emit `{ type: "tool_call", tool: name, input }`
   - `assistant` message with `type: "thinking"` content → emit `{ type: "thinking", text: thinking }`
   - `tool` type line → emit `{ type: "tool_result", tool: tool_use_id, success: true, output: content text }`
5. Fire all `onEvent` calls with `await` (swallow errors — never let event handling crash the agent)
6. When `onEvent` is NOT provided, behaviour is unchanged (no `--output-format` flag, stdio: "inherit")

Update `execCommand` call: when `onEvent` is set, use `quiet: true` and handle stdout manually
via the `spawn` child process directly (don't go through `execCommand` for stdout capture —
handle it inline in `claude-code.ts`).

The implementation pattern (handle stdout yourself when onEvent is set):

```ts
async run(opts: CodingAgentRunOptions): Promise<number> {
  const args = ["-p", opts.prompt, "--allowedTools", "*", "--dangerously-skip-permissions",
                "--max-turns", String(opts.maxTurns), ...extraFlags];

  if (onEvent) {
    args.push("--output-format", "stream-json");
    // spawn manually, capture stdout
    return new Promise((resolve, reject) => {
      const child = spawn("claude", args, {
        env: { ...process.env, ...opts.env } as NodeJS.ProcessEnv,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let buf = "";
      child.stdout?.on("data", (chunk: Buffer) => {
        buf += chunk.toString();
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const evt = JSON.parse(line);
            const mapped = mapClaudeEvent(evt);
            if (mapped) Promise.resolve(onEvent(mapped)).catch(() => {});
          } catch { /* skip malformed lines */ }
        }
      });
      child.on("error", reject);
      child.on("close", (code) => resolve(code ?? 0));
    });
  }

  // No onEvent — use shared execCommand (stdio: inherit)
  return execCommand("claude", args, {
    env: { ...process.env, ...opts.env } as Record<string, string>,
    ignoreReturnCode: true,
    quiet,
    onStderr: quiet ? (line) => log.debug(line) : undefined,
  });
}
```

Write a `mapClaudeEvent(raw: unknown): AgentEvent | null` helper function.

### 3. Update `packages/providers/src/coding-agent/google-gemini.ts`

Add `onEvent?: AgentEventHandler` to `GoogleGeminiConfig`.

Gemini CLI does not have structured JSONL output. When `onEvent` is provided:
- Capture stdout line-by-line
- Emit each non-empty line as `{ type: "text", text: line }`
- Use the same spawn-manually pattern as Claude when `onEvent` is set

### 4. Update `packages/providers/src/coding-agent/openai-codex.ts`

Same as Gemini — add `onEvent?: AgentEventHandler`, emit text lines from stdout.

### 5. Update `packages/providers/src/coding-agent/mock.ts`

Add `onEvent?: AgentEventHandler` to `MockCodingAgentConfig`.
When provided, emit a single `{ type: "text", text: "mock agent run" }` event in `run()`.

### 6. Update `packages/providers/src/coding-agent/index.ts`

Export the new types:
```ts
export type { AgentEvent, AgentEventHandler } from "./types.js";
```

### 7. Create changeset

Create `.changeset/coding-agent-events.md`:

```md
---
"@sweny-ai/providers": minor
---

Add optional `onEvent` streaming callback to coding agent provider configs.

- `ClaudeCodeConfig`, `GoogleGeminiConfig`, `OpenAICodexConfig`, `MockCodingAgentConfig`
  all accept `onEvent?: AgentEventHandler`
- Claude provider uses `--output-format stream-json` for structured events (tool calls,
  tool results, text deltas, thinking blocks)
- Gemini and Codex providers emit text lines as `{ type: "text" }` events
- New `AgentEvent` and `AgentEventHandler` types exported from `@sweny-ai/providers/coding-agent`
- No breaking changes — `onEvent` is optional; omitting it preserves existing behaviour exactly
```

## Files to modify

| File | Change |
|------|--------|
| `packages/providers/src/coding-agent/types.ts` | Add `AgentEvent`, `AgentEventHandler` |
| `packages/providers/src/coding-agent/claude-code.ts` | Add `onEvent` config, stream-json parsing |
| `packages/providers/src/coding-agent/google-gemini.ts` | Add `onEvent` config, text line emit |
| `packages/providers/src/coding-agent/openai-codex.ts` | Add `onEvent` config, text line emit |
| `packages/providers/src/coding-agent/mock.ts` | Add `onEvent` config |
| `packages/providers/src/coding-agent/index.ts` | Export new types |
| `.changeset/coding-agent-events.md` | Create changeset |

## Validation

Run from the repo root:
```bash
npm run typecheck --workspace=packages/providers
npm test --workspace=packages/providers
npm run build --workspace=packages/providers
```

All must pass. No new test files required — existing tests should still pass since
`onEvent` is optional everywhere.

## Commit message

```
feat(providers): add onEvent streaming to coding agent providers

Claude uses --output-format stream-json for structured tool_call/tool_result/text/thinking
events. Gemini and Codex emit text lines. Mock emits a stub text event.
No breaking changes — onEvent is optional on all provider configs.
```

Include a changeset file in the commit.
