import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execute } from "../executor.js";
import { validateWorkflow } from "../schema.js";
import { discoverSkillsWithDiagnostics } from "../skills/custom-loader.js";
import type { McpServerConfig, Skill, Workflow } from "../types.js";

const quiet = { info() {}, warn() {}, error() {}, debug() {} };
const query = vi.hoisted(() => vi.fn());
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({ query, createSdkMcpServer: vi.fn(), tool: vi.fn() }));
import { ClaudeClient } from "../claude.js";

const workflow = (mcp: McpServerConfig): Workflow => ({
  id: "skill-mcp",
  name: "Skill MCP",
  description: "Read an external tool, then finish without it",
  entry: "read",
  skills: { external: { instruction: "Use the echo MCP tool", mcp } },
  nodes: {
    read: { name: "Read", instruction: "Call echo", skills: ["external"] },
    finish: { name: "Finish", instruction: "Summarize", skills: [] },
  },
  edges: [{ from: "read", to: "finish" }],
});

// Real local stdio JSON-RPC server; only the SDK/model boundary is mocked.
// No Claude process, credentials, remote service, or paid model is involved.
const server = `
const readline = require('node:readline');
readline.createInterface({ input: process.stdin }).on('line', line => {
  const msg = JSON.parse(line);
  if (msg.id === undefined) return;
  let result;
  if (msg.method === 'initialize') result = { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } };
  if (msg.method === 'tools/list') result = { tools: [{ name: 'echo', description: 'Echo', inputSchema: { type: 'object' } }] };
  if (msg.method === 'tools/call') result = { content: [{ type: 'text', text: msg.params.arguments.envName ? process.env[msg.params.arguments.envName] : msg.params.arguments.text }] };
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }) + '\\n');
});`;

async function callEcho(config: McpServerConfig, env?: Record<string, string>, envName?: string) {
  const child = spawn(config.command!, config.args ?? [], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...(env ?? process.env), ...config.env },
  });
  const lines = createInterface({ input: child.stdout });
  const iterator = lines[Symbol.asyncIterator]();
  const request = async (id: number, method: string, params: unknown) => {
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    const line = await iterator.next();
    if (line.done) throw new Error("MCP server closed before responding");
    return JSON.parse(line.value).result;
  };
  try {
    await request(1, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    expect((await request(2, "tools/list", {})).tools[0].name).toBe("echo");
    return (await request(3, "tools/call", { name: "echo", arguments: { text: "skill server called", envName } }))
      .content[0].text;
  } finally {
    lines.close();
    child.kill();
  }
}

let dir: string;
let mcp: McpServerConfig;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sweny-skill-mcp-"));
  const script = join(dir, "server.cjs");
  writeFileSync(script, server);
  mcp = { command: process.execPath, args: [script] };
  query.mockReset();
  query.mockImplementation(() =>
    (async function* () {
      yield { type: "result", subtype: "success", result: "{}" };
    })(),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

function client(mcpServers?: Record<string, McpServerConfig>) {
  return new ClaudeClient({ logger: quiet, sandbox: "off", envScope: false, mcpServers });
}
async function run(wf = workflow(mcp), skills = new Map<string, Skill>(), dryRun = false, claude = client()) {
  return execute(wf, { dryRun }, { skills, claude, logger: quiet });
}

describe("skill-declared MCP execution (#328)", () => {
  it("launches an inline skill server and calls its tool; does not leak it to the next node", async () => {
    query.mockImplementation(({ options }) =>
      (async function* () {
        const config = options.mcpServers?.external;
        const message = config ? await callEcho(config) : "no external server";
        yield { type: "result", subtype: "success", result: JSON.stringify({ message }) };
      })(),
    );
    const { results } = await run();
    expect(results.get("read")?.data.message).toBe("skill server called");
    expect(results.get("finish")?.data.message).toBe("no external server");
  });
  it("caller skill overrides inline config and explicit client servers override both", async () => {
    const skill: Skill = {
      id: "external",
      name: "External",
      description: "",
      category: "general",
      config: {},
      tools: [],
      instruction: "Use external",
      mcp: { url: "https://caller.invalid/mcp" },
    };
    await run(workflow(mcp), new Map([[skill.id, skill]]));
    expect(query.mock.calls[0][0].options.mcpServers?.external).toEqual({ ...skill.mcp, type: "http" });
    query.mockClear();
    const explicit = { url: "https://explicit.invalid/mcp" };
    await run(workflow(mcp), new Map([[skill.id, skill]]), false, client({ external: explicit }));
    expect(query.mock.calls[0][0].options.mcpServers.external).toEqual(explicit);
  });
  it("honors discovery's stdio opt-in before wiring a SKILL.md server", async () => {
    const skillDir = join(dir, ".sweny", "skills", "external");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      `---\nname: external\nmcp:\n  command: ${JSON.stringify(mcp.command)}\n  args: ${JSON.stringify(mcp.args)}\n---\nUse echo.\n`,
    );
    const wf = workflow(mcp);
    delete wf.skills;
    const blocked = discoverSkillsWithDiagnostics(dir, {});
    await run(wf, new Map(blocked.skills.map((skill) => [skill.id, skill])));
    expect(query.mock.calls[0][0].options.mcpServers).toBeUndefined();
    expect(blocked.warnings.some((w) => w.kind === "stdio-command-declared")).toBe(true);
    query.mockClear();
    const allowed = discoverSkillsWithDiagnostics(dir, { SWENY_ALLOW_SKILL_STDIO_COMMAND: "1" });
    await run(wf, new Map(allowed.skills.map((skill) => [skill.id, skill])));
    expect(query.mock.calls[0][0].options.mcpServers.external).toEqual({ ...mcp, type: "stdio" });
  });

  it("passes declared skill credentials and server env into the stdio process under env scoping", async () => {
    vi.stubEnv("SWENY_ENV_SCOPE", "on");
    vi.stubEnv("SWENY_MCP_FIXTURE_TOKEN", "declared-fixture-value");
    vi.stubEnv("SWENY_MCP_UNDECLARED_TOKEN", "withheld-fixture-value");
    const skill: Skill = {
      id: "external",
      name: "External",
      description: "",
      category: "general",
      config: { token: { env: "SWENY_MCP_FIXTURE_TOKEN", description: "Fixture token", required: true } },
      tools: [],
      instruction: "Use echo",
      mcp: { ...mcp, env: { SWENY_MCP_SERVER_SETTING: "explicit-server-value" } },
    };
    query.mockImplementation(({ options }) =>
      (async function* () {
        const serverConfig = options.mcpServers?.external;
        if (serverConfig) {
          expect(options.env.SWENY_MCP_UNDECLARED_TOKEN).toBeUndefined();
          const token = await callEcho(serverConfig, options.env, "SWENY_MCP_FIXTURE_TOKEN");
          const setting = await callEcho(serverConfig, options.env, "SWENY_MCP_SERVER_SETTING");
          yield { type: "result", subtype: "success", result: JSON.stringify({ token, setting }) };
        } else {
          yield { type: "result", subtype: "success", result: "{}" };
        }
      })(),
    );
    const { results } = await run(
      workflow(mcp),
      new Map([[skill.id, skill]]),
      false,
      new ClaudeClient({ logger: quiet, sandbox: "off", envScope: true }),
    );
    expect(results.get("read")?.data.token).toBe("declared-fixture-value");
    expect(results.get("read")?.data.setting).toBe("explicit-server-value");
  });

  it("withholds skill and explicit external servers in dry-run", async () => {
    await run(workflow(mcp), new Map(), true, client({ explicit: mcp }));
    for (const [{ options }] of query.mock.calls) {
      expect(options.mcpServers).toBeUndefined();
      expect(options.strictMcpConfig).toBe(true);
    }
  });
  it("rejects an MCP-only inline skill before any earlier node executes", async () => {
    const wf = workflow(mcp);
    wf.skills!.external = { mcp };
    wf.entry = "finish";
    wf.edges = [{ from: "finish", to: "read" }];
    expect(validateWorkflow(wf)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "INVALID_INLINE_SKILL",
          message: expect.stringMatching(/external.*instruction/i),
        }),
      ]),
    );
    await expect(run(wf)).rejects.toThrow(/external.*instruction/i);
    expect(query).not.toHaveBeenCalled();
  });
});
