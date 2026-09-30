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

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { vi } from "vitest";
import type { ToolClass } from "../types.js";
import type { FakeScript, FakeStep, FakeUsage } from "./scenarios.js";

/** Socket paths named by `--socket <path>` in any stdio MCP server config (the tool bridge). */
export function bridgeSocketsIn(servers: Record<string, { args?: unknown }> | undefined): string[] {
  const out: string[] = [];
  for (const s of Object.values(servers ?? {})) {
    const args = Array.isArray(s?.args) ? (s.args as unknown[]) : [];
    const i = args.indexOf("--socket");
    if (i !== -1 && typeof args[i + 1] === "string") out.push(args[i + 1] as string);
  }
  return out;
}

/** The subset of `paths` still on disk. */
export function stillOnDisk(paths: Iterable<string>): string[] {
  return [...new Set(paths)].filter((p) => fs.existsSync(p));
}

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
  /**
   * The wire format has a structured-output channel separate from the final
   * text (Claude's `structured_output`). Codex has none: with a schema, the
   * final message is the JSON. Default true.
   */
  structuredChannel?: boolean;
  /** Usage fields the wire format can carry. Default: every field. Others must stay absent. */
  usageFields?: (keyof FakeUsage)[];
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
  /** Tool bridge socket directories handed to the SDK since the last reset. */
  const bridgeDirs = new Set<string>();

  const query = vi.fn((args: { prompt: string; options: Record<string, any> }) => {
    const o = args.options ?? {};
    for (const s of bridgeSocketsIn(o.mcpServers)) bridgeDirs.add(path.dirname(s));
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
      bridgeDirs.clear();
      query.mockClear();
      register();
    },
    script(next) {
      steps = next;
    },
    captured: () => capture,
    // The SDK fake spawns no process and writes no files; the tool bridge's socket directory must be gone.
    leftovers: () => stillOnDisk(bridgeDirs),
    dispose() {
      vi.doUnmock("@anthropic-ai/claude-agent-sdk");
      vi.resetModules();
    },
  };
}

// ─── Codex: a scripted `codex` process ───────────────────────────

/** What the Codex fake process recorded (harness/fakes/codex-fake.mjs). */
export interface CodexFakeCapture {
  pid: number;
  args: string[];
  env: Record<string, string>;
  prompt: string;
  /** Every `-c key=value` override, parsed into a nested object. */
  config: Record<string, any>;
  sandbox?: string;
  model?: string;
  cd?: string;
  flags: string[];
  outputSchemaPath?: string;
  outputSchema?: unknown;
  mcpServersLoaded: string[];
  /** With `callMcp`: tool names each MCP server listed. */
  mcpTools?: Record<string, string[]>;
}

export interface CodexProcessFake extends HarnessFakes {
  /** Command that runs the fake in place of `codex` (the adapter's `codexCommand`). */
  readonly command: { command: string; args: string[] };
  /** The fake's user-level CODEX_HOME, whose config.toml declares {@link AMBIENT_MCP_CANARY}. */
  readonly ambientHome: string;
  /** Every raw capture since the last reset, oldest first. */
  raw(): CodexFakeCapture[];
  /** Script with options: `callMcp` makes the fake call the configured MCP servers for real. */
  scriptWith(steps: FakeScript, opts: { callMcp?: boolean }): void;
  /** Script only the n-th invocation since the last reset (1-based). */
  scriptFor(invocation: number, steps: FakeScript): void;
  /** Make `codex --version` report this version. */
  setVersion(version: string): void;
  /** Remove the fake's scratch directory (after all cases). */
  destroy(): void;
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * A scripted `codex` CLI for the contract suite: a node script the adapter
 * spawns through its `codexCommand` seam. The fake reads its script and writes
 * what it received to a scratch directory; this kit turns that into the
 * neutral {@link FakeCapture}.
 */
export function createCodexProcessFake(): CodexProcessFake {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sweny-codex-fake-"));
  const ambientHome = path.join(dir, "ambient-codex-home");
  fs.mkdirSync(ambientHome);
  fs.writeFileSync(
    path.join(ambientHome, "config.toml"),
    `[mcp_servers.${AMBIENT_MCP_CANARY}]\ncommand = "ambient-server"\n`,
  );
  const fakePath = fileURLToPath(new URL("../fakes/codex-fake.mjs", import.meta.url));
  const command = { command: process.execPath, args: [fakePath, "--fake-dir", dir] };

  const captureFiles = () =>
    fs
      .readdirSync(dir)
      .filter((f) => /^capture-\d+\.json$/.test(f))
      .sort((a, b) => parseInt(a.slice(8), 10) - parseInt(b.slice(8), 10));
  const raw = (): CodexFakeCapture[] =>
    captureFiles().map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as CodexFakeCapture);

  const writeScript = (value: unknown) => fs.writeFileSync(path.join(dir, "script.json"), JSON.stringify(value));

  const toCapture = (c: CodexFakeCapture, invocations: number): FakeCapture => {
    const features = (c.config.features ?? {}) as Record<string, unknown>;
    const writable = c.sandbox !== "read-only";
    const allows = (cls: ToolClass): boolean => {
      switch (cls) {
        case "shell":
          return features.shell_tool !== false;
        case "write":
        case "edit":
          // apply_patch cannot be switched off; only a read-only sandbox stops writes.
          return writable;
        case "net":
          return c.config.web_search !== "disabled";
        default:
          // subagent
          return features.multi_agent !== false && c.config.agents?.enabled !== false;
      }
    };
    const disabled = (["shell", "write", "edit", "net", "subagent"] as ToolClass[]).every((k) => !allows(k));
    return {
      invocations,
      prompt: c.prompt,
      env: c.env,
      mcpServersLoaded: c.mcpServersLoaded,
      nativeDisallowed: [],
      allows,
      builtinToolsDisabled: disabled,
      maxTurns: undefined,
      model: c.model,
      structuredSchema: c.outputSchema,
      sandboxed: c.sandbox === "read-only" || c.sandbox === "workspace-write",
      // A process harness is always cancellable by kill; cases 8, 9 and 14 prove the process is gone.
      cancelWired: true,
      stopped: !pidAlive(c.pid),
    };
  };

  return {
    command,
    ambientHome,
    structuredChannel: false,
    usageFields: ["inputTokens", "outputTokens", "cacheReadTokens", "cacheCreationTokens"],
    reset() {
      for (const f of fs.readdirSync(dir)) {
        if (/^(capture|script)-\d+\.json$/.test(f)) fs.rmSync(path.join(dir, f), { force: true });
      }
      fs.rmSync(path.join(dir, "version"), { force: true });
      writeScript([]);
      // The user's own Codex home has an MCP server configured; it must never load.
      vi.stubEnv("CODEX_HOME", ambientHome);
    },
    script(steps) {
      writeScript(steps);
    },
    scriptWith(steps, opts) {
      writeScript({ steps, callMcp: opts.callMcp === true });
    },
    scriptFor(invocation, steps) {
      fs.writeFileSync(path.join(dir, `script-${invocation}.json`), JSON.stringify(steps));
    },
    setVersion(version) {
      fs.writeFileSync(path.join(dir, "version"), version);
    },
    captured() {
      const all = raw();
      const last = all.at(-1);
      // No process ran (an abort landed before spawn): nothing is left running.
      if (!last) return { ...emptyCapture(), stopped: true, cancelWired: true };
      return toCapture(last, all.length);
    },
    raw,
    leftovers() {
      const paths: string[] = [];
      for (const c of raw()) {
        if (c.outputSchemaPath) paths.push(path.dirname(c.outputSchemaPath));
        const servers = (c.config.mcp_servers ?? {}) as Record<string, { args?: unknown }>;
        for (const s of bridgeSocketsIn(servers)) paths.push(path.dirname(s));
      }
      const live = raw()
        .filter((c) => pidAlive(c.pid))
        .map((c) => `pid ${c.pid} still running`);
      return [...stillOnDisk(paths), ...live];
    },
    dispose() {
      for (const c of raw()) {
        if (pidAlive(c.pid)) {
          try {
            process.kill(c.pid, "SIGKILL");
          } catch {
            // gone
          }
        }
      }
    },
    destroy() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

// ─── pi: a scripted `pi --mode rpc` process ──────────────────────

/** What the pi fake process recorded (harness/fakes/pi-fake.mjs). */
export interface PiFakeCapture {
  pid: number;
  args: string[];
  env: Record<string, string>;
  cwd: string;
  /** The `message` of the `prompt` RPC command. */
  prompt: string;
  flags: string[];
  model?: string;
  systemPrompt?: string;
  extensions: string[];
  toolsAllow?: string[];
  toolsExclude: string[];
  /** Tools pi would declare to the model: `--tools` allowlist, else defaults minus exclusions. */
  activeTools: string[];
  agentDir: string;
  /** Files in pi's agent dir when it started (the adapter's generated `mcp.json`, `models.json`). */
  agentDirFiles: string[];
  mcpServersLoaded: string[];
  mcpConfig: Record<string, { args?: unknown }>;
  /** With `callMcp`: pi-registered tool names each MCP server listed. */
  mcpTools?: Record<string, string[]>;
  mcpExtensionLoaded: boolean;
  otherExtensionsLoaded: boolean;
}

export interface PiProcessFake extends HarnessFakes {
  /** Command that runs the fake in place of `pi` (the adapter's `piCommand`). */
  readonly command: { command: string; args: string[] };
  /** The fake's HOME: `~/.pi/agent/mcp.json` declares {@link AMBIENT_MCP_CANARY}. */
  readonly ambientHome: string;
  /** A project directory whose `.pi/mcp.json` declares a server; use it as the adapter's `cwd`. */
  readonly projectDir: string;
  /** Every raw capture since the last reset, oldest first. */
  raw(): PiFakeCapture[];
  /** Script with options: `callMcp` calls the configured MCP servers for real; `ignoreAbort` never stops on `abort`. */
  scriptWith(steps: FakeScript, opts: { callMcp?: boolean; ignoreAbort?: boolean; disposition?: string }): void;
  /** Script only the n-th invocation since the last reset (1-based). */
  scriptFor(invocation: number, steps: FakeScript): void;
  /** Make `pi --version` report this version. */
  setVersion(version: string): void;
  /** Remove the fake's scratch directory (after all cases). */
  destroy(): void;
}

/**
 * A scripted `pi` CLI for the contract suite: a node script the adapter spawns
 * through its `piCommand` seam. The fake reads its script and writes what it
 * received to a scratch directory; this kit turns that into the neutral
 * {@link FakeCapture}.
 */
export function createPiProcessFake(): PiProcessFake {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sweny-pi-fake-"));
  const ambientHome = path.join(dir, "ambient-home");
  fs.mkdirSync(path.join(ambientHome, ".pi", "agent"), { recursive: true });
  // The operator's own pi setup has an MCP server configured; it must never load.
  fs.writeFileSync(
    path.join(ambientHome, ".pi", "agent", "mcp.json"),
    JSON.stringify({ mcpServers: { [AMBIENT_MCP_CANARY]: { command: "ambient-server" } } }),
  );
  const projectDir = path.join(dir, "project");
  fs.mkdirSync(path.join(projectDir, ".pi"), { recursive: true });
  // A project server only loads for a trusted project; the adapter passes --no-approve.
  fs.writeFileSync(
    path.join(projectDir, ".pi", "mcp.json"),
    JSON.stringify({ mcpServers: { "project-mcp-canary": { command: "project-server" } } }),
  );
  const fakePath = fileURLToPath(new URL("../fakes/pi-fake.mjs", import.meta.url));
  const command = { command: process.execPath, args: [fakePath, "--fake-dir", dir] };

  const captureFiles = () =>
    fs
      .readdirSync(dir)
      .filter((f) => /^capture-\d+\.json$/.test(f))
      .sort((a, b) => parseInt(a.slice(8), 10) - parseInt(b.slice(8), 10));
  const raw = (): PiFakeCapture[] =>
    captureFiles().map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as PiFakeCapture);

  const writeScript = (value: unknown) => fs.writeFileSync(path.join(dir, "script.json"), JSON.stringify(value));

  const toCapture = (c: PiFakeCapture, invocations: number): FakeCapture => {
    const shell = c.activeTools.some((t) => t === "bash" || t === "powershell");
    const allows = (cls: ToolClass): boolean => {
      switch (cls) {
        case "shell":
          return shell;
        case "write":
          return c.activeTools.includes("write");
        case "edit":
          return c.activeTools.includes("edit");
        case "net":
          // pi has no built-in net tool; the shell can still reach the network.
          return shell;
        default:
          // subagent: pi has no built-in one; only an extension could add it.
          return c.otherExtensionsLoaded;
      }
    };
    const disabled = (["shell", "write", "edit", "net", "subagent"] as ToolClass[]).every((k) => !allows(k));
    return {
      invocations,
      prompt: c.prompt,
      env: c.env,
      mcpServersLoaded: c.mcpServersLoaded,
      nativeDisallowed: [],
      allows,
      builtinToolsDisabled: disabled,
      maxTurns: undefined,
      model: c.model,
      structuredSchema: undefined,
      sandboxed: false,
      // The `abort` RPC command plus kill: cases 8, 9 and 14 prove the process is gone.
      cancelWired: true,
      stopped: !pidAlive(c.pid),
    };
  };

  return {
    command,
    ambientHome,
    projectDir,
    // pi has no output-schema channel: the final message is the JSON.
    structuredChannel: false,
    usageFields: ["costUsd", "inputTokens", "outputTokens", "cacheReadTokens", "cacheCreationTokens"],
    reset() {
      for (const f of fs.readdirSync(dir)) {
        if (/^(capture|script)-\d+\.json$/.test(f)) fs.rmSync(path.join(dir, f), { force: true });
      }
      fs.rmSync(path.join(dir, "version"), { force: true });
      writeScript([]);
      vi.stubEnv("HOME", ambientHome);
    },
    script(steps) {
      writeScript(steps);
    },
    scriptWith(steps, opts) {
      writeScript({ steps, ...opts });
    },
    scriptFor(invocation, steps) {
      fs.writeFileSync(path.join(dir, `script-${invocation}.json`), JSON.stringify(steps));
    },
    setVersion(version) {
      fs.writeFileSync(path.join(dir, "version"), version);
    },
    captured() {
      const all = raw();
      const last = all.at(-1);
      // No process ran (an abort landed before spawn): nothing is left running.
      if (!last) return { ...emptyCapture(), stopped: true, cancelWired: true };
      return toCapture(last, all.length);
    },
    raw,
    leftovers() {
      const paths: string[] = [];
      for (const c of raw()) {
        // pi's scratch agent dir is the adapter's; it must be gone after the run.
        if (c.env.PI_CODING_AGENT_DIR) paths.push(c.env.PI_CODING_AGENT_DIR);
        for (const s of bridgeSocketsIn(c.mcpConfig)) paths.push(path.dirname(s));
      }
      const live = raw()
        .filter((c) => pidAlive(c.pid))
        .map((c) => `pid ${c.pid} still running`);
      return [...stillOnDisk(paths), ...live];
    },
    dispose() {
      for (const c of raw()) {
        if (pidAlive(c.pid)) {
          try {
            process.kill(c.pid, "SIGKILL");
          } catch {
            // gone
          }
        }
      }
    },
    destroy() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
