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
