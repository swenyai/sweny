/**
 * SwenyToolBridge shim (#414): `sweny tool-bridge --socket <path>`, or
 * `--connect 127.0.0.1:<port>` inside the process sandbox (#439), where it
 * tunnels through the sandbox's HTTP proxy.
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

/** Where the bridge listens: the per-run unix socket, or its loopback TCP port (#439). */
export type BridgeEndpoint = { socketPath: string } | { host: string; port: number };

/** Parse `--connect host:port` (IPv4 literal or `localhost`, or `[v6]:port`). */
export function parseConnectTarget(value: string): { host: string; port: number } | undefined {
  const m = /^(?:\[([0-9a-fA-F:.]+)\]|([A-Za-z0-9.-]+)):([1-9][0-9]{0,4})$/.exec(value);
  if (!m) return undefined;
  const port = Number(m[3]);
  return port <= 65535 ? { host: m[1] ?? m[2], port } : undefined;
}

/**
 * The HTTP proxy a sandboxed shim must tunnel through, from its env. srt sets
 * HTTP_PROXY / HTTPS_PROXY (with its per-run credentials) for everything it
 * wraps; inside the sandbox nothing else reaches the host. NO_PROXY is
 * ignored on purpose: srt lists 127.0.0.1 there, but inside the sandbox's own
 * network namespace 127.0.0.1 is not the host.
 */
export function bridgeProxyFromEnv(env: NodeJS.ProcessEnv): URL | undefined {
  for (const k of ["HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy"]) {
    const v = env[k];
    if (!v) continue;
    try {
      const u = new URL(v);
      if (u.protocol === "http:") return u;
    } catch {
      // not a URL: try the next variable
    }
  }
  return undefined;
}

const MAX_PROXY_RESPONSE_BYTES = 16 * 1024;

/**
 * Open a byte stream to the bridge. A TCP endpoint goes through an HTTP
 * CONNECT tunnel when the env names a proxy (the sandboxed case), else
 * straight to the port. `leftover` holds any bytes read past the proxy's
 * response header.
 */
export function openBridgeStream(
  endpoint: BridgeEndpoint,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ sock: net.Socket; leftover: Buffer }> {
  const direct = (sock: net.Socket) =>
    new Promise<{ sock: net.Socket; leftover: Buffer }>((resolve, reject) => {
      sock.once("error", reject);
      sock.once("connect", () => {
        sock.removeListener("error", reject);
        resolve({ sock, leftover: Buffer.alloc(0) });
      });
    });
  if ("socketPath" in endpoint) return direct(net.createConnection(endpoint.socketPath));
  const proxy = bridgeProxyFromEnv(env);
  if (!proxy) return direct(net.createConnection(endpoint.port, endpoint.host));

  return new Promise((resolve, reject) => {
    const target = endpoint.host.includes(":")
      ? `[${endpoint.host}]:${endpoint.port}`
      : `${endpoint.host}:${endpoint.port}`;
    const sock = net.createConnection(Number(proxy.port || 80), proxy.hostname.replace(/^\[|\]$/g, ""));
    let buf = Buffer.alloc(0);
    let done = false;
    const fail = (err: Error) => {
      if (done) return;
      done = true;
      sock.destroy();
      reject(err);
    };
    const onData = (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      const end = buf.indexOf("\r\n\r\n");
      if (end === -1) {
        if (buf.length > MAX_PROXY_RESPONSE_BYTES) fail(new Error("tool bridge: malformed proxy response"));
        return;
      }
      const status = buf.subarray(0, buf.indexOf("\r\n")).toString("latin1");
      if (!/^HTTP\/1\.[01] 200(\s|$)/.test(status)) {
        fail(new Error(`tool bridge: the sandbox proxy refused ${target} (${status})`));
        return;
      }
      done = true;
      sock.removeListener("data", onData);
      sock.removeListener("error", fail);
      sock.removeListener("close", onClose);
      resolve({ sock, leftover: buf.subarray(end + 4) });
    };
    const onClose = () => fail(new Error("tool bridge: the sandbox proxy closed the connection"));
    sock.on("data", onData);
    sock.once("error", fail);
    sock.once("close", onClose);
    sock.once("connect", () => {
      const user = decodeURIComponent(proxy.username);
      const pass = decodeURIComponent(proxy.password);
      const auth =
        user || pass ? `Proxy-Authorization: Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}\r\n` : "";
      sock.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n${auth}\r\n`);
    });
  });
}

/** Socket client that multiplexes requests by id over one connection. */
export class BridgeClient {
  private sock: net.Socket | undefined;
  private connecting: Promise<net.Socket> | undefined;
  private nextId = 1;
  private pending = new Map<number, { resolve: (r: BridgeResponse) => void; reject: (e: Error) => void }>();
  private closedError: Error | undefined;
  private readonly endpoint: BridgeEndpoint;

  constructor(
    endpoint: string | BridgeEndpoint,
    private readonly token: string,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {
    this.endpoint = typeof endpoint === "string" ? { socketPath: endpoint } : endpoint;
  }

  private connect(): Promise<net.Socket> {
    // Once the connection is gone (bad token, server closed) every later call fails fast.
    if (this.closedError) return Promise.reject(this.closedError);
    if (this.sock) return Promise.resolve(this.sock);
    this.connecting ??= openBridgeStream(this.endpoint, this.env).then(
      ({ sock, leftover }) => {
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
        sock.once("error", (err) => this.failAll(err));
        sock.once("close", () => this.failAll(new Error("tool bridge: connection closed")));
        this.sock = sock;
        if (leftover.length > 0) read(leftover);
        return sock;
      },
      (err: Error) => {
        this.failAll(err);
        throw err;
      },
    );
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
  /** The per-run unix socket. */
  socket?: string;
  /** Or the bridge's loopback TCP endpoint, `host:port` (sandboxed agents, #439). */
  connect?: string;
  /** Falls back to `SWENY_TOOL_BRIDGE_TOKEN`. */
  token?: string;
  version?: string;
}

/** Run the stdio MCP shim until stdin closes or the bridge goes away. */
export async function runToolBridgeShim(opts: ShimOptions): Promise<void> {
  const token = opts.token ?? process.env[TOKEN_ENV];
  const tcp = opts.connect ? parseConnectTarget(opts.connect) : undefined;
  const endpoint: BridgeEndpoint | undefined = opts.socket ? { socketPath: opts.socket } : tcp;
  if (!endpoint || (opts.socket && opts.connect) || (opts.connect && !tcp) || !token) {
    process.stderr.write(
      `sweny tool-bridge: one of --socket <path> or --connect <host:port>, and a token (--token or ${TOKEN_ENV}), are required\n`,
    );
    process.exit(2);
  }
  // Keep the token out of anything the shim might spawn or report.
  delete process.env[TOKEN_ENV];

  const client = new BridgeClient(endpoint, token);
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
