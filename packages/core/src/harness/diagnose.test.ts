/**
 * `AgentHarness.diagnose()` (#532), the agent lines of `sweny check`, per
 * harness: missing binary, missing auth, all good, and a version that does not
 * parse. Fake CLIs are shell scripts on a temp PATH; credentials come from a
 * fake env; upstream probes hit a stubbed `fetch`. Never a model call.
 */

import { describe, it, expect, vi, afterEach, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { CodexHarness, TESTED_CODEX_VERSION } from "./codex.js";
import { PiHarness, MIN_PI_VERSION } from "./pi.js";
import { AcpHarness } from "./acp.js";
import { ClaudeCodeHarness } from "./claude-code.js";
import { CODEX_AUTH_HINT } from "./auth.js";
import { diagnoseEnv } from "./diagnose.js";
import { agentEnvOverlay } from "../agent-env.js";
import type { HarnessCheck } from "./types.js";

const dirs: string[] = [];
function tmp(prefix: string): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `sweny-diag-${prefix}-`));
  dirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/** A dir holding one executable `name` that runs `body` under /bin/sh. */
function fakeBin(name: string, body: string): string {
  const bin = tmp("bin");
  const exe = path.join(bin, name);
  fs.writeFileSync(exe, `#!/bin/sh\n${body}\n`);
  fs.chmodSync(exe, 0o755);
  return bin;
}

/** Fake `codex`: `--version` prints `version`; `login status` exits 0 only when FAKE_LOGGED_IN is set. */
function fakeCodex(version = `codex-cli ${TESTED_CODEX_VERSION}`): string {
  return fakeBin(
    "codex",
    [
      'if [ "$1" = "--version" ]; then echo "' + version + '"; exit 0; fi',
      'if [ "$1" = "login" ] && [ "$2" = "status" ]; then',
      '  if [ -n "$FAKE_LOGGED_IN" ]; then echo "Logged in using ChatGPT"; exit 0; fi',
      '  echo "Not logged in" >&2; exit 1',
      "fi",
      "exit 2",
    ].join("\n"),
  );
}

function byName(checks: HarnessCheck[], name: string): HarnessCheck | undefined {
  return checks.find((c) => c.name === name);
}

/** No check line may carry a credential value. */
function expectNoSecret(checks: HarnessCheck[], ...secrets: string[]): void {
  const text = JSON.stringify(checks);
  for (const s of secrets) expect(text).not.toContain(s);
}

function stubFetch(status: number) {
  const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response("{}", { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function noFetch() {
  const fetchMock = vi.fn(async () => {
    throw new Error("network must not be used");
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

// ─── Codex ───────────────────────────────────────────────────────

describe("CodexHarness.diagnose", () => {
  const codex = (opts: ConstructorParameters<typeof CodexHarness>[0] = {}) =>
    new CodexHarness({ codexCommand: { command: "codex", args: [] }, ...opts });

  it("missing binary: the CLI line fails with the install hint", async () => {
    noFetch();
    const checks = await codex().diagnose({ env: { PATH: tmp("empty"), HOME: tmp("home"), OPENAI_API_KEY: "" } });
    expect(byName(checks, "Agent CLI (codex)")).toMatchObject({ status: "fail" });
    expect(byName(checks, "Agent CLI (codex)")!.detail).toMatch(/codex CLI not found.*npm install -g @openai\/codex/);
    // No CLI: there is nothing to ask `codex login status`.
    expect(byName(checks, "Agent login (codex)")).toBeUndefined();
  });

  it("missing auth: no key, no token, no auth.json fails with the Codex hint and skips the login and API lines", async () => {
    const fetchMock = noFetch();
    const checks = await codex().diagnose({ env: { PATH: fakeCodex(), HOME: tmp("home") } });
    expect(byName(checks, "Agent CLI (codex)")).toMatchObject({ status: "ok" });
    expect(byName(checks, "Agent auth (codex)")).toEqual({
      name: "Agent auth (codex)",
      status: "fail",
      detail: CODEX_AUTH_HINT,
    });
    expect(byName(checks, "Agent login (codex)")).toBeUndefined();
    expect(byName(checks, "OpenAI API (codex agent)")).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("all good with an API key: version and path, auth via the key, login skipped, GET /models ok", async () => {
    const fetchMock = stubFetch(200);
    const bin = fakeCodex();
    const key = "sk-test-secret-value-123";
    const checks = await codex().diagnose({ env: { PATH: bin, HOME: tmp("home"), OPENAI_API_KEY: key } });

    expect(byName(checks, "Agent CLI (codex)")).toMatchObject({ status: "ok" });
    expect(byName(checks, "Agent CLI (codex)")!.detail).toContain(TESTED_CODEX_VERSION);
    expect(byName(checks, "Agent CLI (codex)")!.detail).toContain(path.join(bin, "codex"));
    expect(byName(checks, "Agent auth (codex)")).toMatchObject({ status: "ok", detail: "via OPENAI_API_KEY" });
    expect(byName(checks, "Agent login (codex)")).toMatchObject({ status: "skip" });
    expect(byName(checks, "Agent login (codex)")!.detail).toMatch(/no stored login.*OPENAI_API_KEY/);
    expect(byName(checks, "OpenAI API (codex agent)")).toMatchObject({ status: "ok" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://api.openai.com/v1/models");
    expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${key}`);
    expect(init?.method ?? "GET").toBe("GET");
    expectNoSecret(checks, key);
  });

  it("all good with a stored login: codex login status is ok and the API line is skipped", async () => {
    const fetchMock = noFetch();
    const home = tmp("home");
    fs.mkdirSync(path.join(home, ".codex"));
    fs.writeFileSync(path.join(home, ".codex", "auth.json"), "{}");
    const checks = await codex().diagnose({ env: { PATH: fakeCodex(), HOME: home, FAKE_LOGGED_IN: "1" } });
    expect(byName(checks, "Agent auth (codex)")).toMatchObject({ status: "ok", detail: "via codex login" });
    expect(byName(checks, "Agent login (codex)")).toEqual({
      name: "Agent login (codex)",
      status: "ok",
      detail: "logged in with ChatGPT (codex login status)",
    });
    expect(byName(checks, "OpenAI API (codex agent)")).toMatchObject({ status: "skip" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("auth.json present but codex login status says not logged in: the login line fails", async () => {
    noFetch();
    const home = tmp("home");
    fs.mkdirSync(path.join(home, ".codex"));
    fs.writeFileSync(path.join(home, ".codex", "auth.json"), "{}");
    const checks = await codex().diagnose({ env: { PATH: fakeCodex(), HOME: home } });
    expect(byName(checks, "Agent login (codex)")).toMatchObject({ status: "fail" });
    expect(byName(checks, "Agent login (codex)")!.detail).toMatch(/not logged in.*codex login/);
  });

  it("a rejected key fails the API line without printing the key", async () => {
    stubFetch(401);
    const key = "sk-bad-key-456";
    const checks = await codex().diagnose({ env: { PATH: fakeCodex(), HOME: tmp("home"), CODEX_API_KEY: key } });
    expect(byName(checks, "OpenAI API (codex agent)")).toMatchObject({ status: "fail" });
    expect(byName(checks, "OpenAI API (codex agent)")!.detail).toMatch(/401.*CODEX_API_KEY/);
    expectNoSecret(checks, key);
  });

  it("version parse failure: the CLI line fails and no login status is asked", async () => {
    noFetch();
    const checks = await codex().diagnose({
      env: { PATH: fakeCodex("codex-cli nightly"), HOME: tmp("home"), OPENAI_API_KEY: "k" },
    });
    expect(byName(checks, "Agent CLI (codex)")).toEqual({
      name: "Agent CLI (codex)",
      status: "fail",
      detail: 'could not read the codex version from "codex-cli nightly"',
    });
    expect(byName(checks, "Agent login (codex)")).toBeUndefined();
  });

  it("reads the harness env overlay: an overlaid PATH finds the CLI the inherited one does not", async () => {
    stubFetch(200);
    const checks = await codex({ env: { PATH: fakeCodex() } }).diagnose({
      env: { PATH: tmp("empty"), HOME: tmp("home"), OPENAI_API_KEY: "k" },
    });
    expect(byName(checks, "Agent CLI (codex)")).toMatchObject({ status: "ok" });
  });

  it("does not cache: a later preflight still probes the run's own env", async () => {
    noFetch();
    const h = codex();
    await h.diagnose({ env: { PATH: tmp("empty"), HOME: tmp("home") } });
    vi.stubEnv("PATH", fakeCodex());
    vi.stubEnv("CODEX_API_KEY", "k");
    expect(await h.preflight()).toMatchObject({ ok: true, version: TESTED_CODEX_VERSION });
  });
});

// ─── pi ──────────────────────────────────────────────────────────

describe("PiHarness.diagnose", () => {
  const pi = (opts: ConstructorParameters<typeof PiHarness>[0] = {}) =>
    new PiHarness({ piCommand: { command: "pi", args: [] }, modelsFile: undefined, ...opts });
  const fakePi = (out = MIN_PI_VERSION) => fakeBin("pi", `echo "${out}"`);

  it("missing binary: the CLI line fails with the install hint", async () => {
    const checks = await pi().diagnose({ env: { PATH: tmp("empty"), ANTHROPIC_API_KEY: "k" } });
    expect(byName(checks, "Agent CLI (pi)")).toMatchObject({ status: "fail" });
    expect(byName(checks, "Agent CLI (pi)")!.detail).toMatch(/pi CLI not found.*SWENY_PI_PATH/);
    expect(byName(checks, "Agent auth (pi)")).toMatchObject({ status: "ok" });
  });

  it("missing auth: no provider credential fails and names the options", async () => {
    vi.stubEnv("SWENY_PI_MODELS_JSON", "");
    const checks = await pi().diagnose({ env: { PATH: fakePi() } });
    expect(byName(checks, "Agent CLI (pi)")).toMatchObject({ status: "ok" });
    expect(byName(checks, "Agent auth (pi)")).toMatchObject({ status: "fail" });
    expect(byName(checks, "Agent auth (pi)")!.detail).toMatch(/Missing: a model provider credential for pi/);
  });

  it("missing auth for a named provider names its variable", async () => {
    const checks = await pi({ provider: "openai" }).diagnose({ env: { PATH: fakePi() } });
    expect(byName(checks, "Agent auth (pi)")).toEqual({
      name: "Agent auth (pi)",
      status: "fail",
      detail: "Missing: OPENAI_API_KEY for pi provider openai",
    });
  });

  it("all good: version and path, and the credential a run would hand pi, by name only", async () => {
    const bin = fakePi();
    const key = "sk-ant-secret-789";
    const checks = await pi().diagnose({ env: { PATH: bin, ANTHROPIC_API_KEY: key } });
    expect(byName(checks, "Agent CLI (pi)")).toMatchObject({ status: "ok" });
    expect(byName(checks, "Agent CLI (pi)")!.detail).toContain(MIN_PI_VERSION);
    expect(byName(checks, "Agent CLI (pi)")!.detail).toContain(path.join(bin, "pi"));
    expect(byName(checks, "Agent auth (pi)")).toMatchObject({ status: "ok" });
    expect(byName(checks, "Agent auth (pi)")!.detail).toMatch(/via ANTHROPIC_API_KEY/);
    expectNoSecret(checks, key);
  });

  it("a custom models.json counts as auth; a missing one fails", async () => {
    const models = path.join(tmp("models"), "models.json");
    fs.writeFileSync(models, "{}");
    const ok = await pi({ modelsFile: models }).diagnose({ env: { PATH: fakePi() } });
    expect(byName(ok, "Agent auth (pi)")).toMatchObject({ status: "ok" });
    const gone = await pi({ modelsFile: models + ".gone" }).diagnose({ env: { PATH: fakePi() } });
    expect(byName(gone, "Agent auth (pi)")).toMatchObject({ status: "fail" });
  });

  it("version parse failure: the CLI line fails", async () => {
    const checks = await pi().diagnose({ env: { PATH: fakePi("pi dev build"), ANTHROPIC_API_KEY: "k" } });
    expect(byName(checks, "Agent CLI (pi)")).toEqual({
      name: "Agent CLI (pi)",
      status: "fail",
      detail: 'could not read the pi version from "pi dev build"',
    });
  });

  it("too old a version fails with the floor", async () => {
    const checks = await pi().diagnose({ env: { PATH: fakePi("0.1.0"), ANTHROPIC_API_KEY: "k" } });
    expect(byName(checks, "Agent CLI (pi)")!.detail).toBe(`pi 0.1.0 is too old; sweny needs >= ${MIN_PI_VERSION}`);
  });
});

// ─── ACP ─────────────────────────────────────────────────────────

describe("AcpHarness.diagnose", () => {
  it("missing binary: the CLI line fails with the command to check", async () => {
    const checks = await new AcpHarness({ acpCommand: "my-acp-agent acp" }).diagnose({ env: { PATH: tmp("empty") } });
    expect(byName(checks, "Agent CLI (acp:my-acp-agent)")).toMatchObject({ status: "fail" });
    expect(byName(checks, "Agent CLI (acp:my-acp-agent)")!.detail).toMatch(/not found on PATH.*my-acp-agent acp/);
  });

  it("missing auth: a named auth var that is not set fails", async () => {
    const bin = fakeBin("my-acp-agent", "exit 0");
    const h = new AcpHarness({ acpCommand: "my-acp-agent acp", authVars: ["MY_AGENT_TOKEN"] });
    const checks = await h.diagnose({ env: { PATH: bin } });
    expect(byName(checks, "Agent auth (acp:my-acp-agent)")).toEqual({
      name: "Agent auth (acp:my-acp-agent)",
      status: "fail",
      detail: "Missing: MY_AGENT_TOKEN",
    });
  });

  it("all good: the command resolves and the named auth vars are set, by name only", async () => {
    const marker = tmp("marker");
    // The agent is never started: starting it would run outside the sandbox wrapper.
    const bin = fakeBin("my-acp-agent", `touch "${path.join(marker, "started")}"`);
    const h = new AcpHarness({ acpCommand: "my-acp-agent acp", authVars: ["MY_AGENT_TOKEN"] });
    const checks = await h.diagnose({ env: { PATH: bin, MY_AGENT_TOKEN: "tok-secret-1" } });
    expect(byName(checks, "Agent CLI (acp:my-acp-agent)")).toMatchObject({ status: "ok" });
    expect(byName(checks, "Agent CLI (acp:my-acp-agent)")!.detail).toContain(path.join(bin, "my-acp-agent"));
    expect(byName(checks, "Agent auth (acp:my-acp-agent)")).toMatchObject({
      status: "ok",
      detail: "set: MY_AGENT_TOKEN",
    });
    expect(fs.existsSync(path.join(marker, "started"))).toBe(false);
    expectNoSecret(checks, "tok-secret-1");
  });

  it("no auth vars named: the auth line is a skip (the agent owns its login)", async () => {
    const bin = fakeBin("my-acp-agent", "exit 0");
    const checks = await new AcpHarness({ acpCommand: "my-acp-agent acp" }).diagnose({ env: { PATH: bin } });
    expect(byName(checks, "Agent auth (acp:my-acp-agent)")).toMatchObject({ status: "skip" });
  });

  // No version parse case: ACP has no version command; the agent reports its version in `initialize`.
  it("reports that the version comes from the first run", async () => {
    const bin = fakeBin("my-acp-agent", "exit 0");
    const checks = await new AcpHarness({ acpCommand: "my-acp-agent acp" }).diagnose({ env: { PATH: bin } });
    expect(byName(checks, "Agent CLI (acp:my-acp-agent)")!.detail).toMatch(/reports its version when a run starts/);
  });
});

// ─── Claude Code ─────────────────────────────────────────────────

describe("ClaudeCodeHarness.diagnose", () => {
  const claude = () => new ClaudeCodeHarness();

  it("the SDK line is always ok: the CLI ships inside the Agent SDK sweny depends on", async () => {
    noFetch();
    const checks = await claude().diagnose({ env: {}, hasLogin: () => false });
    expect(checks[0].name).toBe("Agent CLI (claude)");
    expect(checks[0].status).toBe("ok");
    expect(checks[0].detail).toMatch(/^Claude Agent SDK \d+\.\d+\.\d+ \(installed with sweny\)$/);
  });

  it("missing auth: no credential and no login is a skip, as before #532", async () => {
    const fetchMock = noFetch();
    const checks = await claude().diagnose({ env: {}, hasLogin: () => false });
    expect(byName(checks, "Anthropic (claude agent)")).toEqual({
      name: "Anthropic (claude agent)",
      status: "skip",
      detail: "No credential configured",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a stored login is ok with no network", async () => {
    const fetchMock = noFetch();
    const configDir = tmp("claude");
    fs.writeFileSync(path.join(configDir, ".credentials.json"), "{}");
    // The default login probe reads CLAUDE_CONFIG_DIR from the env it is given.
    const checks = await claude().diagnose({ env: { CLAUDE_CONFIG_DIR: configDir } });
    expect(byName(checks, "Anthropic (claude agent)")).toMatchObject({
      status: "ok",
      detail: "Claude Code login detected",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("all good with an API key: GET /v1/models, the key never printed", async () => {
    const fetchMock = stubFetch(200);
    const key = "sk-ant-api-secret-000";
    const checks = await claude().diagnose({ env: { ANTHROPIC_API_KEY: key }, hasLogin: () => false });
    expect(byName(checks, "Anthropic (claude agent)")).toMatchObject({ status: "ok", detail: "API key is valid" });
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://api.anthropic.com/v1/models");
    expectNoSecret(checks, key);
  });

  it("a rejected API key fails", async () => {
    stubFetch(401);
    const checks = await claude().diagnose({ env: { ANTHROPIC_API_KEY: "bad" }, hasLogin: () => false });
    expect(byName(checks, "Anthropic (claude agent)")).toMatchObject({ status: "fail" });
    expect(byName(checks, "Anthropic (claude agent)")!.detail).toMatch(/401 Unauthorized/);
  });

  it("a gateway is probed instead of real Anthropic, redacted", async () => {
    const fetchMock = stubFetch(200);
    const checks = await claude().diagnose({
      env: { ANTHROPIC_API_KEY: "k", ANTHROPIC_BASE_URL: "https://user:pw@gw.example.com/x?api_key=leak" },
      hasLogin: () => false,
    });
    expect(byName(checks, "Anthropic (gateway)")).toMatchObject({ status: "ok" });
    expect(String(fetchMock.mock.calls[0][0])).not.toContain("api.anthropic.com");
    expect(byName(checks, "Anthropic (gateway)")!.detail).toContain("(https://gw.example.com)");
    expectNoSecret(checks, "leak", "pw@");
  });

  it("an OAuth token with no gateway skips the upstream probe and names the mode", async () => {
    const fetchMock = noFetch();
    const checks = await claude().diagnose({ env: { CLAUDE_CODE_OAUTH_TOKEN: "o" }, hasLogin: () => false });
    expect(byName(checks, "Anthropic (claude agent)")).toEqual({
      name: "Anthropic (claude agent)",
      status: "skip",
      detail: "auth mode: oauth, skipping upstream API check",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reads the harness env overlay: an overlaid credential replaces the inherited ones", async () => {
    stubFetch(200);
    const h = new ClaudeCodeHarness({ env: { ANTHROPIC_API_KEY: "overlay-key" } });
    const checks = await h.diagnose({ env: { CLAUDE_CODE_OAUTH_TOKEN: "parent" }, hasLogin: () => false });
    // The overlay names a Claude credential, so the inherited OAuth token is dropped: api-key mode.
    expect(byName(checks, "Anthropic (claude agent)")).toMatchObject({ status: "ok", detail: "API key is valid" });
  });
});

// ─── diagnoseEnv ─────────────────────────────────────────────────

describe("diagnoseEnv", () => {
  it("applies the overlay over the base, but never an overlaid SWENY_* name", () => {
    const overlay = agentEnvOverlay({ env: { PATH: "/o", SWENY_AUTH: "oauth" }, envRemove: ["DROP", "SWENY_X"] });
    const env = diagnoseEnv({ PATH: "/b", DROP: "1", SWENY_X: "keep", UNSET: undefined }, overlay, []);
    expect(env).toEqual({ PATH: "/o", SWENY_X: "keep" });
  });

  it("drops inherited credentials when the overlay names one", () => {
    const overlay = agentEnvOverlay({ env: { OPENAI_API_KEY: "new" } });
    expect(diagnoseEnv({ CODEX_API_KEY: "old", A: "1" }, overlay, ["CODEX_API_KEY", "OPENAI_API_KEY"])).toEqual({
      A: "1",
      OPENAI_API_KEY: "new",
    });
  });

  it("defaults to process.env", () => {
    vi.stubEnv("SWENY_DIAG_PROBE", "here");
    expect(diagnoseEnv(undefined, undefined, []).SWENY_DIAG_PROBE).toBe("here");
  });
});
