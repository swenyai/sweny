import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { NodePolicy } from "./types.js";

// ClaudeCodeHarness behind the seam (#330): the SDK query options must be the
// ones ClaudeClient.ask / ClaudeClient.evaluate passed before the refactor.

function resultStream(result: string) {
  return (async function* () {
    yield { type: "result", subtype: "success", result };
  })();
}

function failedStream(subtype: string) {
  return (async function* () {
    yield { type: "result", subtype };
  })();
}

describe("ClaudeCodeHarness", () => {
  let mockQuery: ReturnType<typeof vi.fn>;
  let mod: typeof import("./claude-code.js");
  let index: typeof import("./index.js");
  const noopLogger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() });

  beforeEach(async () => {
    mockQuery = vi.fn();
    vi.doMock("@anthropic-ai/claude-agent-sdk", () => ({
      query: mockQuery,
      createSdkMcpServer: vi.fn().mockReturnValue({ type: "sdk", name: "sweny-core" }),
      tool: vi.fn(),
    }));
    vi.stubEnv("SWENY_SANDBOX", "off");
    mod = await import("./claude-code.js");
    index = await import("./index.js");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  /** The exact options object ask()/evaluate() handed the SDK before the seam. */
  const classificationOptions = (extra: Record<string, unknown> = {}) => ({
    maxTurns: 1,
    cwd: process.cwd(),
    env: expect.any(Object),
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    tools: [],
    mcpServers: {},
    strictMcpConfig: true,
    disallowedTools: ["Bash", "Write", "Edit", "MultiEdit", "NotebookEdit", "WebFetch", "WebSearch"],
    stderr: expect.any(Function),
    ...extra,
  });

  it("ask() passes the same query options as before", async () => {
    mockQuery.mockReturnValueOnce(resultStream("answer"));
    const h = new mod.ClaudeCodeHarness({ logger: noopLogger() });
    expect(await h.ask({ instruction: "Judge it.", context: {} })).toBe("answer");
    const call = mockQuery.mock.calls[0][0];
    expect(call.prompt).toBe("Judge it.");
    expect(call.options).toEqual(classificationOptions());
  });

  it("ask() with a per-call model passes it through", async () => {
    mockQuery.mockReturnValueOnce(resultStream("a"));
    await new mod.ClaudeCodeHarness({ logger: noopLogger() }).ask({
      instruction: "x",
      context: {},
      model: "claude-haiku-4-5",
    });
    expect(mockQuery.mock.calls[0][0].options).toEqual(classificationOptions({ model: "claude-haiku-4-5" }));
  });

  it("evaluate() passes the same query options as before (client default model only)", async () => {
    mockQuery.mockReturnValueOnce(resultStream("beta"));
    const h = new mod.ClaudeCodeHarness({ logger: noopLogger(), model: "client-model" });
    const choice = await h.evaluate({
      question: "Which?",
      context: { a: 1 },
      choices: [{ id: "beta", description: "b" }],
    });
    expect(choice).toBe("beta");
    const call = mockQuery.mock.calls[0][0];
    expect(call.prompt).toBe(mod.buildEvaluatePrompt("Which?", { a: 1 }, [{ id: "beta", description: "b" }]));
    expect(call.options).toEqual(classificationOptions({ model: "client-model" }));
  });

  it("a per-call timeout adds only abortController", async () => {
    mockQuery.mockReturnValueOnce(resultStream("a"));
    await new mod.ClaudeCodeHarness({ logger: noopLogger() }).ask({ instruction: "x", context: {}, timeoutMs: 1000 });
    expect(mockQuery.mock.calls[0][0].options).toEqual(
      classificationOptions({ abortController: expect.any(AbortController) }),
    );
  });

  it("complete() returns null on a non-success result and logs per purpose", async () => {
    const logger = noopLogger();
    const h = new mod.ClaudeCodeHarness({ logger });
    mockQuery.mockReturnValueOnce(failedStream("error_during_execution"));
    expect(await h.complete({ prompt: "p", purpose: "evaluate" })).toBeNull();
    expect(logger.warn).toHaveBeenLastCalledWith(
      expect.stringMatching(/^claude\.evaluate: SDK returned non-success subtype "error_during_execution"/),
    );
    mockQuery.mockReturnValueOnce(failedStream("error_max_turns"));
    expect(await h.complete({ prompt: "p" })).toBeNull();
    expect(logger.warn).toHaveBeenLastCalledWith(
      expect.stringMatching(/^claude\.ask: SDK returned non-success subtype "error_max_turns"/),
    );
  });

  it("complete() returns null when the query throws; ask() maps it to the empty string, evaluate() to null", async () => {
    const logger = noopLogger();
    const h = new mod.ClaudeCodeHarness({ logger });
    mockQuery.mockImplementation(() => {
      throw new Error("sdk down");
    });
    expect(await h.complete({ prompt: "p" })).toBeNull();
    expect(await h.ask({ instruction: "x", context: {} })).toBe("");
    expect(await h.evaluate({ question: "q", context: {}, choices: [{ id: "a", description: "d" }] })).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith("Ask query failed: sdk down");
    expect(logger.warn).toHaveBeenCalledWith("Evaluate query failed: sdk down. Failing closed (no route decision).");
  });

  it("run() fails closed when the stream ends without a result, keeping tool calls and warning", async () => {
    const logger = noopLogger();
    mockQuery.mockReturnValueOnce(
      (async function* () {
        yield {
          type: "assistant",
          message: { content: [{ type: "tool_use", id: "t1", name: "lookup", input: { q: 1 } }] },
        };
      })(),
    );
    const h = new mod.ClaudeCodeHarness({ logger });
    const r = await h.run({ instruction: "x", context: {}, tools: [] });
    expect(r.status).toBe("failed");
    expect(r.data.error).toBe("agent stream ended without a result message");
    expect(r.data.summary).toBeUndefined();
    expect(r.toolCalls).toHaveLength(1);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("ended without a result message"));
  });

  it("complete() returns null when the stream ends without a result; ask() maps it to the empty string", async () => {
    const logger = noopLogger();
    const h = new mod.ClaudeCodeHarness({ logger });
    mockQuery.mockReturnValueOnce((async function* () {})());
    expect(await h.complete({ prompt: "p", purpose: "evaluate" })).toBeNull();
    expect(logger.warn).toHaveBeenLastCalledWith(
      expect.stringMatching(/^claude\.evaluate: agent stream ended without a result message/),
    );
    mockQuery.mockReturnValueOnce((async function* () {})());
    expect(await h.ask({ instruction: "x", context: {} })).toBe("");
  });

  it("run() tags the result with the harness and an empty degraded list", async () => {
    mockQuery.mockReturnValueOnce(resultStream("done"));
    const h = new mod.ClaudeCodeHarness({ logger: noopLogger() });
    const r = await h.run({ instruction: "x", context: {}, tools: [] });
    expect(r.status).toBe("success");
    expect(r.degraded).toEqual([]);
    expect(r.harness.id).toBe("claude-code");
    expect(typeof r.harness.version).toBe("string");
    expect(r.harness.version.length).toBeGreaterThan(0);
  });

  it("a fail-closed run (sandbox strict, unsupported) is tagged too", async () => {
    vi.stubEnv("SWENY_SANDBOX", "strict");
    const h = new mod.ClaudeCodeHarness({ logger: noopLogger(), sandboxProbe: () => "unsupported host" });
    const r = await h.run({ instruction: "x", context: {}, tools: [] });
    expect(r.status).toBe("failed");
    expect(r.data.refused).toBe(true);
    expect(r.degraded).toEqual([]);
    expect(r.harness.id).toBe("claude-code");
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("reports the floor it ran under: scoped env and a started sandbox", async () => {
    mockQuery.mockReturnValueOnce(resultStream("done"));
    const h = new mod.ClaudeCodeHarness({
      logger: noopLogger(),
      envScope: true,
      sandbox: "auto",
      sandboxProbe: () => undefined,
    });
    const r = await h.run({ instruction: "x", context: {}, tools: [] });
    expect(r.policy).toEqual({ envScope: true, sandbox: "auto", sandboxStarted: true });
  });

  it("reports an auto sandbox that could not start, and an unscoped env", async () => {
    mockQuery.mockReturnValueOnce(resultStream("done"));
    const h = new mod.ClaudeCodeHarness({
      logger: noopLogger(),
      envScope: false,
      sandbox: "auto",
      sandboxProbe: () => "unsupported host",
    });
    const r = await h.run({ instruction: "x", context: {}, tools: [] });
    expect(r.policy).toEqual({ envScope: false, sandbox: "auto", sandboxStarted: false });
  });

  it("declares honest capabilities and preflights ok", async () => {
    const h = new mod.ClaudeCodeHarness({ logger: noopLogger(), authProbe: () => ({ ok: true, via: "test" }) });
    expect(h.id).toBe("claude-code");
    expect(h.capabilities.builtinDeny).toBe("by-name");
    expect(h.capabilities.readOnly).toBe("native");
    expect(h.capabilities.structuredOutput).toBe("native");
    expect(h.defaultJudgeModel).toBe("claude-haiku-4-5");
    expect(await h.preflight()).toMatchObject({ ok: true });
  });

  it("preflight fails with the login fix when Claude Code has no auth (#339)", async () => {
    const h = new mod.ClaudeCodeHarness({
      logger: noopLogger(),
      authProbe: () => ({ ok: false, reason: "Claude Code has no login. Set ANTHROPIC_API_KEY" }),
    });
    const pre = await h.preflight();
    expect(pre.ok).toBe(false);
    expect(!pre.ok && pre.reason).toMatch(/Claude Code has no login/);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  describe("policy compile (#365)", () => {
    const policy = (over: Partial<NodePolicy> = {}): NodePolicy => ({
      readOnly: false,
      deny: [],
      egress: [],
      strict: false,
      ...over,
    });

    it("a strict request refuses an unsupported host even when the client sandbox is off", async () => {
      mockQuery.mockReturnValueOnce(resultStream("must not run"));
      const probe = vi.fn(() => "unsupported host");
      const h = new mod.ClaudeCodeHarness({ logger: noopLogger(), sandbox: "off", sandboxProbe: probe });
      const result = await h.run({
        instruction: "x",
        context: {},
        tools: [],
        policy: policy({ sandbox: "strict" }),
      });
      expect(result.status).toBe("failed");
      expect(result.data.refused).toBe(true);
      expect(probe).toHaveBeenCalledOnce();
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it("a supported strict request uses its policy hosts and preserves legacy env access", async () => {
      mockQuery.mockReturnValueOnce(resultStream("done"));
      vi.stubEnv("SWENY_REQUEST_TEST_KEY", "synthetic-value");
      const h = new mod.ClaudeCodeHarness({
        logger: noopLogger(),
        sandbox: "off",
        sandboxProbe: () => undefined,
        envScope: true,
      });
      const result = await h.run({
        instruction: "x",
        context: {},
        tools: [],
        agentAccess: { domains: ["legacy.example.test"], envVars: ["SWENY_REQUEST_TEST_KEY"] },
        policy: policy({ sandbox: "strict", egress: ["policy.example.test"] }),
      });
      expect(result.status).toBe("success");
      const options = mockQuery.mock.calls[0][0].options;
      expect(options.sandbox.enabled).toBe(true);
      expect(options.sandbox.network.allowedDomains).toContain("policy.example.test");
      expect(options.sandbox.network.allowedDomains).not.toContain("legacy.example.test");
      expect(options.env.SWENY_REQUEST_TEST_KEY).toBe("synthetic-value");
    });

    describe("env overlay", () => {
      type Req = Partial<Parameters<InstanceType<typeof mod.ClaudeCodeHarness>["run"]>[0]>;
      const runEnv = async (opts: Record<string, unknown>, req: Req = {}) => {
        mockQuery.mockReturnValueOnce(resultStream("done"));
        const h = new mod.ClaudeCodeHarness({ logger: noopLogger(), ...opts });
        await h.run({ instruction: "x", context: {}, tools: [], ...req });
        return mockQuery.mock.calls.at(-1)![0].options.env as Record<string, string>;
      };

      it("is applied after scoping and passthrough, and wins over both", async () => {
        vi.stubEnv("SWENY_OVERLAY_PASS", "from-parent");
        vi.stubEnv("HOME", "/parent/home");
        const env = await runEnv({
          envScope: true,
          envPassthrough: ["SWENY_OVERLAY_PASS"],
          env: { SWENY_OVERLAY_PASS: "from-overlay", HOME: "/run/home", CLAUDE_CONFIG_DIR: "/run/claude" },
        });
        expect(env.SWENY_OVERLAY_PASS).toBe("from-overlay");
        expect(env.HOME).toBe("/run/home");
        expect(env.CLAUDE_CONFIG_DIR).toBe("/run/claude");
      });

      it("envRemove drops names from the subprocess env, then the overlay is applied", async () => {
        vi.stubEnv("SWENY_OVERLAY_RAW", "raw");
        vi.stubEnv("SWENY_OVERLAY_KEEP", "keep");
        const env = await runEnv({
          envScope: false,
          envRemove: ["SWENY_OVERLAY_RAW", "SWENY_OVERLAY_BOTH"],
          env: { SWENY_OVERLAY_BOTH: "set-again" },
        });
        expect(env).not.toHaveProperty("SWENY_OVERLAY_RAW");
        expect(env.SWENY_OVERLAY_KEEP).toBe("keep");
        expect(env.SWENY_OVERLAY_BOTH).toBe("set-again");
      });

      for (const envScope of [true, false]) {
        it(`an overlaid skill credential is withheld unless the node grants it (env scope ${envScope ? "on" : "off"})`, async () => {
          const overlay = {
            env: { GITHUB_TOKEN: "overlay-gh", SLACK_BOT_TOKEN: "overlay-slack", MY_SKILL_KEY: "overlay-custom" },
            envScope,
          };
          const withheld = await runEnv(overlay, {
            agentAccess: { envVars: [], domains: [], withhold: ["MY_SKILL_KEY"] },
          });
          expect(withheld).not.toHaveProperty("GITHUB_TOKEN");
          expect(withheld).not.toHaveProperty("SLACK_BOT_TOKEN");
          expect(withheld).not.toHaveProperty("MY_SKILL_KEY");
          const granted = await runEnv(overlay, {
            agentAccess: { envVars: ["GITHUB_TOKEN", "MY_SKILL_KEY"], domains: [], withhold: ["MY_SKILL_KEY"] },
          });
          expect(granted.GITHUB_TOKEN).toBe("overlay-gh");
          expect(granted.MY_SKILL_KEY).toBe("overlay-custom");
          expect(granted).not.toHaveProperty("SLACK_BOT_TOKEN");
        });
      }

      it("an overlaid login replaces the inherited one instead of sitting beside it", async () => {
        vi.stubEnv("ANTHROPIC_API_KEY", "parent-key");
        vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "parent-bearer");
        vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN", "");
        const env = await runEnv({ envScope: true, env: { CLAUDE_CODE_OAUTH_TOKEN: "run-oauth" } });
        expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe("run-oauth");
        expect(env).not.toHaveProperty("ANTHROPIC_API_KEY");
        expect(env).not.toHaveProperty("ANTHROPIC_AUTH_TOKEN");

        // And the other way: an overlaid key replaces an inherited OAuth token.
        vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN", "parent-oauth");
        const keyed = await runEnv({ envScope: false, env: { ANTHROPIC_API_KEY: "run-key" } });
        expect(keyed.ANTHROPIC_API_KEY).toBe("run-key");
        expect(keyed).not.toHaveProperty("CLAUDE_CODE_OAUTH_TOKEN");
      });

      it("auth precedence runs on the overlaid env, with the mode from process.env", async () => {
        const both = { CLAUDE_CODE_OAUTH_TOKEN: "run-oauth", ANTHROPIC_API_KEY: "run-key" };
        const auto = await runEnv({ envScope: false, env: both });
        expect(auto.CLAUDE_CODE_OAUTH_TOKEN).toBe("run-oauth");
        expect(auto).not.toHaveProperty("ANTHROPIC_API_KEY");
        // An overlaid SWENY_AUTH reaches the agent but does not change sweny's own mode.
        const overlaidMode = await runEnv({ envScope: false, env: { ...both, SWENY_AUTH: "api-key" } });
        expect(overlaidMode.SWENY_AUTH).toBe("api-key");
        expect(overlaidMode).not.toHaveProperty("ANTHROPIC_API_KEY");
        vi.stubEnv("SWENY_AUTH", "api-key");
        const apiKeyMode = await runEnv({ envScope: false, env: both });
        expect(apiKeyMode.ANTHROPIC_API_KEY).toBe("run-key");
      });

      it("a staged run's push block lands on top of the overlay", async () => {
        const env = await runEnv(
          {
            envScope: true,
            env: {
              GIT_ASKPASS: "/overlay/askpass",
              GH_CONFIG_DIR: "/overlay/gh",
              GIT_CONFIG_COUNT: "1",
              GIT_CONFIG_KEY_0: "user.name",
              GIT_CONFIG_VALUE_0: "overlay",
              GIT_CONFIG_PARAMETERS: "'push.default'='current'",
              GITHUB_TOKEN: "overlay-gh",
            },
          },
          { agentAccess: { envVars: ["GITHUB_TOKEN"], domains: [], noPush: true } },
        );
        expect(env.GIT_ASKPASS).not.toBe("/overlay/askpass");
        expect(env.GIT_ASKPASS).toMatch(/askpass$/);
        expect(env.GH_CONFIG_DIR).not.toBe("/overlay/gh");
        expect(env.GIT_CONFIG_KEY_0).toBe("user.name");
        expect(env.GIT_CONFIG_KEY_1).toBe("credential.helper");
        expect(Number(env.GIT_CONFIG_COUNT)).toBeGreaterThan(1);
        expect(env).not.toHaveProperty("GIT_CONFIG_PARAMETERS");
        expect(env).not.toHaveProperty("GITHUB_TOKEN");
      });

      it("reaches complete() as well as run()", async () => {
        vi.stubEnv("SWENY_OVERLAY_RAW", "raw");
        mockQuery.mockReturnValueOnce(resultStream("a"));
        const h = new mod.ClaudeCodeHarness({
          logger: noopLogger(),
          envScope: false,
          envRemove: ["SWENY_OVERLAY_RAW"],
          env: { CLAUDE_CONFIG_DIR: "/run/claude", GITHUB_TOKEN: "overlay-gh" },
        });
        expect(await h.complete({ prompt: "p" })).toBe("a");
        const env = mockQuery.mock.calls[0][0].options.env as Record<string, string>;
        expect(env.CLAUDE_CONFIG_DIR).toBe("/run/claude");
        expect(env).not.toHaveProperty("SWENY_OVERLAY_RAW");
        expect(env).not.toHaveProperty("GITHUB_TOKEN");
      });

      it("copies the options: changing them after construction has no effect", async () => {
        const overlay: Record<string, string> = { CLAUDE_CONFIG_DIR: "/run/claude" };
        const remove = ["SWENY_OVERLAY_RAW"];
        vi.stubEnv("SWENY_OVERLAY_RAW", "raw");
        mockQuery.mockReturnValueOnce(resultStream("done"));
        const h = new mod.ClaudeCodeHarness({ logger: noopLogger(), envScope: false, env: overlay, envRemove: remove });
        overlay.CLAUDE_CONFIG_DIR = "/changed";
        overlay.SWENY_OVERLAY_ADDED = "added";
        remove.length = 0;
        await h.run({ instruction: "x", context: {}, tools: [] });
        const env = mockQuery.mock.calls[0][0].options.env as Record<string, string>;
        expect(env.CLAUDE_CONFIG_DIR).toBe("/run/claude");
        expect(env).not.toHaveProperty("SWENY_OVERLAY_ADDED");
        expect(env).not.toHaveProperty("SWENY_OVERLAY_RAW");
      });

      // Frozen: what origin/main (before env / envRemove) built from this exact process env.
      const FIXTURE_PROCESS_ENV = {
        PATH: "/usr/bin:/bin",
        HOME: "/home/op",
        LANG: "C.UTF-8",
        CI: "true",
        SWENY_SANDBOX: "off",
        ANTHROPIC_API_KEY: "parent-key",
        CLAUDE_CODE_OAUTH_TOKEN: "parent-oauth",
        CLAUDE_CODE_USE_BEDROCK: "1",
        AWS_REGION: "us-east-1",
        GITHUB_TOKEN: "parent-gh",
        SLACK_BOT_TOKEN: "parent-slack",
        DATABASE_URL: "postgres://x",
      };
      const FROZEN_SCOPED = {
        PATH: "/usr/bin:/bin",
        HOME: "/home/op",
        LANG: "C.UTF-8",
        CI: "true",
        CLAUDE_CODE_OAUTH_TOKEN: "parent-oauth",
        CLAUDE_CODE_USE_BEDROCK: "1",
        AWS_REGION: "us-east-1",
      };
      const FROZEN_UNSCOPED = { ...FROZEN_SCOPED, SWENY_SANDBOX: "off", DATABASE_URL: "postgres://x" };

      for (const [envScope, frozen] of [
        [true, FROZEN_SCOPED],
        [false, FROZEN_UNSCOPED],
      ] as const) {
        it(`no options build the same env as before this change (env scope ${envScope ? "on" : "off"})`, async () => {
          const saved = process.env;
          process.env = { ...FIXTURE_PROCESS_ENV };
          try {
            expect(await runEnv({ envScope })).toEqual(frozen);
          } finally {
            process.env = saved;
          }
        });
      }

      it("absent options and an empty overlay give the same env as the plain build", async () => {
        vi.stubEnv("SWENY_OVERLAY_KEEP", "keep");
        vi.stubEnv("ANTHROPIC_API_KEY", "parent-key");
        vi.stubEnv("GITHUB_TOKEN", "parent-gh");
        const absent = await runEnv({ envScope: false });
        // `env: {}` and `envRemove: []` are set, so this build runs the overlay (copy) path.
        const empty = await runEnv({ envScope: false, env: {}, envRemove: [] });
        expect(empty).toEqual(absent);
        expect(absent.SWENY_OVERLAY_KEEP).toBe("keep");
        expect(absent.ANTHROPIC_API_KEY).toBe("parent-key");
        expect(absent).not.toHaveProperty("GITHUB_TOKEN");
      });

      it("never mutates process.env", async () => {
        vi.stubEnv("SWENY_OVERLAY_RAW", "raw");
        const before = { ...process.env };
        await runEnv({ envRemove: ["SWENY_OVERLAY_RAW"], env: { SWENY_OVERLAY_NEW: "x", HOME: "/run/home" } });
        expect(process.env).toEqual(before);
        expect(process.env.SWENY_OVERLAY_NEW).toBeUndefined();
      });

      it("preflight's default login probe sees the overlay and envRemove", async () => {
        vi.stubEnv("ANTHROPIC_API_KEY", "parent-key");
        vi.stubEnv("SWENY_AUTH", "auto");
        const seen: Array<Record<string, string | undefined>> = [];
        vi.resetModules();
        vi.doMock("./auth.js", async (orig) => ({
          ...(await orig<typeof import("./auth.js")>()),
          claudeCodeAuth: (env: Record<string, string | undefined>) => {
            seen.push({ ...env });
            return { ok: true, via: "test" };
          },
        }));
        const fresh = await import("./claude-code.js");
        await new fresh.ClaudeCodeHarness({
          logger: noopLogger(),
          envRemove: ["SWENY_OVERLAY_RAW"],
          env: { CLAUDE_CODE_OAUTH_TOKEN: "run-oauth", CLAUDE_CONFIG_DIR: "/run/claude", SWENY_AUTH: "api-key" },
        }).preflight();
        await new fresh.ClaudeCodeHarness({ logger: noopLogger(), envRemove: ["ANTHROPIC_API_KEY"] }).preflight();
        vi.doUnmock("./auth.js");
        expect(seen[0].CLAUDE_CODE_OAUTH_TOKEN).toBe("run-oauth");
        expect(seen[0].CLAUDE_CONFIG_DIR).toBe("/run/claude");
        // The overlay's login replaces the parent key for the probe as for the agent.
        expect(seen[0]).not.toHaveProperty("ANTHROPIC_API_KEY");
        // sweny's own settings stay as process.env has them.
        expect(seen[0].SWENY_AUTH).toBe("auto");
        expect(seen[1]).not.toHaveProperty("ANTHROPIC_API_KEY");
      });

      for (const [label, overlay, file] of [
        ["HOME", { HOME: "/run/home" }, "/run/home/.claude/.credentials.json"],
        ["CLAUDE_CONFIG_DIR", { CLAUDE_CONFIG_DIR: "/run/claude" }, "/run/claude/.credentials.json"],
      ] as const) {
        it(`the sandbox denies the login file an overlaid ${label} selects, and the host's`, async () => {
          const env = { ...overlay } as Record<string, string>;
          mockQuery.mockReturnValueOnce(resultStream("done"));
          const h = new mod.ClaudeCodeHarness({
            logger: noopLogger(),
            sandbox: "strict",
            sandboxProbe: () => undefined,
            env,
          });
          await h.run({ instruction: "x", context: {}, tools: [] });
          const paths = (mockQuery.mock.calls[0][0].options.sandbox.credentials.files as Array<{ path: string }>).map(
            (f) => f.path,
          );
          expect(paths).toContain(file);
          expect(paths).toContain(path.join(os.homedir(), ".claude", ".credentials.json"));
        });
      }

      it("the sandbox denies an inherited CLAUDE_CONFIG_DIR login with no overlay", async () => {
        vi.stubEnv("CLAUDE_CONFIG_DIR", "/opt/inherited-claude");
        mockQuery.mockReturnValueOnce(resultStream("done"));
        const h = new mod.ClaudeCodeHarness({ logger: noopLogger(), sandbox: "strict", sandboxProbe: () => undefined });
        await h.run({ instruction: "x", context: {}, tools: [] });
        const paths = (mockQuery.mock.calls[0][0].options.sandbox.credentials.files as Array<{ path: string }>).map(
          (f) => f.path,
        );
        expect(paths).toContain("/opt/inherited-claude/.credentials.json");
      });

      it("an overlaid CLAUDE_CODE_USE_BEDROCK keeps the inherited AWS_* vars under scoping", async () => {
        vi.stubEnv("CLAUDE_CODE_USE_BEDROCK", "");
        vi.stubEnv("AWS_REGION", "us-east-1");
        vi.stubEnv("AWS_ACCESS_KEY_ID", "aws-key");
        const plain = await runEnv({ envScope: true });
        expect(plain).not.toHaveProperty("AWS_REGION");
        const env = await runEnv({ envScope: true, env: { CLAUDE_CODE_USE_BEDROCK: "1" } });
        expect(env.CLAUDE_CODE_USE_BEDROCK).toBe("1");
        expect(env.AWS_REGION).toBe("us-east-1");
        expect(env.AWS_ACCESS_KEY_ID).toBe("aws-key");
      });

      it("preflight finds a Claude Code login under the overlaid HOME (real login helpers)", async () => {
        const home = fs.mkdtempSync(path.join(os.tmpdir(), "sweny-cc-home-"));
        try {
          fs.mkdirSync(path.join(home, ".claude"));
          fs.writeFileSync(path.join(home, ".claude", ".credentials.json"), "{}");
          for (const k of [
            "CLAUDE_CODE_USE_BEDROCK",
            "CLAUDE_CODE_USE_VERTEX",
            "CLAUDE_CODE_OAUTH_TOKEN",
            "ANTHROPIC_API_KEY",
            "ANTHROPIC_AUTH_TOKEN",
            "CLAUDE_CONFIG_DIR",
          ]) {
            vi.stubEnv(k, "");
          }
          const h = new mod.ClaudeCodeHarness({ logger: noopLogger(), env: { HOME: home } });
          expect(await h.preflight()).toMatchObject({ ok: true });
        } finally {
          fs.rmSync(home, { recursive: true, force: true });
        }
      });

      it("rejects a bad overlay at construction", () => {
        const make = (o: Record<string, unknown>) => () => new mod.ClaudeCodeHarness({ logger: noopLogger(), ...o });
        expect(make({ env: { A: 1 } })).toThrow(/env: value for A must be a string/);
        expect(make({ env: { "": "x" } })).toThrow(/invalid env var name/);
        expect(make({ env: { "A=B": "x" } })).toThrow(/invalid env var name/);
        expect(make({ env: { "A\0B": "x" } })).toThrow(/invalid env var name/);
        expect(make({ envRemove: ["A=B"] })).toThrow(/envRemove: invalid env var name/);
        expect(make({ envRemove: "A" })).toThrow(/envRemove: must be an array/);
      });
    });

    it("policy.deny classes reach the SDK as native disallowedTools, merged with the legacy names", async () => {
      mockQuery.mockReturnValueOnce(resultStream("done"));
      const h = new mod.ClaudeCodeHarness({ logger: noopLogger() });
      await h.run({
        instruction: "x",
        context: {},
        tools: [],
        disallowedTools: ["Glob"],
        policy: policy({ deny: ["shell", "net"], nativeDeny: ["Glob"] }),
      });
      const opts = mockQuery.mock.calls[0][0].options;
      expect(opts.disallowedTools).toEqual(["Glob", "Bash", "WebFetch", "WebSearch", ...mod.claudeStateDirDenyRules()]);
      expect(opts.strictMcpConfig).toBe(true);
    });

    it("every class compiles to at least one native name", () => {
      for (const c of ["shell", "write", "edit", "net", "subagent"] as const) {
        expect(mod.compileClaudeCodeDeny(policy({ deny: [c] })).length, c).toBeGreaterThan(0);
      }
    });

    it("policy.readOnly alone is a read-only run (no legacy flag needed)", async () => {
      mockQuery.mockReturnValueOnce(resultStream("done"));
      const h = new mod.ClaudeCodeHarness({
        logger: noopLogger(),
        mcpServers: { github: { type: "http", url: "https://example.test/mcp" } },
      });
      await h.run({ instruction: "x", context: {}, tools: [], policy: policy({ readOnly: true }) });
      const opts = mockQuery.mock.calls[0][0].options;
      for (const t of mod.READ_ONLY_DISALLOWED_TOOLS) expect(opts.disallowedTools).toContain(t);
      expect(opts.mcpServers).toBeUndefined();
      expect(opts.strictMcpConfig).toBe(true);
    });

    it("strict makes MCP exclusive on a write-capable node", async () => {
      mockQuery.mockReturnValueOnce(resultStream("done"));
      const h = new mod.ClaudeCodeHarness({
        logger: noopLogger(),
        mcpServers: { github: { type: "http", url: "https://example.test/mcp" } },
      });
      await h.run({ instruction: "x", context: {}, tools: [], policy: policy({ strict: true }) });
      const opts = mockQuery.mock.calls[0][0].options;
      expect(opts.strictMcpConfig).toBe(true);
      // Still write-capable: its own servers stay, no built-in is denied (only the journals' state dir).
      expect(Object.keys(opts.mcpServers)).toEqual(["github"]);
      expect(opts.disallowedTools).toEqual(mod.claudeStateDirDenyRules());
    });

    it("without a policy the legacy fields behave exactly as before", async () => {
      mockQuery.mockReturnValueOnce(resultStream("done"));
      const h = new mod.ClaudeCodeHarness({ logger: noopLogger() });
      await h.run({ instruction: "x", context: {}, tools: [], disallowedTools: ["Bash"] });
      const opts = mockQuery.mock.calls[0][0].options;
      expect(opts.disallowedTools).toEqual(["Bash", ...mod.claudeStateDirDenyRules()]);
      expect(opts.strictMcpConfig).toBe(true);
    });

    it("auto past its preflight enforces the sandbox (fail, not degrade) and reports the agent contained", async () => {
      vi.stubEnv("SWENY_SANDBOX", "auto");
      mockQuery.mockReturnValueOnce(resultStream("done"));
      const h = new mod.ClaudeCodeHarness({ logger: noopLogger(), sandboxProbe: () => undefined });
      const r = await h.run({ instruction: "x", context: {}, tools: [] });
      expect(mockQuery.mock.calls.at(-1)![0].options.sandbox).toMatchObject({ enabled: true, failIfUnavailable: true });
      expect(r.contained).toBe(true);
    });

    it("auto whose preflight fails runs unsandboxed and reports the agent not contained", async () => {
      vi.stubEnv("SWENY_SANDBOX", "auto");
      mockQuery.mockReturnValueOnce(resultStream("done"));
      const h = new mod.ClaudeCodeHarness({ logger: noopLogger(), sandboxProbe: () => "no bubblewrap" });
      const r = await h.run({ instruction: "x", context: {}, tools: [] });
      expect(mockQuery.mock.calls.at(-1)![0].options.sandbox).toBeUndefined();
      expect(r.contained).toBe(false);
    });

    it("every run loads only the MCP servers sweny passes, and no filesystem settings or plugins", async () => {
      for (const p of [policy({}), policy({ readOnly: true }), undefined]) {
        mockQuery.mockReturnValueOnce(resultStream("done"));
        const h = new mod.ClaudeCodeHarness({
          logger: noopLogger(),
          mcpServers: { github: { type: "http", url: "https://example.test/mcp" } },
        });
        await h.run({ instruction: "x", context: {}, tools: [], ...(p ? { policy: p } : {}) });
        const opts = mockQuery.mock.calls.at(-1)![0].options;
        // No user/project .mcp.json, settings or plugin servers: a filesystem MCP could read the state dir.
        expect(opts.strictMcpConfig).toBe(true);
        expect(opts.settingSources).toEqual([]);
        expect(opts.plugins).toBeUndefined();
      }
    });

    it("every run denies the built-in file tools the run journals' state dir, read and write", async () => {
      vi.stubEnv("SWENY_STATE_DIR", "/srv/sweny-state");
      for (const readOnly of [false, true]) {
        mockQuery.mockReturnValueOnce(resultStream("done"));
        const h = new mod.ClaudeCodeHarness({ logger: noopLogger() });
        await h.run({ instruction: "x", context: {}, tools: [], ...(readOnly ? { readOnly } : {}) });
        const denied: string[] = mockQuery.mock.calls.at(-1)![0].options.disallowedTools;
        // Absolute (`//`) scoped deny rules: Read covers Read/Grep/Glob, Edit covers Edit/Write/NotebookEdit.
        for (const rule of [
          "Read(//srv/sweny-state/runs)",
          "Read(//srv/sweny-state/runs/**)",
          "Edit(//srv/sweny-state/runs)",
          "Edit(//srv/sweny-state/runs/**)",
        ]) {
          expect(denied, `${rule} (readOnly: ${readOnly})`).toContain(rule);
        }
      }
    });
  });

  it("ClaudeClient is the same class (deprecated alias)", () => {
    expect(mod.ClaudeClient).toBe(mod.ClaudeCodeHarness);
  });

  describe("createHarness", () => {
    it("builds a ClaudeCodeHarness for claude and claude-code", () => {
      expect(index.createHarness("claude-code", { logger: noopLogger() })).toBeInstanceOf(mod.ClaudeCodeHarness);
      expect(index.createHarness("claude", { logger: noopLogger() })).toBeInstanceOf(mod.ClaudeCodeHarness);
    });

    it("ids without an adapter keep an honest error", () => {
      expect(() => index.createHarness("gemini")).toThrow(
        'Unsupported coding agent "gemini": supported agents are "claude" (headless Claude Code), ' +
          '"codex" (Codex CLI), "pi" (pi coding agent, experimental), or "acp:<command>" (any Agent Client Protocol agent, ' +
          'experimental, for example "acp:opencode acp"). Remove --agent / coding-agent-provider or set it to one of them.',
      );
    });

    it("the CLI validation error in cli/config.ts uses the same words", async () => {
      const fs = await import("node:fs");
      const src = fs.readFileSync(new URL("../cli/config.ts", import.meta.url), "utf-8");
      expect(src).toContain("errors.push(unsupportedAgentError(config.codingAgentProvider));");
    });
  });
});
