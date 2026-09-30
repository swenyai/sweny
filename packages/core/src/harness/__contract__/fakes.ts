/**
 * Fake harness kit for the contract suite (#413).
 *
 * A fake is a scripted stand-in for the agent behind an adapter. It plays the
 * neutral steps from scenarios.ts, and records what the adapter handed it (env,
 * prompt, MCP servers, tool policy, limits) in a neutral {@link FakeCapture}
 * that the suite asserts on. No fake calls a model.
 *
 * A new adapter ships one `HarnessFakes` next to its `make` function:
 * - Claude Code: {@link createClaudeSdkFake} (the SDK `query` is replaced).
 * - Codex, pi, Hermes, Gemini: a scripted process (`codexPathOverride` or a PATH shim).
 * - ACP: a fake agent built on the ACP SDK.
 */

import { vi } from "vitest";
import type { ToolClass } from "../types.js";
import type { FakeScript, FakeStep } from "./scenarios.js";

/** A user-level MCP server the fake "has configured". It must never reach a run that asked for exclusive MCP. */
export const AMBIENT_MCP_CANARY = "ambient-user-mcp-canary";

/** What the fake agent saw on its most recent invocation. */
export interface FakeCapture {
  /** Invocations since the last `reset()`. */
  invocations: number;
  /** The prompt the agent received. */
  prompt: string;
  /** The environment the agent process would start with. */
  env: Record<string, string>;
  /** MCP servers the agent would load: injected ones plus any ambient config it was not told to ignore. */
  mcpServersLoaded: string[];
  /** Built-in tool names denied by name (native names). */
  nativeDisallowed: string[];
  /** Whether the agent would still have any built-in tool of this class. */
  allows(toolClass: ToolClass): boolean;
  /** All built-in tools disabled (classification calls). */
  builtinToolsDisabled: boolean;
  maxTurns?: number;
  model?: string;
  /** The JSON schema the harness asked the agent to enforce natively. */
  structuredSchema?: unknown;
  /** A native sandbox was requested. */
  sandboxed: boolean;
  /** The harness gave the agent a way to be cancelled (signal, rpc or kill handle). */
  cancelWired: boolean;
  /** The agent process was stopped or interrupted by the time the call returned. */
  stopped: boolean;
}

export interface HarnessFakes {
  /** Clear scripted state and captures. Safe to call between invocations. */
  reset(): void | Promise<void>;
  /** What the fake agent does on its next invocation. */
  script(steps: FakeScript): void;
  /** What the fake saw on its last invocation. */
  captured(): FakeCapture;
  /** Scratch dirs, config files or sockets the harness left behind. */
  leftovers(): string[];
  /** Tear down after a case (unmock, remove scratch). */
  dispose(): void | Promise<void>;
}

// ─── Claude Code: the SDK `query` is the fake ────────────────────

/** Built-in Claude Code tool names per portable class. */
const CLAUDE_TOOLS_BY_CLASS: Record<ToolClass, string[]> = {
  shell: ["Bash"],
  write: ["Write", "NotebookEdit"],
  edit: ["Edit", "MultiEdit"],
  // WebSearch is deliberately left available in dry runs; only fetch is net-write-capable.
  net: ["WebFetch"],
  subagent: ["Task", "Agent"],
};

function emptyCapture(): FakeCapture {
  return {
    invocations: 0,
    prompt: "",
    env: {},
    mcpServersLoaded: [],
    nativeDisallowed: [],
    allows: () => true,
    builtinToolsDisabled: false,
    sandboxed: false,
    cancelWired: false,
    stopped: false,
  };
}

function toSdkMessage(step: FakeStep): Record<string, unknown> | undefined {
  switch (step.kind) {
    case "tool-call":
      return {
        type: "assistant",
        message: { content: [{ type: "tool_use", id: step.id, name: step.name, input: step.input }] },
      };
    case "tool-result":
      return {
        type: "user",
        message: {
          content: [
            { type: "tool_result", tool_use_id: step.id, is_error: step.isError === true, content: step.content },
          ],
        },
      };
    case "final": {
      const u = step.usage;
      const tokenUsage = {
        ...(u?.inputTokens !== undefined ? { input_tokens: u.inputTokens } : {}),
        ...(u?.outputTokens !== undefined ? { output_tokens: u.outputTokens } : {}),
        ...(u?.cacheReadTokens !== undefined ? { cache_read_input_tokens: u.cacheReadTokens } : {}),
        ...(u?.cacheCreationTokens !== undefined ? { cache_creation_input_tokens: u.cacheCreationTokens } : {}),
      };
      const accounting = {
        ...(u?.costUsd !== undefined ? { total_cost_usd: u.costUsd } : {}),
        ...(u?.numTurns !== undefined ? { num_turns: u.numTurns } : {}),
        ...(Object.keys(tokenUsage).length > 0 ? { usage: tokenUsage } : {}),
      };
      if (step.ok === false) {
        return { type: "result", subtype: "error_during_execution", errors: [step.text], ...accounting };
      }
      return {
        type: "result",
        subtype: "success",
        result: step.text,
        ...(step.structured !== undefined ? { structured_output: step.structured } : {}),
        ...accounting,
      };
    }
    default:
      return undefined;
  }
}

export interface ClaudeSdkFake extends HarnessFakes {
  /** The mocked `query`, for assertions the neutral capture does not cover. */
  readonly query: ReturnType<typeof vi.fn>;
}

/**
 * Replace `@anthropic-ai/claude-agent-sdk` with a scripted fake. Call `reset()`
 * before the adapter module is imported, and `dispose()` after each case.
 */
export function createClaudeSdkFake(): ClaudeSdkFake {
  let steps: FakeScript = [];
  let capture: FakeCapture = emptyCapture();

  const query = vi.fn((args: { prompt: string; options: Record<string, any> }) => {
    const o = args.options ?? {};
    const disallowed: string[] = Array.isArray(o.disallowedTools) ? o.disallowedTools : [];
    const builtinToolsDisabled = Array.isArray(o.tools) && o.tools.length === 0;
    const loaded = Object.keys(o.mcpServers ?? {});
    // Without strictMcpConfig the SDK also loads the user's own MCP config.
    if (o.strictMcpConfig !== true) loaded.push(AMBIENT_MCP_CANARY);

    capture = {
      invocations: capture.invocations + 1,
      prompt: args.prompt,
      env: { ...(o.env ?? {}) },
      mcpServersLoaded: loaded,
      nativeDisallowed: [...disallowed],
      builtinToolsDisabled,
      allows: (c: ToolClass) =>
        !builtinToolsDisabled && CLAUDE_TOOLS_BY_CLASS[c].some((name) => !disallowed.includes(name)),
      maxTurns: o.maxTurns,
      model: o.model,
      structuredSchema: o.outputFormat?.schema,
      sandboxed: o.sandbox !== undefined,
      cancelWired: o.abortController instanceof AbortController,
      stopped: false,
    };
    const mine = capture;
    const signal: AbortSignal | undefined = o.abortController?.signal;

    const stream = {
      async *[Symbol.asyncIterator]() {
        for (const step of steps) {
          if (step.kind === "stderr") {
            o.stderr?.(step.text);
          } else if (step.kind === "crash") {
            throw new Error(step.message);
          } else if (step.kind === "exit") {
            throw new Error(`Claude Code process exited with code ${step.code}`);
          } else if (step.kind === "hang") {
            await new Promise<never>((_, reject) => {
              if (signal?.aborted) return reject(new Error("aborted"));
              signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
            });
          } else {
            const msg = toSdkMessage(step);
            if (msg) yield msg;
          }
        }
      },
      interrupt: async () => {
        mine.stopped = true;
      },
    };
    return stream;
  });

  const register = () => {
    vi.doMock("@anthropic-ai/claude-agent-sdk", () => ({
      query,
      createSdkMcpServer: vi.fn().mockReturnValue({ type: "sdk", name: "sweny-core" }),
      tool: vi.fn(),
    }));
  };

  return {
    query,
    reset() {
      steps = [];
      capture = emptyCapture();
      query.mockClear();
      register();
    },
    script(next) {
      steps = next;
    },
    captured: () => capture,
    // The SDK fake spawns no process and writes no files.
    leftovers: () => [],
    dispose() {
      vi.doUnmock("@anthropic-ai/claude-agent-sdk");
      vi.resetModules();
    },
  };
}
