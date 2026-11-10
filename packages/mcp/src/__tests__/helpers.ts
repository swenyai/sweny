import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { registerTools } from "../tools.js";

const dirs: string[] = [];

/** A fresh real (symlink-resolved) temp dir, removed by {@link cleanupWorkspaces}. */
export function makeWorkspace(): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "sweny-mcp-582-")));
  dirs.push(dir);
  return dir;
}

export function cleanupWorkspaces(): void {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
}

export function write(root: string, rel: string, content: string): string {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

export const VALID_WORKFLOW = `id: demo
name: Demo
description: A demo workflow
entry: start
nodes:
  start:
    name: Start
    instruction: Do the thing
    skills: []
  finish:
    name: Finish
    instruction: Wrap up
    skills: []
edges:
  - from: start
    to: finish
`;

/** Edge points at a node that does not exist. */
export const INVALID_WORKFLOW = `id: broken
name: Broken
entry: start
nodes:
  start:
    name: Start
    instruction: Do the thing
    skills: []
edges:
  - from: start
    to: ghost
`;

export async function connect(root: string) {
  const server = new McpServer({ name: "sweny-test", version: "0.0.0" });
  registerTools(server, { root });
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

export interface Called {
  isError: boolean;
  /** First text block: the short summary. */
  summary: string;
  /** Second text block parsed as JSON: the structured result. */
  data: any;
}

export async function call(client: Client, name: string, args: Record<string, unknown> = {}): Promise<Called> {
  const res = (await client.callTool({ name, arguments: args })) as {
    isError?: boolean;
    content: Array<{ type: string; text: string }>;
  };
  return {
    isError: res.isError === true,
    summary: res.content[0]?.text ?? "",
    data: res.content[1] ? JSON.parse(res.content[1].text) : undefined,
  };
}

// ── Run history fixtures ──

export const RUN_A = "20261106-100000-aaaaaa";
export const RUN_B = "20261106-110000-bbbbbb";

export function runRecord(runId: string, startedAt: string, over: Record<string, unknown> = {}) {
  return {
    schema_version: 1,
    run_id: runId,
    workflow_id: "triage",
    workflow_hash: "0".repeat(64),
    started_at: startedAt,
    duration_ms: 1000,
    status: "success",
    nodes: [
      { id: "scan", status: "success", duration_ms: 1000, tool_calls: 1, tokens: 100, cost_usd: 0.01, retries: 0 },
    ],
    routes: [],
    totals: { nodes_total: 1, nodes_ok: 1, nodes_skipped: 0, tool_calls: 1, tokens: 100, cost_usd: 0.01 },
    ...over,
  };
}

export function writeRun(root: string, rec: ReturnType<typeof runRecord>, answers?: Record<string, unknown>): void {
  write(root, `.sweny/runs/${rec.run_id}.json`, JSON.stringify(rec));
  if (answers) {
    write(
      root,
      `.sweny/runs/${rec.run_id}/answers.json`,
      JSON.stringify({ schema_version: 1, run_id: rec.run_id, workflow_id: rec.workflow_id, nodes: answers }),
    );
  }
}

/** True when the call was refused at the input schema (SDK versions differ: an isError result or a rejection). */
export async function refusedBySchema(client: Client, name: string, args: Record<string, unknown>): Promise<boolean> {
  try {
    const res = (await client.callTool({ name, arguments: args })) as { isError?: boolean };
    return res.isError === true;
  } catch {
    return true;
  }
}
