/**
 * SwenyToolBridge (#414): server, socket protocol, shim and crash cleanup.
 *
 * The shim tests spawn the real `sweny tool-bridge` subcommand from
 * `dist/cli/main.js` with the MCP SDK client, so they need the core build
 * (CI builds it before `npm run test`).
 */
import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { startToolBridge, type ToolBridge } from "./server.js";
import { BridgeClient, parseConnectTarget } from "./shim.js";
import { TOKEN_ENV, callToolAsMcp, createFrameReader, tokenMatches } from "./protocol.js";
import { coreToolToSdkTool, parseToolResultContent } from "../claude-code.js";
import type { Tool, ToolContext } from "../../types.js";

const silent = { info() {}, warn() {}, error() {}, debug() {} };
const ctx: ToolContext = { config: {}, logger: silent };

const here = path.dirname(fileURLToPath(import.meta.url));
const distCli = path.resolve(here, "../../../dist/cli/main.js");
const distServer = path.resolve(here, "../../../dist/harness/tool-bridge/server.js");
const haveDist = fs.existsSync(distCli) && fs.existsSync(distServer);
// CI always builds core first; locally, skip the child-process tests without a build.
const describeDist = haveDist || process.env.CI ? describe : describe.skip;

function makeTools(calls: string[]): Tool[] {
  return [
    {
      name: "lookup",
      description: "Look something up",
      access: "read",
      input_schema: {
        type: "object",
        properties: { id: { type: "string", description: "Record id" }, n: { type: "number" } },
        required: ["id"],
      },
      handler: async (input: any) => {
        calls.push(`lookup:${input.id}`);
        return { id: input.id, found: true, n: input.n ?? null };
      },
    },
    {
      name: "say",
      description: "Returns a plain string",
      access: "read",
      input_schema: { type: "object", properties: { text: { type: "string" } } },
      handler: async (input: any) => {
        calls.push("say");
        return `said ${input.text ?? ""}`;
      },
    },
    {
      name: "explode",
      description: "Always throws",
      access: "write",
      input_schema: { type: "object", properties: {} },
      handler: async () => {
        calls.push("explode");
        throw new Error("boom");
      },
    },
  ];
}

/** Send raw lines to the socket; collect parsed responses until the server closes or `waitMs` passes. */
function rawExchange(
  socketPath: string,
  lines: string[],
  waitMs = 500,
): Promise<{ responses: any[]; closedByServer: boolean }> {
  return new Promise((resolve, reject) => {
    const responses: any[] = [];
    let closedByServer = false;
    const sock = net.createConnection(socketPath);
    const read = createFrameReader(
      (v) => responses.push(v),
      () => {},
    );
    sock.on("data", read);
    sock.on("error", reject);
    sock.on("end", () => {
      closedByServer = true;
    });
    sock.on("connect", () => sock.write(lines.join("")));
    setTimeout(() => {
      sock.destroy();
      resolve({ responses, closedByServer });
    }, waitMs);
  });
}

const frame = (o: unknown) => JSON.stringify(o) + "\n";

describe("tool bridge protocol", () => {
  it("tokenMatches is exact and rejects non-strings", () => {
    expect(tokenMatches("abc", "abc")).toBe(true);
    expect(tokenMatches("abc", "abd")).toBe(false);
    expect(tokenMatches("abc", "ab")).toBe(false);
    expect(tokenMatches("abc", undefined)).toBe(false);
    expect(tokenMatches("abc", 123)).toBe(false);
  });

  it("callToolAsMcp validates args with the tool schema before the handler runs", async () => {
    const calls: string[] = [];
    const [lookup] = makeTools(calls);
    const bad = await callToolAsMcp(lookup, { n: 1 }, ctx);
    expect(bad.isError).toBe(true);
    expect(calls).toEqual([]);
    const good = await callToolAsMcp(lookup, { id: "x" }, ctx);
    expect(good).toEqual({ content: [{ type: "text", text: JSON.stringify({ id: "x", found: true, n: null }) }] });
  });
});

describe("tool bridge server", () => {
  let bridge: ToolBridge | undefined;
  afterEach(async () => {
    await bridge?.close();
    bridge = undefined;
  });

  it("socket is 0600 inside a private 0700 directory", async () => {
    bridge = await startToolBridge({ tools: makeTools([]), context: ctx, logger: silent });
    const sockMode = fs.statSync(bridge.socketPath).mode & 0o777;
    const dirMode = fs.statSync(path.dirname(bridge.socketPath)).mode & 0o777;
    expect(sockMode).toBe(0o600);
    expect(dirMode).toBe(0o700);
    expect(fs.statSync(bridge.socketPath).isSocket()).toBe(true);
  });

  it("each run gets its own socket and a 256-bit random token", async () => {
    bridge = await startToolBridge({ tools: [], context: ctx });
    const other = await startToolBridge({ tools: [], context: ctx });
    try {
      expect(bridge.token).toMatch(/^[0-9a-f]{64}$/);
      expect(other.token).not.toBe(bridge.token);
      expect(other.socketPath).not.toBe(bridge.socketPath);
    } finally {
      await other.close();
    }
  });

  it("the token rides in the MCP server env, not argv", async () => {
    bridge = await startToolBridge({ tools: [], context: ctx });
    expect(bridge.mcpServer.type).toBe("stdio");
    expect(bridge.mcpServer.args).toContain(bridge.socketPath);
    expect(bridge.mcpServer.args!.join(" ")).not.toContain(bridge.token);
    expect(bridge.mcpServer.env?.[TOKEN_ENV]).toBe(bridge.token);
  });

  it("rejects a wrong token, drops the connection, and ignores frames after it", async () => {
    const calls: string[] = [];
    bridge = await startToolBridge({ tools: makeTools(calls), context: ctx, logger: silent });
    const { responses, closedByServer } = await rawExchange(bridge.socketPath, [
      frame({ v: 1, id: 1, token: "nope", method: "tools/call", params: { name: "say", arguments: {} } }),
      // A valid frame in the same write must not be served after the rejection.
      frame({ v: 1, id: 2, token: bridge.token, method: "tools/call", params: { name: "say", arguments: {} } }),
    ]);
    expect(responses).toEqual([{ id: 1, ok: false, error: { code: "unauthorized", message: "unauthorized" } }]);
    expect(closedByServer).toBe(true);
    expect(calls).toEqual([]);
  });

  it("rejects a missing token and a malformed frame without a token", async () => {
    bridge = await startToolBridge({ tools: makeTools([]), context: ctx, logger: silent });
    const a = await rawExchange(bridge.socketPath, [frame({ v: 1, id: 7, method: "tools/list" })]);
    expect(a.responses[0]).toMatchObject({ id: 7, ok: false, error: { code: "unauthorized" } });
    const b = await rawExchange(bridge.socketPath, ["not json\n"]);
    expect(b.responses[0]).toMatchObject({ ok: false, error: { code: "unauthorized" } });
  });

  it("requires the token on every call, not just the first", async () => {
    const calls: string[] = [];
    bridge = await startToolBridge({ tools: makeTools(calls), context: ctx, logger: silent });
    const { responses } = await rawExchange(bridge.socketPath, [
      frame({ v: 1, id: 1, token: bridge.token, method: "tools/list" }),
      frame({ v: 1, id: 2, token: "wrong", method: "tools/call", params: { name: "say", arguments: {} } }),
    ]);
    expect(responses[0]).toMatchObject({ id: 1, ok: true });
    expect(responses[1]).toMatchObject({ id: 2, ok: false, error: { code: "unauthorized" } });
    expect(calls).toEqual([]);
  });

  it("serves only the tools it was given; anything else is unknown_tool", async () => {
    const calls: string[] = [];
    // What the executor hands a dry-run node: the read-only subset.
    const readOnly = makeTools(calls).filter((t) => t.access === "read");
    bridge = await startToolBridge({ tools: readOnly, context: ctx, logger: silent });
    const client = new BridgeClient(bridge.socketPath, bridge.token);
    try {
      const list = await client.request("tools/list");
      expect(list.ok).toBe(true);
      expect((list as any).result.tools.map((t: any) => t.name)).toEqual(["lookup", "say"]);
      const denied = await client.request("tools/call", { name: "explode", arguments: {} });
      expect(denied).toMatchObject({ ok: false, error: { code: "unknown_tool" } });
      const proto = await client.request("tools/call", { name: "__proto__", arguments: {} });
      expect(proto).toMatchObject({ ok: false, error: { code: "unknown_tool" } });
      expect(calls).toEqual([]);
    } finally {
      client.close();
    }
  });

  it("close() removes the socket and its directory", async () => {
    const b = await startToolBridge({ tools: makeTools([]), context: ctx });
    const dir = path.dirname(b.socketPath);
    expect(fs.existsSync(b.socketPath)).toBe(true);
    await b.close();
    await b.close(); // idempotent
    expect(fs.existsSync(b.socketPath)).toBe(false);
    expect(fs.existsSync(dir)).toBe(false);
  });

  it("does not log the tool list, arguments or results", async () => {
    const lines: string[] = [];
    const rec = (m: string, d?: unknown) => lines.push(m + (d ? JSON.stringify(d) : ""));
    const logger = { info: rec, warn: rec, error: rec, debug: rec };
    bridge = await startToolBridge({ tools: makeTools([]), context: ctx, logger });
    const client = new BridgeClient(bridge.socketPath, bridge.token);
    await client.request("tools/list");
    await client.request("tools/call", { name: "lookup", arguments: { id: "secret-arg-123" } });
    client.close();
    await rawExchange(bridge.socketPath, [frame({ v: 1, id: 1, token: "bad", method: "tools/list" })]);
    const all = lines.join("\n");
    expect(all).not.toContain("lookup");
    expect(all).not.toContain("secret-arg-123");
    expect(all).not.toContain(bridge.token);
  });
});

describeDist("tool bridge shim (child process, MCP SDK client)", () => {
  let bridge: ToolBridge | undefined;
  let client: Client | undefined;
  let cwd: string;

  afterEach(async () => {
    await client?.close().catch(() => {});
    client = undefined;
    await bridge?.close();
    bridge = undefined;
  });

  async function connectShim(b: ToolBridge, token = b.token): Promise<Client> {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), "sweny-tb-cwd-"));
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [distCli, "tool-bridge", "--socket", b.socketPath],
      env: { ...b.mcpServer.env, [TOKEN_ENV]: token },
      cwd,
      stderr: "pipe",
    });
    const c = new Client({ name: "bridge-test", version: "0.0.0" });
    await c.connect(transport);
    return c;
  }

  async function inProcessClient(tools: Tool[]): Promise<Client> {
    const server = createSdkMcpServer({ name: "sweny-core", tools: tools.map((t) => coreToolToSdkTool(t, ctx)) });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.instance.connect(b);
    const c = new Client({ name: "in-process", version: "0.0.0" });
    await c.connect(a);
    return c;
  }

  const outcome = (p: Promise<any>) =>
    p.then(
      (r) => (r.isError ? "error" : "success"),
      () => "error",
    );

  it("lists and calls tools; output and status match the in-process path", { timeout: 60_000 }, async () => {
    const bridgeCalls: string[] = [];
    const inProcCalls: string[] = [];
    bridge = await startToolBridge({ tools: makeTools(bridgeCalls), context: ctx, logger: silent });
    client = await connectShim(bridge);
    const local = await inProcessClient(makeTools(inProcCalls));
    try {
      const listed = await client.listTools();
      const localListed = await local.listTools();
      expect(listed.tools.map((t) => t.name)).toEqual(["lookup", "say", "explode"]);
      expect(listed.tools.map((t) => t.name)).toEqual(localListed.tools.map((t) => t.name));
      expect(listed.tools[0].inputSchema).toMatchObject({ type: "object", required: ["id"] });

      const cases: Array<[string, Record<string, unknown>]> = [
        ["lookup", { id: "r1", n: 2 }],
        ["say", { text: "hi" }],
        ["explode", {}],
      ];
      for (const [name, args] of cases) {
        const viaBridge: any = await client.callTool({ name, arguments: args });
        const viaSdk: any = await local.callTool({ name, arguments: args });
        // Same MCP content and status as the in-process SDK server.
        expect(viaBridge.content).toEqual(viaSdk.content);
        expect(!!viaBridge.isError).toBe(!!viaSdk.isError);
        // And the same typed output once the harness parses the tool_result.
        expect(parseToolResultContent(viaBridge.content)).toEqual(parseToolResultContent(viaSdk.content));
      }
      expect(
        parseToolResultContent(((await client.callTool({ name: "lookup", arguments: { id: "z" } })) as any).content),
      ).toEqual({
        id: "z",
        found: true,
        n: null,
      });

      // Invalid args: both paths refuse, neither runs the handler.
      const before = [bridgeCalls.length, inProcCalls.length];
      expect(await outcome(client.callTool({ name: "lookup", arguments: { n: 1 } }))).toBe("error");
      expect(await outcome(local.callTool({ name: "lookup", arguments: { n: 1 } }))).toBe("error");
      expect([bridgeCalls.length, inProcCalls.length]).toEqual(before);

      // Handlers ran in this (sweny) process, where the executor observes them.
      expect(bridgeCalls).toEqual(["lookup:r1", "say", "explode", "lookup:z"]);
    } finally {
      await local.close();
    }
  });

  it("a shim with the wrong token cannot list or call tools", { timeout: 60_000 }, async () => {
    const calls: string[] = [];
    bridge = await startToolBridge({ tools: makeTools(calls), context: ctx, logger: silent });
    client = await connectShim(bridge, "0".repeat(64));
    await expect(client.listTools()).rejects.toThrow(/unauthorized/);
    expect(await outcome(client.callTool({ name: "say", arguments: {} }))).toBe("error");
    expect(calls).toEqual([]);
  });

  it("the socket is gone after the run", { timeout: 60_000 }, async () => {
    const b = await startToolBridge({ tools: makeTools([]), context: ctx, logger: silent });
    client = await connectShim(b);
    await client.listTools();
    await b.close();
    expect(fs.existsSync(b.socketPath)).toBe(false);
    expect(fs.existsSync(path.dirname(b.socketPath))).toBe(false);
  });
});

describeDist("tool bridge crash cleanup", () => {
  /** Start a bridge in a child node process, then kill it the given way. */
  function crashChild(
    how: "SIGTERM" | "SIGINT" | "throw",
  ): Promise<{ socketPath: string; code: number | null; signal: string | null }> {
    const script = `
      const { startToolBridge } = await import(${JSON.stringify(distServer)});
      const b = await startToolBridge({ tools: [], context: { config: {} } });
      process.stdout.write(b.socketPath + "\\n");
      ${how === "throw" ? "setTimeout(() => { throw new Error('crash'); }, 50);" : "setInterval(() => {}, 1000);"}
    `;
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      let out = "";
      let socketPath = "";
      child.stdout.on("data", (d) => {
        out += d.toString();
        if (!socketPath && out.includes("\n")) {
          socketPath = out.split("\n")[0].trim();
          if (how !== "throw") child.kill(how);
        }
      });
      child.on("error", reject);
      child.on("exit", (code, signal) => resolve({ socketPath, code, signal }));
    });
  }

  for (const how of ["SIGTERM", "SIGINT", "throw"] as const) {
    it(`removes the socket when the run dies by ${how}`, { timeout: 30_000 }, async () => {
      const { socketPath, code, signal } = await crashChild(how);
      expect(socketPath).toMatch(/b\.sock$/);
      expect(fs.existsSync(socketPath)).toBe(false);
      expect(fs.existsSync(path.dirname(socketPath))).toBe(false);
      // Default signal semantics are kept: the process still dies by the signal.
      if (how === "throw") expect(code).not.toBe(0);
      else expect(signal).toBe(how);
    });
  }
});

// ─── Loopback TCP endpoint for sandboxed agents (#439) ───────────

/** A minimal HTTP CONNECT proxy, like srt's: checks Basic auth, then pipes. */
async function startConnectProxy(opts: { user: string; pass: string; refuse?: boolean }) {
  const seen: string[] = [];
  const server = net.createServer((client) => {
    let buf = Buffer.alloc(0);
    const onData = (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      const end = buf.indexOf("\r\n\r\n");
      if (end === -1) return;
      client.removeListener("data", onData);
      const head = buf.subarray(0, end).toString("latin1").split("\r\n");
      const [, target] = head[0].split(" ");
      seen.push(target);
      const auth = head
        .find((h) => /^proxy-authorization:/i.test(h))
        ?.split(" ")
        .at(-1);
      const want = Buffer.from(`${opts.user}:${decodeURIComponent(opts.pass)}`).toString("base64");
      if (auth !== want) return client.end("HTTP/1.1 407 Proxy Authentication Required\r\n\r\n");
      if (opts.refuse) return client.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      const [host, port] = [
        target.slice(0, target.lastIndexOf(":")),
        Number(target.slice(target.lastIndexOf(":") + 1)),
      ];
      const upstream = net.createConnection(port, host, () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        const rest = buf.subarray(end + 4);
        if (rest.length > 0) upstream.write(rest);
        client.pipe(upstream).pipe(client);
      });
      upstream.on("error", () => client.destroy());
      client.on("error", () => upstream.destroy());
    };
    client.on("data", onData);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as net.AddressInfo).port;
  return {
    url: `http://${opts.user}:${opts.pass}@127.0.0.1:${port}`,
    seen,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

describe("tool bridge TCP endpoint (#439)", () => {
  let bridge: ToolBridge | undefined;
  afterEach(async () => {
    await bridge?.close();
    bridge = undefined;
  });

  it("parses --connect targets", () => {
    expect(parseConnectTarget("127.0.0.1:4321")).toEqual({ host: "127.0.0.1", port: 4321 });
    expect(parseConnectTarget("[::1]:80")).toEqual({ host: "::1", port: 80 });
    expect(parseConnectTarget("127.0.0.1")).toBeUndefined();
    expect(parseConnectTarget("127.0.0.1:0")).toBeUndefined();
    expect(parseConnectTarget("127.0.0.1:70000")).toBeUndefined();
    expect(parseConnectTarget("a b:1")).toBeUndefined();
  });

  it("is off by default: no port, no egress, the shim gets --socket", async () => {
    bridge = await startToolBridge({ tools: [], context: ctx });
    expect(bridge.tcp).toBeUndefined();
    expect(bridge.egress).toEqual([]);
    expect(bridge.mcpServer.args).toContain("--socket");
    expect(bridge.mcpServer.args).not.toContain("--connect");
  });

  it("with tcp: listens on loopback only, names the one egress host, points the shim there", async () => {
    bridge = await startToolBridge({ tools: [], context: ctx, tcp: true });
    expect(bridge.tcp).toEqual({ host: "127.0.0.1", port: expect.any(Number) });
    expect(bridge.egress).toEqual([`127.0.0.1:${bridge.tcp!.port}`]);
    const args = bridge.mcpServer.args!;
    expect(args.slice(-2)).toEqual(["--connect", `127.0.0.1:${bridge.tcp!.port}`]);
    expect(args).not.toContain("--socket");
    expect(args.join(" ")).not.toContain(bridge.token);
  });

  it("serves the same tools with the same token check over TCP", async () => {
    const calls: string[] = [];
    bridge = await startToolBridge({ tools: makeTools(calls), context: ctx, logger: silent, tcp: true });
    const client = new BridgeClient(bridge.tcp!, bridge.token, {});
    try {
      const list = await client.request("tools/list");
      expect((list as any).result.tools.map((t: any) => t.name)).toEqual(["lookup", "say", "explode"]);
      expect(await client.request("tools/call", { name: "say", arguments: { text: "x" } })).toMatchObject({ ok: true });
      expect(calls).toEqual(["say"]);
    } finally {
      client.close();
    }
    const bad = new BridgeClient(bridge.tcp!, "0".repeat(64), {});
    expect(await bad.request("tools/call", { name: "say", arguments: {} })).toMatchObject({
      ok: false,
      error: { code: "unauthorized" },
    });
    bad.close();
    expect(calls).toEqual(["say"]);
  });

  it("tunnels through the HTTP proxy in the env with its credentials, ignoring NO_PROXY", async () => {
    const calls: string[] = [];
    bridge = await startToolBridge({ tools: makeTools(calls), context: ctx, logger: silent, tcp: true });
    const proxy = await startConnectProxy({ user: "srt", pass: "p%40ss" });
    const client = new BridgeClient(bridge.tcp!, bridge.token, { HTTP_PROXY: proxy.url, NO_PROXY: "127.0.0.1" });
    try {
      expect(await client.request("tools/call", { name: "say", arguments: { text: "y" } })).toMatchObject({ ok: true });
      expect(proxy.seen).toEqual([`127.0.0.1:${bridge.tcp!.port}`]);
      expect(calls).toEqual(["say"]);
    } finally {
      client.close();
      await proxy.close();
    }
  });

  it("fails closed when the proxy refuses the tunnel", async () => {
    const calls: string[] = [];
    bridge = await startToolBridge({ tools: makeTools(calls), context: ctx, logger: silent, tcp: true });
    const proxy = await startConnectProxy({ user: "u", pass: "p", refuse: true });
    const client = new BridgeClient(bridge.tcp!, bridge.token, { http_proxy: proxy.url });
    try {
      await expect(client.request("tools/list")).rejects.toThrow(/proxy refused .*403/);
      // Later calls fail fast, same as a dropped socket.
      await expect(client.request("tools/list")).rejects.toThrow(/proxy refused/);
      expect(calls).toEqual([]);
    } finally {
      client.close();
      await proxy.close();
    }
  });

  it("close() stops the TCP listener too", async () => {
    const b = await startToolBridge({ tools: [], context: ctx, tcp: true });
    const { port } = b.tcp!;
    await b.close();
    await expect(
      new Promise((resolve, reject) => {
        const s = net.createConnection(port, "127.0.0.1", () => resolve(s.end()));
        s.on("error", reject);
      }),
    ).rejects.toThrow(/ECONNREFUSED/);
  });
});
