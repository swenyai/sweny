/**
 * #360 step 1: scoped agent env + sandbox (auto / strict / off).
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
  resolveEnvScope,
  formatWithheldWarning,
  scopeAgentEnv,
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
  it("grants no skill env var, withholds every skill's, and keeps the node's provider hosts", () => {
    const skills = createSkillMap([github, linear]);
    const access = resolveAgentAccess(["github"], skills);
    expect(access.envVars).toEqual([]);
    expect(access.withhold).toEqual(expect.arrayContaining(["GITHUB_TOKEN", "LINEAR_API_KEY"]));
    expect(access.domains).toContain("api.github.com");
    expect(access.domains).not.toContain("api.linear.app");
  });

  it("grants only what agent_env names", () => {
    const access = resolveAgentAccess(["github"], createSkillMap([github]), ["GITHUB_TOKEN"]);
    expect(access.envVars).toEqual(["GITHUB_TOKEN"]);
  });

  it("ignores unknown skills", () => {
    expect(resolveAgentAccess(["nope"], createSkillMap([]))).toEqual({ envVars: [], domains: [], withhold: [] });
  });
});

describe("resolveSandboxMode", () => {
  it("defaults to off locally and auto in CI", () => {
    expect(resolveSandboxMode({})).toBe("off");
    expect(resolveSandboxMode({ CI: "false" })).toBe("off");
    expect(resolveSandboxMode({ CI: "true" })).toBe("auto");
  });

  it("an explicit value wins both ways", () => {
    expect(resolveSandboxMode({ SWENY_SANDBOX: "auto" })).toBe("auto");
    expect(resolveSandboxMode({ SWENY_SANDBOX: "strict" })).toBe("strict");
    expect(resolveSandboxMode({ CI: "true", SWENY_SANDBOX: "off" })).toBe("off");
    expect(resolveSandboxMode({}, "auto")).toBe("auto");
  });

  it("parses off / strict and the on alias", () => {
    expect(resolveSandboxMode({ SWENY_SANDBOX: "off" })).toBe("off");
    expect(resolveSandboxMode({ SWENY_SANDBOX: "false" })).toBe("off");
    expect(resolveSandboxMode({ SWENY_SANDBOX: "strict" })).toBe("strict");
    expect(resolveSandboxMode({ SWENY_SANDBOX: "on" })).toBe("strict");
    expect(resolveSandboxMode({ SWENY_SANDBOX: "off" }, "strict")).toBe("strict");
  });

  it("unknown value warns and falls back to the default", () => {
    const warn = vi.fn();
    expect(resolveSandboxMode({ CI: "true", SWENY_SANDBOX: "maybe" }, undefined, { warn })).toBe("auto");
    expect(resolveSandboxMode({ SWENY_SANDBOX: "maybe" }, undefined, { warn })).toBe("off");
    expect(warn).toHaveBeenCalledTimes(2);
  });
});

describe("checkSandboxSupport", () => {
  it("macOS is supported", () => {
    expect(checkSandboxSupport("darwin", "", () => false)).toBeUndefined();
  });
  it("Windows is not", () => {
    expect(checkSandboxSupport("win32", "", () => true)).toMatch(/does not support platform "win32"/);
  });
  it("Linux needs bwrap and socat on PATH, with the install command", () => {
    const works = () => undefined;
    expect(checkSandboxSupport("linux", "/usr/bin", () => false, works)).toMatch(
      /missing bwrap and socat on PATH \(install: sudo apt-get install -y bubblewrap socat\)/,
    );
    expect(checkSandboxSupport("linux", "/usr/bin", (p) => p.endsWith("bwrap"), works)).toMatch(/missing socat/);
    expect(checkSandboxSupport("linux", "/usr/bin", () => true, works)).toBeUndefined();
  });
  it("Linux with binaries present still fails when bwrap cannot create a sandbox", () => {
    expect(
      checkSandboxSupport(
        "linux",
        "/usr/bin",
        () => true,
        () => "bwrap cannot create a sandbox (x)",
      ),
    ).toMatch(/bwrap cannot create a sandbox/);
  });
});

describe("resolveAgentSandbox", () => {
  it("off: no settings, no error, no warning", () => {
    expect(resolveAgentSandbox({ env: { SWENY_SANDBOX: "off" }, probe: () => undefined })).toEqual({ mode: "off" });
  });

  it("auto on a supported host: settings with default + node + configured hosts, degrade not fail", () => {
    const { settings, error, warning } = resolveAgentSandbox({
      env: { CI: "true", SWENY_SANDBOX_ALLOWED_DOMAINS: "internal.example.com, *.corp.example" },
      nodeDomains: ["api.linear.app"],
      probe: () => undefined,
    });
    expect(error).toBeUndefined();
    expect(warning).toBeUndefined();
    expect(settings).toMatchObject({
      enabled: true,
      failIfUnavailable: false,
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

  it("strict on a supported host: failIfUnavailable true", () => {
    const r = resolveAgentSandbox({ env: { SWENY_SANDBOX: "strict" }, probe: () => undefined });
    expect(r.settings?.failIfUnavailable).toBe(true);
  });

  it("auto on an unsupported host: falls back unsandboxed with an actionable warning", () => {
    const r = resolveAgentSandbox({ env: { CI: "true" }, probe: () => "missing bwrap on PATH (install: x)" });
    expect(r.settings).toBeUndefined();
    expect(r.error).toBeUndefined();
    expect(r.warning).toMatch(/unavailable: missing bwrap on PATH \(install: x\)/);
    expect(r.warning).toMatch(/UNSANDBOXED/);
    expect(r.warning).toMatch(/SWENY_SANDBOX=strict/);
  });

  it("strict on an unsupported host: fails closed", () => {
    const r = resolveAgentSandbox({ env: { SWENY_SANDBOX: "strict" }, probe: () => "missing bwrap on PATH" });
    expect(r.settings).toBeUndefined();
    expect(r.error).toMatch(/required \(SWENY_SANDBOX=strict\) but unavailable: missing bwrap/);
  });
});

describe("applyAgentFileConfig (.sweny.yml -> SWENY_* env)", () => {
  it("maps sandbox / env-passthrough / sandbox-allowed-domains; real env wins", async () => {
    const { applyAgentFileConfig } = await import("../cli/config-file.js");
    const env: NodeJS.ProcessEnv = { SWENY_SANDBOX: "strict" };
    applyAgentFileConfig(
      {
        sandbox: "off",
        "env-passthrough": ["NPM_TOKEN", "FOO"],
        "sandbox-allowed-domains": ["internal.example.com"],
      },
      env,
    );
    expect(env.SWENY_SANDBOX).toBe("strict");
    expect(env.SWENY_ENV_PASSTHROUGH).toBe("NPM_TOKEN,FOO");
    expect(env.SWENY_SANDBOX_ALLOWED_DOMAINS).toBe("internal.example.com");
  });

  it("accepts the env_passthrough spelling and YAML booleans", async () => {
    const { applyAgentFileConfig } = await import("../cli/config-file.js");
    const env: NodeJS.ProcessEnv = {};
    applyAgentFileConfig({ env_passthrough: ["BAR"], sandbox: "false" }, env);
    expect(env.SWENY_ENV_PASSTHROUGH).toBe("BAR");
    expect(resolveSandboxMode(env)).toBe("off");
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
    vi.stubEnv("CI", "true");
    vi.stubEnv("GITHUB_ACTIONS", "");
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
  const supported = () => undefined;
  const logger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() });

  it("run: env excludes a random unlisted var; a granted (agent_env) skill var is present", async () => {
    const client = new ClaudeClient({ sandboxProbe: supported });
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
    await new ClaudeClient({ sandboxProbe: supported }).run({ instruction: "x", context: {}, tools: [] });
    expect(opts().env.GITHUB_TOKEN).toBeUndefined();
  });

  it("run: SWENY_ENV_PASSTHROUGH and the envPassthrough option add names", async () => {
    vi.stubEnv("SWENY_ENV_PASSTHROUGH", "SWENY_RANDOM_UNLISTED_7f3a");
    await new ClaudeClient({ sandboxProbe: supported }).run({ instruction: "x", context: {}, tools: [] });
    expect(opts().env.SWENY_RANDOM_UNLISTED_7f3a).toBe("leak-me");

    // A skill credential never rides on passthrough: only a node's agent_env grants it.
    mockQuery.mockClear();
    vi.stubEnv("SWENY_ENV_PASSTHROUGH", "");
    const log = logger();
    await new ClaudeClient({ envPassthrough: ["GITHUB_TOKEN"], sandboxProbe: supported, logger: log }).run({
      instruction: "x",
      context: {},
      tools: [],
    });
    expect(opts().env.GITHUB_TOKEN).toBeUndefined();
    expect(log.warn.mock.calls.some((c: unknown[]) => /agent_env/.test(String(c[0])))).toBe(true);
  });

  it("run: with scoping off a skill credential is still withheld unless granted", async () => {
    vi.stubEnv("SWENY_ENV_SCOPE", "off");
    await new ClaudeClient({ sandboxProbe: supported }).run({ instruction: "x", context: {}, tools: [] });
    expect(opts().env.GITHUB_TOKEN).toBeUndefined();
    expect(opts().env.SWENY_RANDOM_UNLISTED_7f3a).toBe("leak-me");

    mockQuery.mockClear();
    await new ClaudeClient({ sandboxProbe: supported }).run({
      instruction: "x",
      context: {},
      tools: [],
      agentAccess: { envVars: ["GITHUB_TOKEN"], domains: [] },
    });
    expect(opts().env.GITHUB_TOKEN).toBe("ghp_secret");
  });

  it("run: auth precedence still applies after scoping (OAuth strips the API key)", async () => {
    vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN", "oauth-x");
    await new ClaudeClient({ sandboxProbe: supported }).run({ instruction: "x", context: {}, tools: [] });
    expect(opts().env.CLAUDE_CODE_OAUTH_TOKEN).toBe("oauth-x");
    expect(opts().env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it("run: CI default (auto) on a supported host passes the sandbox option; local default passes none", async () => {
    await new ClaudeClient({ sandboxProbe: supported }).run({
      instruction: "x",
      context: {},
      tools: [],
      agentAccess: { envVars: [], domains: ["api.linear.app"] },
    });
    expect(opts().sandbox).toMatchObject({ enabled: true, failIfUnavailable: false, allowUnsandboxedCommands: false });
    expect(opts().sandbox.network.allowedDomains).toContain("api.linear.app");

    mockQuery.mockClear();
    vi.stubEnv("CI", "");
    await new ClaudeClient({ sandboxProbe: supported }).run({ instruction: "x", context: {}, tools: [] });
    expect(opts().sandbox).toBeUndefined();

    mockQuery.mockClear();
    vi.stubEnv("SWENY_SANDBOX", "auto");
    await new ClaudeClient({ sandboxProbe: supported }).run({ instruction: "x", context: {}, tools: [] });
    expect(opts().sandbox?.enabled).toBe(true);
  });

  it("run: auto on an unsupported host warns once and runs unsandboxed", async () => {
    const log = logger();
    const client = new ClaudeClient({ sandboxProbe: () => "missing bwrap and socat on PATH", logger: log });
    const r1 = await client.run({ instruction: "x", context: {}, tools: [] });
    await client.run({ instruction: "y", context: {}, tools: [] });
    expect(r1.status).toBe("success");
    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(opts().sandbox).toBeUndefined();
    // Env scoping still applies when unsandboxed.
    expect(opts().env.SWENY_RANDOM_UNLISTED_7f3a).toBeUndefined();
    const sandboxWarns = log.warn.mock.calls.filter((c: unknown[]) => /Agent sandbox unavailable/.test(String(c[0])));
    expect(sandboxWarns).toHaveLength(1);
    expect(sandboxWarns[0][0]).toMatch(/missing bwrap and socat on PATH/);
    expect(sandboxWarns[0][0]).toMatch(/SWENY_SANDBOX=strict/);
  });

  it("run: the fallback warning is a GitHub annotation under Actions", async () => {
    vi.stubEnv("GITHUB_ACTIONS", "true");
    const log = logger();
    await new ClaudeClient({ sandboxProbe: () => "missing bwrap", logger: log }).run({
      instruction: "x",
      context: {},
      tools: [],
    });
    expect(
      log.warn.mock.calls.some((c: unknown[]) => String(c[0]).startsWith("::warning title=SWEny agent sandbox::")),
    ).toBe(true);
  });

  it("run: strict on an unsupported host fails closed without calling the SDK", async () => {
    vi.stubEnv("SWENY_SANDBOX", "strict");
    const result = await new ClaudeClient({
      sandboxProbe: () => "missing bwrap and socat on PATH",
      logger: logger(),
    }).run({ instruction: "x", context: {}, tools: [] });
    expect(mockQuery).not.toHaveBeenCalled();
    expect(result.status).toBe("failed");
    expect(result.data.error).toMatch(/Agent sandbox is required \(SWENY_SANDBOX=strict\)/);
  });

  it("run: strict via the client option passes failIfUnavailable true; off passes nothing", async () => {
    await new ClaudeClient({ sandbox: "strict", sandboxProbe: supported }).run({
      instruction: "x",
      context: {},
      tools: [],
    });
    expect(opts().sandbox?.failIfUnavailable).toBe(true);

    mockQuery.mockClear();
    vi.stubEnv("SWENY_SANDBOX", "off");
    await new ClaudeClient({ sandboxProbe: supported }).run({ instruction: "x", context: {}, tools: [] });
    expect(opts().sandbox).toBeUndefined();
  });

  it("evaluate/ask: scoped env, no sandbox (no tools to sandbox)", async () => {
    vi.stubEnv("SWENY_SANDBOX", "strict");
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

// ─── Env scope on/off (default on in CI, off locally) ──────────

describe("resolveEnvScope", () => {
  it("defaults to off locally and on in CI", () => {
    expect(resolveEnvScope({})).toBe(false);
    expect(resolveEnvScope({ CI: "false" })).toBe(false);
    expect(resolveEnvScope({ CI: "true" })).toBe(true);
  });

  it("an explicit value wins both ways", () => {
    expect(resolveEnvScope({ SWENY_ENV_SCOPE: "on" })).toBe(true);
    expect(resolveEnvScope({ CI: "true", SWENY_ENV_SCOPE: "off" })).toBe(false);
    expect(resolveEnvScope({ CI: "true" }, false)).toBe(false);
    expect(resolveEnvScope({}, true)).toBe(true);
  });

  it("unknown value warns and uses the default", () => {
    const warn = vi.fn();
    expect(resolveEnvScope({ CI: "true", SWENY_ENV_SCOPE: "maybe" }, undefined, { warn })).toBe(true);
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe("withheld-vars warning", () => {
  it("scopeAgentEnv reports withheld names only", () => {
    const { env, withheld } = scopeAgentEnv({ PATH: "/bin", DATABASE_URL: "postgres://u:hunter2@db" });
    expect(env.PATH).toBe("/bin");
    expect(withheld).toEqual(["DATABASE_URL"]);
  });

  it("lists names sorted, never values, capped at 30 plus 'and N more', with the passthrough hint", () => {
    const names = Array.from({ length: 35 }, (_, i) => `VAR_${String(i).padStart(2, "0")}`).reverse();
    const msg = formatWithheldWarning(names);
    expect(msg).toContain("withheld 35 environment variable(s)");
    expect(msg).toContain("VAR_00, VAR_01");
    expect(msg).toContain("VAR_29");
    expect(msg).not.toContain("VAR_30");
    expect(msg).toContain("and 5 more");
    expect(msg).toContain("env-passthrough");
  });
});

describe("ClaudeClient env scope wiring", () => {
  let mockQuery: ReturnType<typeof vi.fn>;
  let ClaudeClient: any;

  beforeEach(async () => {
    mockQuery = vi.fn().mockImplementation(() =>
      (async function* () {
        yield { type: "result", subtype: "success", result: "ok" };
      })(),
    );
    vi.doMock("@anthropic-ai/claude-agent-sdk", () => ({
      query: mockQuery,
      createSdkMcpServer: vi.fn().mockReturnValue({ type: "sdk", name: "sweny-core" }),
      tool: vi.fn(),
    }));
    ClaudeClient = (await import("../claude.js")).ClaudeClient;
    vi.stubEnv("CI", "");
    vi.stubEnv("GITHUB_ACTIONS", "");
    vi.stubEnv("SWENY_SANDBOX", "off");
    vi.stubEnv("SWENY_ENV_SCOPE", "");
    vi.stubEnv("SWENY_ENV_PASSTHROUGH", "");
    vi.stubEnv("DATABASE_URL", "postgres://u:hunter2@db");
    vi.stubEnv("BASE_URL", "http://localhost:3000");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  const envAt = (i: number) => mockQuery.mock.calls[i][0].options.env;
  const logger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() });
  const run = (client: any) => client.run({ instruction: "x", context: {}, tools: [] });

  it("local default passes the full env and does not warn", async () => {
    const log = logger();
    await run(new ClaudeClient({ logger: log }));
    expect(envAt(0).DATABASE_URL).toBe("postgres://u:hunter2@db");
    expect(envAt(0).BASE_URL).toBe("http://localhost:3000");
    expect(log.warn.mock.calls.some((c: unknown[]) => /withheld/.test(String(c[0])))).toBe(false);
  });

  it("CI default scopes the env", async () => {
    vi.stubEnv("CI", "true");
    await run(new ClaudeClient({ logger: logger() }));
    expect(envAt(0).DATABASE_URL).toBeUndefined();
    expect(envAt(0).PATH).toBe(process.env.PATH);
  });

  it("explicit override both ways: on locally, off in CI (env var and client option)", async () => {
    vi.stubEnv("SWENY_ENV_SCOPE", "on");
    await run(new ClaudeClient({ logger: logger() }));
    expect(envAt(0).DATABASE_URL).toBeUndefined();

    vi.stubEnv("CI", "true");
    vi.stubEnv("SWENY_ENV_SCOPE", "off");
    await run(new ClaudeClient({ logger: logger() }));
    expect(envAt(1).DATABASE_URL).toBe("postgres://u:hunter2@db");

    vi.stubEnv("SWENY_ENV_SCOPE", "");
    await run(new ClaudeClient({ envScope: false, logger: logger() }));
    expect(envAt(2).DATABASE_URL).toBe("postgres://u:hunter2@db");
  });

  it("reports once per process: a plain info summary, plus a GitHub annotation listing only non-baseline names", async () => {
    vi.stubEnv("CI", "true");
    vi.stubEnv("GITHUB_ACTIONS", "true");
    vi.stubEnv("ANDROID_HOME", "/usr/local/lib/android");
    vi.stubEnv("ACCEPT_EULA", "Y");
    const log = logger();
    const client = new ClaudeClient({ logger: log });
    await run(client);
    await run(client);
    await client.ask({ instruction: "q", context: {} });
    await run(new ClaudeClient({ logger: log }));
    const infos = log.info.mock.calls.map((c: unknown[]) => String(c[0])).filter((m: string) => /env scoped/.test(m));
    expect(infos).toHaveLength(1);
    expect(infos[0]).not.toContain("::warning");
    expect(infos[0]).toMatch(/\(\d+ withheld, \d+ from the CI image\)/);
    const warns = log.warn.mock.calls.map((c: unknown[]) => String(c[0])).filter((m: string) => /withheld/.test(m));
    expect(warns).toHaveLength(1);
    expect(warns[0].startsWith("::warning title=SWEny agent env::")).toBe(true);
    expect(warns[0]).toContain("BASE_URL");
    expect(warns[0]).toContain("DATABASE_URL");
    expect(warns[0]).not.toContain("ANDROID_HOME");
    expect(warns[0]).not.toContain("ACCEPT_EULA");
    expect(warns[0]).not.toContain("hunter2");
    expect(warns[0]).not.toContain("localhost:3000");
    const dbg = log.debug.mock.calls.map((c: unknown[]) => String(c[0])).find((m: string) => /env withheld/.test(m));
    expect(dbg).toContain("ANDROID_HOME");
  });

  it("maps .sweny.yml env-scope to SWENY_ENV_SCOPE", async () => {
    const { applyAgentFileConfig } = await import("../cli/config-file.js");
    const env: NodeJS.ProcessEnv = {};
    applyAgentFileConfig({ "env-scope": "off" }, env);
    expect(env.SWENY_ENV_SCOPE).toBe("off");
  });
});
