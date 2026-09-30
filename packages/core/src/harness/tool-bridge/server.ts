/**
 * SwenyToolBridge server (#414): the sweny side of the bridge.
 *
 * Holds a node's skill `Tool[]` in the sweny process and serves them over a
 * per-run unix socket to the stdio MCP shim (`sweny tool-bridge`), so any
 * harness that speaks stdio MCP gets skill tools while the handlers, and the
 * executor's tool:call / tool:result observation, stay in sweny.
 *
 * Security properties (this is an injection boundary):
 * - The socket lives in a fresh `mkdtemp` directory (mode 0700) and is itself
 *   chmod 0600, so other users cannot connect.
 * - With `tcp` (only for agents inside the process sandbox wrapper, #439) the
 *   same handler also listens on 127.0.0.1:<random port>. Other local users
 *   can open that port, so there the token is the only gate; the sandboxed
 *   agent reaches it through srt's proxy only because the adapter allowlists
 *   exactly that host:port for the run.
 * - A random 256-bit token is required on every frame. A wrong or missing
 *   token gets an `unauthorized` error and the connection is dropped.
 * - Only the tools passed in are listed or callable. The executor has already
 *   applied the node's allow/deny filter and the dry-run read-only filter, so
 *   the bridge can never widen what the node sees.
 * - Tool results use the same MCP content and `isError` status as the
 *   in-process path (`callToolAsMcp`).
 * - `close()` removes the socket and its directory; a process `exit` hook
 *   and SIGINT/SIGTERM handlers do the same if the run crashes first.
 * - Nothing here logs the tool list, tool arguments or results.
 */

import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { Logger, McpServerConfig, Tool, ToolContext } from "../../types.js";
import {
  TOKEN_ENV,
  callToolAsMcp,
  createFrameReader,
  encodeFrame,
  parseRequest,
  tokenMatches,
  type BridgeResponse,
  type BridgeToolDescriptor,
} from "./protocol.js";

export interface ToolBridgeOptions {
  /** The node's skill tools, already allow/deny and read-only filtered by core. */
  tools: Tool[];
  /** Context passed to handlers (the executor's tracked handlers ignore it and inject their own). */
  context: ToolContext;
  logger?: Pick<Logger, "debug" | "warn">;
  /**
   * Command that starts the shim. Default: this node binary running the
   * sweny CLI next to this module (`dist/cli/main.js tool-bridge`).
   */
  shimCommand?: { command: string; args: string[] };
  /** Parent directory for the private socket dir. Default: `os.tmpdir()`. */
  tmpDir?: string;
  /**
   * Also serve on a loopback TCP port, and point the shim there (#439). For an
   * agent inside the process sandbox wrapper: srt blocks `socket(AF_UNIX)` on
   * Linux, so the shim cannot reach the unix socket, but it can reach an
   * allowlisted host through srt's egress proxy. The adapter adds
   * {@link ToolBridge.egress} to the node's egress; nothing else is opened.
   */
  tcp?: boolean;
}

export interface ToolBridge {
  /** Absolute path of the unix socket. */
  readonly socketPath: string;
  /** Per-run token. Never log it. */
  readonly token: string;
  /** Loopback TCP endpoint, when started with `tcp: true`. */
  readonly tcp?: { host: string; port: number };
  /** Hosts a sandboxed shim must reach (`127.0.0.1:<port>` with `tcp`, else none). */
  readonly egress: string[];
  /** stdio MCP server config a harness uses to start the shim. The token rides in `env`, not argv. */
  readonly mcpServer: McpServerConfig;
  /** Stop serving, drop connections, remove the socket and its directory. Idempotent. */
  close(): Promise<void>;
}

// ─── Crash cleanup ───────────────────────────────────────────────

/** Directories of bridges that are still open, removed synchronously on exit or signal. */
const liveDirs = new Set<string>();
let hooksInstalled = false;

function removeDirSync(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Best effort: the process is going down.
  }
}

function cleanupAllSync(): void {
  for (const dir of liveDirs) removeDirSync(dir);
  liveDirs.clear();
}

function onSignal(signal: NodeJS.Signals): void {
  cleanupAllSync();
  // Keep default signal semantics: if nobody else handles it, re-raise so the
  // process still dies with the signal.
  process.removeListener("exit", cleanupAllSync);
  process.removeListener("SIGINT", onSignal);
  process.removeListener("SIGTERM", onSignal);
  hooksInstalled = false;
  if (process.listenerCount(signal) === 0) process.kill(process.pid, signal);
}

function installCrashHooks(): void {
  if (hooksInstalled) return;
  hooksInstalled = true;
  // `exit` also fires after an uncaught exception, before the process ends.
  process.on("exit", cleanupAllSync);
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
}

function uninstallCrashHooksIfIdle(): void {
  if (!hooksInstalled || liveDirs.size > 0) return;
  hooksInstalled = false;
  process.removeListener("exit", cleanupAllSync);
  process.removeListener("SIGINT", onSignal);
  process.removeListener("SIGTERM", onSignal);
}

// ─── Server ──────────────────────────────────────────────────────

/** Default shim command: the sweny CLI that ships next to this module. */
export function defaultShimCommand(): { command: string; args: string[] } {
  const cli = fileURLToPath(new URL("../../cli/main.js", import.meta.url));
  return { command: process.execPath, args: [cli, "tool-bridge"] };
}

function describeTool(t: Tool): BridgeToolDescriptor {
  return {
    name: t.name,
    description: t.description,
    inputSchema: { type: "object", ...(t.input_schema as Record<string, unknown>) },
  };
}

/** Start a bridge for one node run. Call `close()` when the run ends. */
export async function startToolBridge(opts: ToolBridgeOptions): Promise<ToolBridge> {
  const { tools, context, logger } = opts;
  const byName = new Map(tools.map((t) => [t.name, t]));
  const descriptors = tools.map(describeTool);

  // mkdtemp creates the directory with mode 0700.
  const dir = fs.mkdtempSync(path.join(opts.tmpDir ?? os.tmpdir(), "sweny-tb-"));
  fs.chmodSync(dir, 0o700);
  const socketPath = path.join(dir, "b.sock");
  const token = randomBytes(32).toString("hex");
  liveDirs.add(dir);
  installCrashHooks();

  const sockets = new Set<net.Socket>();

  const onConnection = (sock: net.Socket) => {
    sockets.add(sock);
    sock.on("close", () => sockets.delete(sock));
    sock.on("error", () => sock.destroy());

    // Set on the first bad token: later frames on this connection, even ones
    // already buffered in the same chunk, are ignored.
    let rejected = false;
    const send = (res: BridgeResponse) => {
      if (!sock.destroyed && sock.writable) sock.write(encodeFrame(res));
    };

    const read = createFrameReader(
      (value) => {
        if (rejected) return;
        const req = parseRequest(value);
        const id = req?.id ?? -1;
        // Token first: an unauthenticated peer learns nothing else.
        if (!tokenMatches(token, (value as { token?: unknown } | undefined)?.token)) {
          logger?.warn("tool bridge: rejected a request with a bad token");
          send({ id, ok: false, error: { code: "unauthorized", message: "unauthorized" } });
          rejected = true;
          sock.end();
          setTimeout(() => sock.destroy(), 1000).unref();
          return;
        }
        if (!req) {
          send({ id, ok: false, error: { code: "bad_request", message: "malformed request" } });
          return;
        }
        if (req.method === "tools/list") {
          send({ id, ok: true, result: { tools: descriptors } });
          return;
        }
        const name = req.params?.name;
        const tool = typeof name === "string" ? byName.get(name) : undefined;
        if (!tool) {
          send({ id, ok: false, error: { code: "unknown_tool", message: `unknown tool: ${String(name)}` } });
          return;
        }
        callToolAsMcp(tool, req.params?.arguments, context).then(
          (result) => send({ id, ok: true, result }),
          () => send({ id, ok: false, error: { code: "internal", message: "tool call failed" } }),
        );
      },
      () => {
        send({ id: -1, ok: false, error: { code: "bad_request", message: "frame too large" } });
        sock.destroy();
      },
    );
    sock.on("data", read);
  };
  const server = net.createServer(onConnection);
  // Same handler and token check; only started for sandboxed agents.
  const tcpServer = opts.tcp ? net.createServer(onConnection) : undefined;
  const listen = (s: net.Server, options: net.ListenOptions) =>
    new Promise<void>((resolve, reject) => {
      s.once("error", reject);
      s.listen(options, () => {
        s.removeListener("error", reject);
        resolve();
      });
    });

  let tcp: { host: string; port: number } | undefined;
  try {
    await listen(server, { path: socketPath });
    fs.chmodSync(socketPath, 0o600);
    if (tcpServer) {
      await listen(tcpServer, { port: 0, host: "127.0.0.1" });
      tcp = { host: "127.0.0.1", port: (tcpServer.address() as net.AddressInfo).port };
    }
  } catch (err) {
    server.close();
    tcpServer?.close();
    liveDirs.delete(dir);
    removeDirSync(dir);
    uninstallCrashHooksIfIdle();
    throw err;
  }
  logger?.debug("tool bridge: listening");

  const shim = opts.shimCommand ?? defaultShimCommand();
  let closed = false;

  return {
    socketPath,
    token,
    tcp,
    egress: tcp ? [`${tcp.host}:${tcp.port}`] : [],
    mcpServer: {
      type: "stdio",
      command: shim.command,
      args: [...shim.args, ...(tcp ? ["--connect", `${tcp.host}:${tcp.port}`] : ["--socket", socketPath])],
      // No update-check nudge in the shim: its stdio belongs to MCP.
      env: { [TOKEN_ENV]: token, SWENY_NO_UPDATE_CHECK: "1" },
    },
    async close() {
      if (closed) return;
      closed = true;
      for (const s of sockets) s.destroy();
      await Promise.all(
        [server, tcpServer].map((s) => (s ? new Promise<void>((resolve) => s.close(() => resolve())) : undefined)),
      );
      liveDirs.delete(dir);
      removeDirSync(dir);
      uninstallCrashHooksIfIdle();
    },
  };
}
