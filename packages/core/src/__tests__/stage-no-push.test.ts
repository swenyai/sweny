/**
 * #442: under --stage and --dry-run a git push cannot leave a node.
 *
 * The executor marks the node's agentAccess `noPush`; every harness applies
 * withPushBlocked to the agent env. These specs run real git against a local
 * bare remote with that env. No network, no LLM calls. The harness contract
 * suite (case 19) proves each adapter hands this env to its agent.
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { NO_PUSH_REMOTE, PUSH_TOKEN_VARS, noPushDir, withPushBlocked } from "../agent-env.js";
import { execute } from "../executor.js";
import { createSkillMap } from "../skills/index.js";
import { github } from "../skills/github.js";
import type { Claude, NodeResult, Workflow } from "../types.js";

const posix = process.platform !== "win32";

function baseEnv(extra: Record<string, string> = {}): Record<string, string> {
  return {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: process.env.HOME ?? tmpdir(),
    GIT_CONFIG_NOSYSTEM: "1",
    ...extra,
  };
}

function git(args: string[], cwd: string, env: Record<string, string>) {
  const r = spawnSync("git", args, { cwd, env, encoding: "utf8", timeout: 30_000 });
  return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

/** A clone with one commit and a local bare remote named origin. */
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "sweny-442-"));
  const remote = path.join(root, "remote.git");
  const work = path.join(root, "work");
  const globalCfg = path.join(root, "gitconfig");
  writeFileSync(globalCfg, "");
  const env = baseEnv({ GIT_CONFIG_GLOBAL: globalCfg });
  expect(git(["init", "-q", "--bare", remote], root, env).status).toBe(0);
  expect(git(["init", "-q", work], root, env).status).toBe(0);
  expect(
    git(["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "init"], work, env).status,
  ).toBe(0);
  expect(git(["remote", "add", "origin", remote], work, env).status).toBe(0);
  const refs = () => git(["for-each-ref", "--format=%(refname)"], remote, env).out.trim();
  return { root, remote, work, globalCfg, env, refs, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

describe("withPushBlocked (#442)", () => {
  it("is the identity when not enabled", () => {
    const env = { PATH: "/usr/bin", GITHUB_TOKEN: "t" };
    expect(withPushBlocked(env, false)).toBe(env);
    expect(withPushBlocked(env, undefined)).toBe(env);
  });

  it("withholds write tokens and git transport credentials, keeps everything else", () => {
    const src: Record<string, string> = { PATH: "/usr/bin", ANTHROPIC_API_KEY: "model-key", LINEAR_API_KEY: "l" };
    for (const k of PUSH_TOKEN_VARS) src[k] = `${k}-value`;
    const out = withPushBlocked(src, true);
    for (const k of PUSH_TOKEN_VARS.filter((k) => k !== "GIT_ASKPASS")) expect(out).not.toHaveProperty(k);
    expect(out.GIT_ASKPASS).not.toBe("GIT_ASKPASS-value");
    expect(Object.values(out)).not.toContain("GITHUB_TOKEN-value");
    expect(out.ANTHROPIC_API_KEY).toBe("model-key");
    expect(out.PATH).toBe("/usr/bin");
    expect(out.GIT_TERMINAL_PROMPT).toBe("0");
    // gh gets an empty config dir, so a stored `gh auth login` is not used either.
    expect(readdirSync(out.GH_CONFIG_DIR)).toEqual([]);
  });

  it("appends after GIT_CONFIG_* entries the operator already set", () => {
    const out = withPushBlocked({ GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "a.b", GIT_CONFIG_VALUE_0: "c" }, true);
    expect(out.GIT_CONFIG_KEY_0).toBe("a.b");
    expect(out.GIT_CONFIG_VALUE_0).toBe("c");
    expect(out.GIT_CONFIG_KEY_1).toBe("credential.helper");
    expect(Number(out.GIT_CONFIG_COUNT)).toBeGreaterThan(2);
    const keys = Object.keys(out).filter((k) => k.startsWith("GIT_CONFIG_KEY_"));
    expect(keys.length).toBe(Number(out.GIT_CONFIG_COUNT));
  });

  it("does not touch the caller's env object", () => {
    const src = { GITHUB_TOKEN: "t" };
    withPushBlocked(src, true);
    expect(src).toEqual({ GITHUB_TOKEN: "t" });
  });
});

describe.skipIf(!posix)("git under withPushBlocked (#442, real git)", () => {
  it("every push form fails and the remote gets no ref; normal mode pushes", () => {
    const f = fixture();
    try {
      const blocked = withPushBlocked(f.env, true);
      const attempts: string[][] = [
        ["push"],
        ["push", "origin", "HEAD:refs/heads/a"],
        ["push", "--no-verify", "origin", "HEAD:refs/heads/b"],
        ["push", "--force", "origin", "HEAD:refs/heads/c"],
        ["push", "--no-verify", f.remote, "HEAD:refs/heads/d"],
        ["push", "--no-verify", `file://${f.remote}`, "HEAD:refs/heads/e"],
        ["push", "--no-verify", "https://example.invalid/x.git", "HEAD:refs/heads/f"],
        ["push", "--no-verify", "git@example.invalid:x/y.git", "HEAD:refs/heads/g"],
      ];
      for (const args of attempts) {
        const r = git(args, f.work, blocked);
        expect(r.status, `git ${args.join(" ")}: ${r.out}`).not.toBe(0);
      }
      expect(f.refs()).toBe("");
      // The rewrite never reaches the network: git has no helper for the scheme.
      expect(git(["push", "--no-verify", "https://example.invalid/x.git", "HEAD:x"], f.work, blocked).out).toContain(
        NO_PUSH_REMOTE,
      );

      // Fetch and commit still work under stage.
      expect(git(["fetch", "-q", "origin"], f.work, blocked).status).toBe(0);
      expect(
        git(["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "c2"], f.work, blocked)
          .status,
      ).toBe(0);

      // Normal mode unchanged.
      const normal = git(["push", "-q", "origin", "HEAD:refs/heads/ok"], f.work, f.env);
      expect(normal.status, normal.out).toBe(0);
      expect(f.refs()).toBe("refs/heads/ok");
    } finally {
      f.cleanup();
    }
  });

  it("a remote with an explicit pushurl is caught by the pre-push hook", () => {
    const f = fixture();
    try {
      expect(git(["remote", "add", "p", f.remote], f.work, f.env).status).toBe(0);
      expect(git(["config", "remote.p.pushurl", f.remote], f.work, f.env).status).toBe(0);
      const r = git(["push", "p", "HEAD:refs/heads/h"], f.work, withPushBlocked(f.env, true));
      expect(r.status).not.toBe(0);
      expect(r.out).toContain("git push is blocked");
      expect(f.refs()).toBe("");
    } finally {
      f.cleanup();
    }
  });

  it("an ssh push is refused before connecting, even with an explicit pushurl and --no-verify", () => {
    const f = fixture();
    try {
      expect(git(["remote", "add", "s", "ssh://127.0.0.1:1/x.git"], f.work, f.env).status).toBe(0);
      expect(git(["config", "remote.s.pushurl", "ssh://127.0.0.1:1/x.git"], f.work, f.env).status).toBe(0);
      const r = git(["push", "--no-verify", "s", "HEAD:refs/heads/i"], f.work, withPushBlocked(f.env, true));
      expect(r.status).not.toBe(0);
      expect(r.out).toContain("git push is blocked");
    } finally {
      f.cleanup();
    }
  });

  it("the ssh wrapper hands fetches to the operator's own ssh command", () => {
    const blocked = withPushBlocked(baseEnv({ GIT_SSH_COMMAND: "echo own-ssh" }), true);
    const wrapper = path.join(noPushDir(), "ssh");
    const r = spawnSync(wrapper, ["host", "git-upload-pack 'x.git'"], { env: blocked, encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("own-ssh host git-upload-pack 'x.git'");
  });

  it("no stored credential reaches git: helpers are reset and askpass refuses", () => {
    const f = fixture();
    try {
      writeFileSync(
        f.globalCfg,
        '[credential "https://github.com"]\n\thelper = "!echo password=leaked"\n[credential]\n\thelper = "!echo password=leaked"\n',
      );
      const input = "protocol=https\nhost=github.com\nusername=x\n\n";
      const fill = (env: Record<string, string>) =>
        spawnSync("git", ["credential", "fill"], { cwd: f.work, env, input, encoding: "utf8", timeout: 30_000 });
      // Control: the helper answers without the block.
      expect(fill({ ...f.env, GIT_TERMINAL_PROMPT: "0" }).stdout).toContain("password=leaked");
      const r = fill(withPushBlocked(f.env, true));
      expect(r.status).not.toBe(0);
      expect(r.stdout ?? "").not.toContain("leaked");
    } finally {
      f.cleanup();
    }
  });

  it("the no-push dir exists once per process", () => {
    const a = noPushDir();
    expect(noPushDir()).toBe(a);
    expect(existsSync(path.join(a, "hooks", "pre-push"))).toBe(true);
  });
});

describe("executor marks staged and dry-run nodes noPush (#442)", () => {
  function recordingClaude() {
    const runs: Parameters<Claude["run"]>[0][] = [];
    const claude: Claude = {
      async run(opts): Promise<NodeResult> {
        runs.push(opts);
        return { status: "success", data: {}, toolCalls: [] };
      },
      async evaluate(opts) {
        return opts.choices[0].id;
      },
      async ask() {
        return "";
      },
    };
    return { claude, runs };
  }

  const wf = (staged?: boolean): Workflow => ({
    id: "t",
    name: "T",
    description: "",
    entry: "a",
    edges: [],
    ...(staged ? { safe_outputs: { staged: true } } : {}),
    nodes: { a: { name: "A", instruction: "Do it.", skills: ["github"] } },
  });

  const noPushOf = (runs: Parameters<Claude["run"]>[0][]) =>
    (runs[0].agentAccess as { noPush?: boolean } | undefined)?.noPush;

  it("--stage sets noPush", async () => {
    const { claude, runs } = recordingClaude();
    await execute(
      wf(),
      {},
      { skills: createSkillMap([github]), claude, config: { GITHUB_TOKEN: "x" }, stageOutputs: true },
    );
    expect(noPushOf(runs)).toBe(true);
    expect(runs[0].agentAccess?.envVars).toContain("GITHUB_TOKEN");
  });

  it("a dry run sets noPush", async () => {
    const { claude, runs } = recordingClaude();
    await execute(wf(), { dryRun: true }, { skills: createSkillMap([github]), claude, config: { GITHUB_TOKEN: "x" } });
    expect(noPushOf(runs)).toBe(true);
  });

  it("safe_outputs.staged in the workflow sets noPush", async () => {
    const { claude, runs } = recordingClaude();
    await execute(wf(true), {}, { skills: createSkillMap([github]), claude, config: { GITHUB_TOKEN: "x" } });
    expect(noPushOf(runs)).toBe(true);
  });

  it("a normal run does not", async () => {
    const { claude, runs } = recordingClaude();
    await execute(wf(), {}, { skills: createSkillMap([github]), claude, config: { GITHUB_TOKEN: "x" } });
    expect(noPushOf(runs)).toBeUndefined();
  });
});
