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
  bwrapWorks,
  systemBin,
  usernsHint,
  type ProbeResult,
  DEFAULT_SANDBOX_DOMAINS,
  resolveEnvScope,
  formatWithheldWarning,
  scopeAgentEnv,
  agentEnvOverlay,
  applyEnvOverlay,
  overlaidProcessEnv,
  buildSandboxSettings,
  claudeCredentialFiles,
  resolveExecutable,
  hasCodexLogin,
} from "../agent-env.js";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as nodePath from "node:path";
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

  it("SWENY_SANDBOX_DEFAULT (the Action's strict) is the default; any explicit value still wins (#599)", () => {
    expect(resolveSandboxMode({ CI: "true", SWENY_SANDBOX_DEFAULT: "strict" })).toBe("strict");
    expect(resolveSandboxMode({ SWENY_SANDBOX_DEFAULT: " Strict\n" })).toBe("strict");
    expect(resolveSandboxMode({ SWENY_SANDBOX_DEFAULT: "auto" })).toBe("auto");
    expect(resolveSandboxMode({ CI: "true", SWENY_SANDBOX_DEFAULT: "off" })).toBe("off");
    // .sweny.yml `sandbox:` arrives as SWENY_SANDBOX, so it beats the Action's default.
    expect(resolveSandboxMode({ CI: "true", SWENY_SANDBOX: "off", SWENY_SANDBOX_DEFAULT: "strict" })).toBe("off");
    expect(resolveSandboxMode({ CI: "true", SWENY_SANDBOX: "auto", SWENY_SANDBOX_DEFAULT: "strict" })).toBe("auto");
    expect(resolveSandboxMode({ SWENY_SANDBOX_DEFAULT: "strict" }, "off")).toBe("off");
    // Not a mode: ignored, the CI rule applies.
    expect(resolveSandboxMode({ CI: "true", SWENY_SANDBOX_DEFAULT: "bogus" })).toBe("auto");
    expect(resolveSandboxMode({ SWENY_SANDBOX_DEFAULT: "" })).toBe("off");
    const warn = vi.fn();
    expect(resolveSandboxMode({ SWENY_SANDBOX: "maybe", SWENY_SANDBOX_DEFAULT: "strict" }, undefined, { warn })).toBe(
      "strict",
    );
    expect(warn).toHaveBeenCalledWith('SWENY_SANDBOX="maybe" is not one of off|auto|strict; using strict');
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

describe("bwrapWorks", () => {
  const BASE = ["--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc"];
  const ok = (stdout = ""): ProbeResult => ({ status: 0, stdout, stderr: "" });
  const bad = (stderr: string): ProbeResult => ({ status: 1, stdout: "", stderr });
  const UTIL_LINUX_HELP =
    "Usage:\n unshare [options] [<program> [<argument>...]]\n -r, --map-root-user  map the current user to root\n";
  const bins = (names: Record<string, string>) => (name: string) => names[name];
  const both = bins({ bwrap: "/usr/bin/bwrap", unshare: "/usr/bin/unshare" });

  it("runs bwrap, checks unshare supports --map-root-user, then nests it by absolute path", () => {
    const calls: string[][] = [];
    const run = (file: string, args: string[]) => {
      calls.push([file, ...args]);
      return args[0] === "--help" ? ok(UTIL_LINUX_HELP) : ok();
    };
    expect(bwrapWorks(run, both)).toBeUndefined();
    expect(calls).toEqual([
      ["/usr/bin/bwrap", ...BASE, "true"],
      ["/usr/bin/unshare", "--help"],
      ["/usr/bin/bwrap", ...BASE, "/usr/bin/unshare", "--user", "--map-root-user", "true"],
    ]);
  });

  it("Ubuntu 26.04: plain bwrap works but the nested user namespace is denied", () => {
    const run = (_file: string, args: string[]) =>
      args[0] === "--help"
        ? ok(UTIL_LINUX_HELP)
        : args.includes("--map-root-user")
          ? bad("unshare: write failed /proc/self/uid_map: Operation not permitted\n")
          : ok();
    const reason = bwrapWorks(run, both);
    expect(reason).toMatch(
      /^bwrap cannot nest a user namespace, which the sandbox's seccomp helper needs \(unshare: write failed \/proc\/self\/uid_map: Operation not permitted\)/,
    );
    expect(reason).toContain("sudo apparmor_parser -R /etc/apparmor.d/bwrap-userns-restrict");
    expect(reason).toContain("kernel.apparmor_restrict_unprivileged_userns=0");
  });

  it("a plain bwrap failure is reported first and skips the rest", () => {
    const calls: string[][] = [];
    const reason = bwrapWorks((file, args) => {
      calls.push(args);
      return bad("bwrap: setting up uid map: Permission denied\nmore");
    }, both);
    expect(calls).toHaveLength(1);
    expect(reason).toMatch(
      /^bwrap cannot create a sandbox \(bwrap: setting up uid map: Permission denied\); unprivileged/,
    );
  });

  it("skips the nested run when unshare is not in a system directory", () => {
    const calls: string[][] = [];
    const run = (_f: string, args: string[]) => (calls.push(args), ok());
    expect(bwrapWorks(run, bins({ bwrap: "/usr/bin/bwrap" }))).toBeUndefined();
    expect(calls).toEqual([[...BASE, "true"]]);
  });

  it("skips the nested run when unshare has no --map-root-user (busybox), instead of disabling the sandbox", () => {
    const calls: string[][] = [];
    const run = (_f: string, args: string[]) => {
      calls.push(args);
      return args[0] === "--help"
        ? {
            status: 0,
            stdout: "",
            stderr:
              "BusyBox v1.36.1 multi-call binary.\n\nUsage: unshare [OPTIONS] [PROG ARGS]\n\t-U\tUnshare user namespace\n",
          }
        : ok();
    };
    expect(bwrapWorks(run, both)).toBeUndefined();
    expect(calls.some((a) => a.includes("--map-root-user"))).toBe(false);
  });

  it("only looks for bwrap in system directories, never PATH", () => {
    const run = () => ok();
    expect(bwrapWorks(run, bins({}))).toMatch(
      /^bwrap is not installed in \/usr\/bin, \/bin, \/usr\/local\/bin or \/usr\/sbin/,
    );
  });

  it("echoes one sanitized, capped line of the probe's stderr", () => {
    const long = "x".repeat(500);
    const reason = bwrapWorks(() => bad(`bwrap: \u001b[31mred\u0007 ${long}\nsecond line`), both)!;
    expect(reason).not.toContain("second line");
    expect(reason).not.toMatch(/[\u0000-\u001f\u007f]/);
    const echoed = /\((.*?)\)/.exec(reason)![1];
    expect(echoed.length).toBeLessThanOrEqual(200);
    expect(echoed.startsWith("bwrap: ?[31mred? x")).toBe(true);
  });
});

describe("systemBin", () => {
  it("resolves only from /usr/bin, /bin, /usr/local/bin and /usr/sbin, in that order", () => {
    const seen: string[] = [];
    expect(systemBin("bwrap", (p) => (seen.push(p), p === "/usr/local/bin/bwrap"))).toBe("/usr/local/bin/bwrap");
    expect(seen).toEqual(["/usr/bin/bwrap", "/bin/bwrap", "/usr/local/bin/bwrap"]);
    expect(systemBin("bwrap", () => false)).toBeUndefined();
  });
});

describe("usernsHint", () => {
  it("names the sysctl and the Ubuntu 26.04 bwrap profile for the apply-seccomp error", () => {
    const hint = usernsHint(
      "apply-seccomp: write /proc/self/setgroups (nested userns is capability-restricted; caller must provide CAP_SYS_ADMIN): Permission denied",
    );
    expect(hint).toContain("sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0");
    expect(hint).toContain("sudo apparmor_parser -R /etc/apparmor.d/bwrap-userns-restrict");
  });
  it("is empty for an unrelated error", () => {
    expect(usernsHint("bwrap: No such file or directory")).toBe("");
  });
});

describe("resolveAgentSandbox", () => {
  it("off: no settings, no error, no warning", () => {
    expect(resolveAgentSandbox({ env: { SWENY_SANDBOX: "off" }, probe: () => undefined })).toEqual({ mode: "off" });
  });

  it("auto on a supported host: settings with default + node + configured hosts, enforced (fail, not degrade)", () => {
    const { settings, error, warning } = resolveAgentSandbox({
      env: { CI: "true", SWENY_SANDBOX_ALLOWED_DOMAINS: "internal.example.com, *.corp.example" },
      nodeDomains: ["api.linear.app"],
      probe: () => undefined,
    });
    expect(error).toBeUndefined();
    expect(warning).toBeUndefined();
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

  it("strict by the Action's default on an unsupported host: fails closed and names the fix and the opt-out (#599)", () => {
    const r = resolveAgentSandbox({
      env: { CI: "true", SWENY_SANDBOX_DEFAULT: "strict" },
      probe: () => "missing bwrap on PATH",
    });
    expect(r.mode).toBe("strict");
    expect(r.settings).toBeUndefined();
    expect(r.warning).toBeUndefined();
    expect(r.error).toContain("SWENY_SANDBOX_DEFAULT=strict, the GitHub Action's default");
    expect(r.error).toContain("apt-get install -y bubblewrap socat");
    expect(r.error).toContain(
      "SWENY_SANDBOX=off in the workflow's env (in CI, .sweny.yml and .env cannot lower the sandbox) with harness-policy warn",
    );
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

  describe("in CI, .sweny.yml only tightens (#599)", () => {
    const run = async (file: Record<string, unknown>, env: NodeJS.ProcessEnv) => {
      const { applyAgentFileConfig } = await import("../cli/config-file.js");
      const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      try {
        applyAgentFileConfig(file, env);
        return err.mock.calls.join("");
      } finally {
        err.mockRestore();
      }
    };

    it("sandbox: off cannot lower the Action's strict default, nor auto in CI", async () => {
      const action: NodeJS.ProcessEnv = { CI: "true", GITHUB_ACTIONS: "true", SWENY_SANDBOX_DEFAULT: "strict" };
      const out = await run({ sandbox: "off" }, action);
      expect(action.SWENY_SANDBOX).toBeUndefined();
      expect(resolveSandboxMode(action)).toBe("strict");
      expect(out).toContain("::warning title=SWEny agent sandbox::.sweny.yml sets SWENY_SANDBOX");
      expect(out).toContain("lower the agent sandbox from strict to off");
      expect(out).toContain("the step's env:");
      for (const v of ["auto", "false"]) {
        const e: NodeJS.ProcessEnv = { CI: "true", SWENY_SANDBOX_DEFAULT: "strict" };
        await run({ sandbox: v }, e);
        expect(resolveSandboxMode(e), v).toBe("strict");
      }
      const ci: NodeJS.ProcessEnv = { CI: "true" };
      const plain = await run({ sandbox: "off" }, ci);
      expect(resolveSandboxMode(ci)).toBe("auto");
      expect(plain).toContain(
        "  warning: .sweny.yml sets SWENY_SANDBOX, which would lower the agent sandbox from auto to off",
      );
    });

    it("tightening and same-level values apply; outside CI everything applies as before", async () => {
      const ci: NodeJS.ProcessEnv = { CI: "true" };
      expect(await run({ sandbox: "strict", "env-scope": "on" }, ci)).toBe("");
      expect(ci.SWENY_SANDBOX).toBe("strict");
      expect(ci.SWENY_ENV_SCOPE).toBe("on");
      const action: NodeJS.ProcessEnv = { CI: "true", SWENY_SANDBOX_DEFAULT: "strict" };
      await run({ sandbox: "strict" }, action);
      expect(action.SWENY_SANDBOX).toBe("strict");
      const local: NodeJS.ProcessEnv = {};
      expect(await run({ sandbox: "off", "env-scope": "off" }, local)).toBe("");
      expect(local.SWENY_SANDBOX).toBe("off");
      expect(local.SWENY_ENV_SCOPE).toBe("off");
    });

    it("env-scope: off is refused in CI; env-passthrough and allowed domains stay as documented", async () => {
      const ci: NodeJS.ProcessEnv = { CI: "true" };
      const out = await run(
        { "env-scope": "off", "env-passthrough": ["NPM_TOKEN"], "sandbox-allowed-domains": ["x.example.com"] },
        ci,
      );
      expect(ci.SWENY_ENV_SCOPE).toBeUndefined();
      expect(resolveEnvScope(ci)).toBe(true);
      expect(out).toContain("turn agent env scoping off");
      expect(ci.SWENY_ENV_PASSTHROUGH).toBe("NPM_TOKEN");
      expect(ci.SWENY_SANDBOX_ALLOWED_DOMAINS).toBe("x.example.com");
    });

    it("the workflow's own env still wins, loosening included", async () => {
      const env: NodeJS.ProcessEnv = { CI: "true", SWENY_SANDBOX_DEFAULT: "strict", SWENY_SANDBOX: "off" };
      expect(await run({ sandbox: "strict" }, env)).toBe("");
      expect(resolveSandboxMode(env)).toBe("off");
    });
  });
});

describe("repoFileLoosening (#599)", () => {
  it("names the key and the effect, never the raw value", async () => {
    const { repoFileLoosening } = await import("../agent-env.js");
    const ci = { CI: "true" };
    expect(repoFileLoosening("SWENY_SANDBOX", "off", ci, ".env")).toBe(
      ".env sets SWENY_SANDBOX, which would lower the agent sandbox from auto to off in CI; ignored. " +
        "In CI a repository file can only tighten the agent sandbox. To change it, set SWENY_SANDBOX in the " +
        "workflow's env (for the swenyai/sweny Action, the step's env:).",
    );
    const evil = "a\n::error::pwned";
    for (const k of ["SWENY_ENV_PASSTHROUGH", "SWENY_SANDBOX_ALLOWED_DOMAINS"]) {
      const msg = repoFileLoosening(k, evil, ci, ".env");
      expect(msg).toContain(`.env sets ${k}`);
      expect(msg).not.toContain("pwned");
    }
    expect(repoFileLoosening("SWENY_ENV_PASSTHROUGH", "NPM_TOKEN", ci, ".env")).toContain(
      "pass more variables to the agent",
    );
    expect(repoFileLoosening("SWENY_SANDBOX_ALLOWED_DOMAINS", "x.io", ci, ".env")).toContain(
      "widen the agent's network allowlist",
    );
  });

  it("accepts: outside CI, tightening, same level, non-modes, empty lists, and unrelated keys", async () => {
    const { repoFileLoosening } = await import("../agent-env.js");
    expect(repoFileLoosening("SWENY_SANDBOX", "off", {}, ".env")).toBeUndefined();
    expect(repoFileLoosening("SWENY_SANDBOX", "off", { CI: "false" }, ".env")).toBeUndefined();
    expect(repoFileLoosening("SWENY_SANDBOX", "auto", { CI: "true" }, ".env")).toBeUndefined();
    expect(repoFileLoosening("SWENY_SANDBOX", "strict", { CI: "true" }, ".env")).toBeUndefined();
    expect(repoFileLoosening("SWENY_SANDBOX", "bogus", { CI: "true" }, ".env")).toBeUndefined();
    expect(repoFileLoosening("SWENY_SANDBOX", "auto", { CI: "1", SWENY_SANDBOX_DEFAULT: "strict" }, ".env")).toContain(
      "from strict to auto",
    );
    expect(
      repoFileLoosening("SWENY_SANDBOX", "No", { CI: "1", SWENY_SANDBOX_DEFAULT: "auto" }, ".sweny.yml"),
    ).toContain(".sweny.yml sets SWENY_SANDBOX, which would lower the agent sandbox from auto to off");
    expect(repoFileLoosening("SWENY_ENV_SCOPE", "on", { CI: "true" }, ".env")).toBeUndefined();
    for (const v of ["off", " FALSE ", "0"]) {
      expect(repoFileLoosening("SWENY_ENV_SCOPE", v, { CI: "true" }, ".env"), v).toContain("env scoping off");
    }
    expect(repoFileLoosening("SWENY_ENV_PASSTHROUGH", " ", { CI: "true" }, ".env")).toBeUndefined();
    expect(repoFileLoosening("SWENY_ENV_PASSTHROUGH", "X", { CI: "true" }, ".sweny.yml")).toBeUndefined();
    expect(repoFileLoosening("SWENY_SANDBOX_ALLOWED_DOMAINS", "x", { CI: "true" }, ".sweny.yml")).toBeUndefined();
    expect(repoFileLoosening("GITHUB_TOKEN", "x", { CI: "true" }, ".env")).toBeUndefined();
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
    expect(opts().sandbox).toMatchObject({ enabled: true, failIfUnavailable: true, allowUnsandboxedCommands: false });
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

describe("caller env overlay (harness env / envRemove)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("agentEnvOverlay: undefined when neither option is set, a frozen copy otherwise", () => {
    expect(agentEnvOverlay({})).toBeUndefined();
    const env = { A: "1" };
    const remove = ["B"];
    const o = agentEnvOverlay({ env, envRemove: remove })!;
    env.A = "2";
    remove.push("C");
    expect(o.env).toEqual({ A: "1" });
    expect(o.remove).toEqual(["B"]);
    expect(Object.isFrozen(o.env)).toBe(true);
    expect(Object.isFrozen(o.remove)).toBe(true);
    // An empty overlay is still an overlay: the harness takes the copy path.
    expect(agentEnvOverlay({ env: {} })).toEqual({ env: {}, remove: [] });
  });

  it("agentEnvOverlay rejects non-string values and invalid names", () => {
    const bad = (o: unknown) => () => agentEnvOverlay(o as Parameters<typeof agentEnvOverlay>[0]);
    expect(bad({ env: { A: 1 } })).toThrow(/env: value for A must be a string, got number/);
    expect(bad({ env: { A: undefined } })).toThrow(/value for A must be a string/);
    expect(bad({ env: { "": "x" } })).toThrow(/env: invalid env var name ""/);
    expect(bad({ env: { "A=B": "x" } })).toThrow(/invalid env var name/);
    expect(bad({ env: { "A\0": "x" } })).toThrow(/invalid env var name/);
    expect(bad({ env: { A: "x\0y" } })).toThrow(/contains NUL/);
    expect(bad({ env: null })).toThrow(/env: must be a plain object/);
    expect(bad({ env: new Map([["A", "1"]]) })).toThrow(/env: must be a plain object/);
    expect(bad({ env: { "A B": "x" } })).toThrow(/invalid env var name/);
    expect(bad({ env: { "A\n": "x" } })).toThrow(/invalid env var name/);
    expect(bad({ envRemove: ["A B"] })).toThrow(/envRemove: invalid env var name/);
    expect(bad({ env: { A: undefined } })).toThrow(/leave the key out, or name it in envRemove to unset it/);
    for (const k of ["HOME", "CLAUDE_CONFIG_DIR", "CODEX_HOME"]) {
      expect(bad({ env: { [k]: "relative/dir" } })).toThrow(new RegExp(`env: ${k} must be an absolute path`));
      expect(bad({ env: { [k]: "/abs/dir" } })).not.toThrow();
    }
    // Case is kept as given.
    expect(agentEnvOverlay({ env: { path: "/x" } })!.env).toEqual({ path: "/x" });
    expect(bad({ envRemove: [""] })).toThrow(/envRemove: invalid env var name/);
    expect(bad({ envRemove: [1] })).toThrow(/envRemove: invalid env var name/);
  });

  it("applyEnvOverlay: remove, then drop the inherited login when the overlay names one, then lay values on", () => {
    const base = { A: "a", B: "b", KEY: "parent-key", TOKEN: "parent-token" };
    expect(applyEnvOverlay(base, undefined, ["KEY", "TOKEN"])).toBe(base);
    const out = applyEnvOverlay(base, { env: { B: "overlay", TOKEN: "run-token" }, remove: ["A", "B"] }, [
      "KEY",
      "TOKEN",
    ]);
    expect(out).toEqual({ B: "overlay", TOKEN: "run-token" });
    expect(base).toEqual({ A: "a", B: "b", KEY: "parent-key", TOKEN: "parent-token" });
    // No credential in the overlay: the inherited login stays.
    expect(applyEnvOverlay(base, { env: { C: "c" }, remove: [] }, ["KEY", "TOKEN"]).KEY).toBe("parent-key");
  });

  it("overlaidProcessEnv applies the overlay but leaves SWENY_* as process.env has them", () => {
    vi.stubEnv("SWENY_AUTH", "auto");
    vi.stubEnv("SWENY_OVERLAY_TEST_KEY", "parent-key");
    const env = overlaidProcessEnv(
      { env: { SWENY_AUTH: "oauth", SWENY_OVERLAY_TEST_TOKEN: "run" }, remove: ["SWENY_AUTH"] },
      ["SWENY_OVERLAY_TEST_KEY"],
    );
    expect(env.SWENY_AUTH).toBe("auto");
    expect(env.SWENY_OVERLAY_TEST_TOKEN).toBeUndefined();
    expect(env.SWENY_OVERLAY_TEST_KEY).toBe("parent-key");
    const swapped = overlaidProcessEnv({ env: { OVERLAY_TEST_KEY: "run-key" }, remove: [] }, [
      "OVERLAY_TEST_KEY",
      "SWENY_OVERLAY_TEST_KEY",
    ]);
    expect(swapped.OVERLAY_TEST_KEY).toBe("run-key");
    expect(swapped).not.toHaveProperty("SWENY_OVERLAY_TEST_KEY");
  });
});

describe("sandbox credential files follow the agent env (harness env overlay)", () => {
  const files = (agentEnv?: Record<string, string>) =>
    buildSandboxSettings(["api.anthropic.com"], { home: "/home/op", agentEnv }).credentials!.files!.map((f) => f.path);

  it("denies the host login file, and the one an overlaid HOME or CLAUDE_CONFIG_DIR selects", () => {
    expect(files()).toContain("/home/op/.claude/.credentials.json");
    expect(files({ HOME: "/run/home" })).toEqual(
      expect.arrayContaining(["/home/op/.claude/.credentials.json", "/run/home/.claude/.credentials.json"]),
    );
    expect(files({ CLAUDE_CONFIG_DIR: "/run/claude" })).toEqual(
      expect.arrayContaining(["/home/op/.claude/.credentials.json", "/run/claude/.credentials.json"]),
    );
  });

  it("claudeCredentialFiles dedupes the host file", () => {
    expect(claudeCredentialFiles({ HOME: "/home/op" }, "/home/op")).toEqual(["/home/op/.claude/.credentials.json"]);
  });
});

describe("overlay-aware lookups", () => {
  it("buildAgentEnv keeps the cloud vars an overlaid CLAUDE_CODE_USE_BEDROCK / _VERTEX turns on", () => {
    const source = { PATH: "/usr/bin", AWS_REGION: "us-east-1", AWS_ACCESS_KEY_ID: "k", GOOGLE_CLOUD_PROJECT: "p" };
    expect(buildAgentEnv(source)).not.toHaveProperty("AWS_REGION");
    const bedrock = buildAgentEnv(source, { routing: { ...source, CLAUDE_CODE_USE_BEDROCK: "1" } });
    expect(bedrock.AWS_REGION).toBe("us-east-1");
    expect(bedrock.AWS_ACCESS_KEY_ID).toBe("k");
    const vertex = buildAgentEnv(source, { routing: { CLAUDE_CODE_USE_VERTEX: "1" } });
    expect(vertex.GOOGLE_CLOUD_PROJECT).toBe("p");
  });

  it("claudeCredentialFiles resolves a relative value against the agent cwd", () => {
    expect(claudeCredentialFiles({ CLAUDE_CONFIG_DIR: "cfg" }, "/home/op", "/work")).toContain(
      "/work/cfg/.credentials.json",
    );
  });

  it("resolveExecutable looks a bare name up on the given PATH and a relative path against cwd", () => {
    const dir = mkdtempSync(nodePath.join(tmpdir(), "sweny-exe-"));
    try {
      const bin = nodePath.join(dir, "bin");
      mkdirSync(bin);
      const exe = nodePath.join(bin, "sweny-fake-tool");
      writeFileSync(exe, "#!/bin/sh\n");
      chmodSync(exe, 0o755);
      expect(resolveExecutable("sweny-fake-tool", { PATH: "/nonexistent" }, dir)).toBeUndefined();
      expect(resolveExecutable("sweny-fake-tool", { PATH: bin }, dir)).toBe(exe);
      expect(resolveExecutable("./bin/sweny-fake-tool", {}, dir)).toBe(exe);
      expect(resolveExecutable("./bin/sweny-fake-tool", {}, "/")).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("hasCodexLogin reads the env's HOME, not the process's", () => {
    const seen: string[] = [];
    const exists = (p: string) => (seen.push(p), p === "/run/home/.codex/auth.json");
    expect(hasCodexLogin({ HOME: "/run/home" }, exists)).toBe(true);
    expect(hasCodexLogin({ HOME: "/other" }, exists)).toBe(false);
    expect(hasCodexLogin({ HOME: "/other", CODEX_HOME: "/run/home/.codex" }, exists)).toBe(true);
  });
});
