/**
 * #360 step 1: scoped agent env + CI sandbox.
 *
 * Pure helpers are tested directly; the ClaudeClient wiring is tested with
 * the SDK `query` mocked, asserting on the exact options it receives. No
 * LLM calls.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildAgentEnv,
  resolveAgentAccess,
  resolveSandboxMode,
  resolveAgentSandbox,
  checkSandboxSupport,
  DEFAULT_SANDBOX_DOMAINS,
} from "../agent-env.js";
import { github } from "../skills/github.js";
import { linear } from "../skills/linear.js";
import { createSkillMap } from "../skills/index.js";

const BASE = {
  PATH: "/usr/bin",
  HOME: "/home/runner",
  LANG: "en_US.UTF-8",
  LC_ALL: "C",
  TZ: "UTC",
  HTTPS_PROXY: "http://proxy:3128",
  CI: "true",
  GITHUB_REPOSITORY: "o/r",
  ANTHROPIC_API_KEY: "sk-ant-x",
  ANTHROPIC_BASE_URL: "https://gw",
  CLAUDE_CODE_OAUTH_TOKEN: "oauth-x",
  GITHUB_TOKEN: "ghp_secret",
  LINEAR_API_KEY: "lin_secret",
  AWS_SECRET_ACCESS_KEY: "aws_secret",
  SWENY_RANDOM_UNLISTED_7f3a: "leak-me",
  NPM_TOKEN: "npm_secret",
};

describe("buildAgentEnv", () => {
  it("drops a random non-listed var and unrelated secrets", () => {
    const env = buildAgentEnv(BASE);
    expect(env.SWENY_RANDOM_UNLISTED_7f3a).toBeUndefined();
    expect(env.NPM_TOKEN).toBeUndefined();
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(env.LINEAR_API_KEY).toBeUndefined();
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
  });

  it("keeps process basics, locale, TZ, proxy, CI vars and agent auth", () => {
    const env = buildAgentEnv(BASE);
    for (const k of [
      "PATH",
      "HOME",
      "LANG",
      "LC_ALL",
      "TZ",
      "HTTPS_PROXY",
      "CI",
      "GITHUB_REPOSITORY",
      "ANTHROPIC_API_KEY",
      "ANTHROPIC_BASE_URL",
      "CLAUDE_CODE_OAUTH_TOKEN",
    ]) {
      expect(env[k], k).toBe((BASE as Record<string, string>)[k]);
    }
  });

  it("includes declared skill vars (extraVars) and the operator passthrough list", () => {
    const env = buildAgentEnv(BASE, { extraVars: ["GITHUB_TOKEN"], passthrough: ["NPM_TOKEN"] });
    expect(env.GITHUB_TOKEN).toBe("ghp_secret");
    expect(env.NPM_TOKEN).toBe("npm_secret");
    expect(env.LINEAR_API_KEY).toBeUndefined();
  });

  it("passes AWS_* only when Claude Code is routed through Bedrock", () => {
    expect(buildAgentEnv({ ...BASE, CLAUDE_CODE_USE_BEDROCK: "1" }).AWS_SECRET_ACCESS_KEY).toBe("aws_secret");
    expect(buildAgentEnv({ ...BASE, CLAUDE_CODE_USE_BEDROCK: "0" }).AWS_SECRET_ACCESS_KEY).toBeUndefined();
  });

  it("'*' in passthrough inherits everything, with a warning", () => {
    const warn = vi.fn();
    const env = buildAgentEnv(BASE, { passthrough: ["*"], logger: { warn } });
    expect(env.SWENY_RANDOM_UNLISTED_7f3a).toBe("leak-me");
    expect(warn).toHaveBeenCalledOnce();
  });

  it("drops undefined values and never mutates the source", () => {
    const src: Record<string, string | undefined> = { PATH: "/bin", HOME: undefined };
    const env = buildAgentEnv(src);
    expect("HOME" in env).toBe(false);
    expect(src).toEqual({ PATH: "/bin", HOME: undefined });
  });
});

describe("resolveAgentAccess", () => {
  it("returns a node's declared skill env vars and provider hosts", () => {
    const skills = createSkillMap([github, linear]);
    const access = resolveAgentAccess(["github"], skills);
    expect(access.envVars).toContain("GITHUB_TOKEN");
    expect(access.envVars).not.toContain("LINEAR_API_KEY");
    expect(access.domains).toContain("api.github.com");
    expect(access.domains).not.toContain("api.linear.app");
  });

  it("ignores unknown skills", () => {
    expect(resolveAgentAccess(["nope"], createSkillMap([]))).toEqual({ envVars: [], domains: [] });
  });
});

describe("resolveSandboxMode", () => {
  it("auto: on in CI, off locally", () => {
    expect(resolveSandboxMode({ CI: "true" }).enabled).toBe(true);
    expect(resolveSandboxMode({}).enabled).toBe(false);
    expect(resolveSandboxMode({ CI: "false" }).enabled).toBe(false);
  });

  it("SWENY_SANDBOX overrides both ways", () => {
    expect(resolveSandboxMode({ CI: "true", SWENY_SANDBOX: "off" }).enabled).toBe(false);
    expect(resolveSandboxMode({ SWENY_SANDBOX: "on" }).enabled).toBe(true);
  });

  it("unknown value warns and falls back to auto", () => {
    const warn = vi.fn();
    expect(resolveSandboxMode({ CI: "true", SWENY_SANDBOX: "maybe" }, undefined, { warn })).toEqual({
      mode: "auto",
      enabled: true,
    });
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe("checkSandboxSupport", () => {
  it("macOS is supported", () => {
    expect(checkSandboxSupport("darwin", "", () => false)).toBeUndefined();
  });
  it("Windows is not", () => {
    expect(checkSandboxSupport("win32", "", () => true)).toMatch(/does not support platform "win32"/);
  });
  it("Linux needs bwrap and socat on PATH", () => {
    expect(checkSandboxSupport("linux", "/usr/bin", () => false)).toMatch(/missing bwrap and socat/);
    expect(checkSandboxSupport("linux", "/usr/bin", (p) => p.endsWith("bwrap"))).toMatch(/missing socat/);
    expect(checkSandboxSupport("linux", "/usr/bin", () => true)).toBeUndefined();
  });
});

describe("resolveAgentSandbox", () => {
  it("off locally: no settings, no error", () => {
    expect(resolveAgentSandbox({ env: {}, probe: () => undefined })).toEqual({});
  });

  it("CI: strict settings with default + node + configured hosts", () => {
    const { settings, error } = resolveAgentSandbox({
      env: { CI: "true", SWENY_SANDBOX_ALLOWED_DOMAINS: "internal.example.com, *.corp.example" },
      nodeDomains: ["api.linear.app"],
      probe: () => undefined,
    });
    expect(error).toBeUndefined();
    expect(settings).toMatchObject({
      enabled: true,
      failIfUnavailable: true,
      allowUnsandboxedCommands: false,
      network: { strictAllowlist: true },
    });
    const domains = settings!.network!.allowedDomains!;
    expect(domains).toEqual(expect.arrayContaining([...DEFAULT_SANDBOX_DOMAINS]));
    expect(domains).toEqual(expect.arrayContaining(["api.linear.app", "internal.example.com", "*.corp.example"]));
    const denied = settings!.credentials!.envVars!.map((e) => `${e.name}:${e.mode}`);
    expect(denied).toEqual(
      expect.arrayContaining(["ANTHROPIC_API_KEY:deny", "ANTHROPIC_AUTH_TOKEN:deny", "CLAUDE_CODE_OAUTH_TOKEN:deny"]),
    );
  });

  it("CI + unsupported host: fails closed with the opt-out named", () => {
    const r = resolveAgentSandbox({ env: { CI: "true" }, probe: () => "missing bwrap on PATH" });
    expect(r.settings).toBeUndefined();
    expect(r.error).toMatch(/required \(running in CI \(CI=true\)\) but unavailable: missing bwrap/);
    expect(r.error).toMatch(/SWENY_SANDBOX=off/);
  });
});

describe("applyAgentFileConfig (.sweny.yml -> SWENY_* env)", () => {
  it("maps sandbox / env-passthrough / sandbox-allowed-domains; real env wins", async () => {
    const { applyAgentFileConfig } = await import("../cli/config-file.js");
    const env: NodeJS.ProcessEnv = { SWENY_SANDBOX: "on" };
    applyAgentFileConfig(
      {
        sandbox: "off",
        "env-passthrough": ["NPM_TOKEN", "FOO"],
        "sandbox-allowed-domains": ["internal.example.com"],
      },
      env,
    );
    expect(env.SWENY_SANDBOX).toBe("on");
    expect(env.SWENY_ENV_PASSTHROUGH).toBe("NPM_TOKEN,FOO");
    expect(env.SWENY_SANDBOX_ALLOWED_DOMAINS).toBe("internal.example.com");
  });

  it("accepts the env_passthrough spelling and YAML booleans", async () => {
    const { applyAgentFileConfig } = await import("../cli/config-file.js");
    const env: NodeJS.ProcessEnv = {};
    applyAgentFileConfig({ env_passthrough: ["BAR"], sandbox: "false" }, env);
    expect(env.SWENY_ENV_PASSTHROUGH).toBe("BAR");
    expect(resolveSandboxMode({ ...env, CI: "true" }).enabled).toBe(false);
  });
});

// ─── ClaudeClient wiring ────────────────────────────────────────

describe("ClaudeClient scoped env + sandbox wiring", () => {
  let mockQuery: ReturnType<typeof vi.fn>;
  let ClaudeClient: any;

  const ok = () =>
    (async function* () {
      yield { type: "result", subtype: "success", result: "ok" };
    })();

  beforeEach(async () => {
    mockQuery = vi.fn().mockImplementation(ok);
    vi.doMock("@anthropic-ai/claude-agent-sdk", () => ({
      query: mockQuery,
      createSdkMcpServer: vi.fn().mockReturnValue({ type: "sdk", name: "sweny-core" }),
      tool: vi.fn(),
    }));
    ClaudeClient = (await import("../claude.js")).ClaudeClient;
    vi.stubEnv("CI", "");
    vi.stubEnv("SWENY_SANDBOX", "");
    vi.stubEnv("SWENY_ENV_PASSTHROUGH", "");
    vi.stubEnv("SWENY_SANDBOX_ALLOWED_DOMAINS", "");
    vi.stubEnv("SWENY_RANDOM_UNLISTED_7f3a", "leak-me");
    vi.stubEnv("GITHUB_TOKEN", "ghp_secret");
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-x");
    vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  const opts = () => mockQuery.mock.calls[0][0].options;

  it("run: env excludes a random unlisted var; declared skill vars are present", async () => {
    const client = new ClaudeClient({ sandboxProbe: () => undefined });
    await client.run({
      instruction: "x",
      context: {},
      tools: [],
      agentAccess: { envVars: ["GITHUB_TOKEN"], domains: [] },
    });
    expect(opts().env.SWENY_RANDOM_UNLISTED_7f3a).toBeUndefined();
    expect(opts().env.GITHUB_TOKEN).toBe("ghp_secret");
    expect(opts().env.ANTHROPIC_API_KEY).toBe("sk-ant-x");
    expect(opts().env.PATH).toBe(process.env.PATH);
  });

  it("run: a skill var the node did not declare is absent", async () => {
    await new ClaudeClient({ sandboxProbe: () => undefined }).run({ instruction: "x", context: {}, tools: [] });
    expect(opts().env.GITHUB_TOKEN).toBeUndefined();
  });

  it("run: SWENY_ENV_PASSTHROUGH and the envPassthrough option add names", async () => {
    vi.stubEnv("SWENY_ENV_PASSTHROUGH", "SWENY_RANDOM_UNLISTED_7f3a");
    await new ClaudeClient().run({ instruction: "x", context: {}, tools: [] });
    expect(opts().env.SWENY_RANDOM_UNLISTED_7f3a).toBe("leak-me");

    mockQuery.mockClear();
    vi.stubEnv("SWENY_ENV_PASSTHROUGH", "");
    await new ClaudeClient({ envPassthrough: ["GITHUB_TOKEN"] }).run({ instruction: "x", context: {}, tools: [] });
    expect(opts().env.GITHUB_TOKEN).toBe("ghp_secret");
  });

  it("run: auth precedence still applies after scoping (OAuth strips the API key)", async () => {
    vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN", "oauth-x");
    await new ClaudeClient().run({ instruction: "x", context: {}, tools: [] });
    expect(opts().env.CLAUDE_CODE_OAUTH_TOKEN).toBe("oauth-x");
    expect(opts().env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it("run: no sandbox option locally by default", async () => {
    await new ClaudeClient({ sandboxProbe: () => undefined }).run({ instruction: "x", context: {}, tools: [] });
    expect(opts().sandbox).toBeUndefined();
  });

  it("run: sandbox option passed in CI, with node hosts", async () => {
    vi.stubEnv("CI", "true");
    await new ClaudeClient({ sandboxProbe: () => undefined }).run({
      instruction: "x",
      context: {},
      tools: [],
      agentAccess: { envVars: [], domains: ["api.linear.app"] },
    });
    expect(opts().sandbox).toMatchObject({ enabled: true, failIfUnavailable: true, allowUnsandboxedCommands: false });
    expect(opts().sandbox.network.allowedDomains).toContain("api.linear.app");
  });

  it("run: sandbox forced on locally via option; off in CI via SWENY_SANDBOX=off", async () => {
    await new ClaudeClient({ sandbox: "on", sandboxProbe: () => undefined }).run({
      instruction: "x",
      context: {},
      tools: [],
    });
    expect(opts().sandbox?.enabled).toBe(true);

    mockQuery.mockClear();
    vi.stubEnv("CI", "true");
    vi.stubEnv("SWENY_SANDBOX", "off");
    await new ClaudeClient({ sandboxProbe: () => "missing bwrap" }).run({ instruction: "x", context: {}, tools: [] });
    expect(opts().sandbox).toBeUndefined();
  });

  it("run: CI + unsupported sandbox fails closed without calling the SDK", async () => {
    vi.stubEnv("CI", "true");
    const result = await new ClaudeClient({ sandboxProbe: () => "missing bwrap and socat on PATH" }).run({
      instruction: "x",
      context: {},
      tools: [],
    });
    expect(mockQuery).not.toHaveBeenCalled();
    expect(result.status).toBe("failed");
    expect(result.data.error).toMatch(/Agent sandbox is required/);
    expect(result.data.error).toMatch(/SWENY_SANDBOX=off/);
  });

  it("evaluate/ask: scoped env, no sandbox (no tools to sandbox)", async () => {
    vi.stubEnv("CI", "true");
    const client = new ClaudeClient({ sandboxProbe: () => "unsupported" });
    await client.evaluate({ question: "q", context: {}, choices: [{ id: "a", description: "a" }] });
    expect(opts().env.SWENY_RANDOM_UNLISTED_7f3a).toBeUndefined();
    expect(opts().sandbox).toBeUndefined();

    mockQuery.mockClear();
    await client.ask({ instruction: "q", context: {} });
    expect(opts().env.GITHUB_TOKEN).toBeUndefined();
    expect(opts().sandbox).toBeUndefined();
  });
});
