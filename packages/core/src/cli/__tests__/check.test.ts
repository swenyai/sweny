import { describe, it, expect, vi, afterEach } from "vitest";
import { resolveCheckAuthMode, redactUrl, checkAnthropicGateway, checkDatadog } from "../check.js";

type AuthFields = Parameters<typeof resolveCheckAuthMode>[0];

function auth(over: Partial<AuthFields> = {}): AuthFields {
  return { anthropicApiKey: "", anthropicAuthToken: "", claudeOauthToken: "", swenyAuth: "auto", ...over };
}

describe("resolveCheckAuthMode", () => {
  it("auto: OAuth wins when present (protective)", () => {
    expect(resolveCheckAuthMode(auth({ claudeOauthToken: "o", anthropicApiKey: "k" }))).toBe("oauth");
  });

  it("auto: api-key when only a key is present", () => {
    expect(resolveCheckAuthMode(auth({ anthropicApiKey: "k" }))).toBe("api-key");
  });

  it("auto: auth-token when only a bearer is present", () => {
    expect(resolveCheckAuthMode(auth({ anthropicAuthToken: "b" }))).toBe("auth-token");
  });

  it("auto: none when nothing is configured", () => {
    expect(resolveCheckAuthMode(auth())).toBe("none");
  });

  it("oauth mode: oauth when token present, else none", () => {
    expect(resolveCheckAuthMode(auth({ swenyAuth: "oauth", claudeOauthToken: "o", anthropicApiKey: "k" }))).toBe(
      "oauth",
    );
    expect(resolveCheckAuthMode(auth({ swenyAuth: "oauth", anthropicApiKey: "k" }))).toBe("none");
  });

  it("api-key mode: prefers key, then bearer, ignoring a present OAuth token", () => {
    expect(
      resolveCheckAuthMode(
        auth({ swenyAuth: "api-key", claudeOauthToken: "o", anthropicApiKey: "k", anthropicAuthToken: "b" }),
      ),
    ).toBe("api-key");
    expect(resolveCheckAuthMode(auth({ swenyAuth: "api-key", anthropicAuthToken: "b" }))).toBe("auth-token");
    expect(resolveCheckAuthMode(auth({ swenyAuth: "api-key" }))).toBe("none");
  });
});

describe("redactUrl", () => {
  it("keeps scheme + host only", () => {
    expect(redactUrl("https://litellm.internal:4000/v1/messages")).toBe("https://litellm.internal:4000");
  });

  it("drops userinfo and query (which can carry a credential)", () => {
    expect(redactUrl("https://user:secret@gw.example.com/v1?api_key=leak")).toBe("https://gw.example.com");
  });

  it("returns a safe placeholder for an invalid URL", () => {
    expect(redactUrl("not a url")).toBe("(invalid URL)");
  });
});

describe("checkAnthropicGateway", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubFetch(impl: (url: string, init: any) => Promise<{ ok: boolean; status: number }>) {
    const spy = vi.fn(impl);
    vi.stubGlobal("fetch", spy);
    return spy;
  }

  it("probes the gateway base (not real Anthropic) with x-api-key in api-key mode", async () => {
    const spy = stubFetch(async () => ({ ok: true, status: 200 }));
    const res = await checkAnthropicGateway("https://gw.example.com", auth({ anthropicApiKey: "k" }), "api-key");
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe("https://gw.example.com/v1/models");
    expect(url).not.toContain("api.anthropic.com");
    expect(init.headers["x-api-key"]).toBe("k");
    expect(init.headers.Authorization).toBeUndefined();
    expect(res.status).toBe("ok");
  });

  it("uses Authorization: Bearer for auth-token mode", async () => {
    const spy = stubFetch(async () => ({ ok: true, status: 200 }));
    await checkAnthropicGateway("https://gw.example.com", auth({ anthropicAuthToken: "b" }), "auth-token");
    expect(spy.mock.calls[0][1].headers.Authorization).toBe("Bearer b");
  });

  it("treats 404 as reachable (gateways may not implement /v1/models)", async () => {
    stubFetch(async () => ({ ok: false, status: 404 }));
    const res = await checkAnthropicGateway("https://gw.example.com", auth({ anthropicApiKey: "k" }), "api-key");
    expect(res.status).toBe("ok");
  });

  it("fails on 401/403 with a redacted base and no secret", async () => {
    stubFetch(async () => ({ ok: false, status: 401 }));
    const res = await checkAnthropicGateway(
      "https://user:supersecret@gw.example.com/v1",
      auth({ anthropicApiKey: "supersecret" }),
      "api-key",
    );
    expect(res.status).toBe("fail");
    expect(res.detail).toContain("https://gw.example.com");
    expect(res.detail).not.toContain("supersecret");
  });

  it("fails on an unexpected status", async () => {
    stubFetch(async () => ({ ok: false, status: 500 }));
    const res = await checkAnthropicGateway("https://gw.example.com", auth({ anthropicApiKey: "k" }), "api-key");
    expect(res.status).toBe("fail");
  });

  it("fails (not throws) on a network error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
    const res = await checkAnthropicGateway("https://gw.example.com", auth({ anthropicApiKey: "k" }), "api-key");
    expect(res.status).toBe("fail");
  });

  it("strips a trailing slash from the base before appending /v1/models", async () => {
    const spy = stubFetch(async () => ({ ok: true, status: 200 }));
    await checkAnthropicGateway("https://gw.example.com/", auth({ anthropicApiKey: "k" }), "api-key");
    expect(spy.mock.calls[0][0]).toBe("https://gw.example.com/v1/models");
  });

  it("passes an AbortSignal so a hung connect cannot hang the check", async () => {
    const spy = stubFetch(async () => ({ ok: true, status: 200 }));
    await checkAnthropicGateway("https://gw.example.com", auth({ anthropicApiKey: "k" }), "api-key");
    expect(spy.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it("reports a timeout (not a hang) when the abort signal fires", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const err = new Error("The operation was aborted due to timeout");
        err.name = "TimeoutError";
        throw err;
      }),
    );
    const res = await checkAnthropicGateway("https://gw.example.com", auth({ anthropicApiKey: "k" }), "api-key");
    expect(res.status).toBe("fail");
    expect(res.detail).toMatch(/timed out/i);
  });
});

describe("checkDatadog", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubFetch(impl: (url: string, init: any) => Promise<{ ok: boolean; status: number }>) {
    const spy = vi.fn(impl);
    vi.stubGlobal("fetch", spy);
    return spy;
  }

  it("builds the api.<site> URL and passes an AbortSignal for a valid site", async () => {
    const spy = stubFetch(async () => ({ ok: true, status: 200 }));
    const res = await checkDatadog({ apiKey: "a", appKey: "b", site: "datadoghq.eu" });
    expect(spy.mock.calls[0][0]).toBe("https://api.datadoghq.eu/api/v2/validate");
    expect(spy.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    expect(res.status).toBe("ok");
  });

  // Real Datadog sites the allowlist must NOT reject (multi-label hosts,
  // numeric subdomains, hyphenated gov host). Guards against a future
  // "tightening" of the regex that breaks legitimate sites.
  it.each(["datadoghq.com", "datadoghq.eu", "us5.datadoghq.com", "us3.datadoghq.com", "ddog-gov.com"])(
    "accepts the valid site %s and builds the expected URL",
    async (site) => {
      const spy = stubFetch(async () => ({ ok: true, status: 200 }));
      const res = await checkDatadog({ apiKey: "a", appKey: "b", site });
      expect(spy.mock.calls[0][0]).toBe(`https://api.${site}/api/v2/validate`);
      expect(res.status).toBe("ok");
    },
  );

  // Dangerous values that smuggle a path/query/host or credentials into the
  // interpolated URL. All must fail before any fetch.
  it.each(["evil.com/x?", "datadoghq.com/../../x", "datadoghq.com:9999@evil.com", "datadoghq.com ", "DATADOGHQ.COM"])(
    "rejects the dangerous site %j before building the URL (no fetch)",
    async (site) => {
      const spy = stubFetch(async () => ({ ok: true, status: 200 }));
      const res = await checkDatadog({ apiKey: "a", appKey: "b", site });
      expect(spy).not.toHaveBeenCalled();
      expect(res.status).toBe("fail");
      expect(res.detail).toMatch(/Invalid DD_SITE/i);
    },
  );

  it("reports a timeout when the abort signal fires", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const err = new Error("timed out");
        err.name = "TimeoutError";
        throw err;
      }),
    );
    const res = await checkDatadog({ apiKey: "a", appKey: "b" });
    expect(res.status).toBe("fail");
    expect(res.detail).toMatch(/timed out/i);
  });
});

// ── #382: check agrees with run about auth and scope ─────────────────────

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  detectClaudeCodeLogin,
  discoverWorkflowSkillIds,
  validateCheckInputs,
  checkProviderConnectivity,
  checkAgent,
  runCheck,
} from "../check.js";
import { parseCliInputs } from "../config.js";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sweny-check-"));
}

function baseConfig() {
  const keys = [
    "ANTHROPIC_API_KEY",
    "CLAUDE_CODE_OAUTH_TOKEN",
    "ANTHROPIC_AUTH_TOKEN",
    "GITHUB_TOKEN",
    "GITHUB_REPOSITORY",
  ];
  const saved: Record<string, string | undefined> = {};
  for (const k of keys) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  try {
    return parseCliInputs({}, {});
  } finally {
    for (const k of keys) if (saved[k] !== undefined) process.env[k] = saved[k];
  }
}

describe("detectClaudeCodeLogin", () => {
  it("true when ~/.claude/.credentials.json exists", () => {
    const home = tmpDir();
    fs.mkdirSync(path.join(home, ".claude"));
    fs.writeFileSync(path.join(home, ".claude", ".credentials.json"), "{}");
    expect(detectClaudeCodeLogin({ env: {}, home, platform: "linux" })).toBe(true);
  });

  it("honors CLAUDE_CONFIG_DIR", () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, ".credentials.json"), "{}");
    expect(detectClaudeCodeLogin({ env: { CLAUDE_CONFIG_DIR: dir }, home: tmpDir(), platform: "linux" })).toBe(true);
  });

  it("false with no file on linux", () => {
    expect(detectClaudeCodeLogin({ env: {}, home: tmpDir(), platform: "linux" })).toBe(false);
  });

  it("uses the macOS keychain probe when no file exists", () => {
    const base = { env: {}, platform: "darwin" as const };
    expect(detectClaudeCodeLogin({ ...base, home: tmpDir(), keychainHasLogin: () => true })).toBe(true);
    expect(detectClaudeCodeLogin({ ...base, home: tmpDir(), keychainHasLogin: () => false })).toBe(false);
    expect(
      detectClaudeCodeLogin({
        ...base,
        home: tmpDir(),
        keychainHasLogin: () => {
          throw new Error("boom");
        },
      }),
    ).toBe(false);
  });
});

describe("discoverWorkflowSkillIds", () => {
  it("reports found=false when there are no workflow files", () => {
    expect(discoverWorkflowSkillIds(tmpDir())).toEqual({ found: false, skillIds: new Set() });
  });

  it("collects skills across workflow files; a no-skill workflow is found with an empty set", () => {
    const cwd = tmpDir();
    const dir = path.join(cwd, ".sweny", "workflows");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "a.yml"),
      "id: a\nnodes:\n  x:\n    skills: [github]\n  y:\n    skills: [linear]\n",
    );
    fs.writeFileSync(path.join(dir, "b.yml"), "id: b\nnodes:\n  z:\n    name: Z\n");
    const r = discoverWorkflowSkillIds(cwd);
    expect(r.found).toBe(true);
    expect([...r.skillIds].sort()).toEqual(["github", "linear"]);

    const only = tmpDir();
    fs.mkdirSync(path.join(only, ".sweny", "workflows"), { recursive: true });
    fs.writeFileSync(path.join(only, ".sweny", "workflows", "s.yml"), "id: s\nnodes:\n  a:\n    name: A\n");
    expect(discoverWorkflowSkillIds(only)).toEqual({ found: true, skillIds: new Set() });
  });
});

describe("validateCheckInputs", () => {
  it("Claude Code login satisfies agent auth (no ANTHROPIC_API_KEY demanded)", () => {
    const errors = validateCheckInputs(baseConfig(), { scope: new Set(), claudeCodeLogin: true, env: {} });
    expect(errors).toEqual([]);
  });

  it("without login, reports only the auth error for a no-skill workflow (no token, no repository)", () => {
    const errors = validateCheckInputs(baseConfig(), { scope: new Set(), claudeCodeLogin: false, env: {} });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN/);
  });

  it("requires exactly the credentials the workflow skills need", () => {
    const errors = validateCheckInputs(baseConfig(), { scope: new Set(["github"]), claudeCodeLogin: true, env: {} });
    expect(errors).toEqual(['Missing: GITHUB_TOKEN (needed by skill "github")']);
    const ok = validateCheckInputs(baseConfig(), {
      scope: new Set(["github"]),
      claudeCodeLogin: true,
      env: { GITHUB_TOKEN: "t" },
    });
    expect(ok).toEqual([]);
  });

  it("legacy (no workflows) still demands the repository, login aside", () => {
    const errors = validateCheckInputs({ ...baseConfig(), repository: "" }, { claudeCodeLogin: true, env: {} });
    expect(errors.some((e) => /repository/i.test(e))).toBe(true);
    expect(errors.some((e) => /ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN/.test(e))).toBe(false);
  });
});

describe("checkProviderConnectivity scope", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("a no-skill workflow with a Claude Code login checks only the agent, with no network", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("network must not be used");
    });
    vi.stubGlobal("fetch", fetchMock);
    const configDir = tmpDir();
    fs.writeFileSync(path.join(configDir, ".credentials.json"), "{}");
    const results = await checkProviderConnectivity(baseConfig(), {
      scope: new Set(),
      env: { CLAUDE_CONFIG_DIR: configDir },
    });
    expect(results.map((r) => r.name)).toEqual(["Agent CLI (claude)", "Anthropic (claude agent)"]);
    expect(results[1]).toMatchObject({ status: "ok" });
    expect(results[1].detail).toMatch(/Claude Code login/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ── #532: every agent's lines come from its harness ──────────────────────

describe("checkAgent", () => {
  it("renders whatever the harness's diagnose() returns, in order, with no agent branch", async () => {
    const lines = [
      { name: "Agent CLI (codex)", status: "ok" as const, detail: "0.159.2 (/bin/codex)" },
      { name: "Agent auth (codex)", status: "fail" as const, detail: "Missing: OPENAI_API_KEY" },
    ];
    const diagnose = vi.fn(async () => lines);
    const results = await checkAgent({ ...baseConfig(), codingAgentProvider: "codex" }, { harness: { diagnose } });
    expect(results).toEqual(lines);
    expect(diagnose).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 5000 }));
  });

  it("hands diagnose() the env with the agent settings .sweny.yml can carry", async () => {
    const diagnose = vi.fn(async (_opts?: { env?: Record<string, string | undefined> }) => []);
    const config = { ...baseConfig(), anthropicBaseUrl: "https://gw.example.com", swenyAuth: "oauth" as const };
    await checkAgent(config, { harness: { diagnose }, env: { PATH: "/fake", HOME: "/h" } });
    const env = diagnose.mock.calls[0][0]!.env!;
    expect(env).toMatchObject({
      PATH: "/fake",
      HOME: "/h",
      ANTHROPIC_BASE_URL: "https://gw.example.com",
      SWENY_AUTH: "oauth",
    });
  });

  it("an unsupported agent fails with the supported list", async () => {
    const results = await checkAgent({ ...baseConfig(), codingAgentProvider: "gpt-pilot" });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ name: "Coding agent (gpt-pilot)", status: "fail" });
    expect(results[0].detail).toMatch(/Unsupported coding agent "gpt-pilot"/);
  });

  it("a harness with no diagnose() is a skip, not a failure", async () => {
    const results = await checkAgent({ ...baseConfig(), codingAgentProvider: "pi" }, { harness: {} });
    expect(results).toEqual([
      { name: "Coding agent (pi)", status: "skip", detail: "This agent has no preflight checks" },
    ]);
  });

  it("drives the real Codex harness: a missing CLI is a failed line, not a thrown error", async () => {
    const results = await checkAgent(
      { ...baseConfig(), codingAgentProvider: "codex" },
      { env: { PATH: tmpDir(), HOME: tmpDir() } },
    );
    expect(results[0]).toMatchObject({ name: "Agent CLI (codex)", status: "fail" });
  });
});

describe("runCheck (#532)", () => {
  afterEach(() => vi.unstubAllGlobals());

  const harness = (lines: { name: string; status: "ok" | "fail" | "skip"; detail: string }[], pre: unknown) => ({
    diagnose: vi.fn(async () => lines),
    preflight: vi.fn(async () => pre as { ok: true; version: string } | { ok: false; reason: string }),
  });

  it("the gate fails but no line says why: its reason is added as a failed line, and check fails", async () => {
    const h = harness([{ name: "Anthropic (claude agent)", status: "skip", detail: "No credential configured" }], {
      ok: false,
      reason: "Missing: ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN, for --agent claude",
    });
    const report = await runCheck(baseConfig(), { scope: new Set(), harness: h, env: {} });
    expect(report.results).toEqual([
      { name: "Anthropic (claude agent)", status: "skip", detail: "No credential configured" },
      {
        name: "Agent (claude)",
        status: "fail",
        detail: "Missing: ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN, for --agent claude",
      },
    ]);
    expect(report.failed).toBe(true);
    // validateInputs' generic agent-auth line is replaced by the harness's own lines.
    expect(report.errors).toEqual([]);
  });

  it("an agent line already failed: its diagnosis stands alone, the gate is not asked", async () => {
    const h = harness([{ name: "Agent CLI (codex)", status: "fail", detail: "codex CLI not found" }], {
      ok: true,
      version: "x",
    });
    const report = await runCheck(
      { ...baseConfig(), codingAgentProvider: "codex" },
      { scope: new Set(), harness: h, env: {} },
    );
    expect(report.results).toEqual([{ name: "Agent CLI (codex)", status: "fail", detail: "codex CLI not found" }]);
    expect(h.preflight).not.toHaveBeenCalled();
    expect(report.failed).toBe(true);
  });

  it("all good: the agent lines only, no duplicate 'ready' line, check passes", async () => {
    const h = harness([{ name: "Agent CLI (pi)", status: "ok", detail: "1.0.0" }], { ok: true, version: "1.0.0" });
    const report = await runCheck(
      { ...baseConfig(), codingAgentProvider: "pi" },
      { scope: new Set(), harness: h, env: {} },
    );
    expect(report.results).toEqual([{ name: "Agent CLI (pi)", status: "ok", detail: "1.0.0" }]);
    expect(report.failed).toBe(false);
  });

  it("config errors still render the agent's lines and skip the provider probes", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("network must not be used");
    });
    vi.stubGlobal("fetch", fetchMock);
    const h = harness([{ name: "Agent CLI (pi)", status: "ok", detail: "1.0.0" }], { ok: true, version: "1.0.0" });
    const report = await runCheck(
      { ...baseConfig(), codingAgentProvider: "pi" },
      { scope: new Set(["github"]), harness: h, env: {} },
    );
    expect(report.results).toEqual([{ name: "Agent CLI (pi)", status: "ok", detail: "1.0.0" }]);
    expect(report.errors.some((e) => e.includes("GITHUB_TOKEN"))).toBe(true);
    expect(report.failed).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("an unsupported agent is one failed line, not also a config error", async () => {
    const report = await runCheck({ ...baseConfig(), codingAgentProvider: "gpt-pilot" }, { scope: new Set(), env: {} });
    expect(report.results).toHaveLength(1);
    expect(report.results[0]).toMatchObject({ name: "Coding agent (gpt-pilot)", status: "fail" });
    expect(report.errors).toEqual([]);
  });
});
