import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DOTENV_DENIED_KEYS, isDotenvDenied, loadDotenv } from "./config-file.js";
import { unmarkWorkspaceEnv } from "../startup-env.js";

// The workspace .env is agent-writable: it may carry credentials, never
// runtime or platform state sweny trusts as the operator's.
describe("loadDotenv denylist", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it.each([
    "GITHUB_STEP_SUMMARY",
    "GITHUB_OUTPUT",
    "GITHUB_ENV",
    "GITHUB_PATH",
    "GITHUB_SERVER_URL",
    "GITHUB_API_URL",
    "RUNNER_TEMP",
    "ACTIONS_RUNTIME_TOKEN",
    "CI",
    "PATH",
    "Path",
    "NODE_OPTIONS",
    "NODE_EXTRA_CA_CERTS",
    "GIT_SSL_CAINFO",
    "GIT_CONFIG_GLOBAL",
    "HTTPS_PROXY",
    "https_proxy",
    "HTTP_PROXY",
    "ALL_PROXY",
    "NO_PROXY",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "TMPDIR",
    "TEMP",
    "TMP",
    "HOME",
  ])("denies %s", (key) => {
    expect(isDotenvDenied(key)).toBe(true);
  });

  it("denies SWENY_SANDBOX_DEFAULT, the Action's default, which is operator state (#599)", () => {
    expect(isDotenvDenied("SWENY_SANDBOX_DEFAULT")).toBe(true);
  });

  it("in CI, a .env value that loosens the agent floor is refused with a warning; tightening loads (#599)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sweny-dotenv-"));
    dirs.push(dir);
    fs.writeFileSync(
      path.join(dir, ".env"),
      [
        "SWENY_SANDBOX=off",
        "SWENY_ENV_SCOPE=off",
        "SWENY_ENV_PASSTHROUGH=AWS_SECRET_ACCESS_KEY",
        "SWENY_SANDBOX_ALLOWED_DOMAINS=evil.example.com",
        "SWENY_SANDBOX_DEFAULT=off",
        "SWENY_DOTENV_TEST_CREDENTIAL=secret",
      ].join("\n") + "\n",
    );
    const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const ci: NodeJS.ProcessEnv = { CI: "true", GITHUB_ACTIONS: "true", SWENY_SANDBOX_DEFAULT: "strict" };
    loadDotenv(dir, ci);
    expect(ci).toEqual({
      CI: "true",
      GITHUB_ACTIONS: "true",
      SWENY_SANDBOX_DEFAULT: "strict",
      SWENY_DOTENV_TEST_CREDENTIAL: "secret",
    });
    const out = err.mock.calls.join("");
    for (const k of ["SWENY_SANDBOX", "SWENY_ENV_SCOPE", "SWENY_ENV_PASSTHROUGH", "SWENY_SANDBOX_ALLOWED_DOMAINS"]) {
      expect(out).toContain(`::warning title=SWEny agent sandbox::.env sets ${k}, which would`);
    }
    expect(out).not.toContain("evil.example.com");
    expect(out).not.toContain("AWS_SECRET_ACCESS_KEY");

    // A plain CI (no Action default): auto is the floor; strict tightens and loads.
    fs.writeFileSync(path.join(dir, ".env"), "SWENY_SANDBOX=strict\nSWENY_ENV_SCOPE=on\n");
    const plain: NodeJS.ProcessEnv = { CI: "true" };
    loadDotenv(dir, plain);
    expect(plain.SWENY_SANDBOX).toBe("strict");
    expect(plain.SWENY_ENV_SCOPE).toBe("on");

    // Locally (no CI) the .env loads as before.
    fs.writeFileSync(path.join(dir, ".env"), "SWENY_SANDBOX=off\nSWENY_ENV_PASSTHROUGH=FOO\n");
    const local: NodeJS.ProcessEnv = {};
    loadDotenv(dir, local);
    expect(local).toEqual({ SWENY_SANDBOX: "off", SWENY_ENV_PASSTHROUGH: "FOO" });
  });

  it.each(["GITHUB_TOKEN", "ANTHROPIC_API_KEY", "LINEAR_API_KEY", "SWENY_SANDBOX", "DD_API_KEY"])(
    "allows %s",
    (key) => {
      expect(isDotenvDenied(key)).toBe(false);
    },
  );

  it("denies a lookalike of the allowed credential", () => {
    expect(isDotenvDenied("GITHUB_TOKEN_PATH")).toBe(true);
    expect(DOTENV_DENIED_KEYS.test("GITHUB_TOKEN")).toBe(false);
  });

  it("skips denied keys with a warning and still loads credentials", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sweny-dotenv-"));
    dirs.push(dir);
    const denied = "GITHUB_STEP_SUMMARY";
    const allowed = "SWENY_DOTENV_TEST_CREDENTIAL";
    const deniedWasSet = process.env[denied] !== undefined;
    fs.writeFileSync(path.join(dir, ".env"), `${denied}=/home/user/.bashrc\n${allowed}=secret\n`);
    const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      loadDotenv(dir);
      expect(process.env[allowed]).toBe("secret");
      if (!deniedWasSet) {
        expect(process.env[denied]).toBeUndefined();
        expect(err.mock.calls.join("")).toContain(`.env sets ${denied}`);
      }
    } finally {
      delete process.env[allowed];
      unmarkWorkspaceEnv(allowed);
    }
  });
});

// loadDotenv parses with Node's util.parseEnv, so a .env file behaves the way
// it does in every other tool.
describe("loadDotenv parsing", () => {
  const dirs: string[] = [];
  const keys = [
    "SWENY_DOTENV_T_URL",
    "SWENY_DOTENV_T_HASH",
    "SWENY_DOTENV_T_SINGLE",
    "SWENY_DOTENV_T_EXPORT",
    "SWENY_DOTENV_T_MULTI",
    "SWENY_DOTENV_T_ESCAPED",
    "SWENY_DOTENV_T_CRLF_A",
    "SWENY_DOTENV_T_CRLF_B",
    "SWENY_DOTENV_T_WINS",
    "SWENY_DOTENV_T_EMPTY",
  ];
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
    for (const k of keys) {
      delete process.env[k];
      unmarkWorkspaceEnv(k);
    }
    vi.restoreAllMocks();
  });

  function load(content: string): void {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sweny-dotenv-"));
    dirs.push(dir);
    fs.writeFileSync(path.join(dir, ".env"), content);
    loadDotenv(dir);
  }

  it("drops an inline comment after an unquoted value", () => {
    load("SWENY_DOTENV_T_URL=https://gitlab.example.com   # self-hosted\n");
    expect(process.env.SWENY_DOTENV_T_URL).toBe("https://gitlab.example.com");
  });

  it("keeps # inside quoted values", () => {
    load(`SWENY_DOTENV_T_HASH="pa#ss word" # note\nSWENY_DOTENV_T_SINGLE='a # b'\n`);
    expect(process.env.SWENY_DOTENV_T_HASH).toBe("pa#ss word");
    expect(process.env.SWENY_DOTENV_T_SINGLE).toBe("a # b");
  });

  it("accepts an export prefix", () => {
    load("export SWENY_DOTENV_T_EXPORT=exported\n");
    expect(process.env.SWENY_DOTENV_T_EXPORT).toBe("exported");
  });

  it("reads multiline double-quoted values", () => {
    load('SWENY_DOTENV_T_MULTI="line one\nline two"\n');
    expect(process.env.SWENY_DOTENV_T_MULTI).toBe("line one\nline two");
  });

  it("expands \\n inside double quotes", () => {
    load('SWENY_DOTENV_T_ESCAPED="a\\nb"\n');
    expect(process.env.SWENY_DOTENV_T_ESCAPED).toBe("a\nb");
  });

  it("handles CRLF line endings", () => {
    load('# comment\r\nSWENY_DOTENV_T_CRLF_A=one\r\nSWENY_DOTENV_T_CRLF_B="two"\r\n');
    expect(process.env.SWENY_DOTENV_T_CRLF_A).toBe("one");
    expect(process.env.SWENY_DOTENV_T_CRLF_B).toBe("two");
  });

  it("sets an empty value", () => {
    load("SWENY_DOTENV_T_EMPTY=\n");
    expect(process.env.SWENY_DOTENV_T_EMPTY).toBe("");
  });

  it("lets an existing env var win", () => {
    process.env.SWENY_DOTENV_T_WINS = "real";
    load("SWENY_DOTENV_T_WINS=from-file\n");
    expect(process.env.SWENY_DOTENV_T_WINS).toBe("real");
  });

  it("still refuses a denied key with the warning, in a CRLF file with comments", () => {
    const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const was = process.env.GITHUB_ENV;
    delete process.env.GITHUB_ENV;
    try {
      load("GITHUB_ENV=/tmp/evil # hi\r\nSWENY_DOTENV_T_URL=ok\r\n");
      expect(process.env.GITHUB_ENV).toBeUndefined();
      expect(err.mock.calls.join("")).toContain(".env sets GITHUB_ENV");
      expect(process.env.SWENY_DOTENV_T_URL).toBe("ok");
    } finally {
      if (was !== undefined) process.env.GITHUB_ENV = was;
    }
  });
});
