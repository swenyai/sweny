/**
 * Newline-delimited JSON-RPC 2.0 over a child process's stdio: the ACP stdio
 * transport (agentclientprotocol.com/protocol/v1/transports, schema v1.24.1).
 *
 * - The client launches the agent as a subprocess and writes one JSON-RPC
 *   message per line to its stdin; the agent answers on stdout.
 * - Messages MUST NOT contain embedded newlines (`JSON.stringify` never emits
 *   one).
 * - The agent MAY log on stderr. It MUST NOT write anything but ACP messages
 *   to stdout; real agents sometimes do, so a stdout line that is not JSON is
 *   logged and skipped instead of ending the run.
 *
 * Hand-rolled on purpose: the wire is four message shapes, so sweny takes no
 * SDK dependency for it, and the contract fake speaks the raw wire, which means
 * the suite checks the protocol itself and not an SDK's reading of it.
 *
 * No agent SDK imports.
 */

import type { ChildProcess } from "node:child_process";

/** JSON-RPC / ACP error codes (schema `ErrorCode`). */
export const RPC_ERROR = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
  requestCancelled: -32800,
  authRequired: -32000,
  resourceNotFound: -32002,
} as const;

/** An error response from the peer (or a local failure reaching it). */
export class RpcError extends Error {
  constructor(
    message: string,
    readonly code: number,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = "RpcError";
  }
}

export interface RpcHandlers {
  /** A request from the peer. Resolve with the `result`, or throw {@link RpcError} for an error response. */
  onRequest(method: string, params: unknown): Promise<unknown>;
  /** A notification from the peer. */
  onNotification(method: string, params: unknown): void;
  /** A stdout line that was not a JSON-RPC message (debug only). */
  onJunk?(line: string): void;
}

interface Pending {
  resolve(value: unknown): void;
  reject(err: Error): void;
  method: string;
}

/**
 * One JSON-RPC connection. Requests from us are matched to responses by id;
 * requests from the peer are answered through {@link RpcHandlers.onRequest}.
 * When the peer goes away every pending request rejects.
 */
export class RpcPeer {
  private nextId = 1;
  private pending = new Map<number | string, Pending>();
  private buf = "";
  private ended: string | undefined;

  constructor(
    private readonly child: Pick<ChildProcess, "stdin" | "stdout">,
    private readonly handlers: RpcHandlers,
  ) {
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => this.onData(chunk));
    child.stdin?.on("error", () => {
      // The agent exited before reading; the exit handling reports why.
    });
  }

  private onData(chunk: string): void {
    this.buf += chunk;
    let nl: number;
    while ((nl = this.buf.indexOf("\n")) !== -1) {
      const line = this.buf.slice(0, nl);
      this.buf = this.buf.slice(nl + 1);
      this.onLine(line);
    }
  }

  private onLine(raw: string): void {
    const line = raw.trim();
    if (!line) return;
    let msg: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(line);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
      msg = parsed as Record<string, unknown>;
    } catch {
      this.handlers.onJunk?.(line.length > 200 ? line.slice(0, 199) + "..." : line);
      return;
    }
    const id = msg.id;
    const hasId = typeof id === "number" || typeof id === "string";
    if (typeof msg.method === "string") {
      if (hasId) void this.answer(id as number | string, msg.method, msg.params);
      else this.handlers.onNotification(msg.method, msg.params);
      return;
    }
    if (!hasId) return;
    const p = this.pending.get(id as number | string);
    if (!p) return;
    this.pending.delete(id as number | string);
    const err = msg.error as { code?: unknown; message?: unknown; data?: unknown } | undefined;
    if (err && typeof err === "object") {
      p.reject(
        new RpcError(
          typeof err.message === "string" ? err.message : `${p.method} failed`,
          typeof err.code === "number" ? err.code : RPC_ERROR.internal,
          err.data,
        ),
      );
    } else {
      p.resolve(msg.result);
    }
  }

  private async answer(id: number | string, method: string, params: unknown): Promise<void> {
    try {
      const result = await this.handlers.onRequest(method, params);
      this.write({ jsonrpc: "2.0", id, result: result ?? null });
    } catch (err) {
      const e =
        err instanceof RpcError
          ? err
          : new RpcError(err instanceof Error ? err.message : String(err), RPC_ERROR.internal);
      this.write({ jsonrpc: "2.0", id, error: { code: e.code, message: e.message } });
    }
  }

  private write(msg: Record<string, unknown>): void {
    const stdin = this.child.stdin;
    if (!stdin || stdin.destroyed || !stdin.writable) return;
    stdin.write(JSON.stringify(msg) + "\n");
  }

  /** Send a request and wait for its response. */
  request<T = unknown>(method: string, params: unknown): Promise<T> {
    if (this.ended !== undefined) return Promise.reject(new RpcError(this.ended, RPC_ERROR.internal));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: (v) => resolve(v as T), reject, method });
      this.write({ jsonrpc: "2.0", id, method, params });
    });
  }

  /** Send a notification (no response). */
  notify(method: string, params: unknown): void {
    if (this.ended !== undefined) return;
    this.write({ jsonrpc: "2.0", method, params });
  }

  /** The peer is gone: reject everything still waiting. Idempotent. */
  end(reason: string): void {
    if (this.ended !== undefined) return;
    this.ended = reason;
    // A final line without a newline is complete only if it parses.
    if (this.buf.trim()) this.onLine(this.buf);
    this.buf = "";
    const pending = [...this.pending.values()];
    this.pending.clear();
    for (const p of pending) p.reject(new RpcError(reason, RPC_ERROR.internal));
  }
}

/**
 * Split a command line into argv: whitespace separates words, single and
 * double quotes group, backslash escapes the next character outside single
 * quotes. No expansion of any kind (no globbing, no variables, no shell), so
 * the string after `acp:` can never run anything but the program it names.
 */
export function splitCommandLine(input: string): string[] {
  const out: string[] = [];
  let cur = "";
  let started = false;
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quote) {
      if (ch === quote) quote = null;
      else if (ch === "\\" && quote === '"' && i + 1 < input.length) cur += input[++i];
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
    } else if (ch === "\\" && i + 1 < input.length) {
      cur += input[++i];
      started = true;
    } else if (/\s/.test(ch)) {
      if (started) {
        out.push(cur);
        cur = "";
        started = false;
      }
    } else {
      cur += ch;
      started = true;
    }
  }
  if (quote) throw new Error(`unterminated ${quote} quote in "${input}"`);
  if (started) out.push(cur);
  return out;
}
