/**
 * SwenyToolBridge shim (#414): `sweny tool-bridge --socket <path>`.
 *
 * A stdio MCP server a harness starts as a child process. It holds no tools
 * of its own: `tools/list` and `tools/call` are forwarded over the per-run
 * unix socket to the sweny process (server.ts), which runs the real handlers.
 *
 * stdout carries MCP only; diagnostics go to stderr. The token comes from
 * `--token` or, by default, the `SWENY_TOOL_BRIDGE_TOKEN` env var the server
 * puts in the MCP server config, so it never shows up in `ps` output.
 */

import * as net from "node:net";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import {
  BRIDGE_PROTOCOL_VERSION,
  TOKEN_ENV,
  createFrameReader,
  encodeFrame,
  type BridgeMethod,
  type BridgeResponse,
  type BridgeToolDescriptor,
  type McpCallToolResult,
} from "./protocol.js";

/** Socket client that multiplexes requests by id over one connection. */
export class BridgeClient {
  private sock: net.Socket | undefined;
  private connecting: Promise<net.Socket> | undefined;
  private nextId = 1;
  private pending = new Map<number, { resolve: (r: BridgeResponse) => void; reject: (e: Error) => void }>();
  private closedError: Error | undefined;

  constructor(
    private readonly socketPath: string,
    private readonly token: string,
  ) {}

  private connect(): Promise<net.Socket> {
    // Once the connection is gone (bad token, server closed) every later call fails fast.
    if (this.closedError) return Promise.reject(this.closedError);
    if (this.sock) return Promise.resolve(this.sock);
    this.connecting ??= new Promise<net.Socket>((resolve, reject) => {
      const sock = net.createConnection(this.socketPath);
      const read = createFrameReader(
        (value) => {
          const res = value as BridgeResponse | undefined;
          if (!res || typeof res.id !== "number") return;
          const waiter = this.pending.get(res.id);
          if (waiter) {
            this.pending.delete(res.id);
            waiter.resolve(res);
          } else if (res.ok === false) {
            // Unsolicited error (for example a frame-size rejection): fail everything.
            this.failAll(new Error(`tool bridge: ${res.error.message}`));
          }
        },
        () => this.failAll(new Error("tool bridge: response frame too large")),
      );
      sock.on("data", read);
      sock.once("connect", () => {
        this.sock = sock;
        resolve(sock);
      });
      sock.once("error", (err) => {
        reject(err);
        this.failAll(err);
      });
      sock.once("close", () => this.failAll(new Error("tool bridge: connection closed")));
    });
    return this.connecting;
  }

  private failAll(err: Error): void {
    this.closedError ??= err;
    for (const w of this.pending.values()) w.reject(err);
    this.pending.clear();
    this.sock?.destroy();
    this.sock = undefined;
  }

  async request(method: BridgeMethod, params?: { name: string; arguments?: Record<string, unknown> }) {
    const sock = await this.connect();
    const id = this.nextId++;
    return new Promise<BridgeResponse>((resolve, reject) => {
      if (this.closedError || sock.destroyed) {
        reject(this.closedError ?? new Error("tool bridge: connection closed"));
        return;
      }
      this.pending.set(id, { resolve, reject });
      sock.write(encodeFrame({ v: BRIDGE_PROTOCOL_VERSION, id, token: this.token, method, params }));
    });
  }

  close(): void {
    this.sock?.destroy();
  }
}

export interface ShimOptions {
  socket: string;
  /** Falls back to `SWENY_TOOL_BRIDGE_TOKEN`. */
  token?: string;
  version?: string;
}

/** Run the stdio MCP shim until stdin closes or the bridge goes away. */
export async function runToolBridgeShim(opts: ShimOptions): Promise<void> {
  const token = opts.token ?? process.env[TOKEN_ENV];
  if (!opts.socket || !token) {
    process.stderr.write(`sweny tool-bridge: --socket and a token (--token or ${TOKEN_ENV}) are required\n`);
    process.exit(2);
  }
  // Keep the token out of anything the shim might spawn or report.
  delete process.env[TOKEN_ENV];

  const client = new BridgeClient(opts.socket, token);
  const server = new Server({ name: "sweny-core", version: opts.version ?? "0.0.0" }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const res = await client.request("tools/list");
    if (!res.ok) throw new Error(`tool bridge: ${res.error.message}`);
    return { tools: (res.result as { tools: BridgeToolDescriptor[] }).tools } as any;
  });

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const res = await client.request("tools/call", {
      name: req.params.name,
      arguments: req.params.arguments as Record<string, unknown> | undefined,
    });
    if (!res.ok) {
      // Unknown tool and friends surface as a tool error result, the same way
      // the in-process SDK server reports a call it cannot serve.
      return { content: [{ type: "text", text: `Error: ${res.error.message}` }], isError: true };
    }
    return res.result as McpCallToolResult as any;
  });

  const shutdown = () => {
    client.close();
    void server.close().finally(() => process.exit(0));
  };
  process.stdin.once("end", shutdown);
  process.stdin.once("close", shutdown);

  await server.connect(new StdioServerTransport());
}
