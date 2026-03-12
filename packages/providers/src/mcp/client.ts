/**
 * Thin wrapper around the MCP SDK Client for use inside provider adapters.
 *
 * DEPENDENCY: Requires `@modelcontextprotocol/sdk` — add to peerDependencies:
 *   "@modelcontextprotocol/sdk": "^1.0"
 *
 * Providers that use this are NOT drop-in replacements for the native
 * implementations — see the individual *-mcp.ts files for what is lost.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

import { ProviderError } from "../errors.js";

export interface MCPServerConfig {
  /**
   * Transport type. Defaults to "stdio" if `command` is set, "http" if `url` is set.
   * Use "http" for remote/cloud-hosted MCP servers (Streamable HTTP transport).
   * Use "stdio" for local pre-installed binaries. Never use "npx -y" at runtime.
   */
  type?: "stdio" | "http";

  // ── stdio fields ──
  /** Command to spawn the MCP server process. e.g. "/usr/local/bin/github-mcp" */
  command?: string;
  /** Args passed to the command. */
  args?: string[];
  /**
   * Additional env vars merged into the server process environment.
   * Use this for API keys the server reads from env (most MCP servers do this).
   */
  env?: Record<string, string>;

  // ── http fields ──
  /** URL of the remote MCP server (Streamable HTTP transport). */
  url?: string;
  /**
   * HTTP headers sent with every request.
   * Use for API key auth: e.g. `{ Authorization: "Bearer <token>" }`.
   */
  headers?: Record<string, string>;
}

/**
 * Wraps a stdio MCP server as a callable client.
 *
 * Connection is lazy — call connect() explicitly or let the first call()
 * trigger it. The server process lives for the lifetime of this instance.
 * Call disconnect() when done to avoid orphaned processes.
 */
export class MCPClient {
  private client: Client | null = null;
  private tools: Tool[] = [];
  private connectPromise: Promise<void> | null = null;

  constructor(
    /** Name used in error messages — typically the provider name. */
    private readonly name: string,
    private readonly config: MCPServerConfig,
  ) {}

  async connect(): Promise<void> {
    // Return in-flight connection so concurrent callers wait on the same attempt.
    if (this.connectPromise) return this.connectPromise;
    if (this.client) return;

    // Clear connectPromise on failure so callers can retry after a transient error.
    this.connectPromise = this._connect().catch((err) => {
      this.connectPromise = null;
      throw err;
    });
    return this.connectPromise;
  }

  private async _connect(): Promise<void> {
    const resolvedType = this.config.type ?? (this.config.url ? "http" : "stdio");

    if (resolvedType === "http") {
      throw new ProviderError(
        `MCPClient "${this.name}": HTTP transport is not supported in MCPClient — ` +
          "configure HTTP servers in mcpServers and let the coding agent connect to them.",
        this.name,
      );
    }

    if (!this.config.command) {
      throw new ProviderError(`MCPClient "${this.name}": stdio transport requires a command.`, this.name);
    }

    const transport = new StdioClientTransport({
      command: this.config.command,
      args: this.config.args ?? [],
      // MCP servers read credentials from env — merge caller-supplied keys
      // with the current process env so PATH etc. is still available.
      env: { ...process.env, ...this.config.env } as Record<string, string>,
    });

    this.client = new Client({ name: "sweny", version: "1.0.0" }, { capabilities: {} });
    await this.client.connect(transport);

    const { tools } = await this.client.listTools();
    this.tools = tools;
  }

  /** Returns tool names exposed by this server — useful for debugging. */
  availableTools(): string[] {
    return this.tools.map((t) => t.name);
  }

  hasTool(name: string): boolean {
    return this.tools.some((t) => t.name === name);
  }

  /**
   * Call a tool and return the parsed result.
   *
   * NOTE: MCP tool results are `ContentBlock[]` — text content is returned as
   * raw strings that may or may not be valid JSON depending on the server.
   * We attempt JSON.parse; if that fails we return the raw string as-is.
   * Callers must validate the shape themselves (Zod recommended for production).
   */
  async call<T = unknown>(toolName: string, args: Record<string, unknown>): Promise<T> {
    if (!this.client) await this.connect();

    // Guard against concurrent disconnect racing with an in-flight call.
    const client = this.client;
    if (!client) throw new ProviderError(`MCPClient "${this.name}" was disconnected`, this.name);

    // callTool returns { [x: string]: unknown; content: ContentBlock[]; isError?: boolean }
    // The index signature causes TypeScript to widen content to unknown, so we
    // cast through the concrete SDK type to recover the typed content array.
    type ContentBlock = { type: string; text?: string };
    type CallResult = { content: ContentBlock[]; isError?: boolean };
    const result = (await client.callTool({
      name: toolName,
      arguments: args,
    })) as CallResult;

    const isText = (c: ContentBlock): c is ContentBlock & { text: string } =>
      c.type === "text" && typeof c.text === "string";

    if (result.isError) {
      const errorText = result.content
        .filter(isText)
        .map((c) => c.text)
        .join("\n");
      throw new ProviderError(`MCP tool "${toolName}" failed: ${errorText}`, this.name);
    }

    const textBlock = result.content.find(isText);

    if (textBlock) {
      try {
        return JSON.parse(textBlock.text) as T;
      } catch {
        return textBlock.text as unknown as T;
      }
    }

    return result.content as unknown as T;
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.connectPromise = null;
    }
  }
}
