import { afterEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import {
  branchName,
  hardenedGitEnv,
  isSafeBranch,
  isSafeRepo,
  pushAuthConfig,
  pushHeadBranch,
  repoFromRemote,
  resolveTrustedGit,
  trustedPathDirs,
  type GitRunner,
} from "./git-push.js";
import { github } from "./github.js";
import { loadDotenv } from "../cli/config-file.js";
import { startupEnv, startupTmpdir, unmarkWorkspaceEnv } from "../startup-env.js";

// #473: with `persist-credentials: false` the checkout holds no token, so
// sweny pushes the PR head itself, from its own process, with the github
// skill's token. The checkout is agent-written: these specs run real git
// against local bare repos and plant the hooks, config and push URLs an
// injected agent would. No network.
const TOKEN = "ghs_pushCanaryPushCanary0473";
const BASIC = Buffer.from(`x-access-token:${TOKEN}`).toString("base64");
/** The checkout's origin. */
const DEST = "https://github.com/owner/repo.git";
/** Where sweny pushes for repo `Owner/Repo` (built from the PR's repo, not from origin). */
const PUSH = "https://github.com/Owner/Repo.git";
const posix = process.platform !== "win32";

type Call = { args: string[]; cwd: string; env: NodeJS.ProcessEnv };

function run(args: string[], cwd: string, env: NodeJS.ProcessEnv) {
  const r = spawnSync("git", args, { cwd, env, encoding: "utf8", timeout: 30_000 });
  return { code: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/**
 * Real git, with the GitHub URL sweny computes swapped for a local bare repo
 * (the stand-in for github.com). Records every call.
 */
function realGit(rewrite: Record<string, string>) {
  const calls: Call[] = [];
  const git: GitRunner = async (args, o) => {
    calls.push({ args, cwd: o.cwd, env: o.env });
    // Never reach the network: an un-rewritten remote URL fails the call.
    if (args.some((a) => /^(https?|ssh):\/\//.test(a) && !(a in rewrite))) {
      return { code: 99, stdout: "", stderr: `test: network URL not rewritten: ${args.join(" ")}` };
    }
    return run(
      args.map((a) => rewrite[a] ?? a),
      o.cwd,
      o.env,
    );
  };
  return { git, calls, pushes: () => calls.filter((c) => c.args.includes("push")) };
}

/** A checkout of owner/repo with a feature branch, a stand-in remote and a decoy. */
function fixture(opts: { origin?: string } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "sweny-push-test-"));
  const globalCfg = path.join(root, "gitconfig");
  writeFileSync(globalCfg, "");
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: root,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: globalCfg,
  };
  const remote = path.join(root, "remote.git");
  const decoy = path.join(root, "decoy.git");
  const work = path.join(root, "work");
  const id = ["-c", "user.name=t", "-c", "user.email=t@t"];
  expect(run(["init", "-q", "--bare", remote], root, env).code).toBe(0);
  expect(run(["init", "-q", "--bare", decoy], root, env).code).toBe(0);
  expect(run(["init", "-q", work], root, env).code).toBe(0);
  expect(run([...id, "commit", "-q", "--allow-empty", "-m", "init"], work, env).code).toBe(0);
  expect(run(["branch", "-M", "main"], work, env).code).toBe(0);
  expect(run(["remote", "add", "origin", opts.origin ?? DEST], work, env).code).toBe(0);
  expect(run(["checkout", "-q", "-b", "off-1-fix"], work, env).code).toBe(0);
  writeFileSync(path.join(work, "fix.txt"), "fixed\n");
  expect(run(["add", "fix.txt"], work, env).code).toBe(0);
  expect(run([...id, "commit", "-q", "-m", "fix"], work, env).code).toBe(0);
  const sha = run(["rev-parse", "HEAD"], work, env).stdout.trim();
  const refs = (bare: string) => run(["for-each-ref", "--format=%(refname) %(objectname)"], bare, env).stdout.trim();
  return {
    root,
    env,
    remote,
    decoy,
    work,
    sha,
    refs,
    git: (args: string[]) => run(args, work, env),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

const opts = (f: ReturnType<typeof fixture>) => ({
  repo: "Owner/Repo",
  head: "off-1-fix",
  base: "main",
  defaultBranch: "main",
  token: TOKEN,
  cwd: f.work,
  env: f.env,
});

/** The command-scope config git sees, as key -> values. */
function gitConfig(env: NodeJS.ProcessEnv): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (let i = 0; i < Number(env.GIT_CONFIG_COUNT ?? 0); i++) {
    (out[env[`GIT_CONFIG_KEY_${i}`]!] ??= []).push(env[`GIT_CONFIG_VALUE_${i}`]!);
  }
  return out;
}

/** Every file under `dir`, read, joined. */
function readAll(dir: string): string {
  if (!existsSync(dir)) return "";
  return readdirSync(dir)
    .map((n) => readFileSync(path.join(dir, n), "utf-8"))
    .join("\n");
}

describe.skipIf(!posix)("pushHeadBranch against an agent-written checkout (real git)", () => {
  const fixtures: ReturnType<typeof fixture>[] = [];
  afterEach(() => {
    for (const f of fixtures.splice(0)) f.cleanup();
  });
  const make = (o?: { origin?: string }) => {
    const f = fixture(o);
    fixtures.push(f);
    return f;
  };

  it("no agent hook, fsmonitor or insteadOf runs or steers the push; the token stays out of their reach", async () => {
    const f = make();
    const canary = path.join(f.root, "canary");
    mkdirSync(canary);
    // Hooks that record their env, in .git/hooks and in a core.hooksPath dir.
    const spy = (name: string) => `#!/bin/sh\nenv > "${canary}/${name}.$$"\nexit 0\n`;
    const evil = path.join(f.root, "evil-hooks");
    mkdirSync(evil);
    for (const dir of [path.join(f.work, ".git", "hooks"), evil]) {
      for (const hook of ["pre-push", "reference-transaction", "post-update", "push-to-checkout"]) {
        writeFileSync(path.join(dir, hook), spy(hook));
        chmodSync(path.join(dir, hook), 0o755);
      }
    }
    writeFileSync(path.join(evil, "fsmonitor"), spy("fsmonitor"));
    chmodSync(path.join(evil, "fsmonitor"), 0o755);
    const remoteUrl = `file://${f.remote}`;
    expect(f.git(["config", "core.hooksPath", evil]).code).toBe(0);
    expect(f.git(["config", "core.fsmonitor", path.join(evil, "fsmonitor")]).code).toBe(0);
    // Any push to the real remote would be redirected to the decoy.
    expect(f.git(["config", `url.file://${f.decoy}.insteadOf`, remoteUrl]).code).toBe(0);

    // Control: a plain git push in this checkout runs the hook and lands in the decoy.
    expect(f.git(["push", "-q", remoteUrl, "HEAD:refs/heads/control"]).code).toBe(0);
    expect(readdirSync(canary).some((n) => n.startsWith("pre-push"))).toBe(true);
    expect(f.refs(f.decoy)).toContain("refs/heads/control");
    rmSync(canary, { recursive: true });
    mkdirSync(canary);

    const g = realGit({ [PUSH]: remoteUrl });
    // The operator env holds the token too (a CI job's GITHUB_TOKEN).
    const r = await pushHeadBranch({ ...opts(f), env: { ...f.env, GITHUB_TOKEN: TOKEN }, git: g.git });
    expect(r).toEqual({ pushed: true, attempted: true });

    // Pushed to the validated destination, not the decoy.
    expect(f.refs(f.remote)).toBe(`refs/heads/off-1-fix ${f.sha}`);
    expect(f.refs(f.decoy)).toBe(`refs/heads/control ${f.sha}`);
    // No agent program ran: no hook, no fsmonitor, so nothing saw the token.
    expect(readdirSync(canary)).toEqual([]);
    expect(readAll(canary)).not.toContain(TOKEN);

    // One push: explicit URL and refspec, hooks off, never forced, token never in argv.
    const [push, ...more] = g.pushes();
    expect(more).toEqual([]);
    expect(push.args).toContain(PUSH);
    expect(push.args).toContain("--no-verify");
    expect(push.args.at(-1)).toBe("refs/heads/off-1-fix:refs/heads/off-1-fix");
    expect(push.args.join(" ")).not.toContain(TOKEN);
    expect(push.args.join(" ")).not.toContain(BASIC);
    expect(push.args.some((a) => a === "--force" || a.startsWith("+") || a === "-f")).toBe(false);
    // It ran in a private repo, not the checkout, with no system or global config.
    expect(push.cwd).not.toBe(f.work);
    expect(push.env.GIT_CONFIG_NOSYSTEM).toBe("1");
    expect(push.env.GIT_CONFIG_GLOBAL).toMatch(/null|nul/i);
    expect(gitConfig(push.env)).toEqual({
      "http.https://github.com/.extraheader": ["", `AUTHORIZATION: basic ${BASIC}`],
    });
    // Only the push carries the token (as the header); reads in the checkout never do.
    expect(JSON.stringify(push.env)).not.toContain(TOKEN);
    for (const c of g.calls.filter((c) => c !== push)) {
      expect(JSON.stringify(c.env)).not.toContain(BASIC);
      expect(JSON.stringify(c.env)).not.toContain(TOKEN);
    }
    // The private push repo is gone.
    expect(existsSync(push.cwd)).toBe(false);
  });

  it("a push URL that differs from the PR's repo refuses the push", async () => {
    const f = make();
    expect(f.git(["config", "remote.origin.pushurl", `file://${f.decoy}`]).code).toBe(0);
    const g = realGit({ [PUSH]: `file://${f.remote}` });
    const r = await pushHeadBranch({ ...opts(f), git: g.git });
    expect(r).toMatchObject({ pushed: false, attempted: false });
    expect(r.reason).toContain("origin is not");
    expect(g.pushes()).toEqual([]);
    expect(f.refs(f.remote)).toBe("");
    expect(f.refs(f.decoy)).toBe("");
  });

  it("a second fetch URL for another repo refuses the push", async () => {
    const f = make();
    expect(f.git(["remote", "set-url", "--add", "origin", "https://github.com/evil/other.git"]).code).toBe(0);
    const g = realGit({ [PUSH]: `file://${f.remote}` });
    expect((await pushHeadBranch({ ...opts(f), git: g.git })).attempted).toBe(false);
    expect(g.pushes()).toEqual([]);
  });

  it("an scp-form origin of the same repo pushes over https with the token", async () => {
    const f = make({ origin: "git@github.com:owner/repo.git" });
    const g = realGit({ [PUSH]: `file://${f.remote}` });
    expect(await pushHeadBranch({ ...opts(f), git: g.git })).toEqual({ pushed: true, attempted: true });
    expect(g.pushes()[0].args).toContain(PUSH);
    expect(f.refs(f.remote)).toBe(`refs/heads/off-1-fix ${f.sha}`);
  });

  it("pushes from the checkout it is given, not process.cwd()", async () => {
    const f = make();
    expect(path.resolve(process.cwd())).not.toBe(path.resolve(f.work));
    const g = realGit({ [PUSH]: `file://${f.remote}` });
    expect((await pushHeadBranch({ ...opts(f), git: g.git })).pushed).toBe(true);
    expect(g.calls.filter((c) => c.args.includes("rev-parse")).every((c) => c.cwd === path.resolve(f.work))).toBe(true);
    expect(f.refs(f.remote)).toBe(`refs/heads/off-1-fix ${f.sha}`);
  });

  it("pushes from a shallow checkout (actions/checkout's default depth)", async () => {
    const f = make();
    const id = ["-c", "user.name=t", "-c", "user.email=t@t"];
    // The remote has main with history; the checkout is a depth-1 clone of it.
    expect(f.git(["checkout", "-q", "main"]).code).toBe(0);
    for (const n of [1, 2, 3]) expect(f.git([...id, "commit", "-q", "--allow-empty", "-m", `m${n}`]).code).toBe(0);
    expect(f.git(["push", "-q", `file://${f.remote}`, "main:refs/heads/main"]).code).toBe(0);
    expect(run(["symbolic-ref", "HEAD", "refs/heads/main"], f.remote, f.env).code).toBe(0);
    const shallow = path.join(f.root, "shallow");
    expect(run(["clone", "-q", "--depth", "1", `file://${f.remote}`, shallow], f.root, f.env).code).toBe(0);
    expect(existsSync(path.join(shallow, ".git", "shallow"))).toBe(true);
    expect(run(["remote", "set-url", "origin", DEST], shallow, f.env).code).toBe(0);
    expect(run(["checkout", "-q", "-b", "off-2-fix"], shallow, f.env).code).toBe(0);
    writeFileSync(path.join(shallow, "b.txt"), "b\n");
    expect(run(["add", "b.txt"], shallow, f.env).code).toBe(0);
    expect(run([...id, "commit", "-q", "-m", "b"], shallow, f.env).code).toBe(0);
    const sha = run(["rev-parse", "HEAD"], shallow, f.env).stdout.trim();

    const g = realGit({ [PUSH]: `file://${f.remote}` });
    const r = await pushHeadBranch({ ...opts(f), head: "off-2-fix", cwd: shallow, git: g.git });
    expect(r).toEqual({ pushed: true, attempted: true });
    expect(run(["rev-parse", "refs/heads/off-2-fix"], f.remote, f.env).stdout.trim()).toBe(sha);
    expect(run(["fsck", "--connectivity-only", "--no-dangling"], f.remote, f.env).code).toBe(0);
  });

  it("pushes from a linked worktree", async () => {
    const f = make();
    const wt = path.join(f.root, "wt");
    expect(f.git(["worktree", "add", "-q", "-b", "off-3-fix", wt, "off-1-fix"]).code).toBe(0);
    const g = realGit({ [PUSH]: `file://${f.remote}` });
    const r = await pushHeadBranch({ ...opts(f), head: "off-3-fix", cwd: wt, git: g.git });
    expect(r).toEqual({ pushed: true, attempted: true });
    expect(f.refs(f.remote)).toBe(`refs/heads/off-3-fix ${f.sha}`);
  });

  it("GITHUB_SERVER_URL sets the destination and scopes the header to a GHES host", async () => {
    const f = make({ origin: "https://ghe.example.com/owner/repo.git" });
    const dest = "https://ghe.example.com/Owner/Repo.git";
    const g = realGit({ [dest]: `file://${f.remote}` });
    const env = { ...f.env, GITHUB_SERVER_URL: "https://ghe.example.com" };
    expect((await pushHeadBranch({ ...opts(f), env, git: g.git })).pushed).toBe(true);
    const [push] = g.pushes();
    expect(push.args).toContain(dest);
    expect(Object.keys(gitConfig(push.env))).toEqual(["http.https://ghe.example.com/.extraheader"]);
  });

  it.each([
    ["origin is another repo", { origin: "https://github.com/someone/else.git" }, {}],
    ["origin is the repo on another host", { origin: "https://gitlab.com/owner/repo.git" }, {}],
    ["no local branch", {}, { head: "nope-1" }],
    ["head is the base", {}, { head: "off-1-fix", base: "off-1-fix" }],
    ["head is main", {}, { head: "main", base: "develop" }],
    ["head is an option", {}, { head: "--force" }],
    ["head walks up", {}, { head: "a/../b" }],
    ["repo is not owner/repo", {}, { repo: "owner/repo/../x" }],
    ["no token", {}, { token: undefined }],
    ["server is not https", {}, { env: { GITHUB_SERVER_URL: "http://github.com" } }],
  ])("skips without pushing: %s", async (_label, fx, over) => {
    const f = make(fx);
    const g = realGit({ [PUSH]: `file://${f.remote}` });
    const o = { ...opts(f), ...over } as Parameters<typeof pushHeadBranch>[0];
    if ("env" in over) o.env = { ...f.env, ...(over as { env: NodeJS.ProcessEnv }).env };
    const r = await pushHeadBranch({ ...o, git: g.git });
    expect(r.pushed).toBe(false);
    expect(r.attempted).toBe(false);
    expect(g.pushes()).toEqual([]);
    expect(f.refs(f.remote)).toBe("");
  });

  it("skips when head is the default branch the API reports", async () => {
    const f = make();
    const g = realGit({ [PUSH]: `file://${f.remote}` });
    const r = await pushHeadBranch({ ...opts(f), defaultBranch: "off-1-fix", git: g.git });
    expect(r).toMatchObject({ pushed: false, attempted: false, reason: "head off-1-fix is the default branch" });
    expect(g.calls).toEqual([]);
    expect(f.refs(f.remote)).toBe("");
  });

  it("skips when the default branch is unknown (no API answer)", async () => {
    const f = make();
    const g = realGit({ [PUSH]: `file://${f.remote}` });
    const r = await pushHeadBranch({ ...opts(f), defaultBranch: undefined, git: g.git });
    expect(r).toMatchObject({ pushed: false, attempted: false, reason: "the repo's default branch is unknown" });
    expect(g.calls).toEqual([]);
  });

  it("the checkout's origin/HEAD is not consulted: a planted one neither blocks nor steers", async () => {
    const f = make();
    expect(f.git(["update-ref", "refs/remotes/origin/off-1-fix", f.sha]).code).toBe(0);
    expect(f.git(["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/off-1-fix"]).code).toBe(0);
    const g = realGit({ [PUSH]: `file://${f.remote}` });
    const r = await pushHeadBranch({ ...opts(f), defaultBranch: "develop", git: g.git });
    expect(r).toEqual({ pushed: true, attempted: true });
    expect(g.calls.some((c) => c.args.includes("symbolic-ref"))).toBe(false);
  });

  it.each([
    ["head refs/heads/x vs base x", { head: "refs/heads/off-1-fix", base: "off-1-fix" }, "head is the base branch"],
    ["head x vs base refs/heads/x", { head: "off-1-fix", base: "refs/heads/off-1-fix" }, "head is the base branch"],
    ["head vs default refs/heads/x", { defaultBranch: "refs/heads/off-1-fix" }, "head off-1-fix is the default branch"],
    ["head refs/heads/main", { head: "refs/heads/main", base: "develop" }, "head main is the default branch"],
  ])("refs/heads/ prefixes compare equal: %s", async (_l, over, reason) => {
    const f = make();
    const g = realGit({ [PUSH]: `file://${f.remote}` });
    const r = await pushHeadBranch({ ...opts(f), ...over, git: g.git });
    expect(r).toMatchObject({ pushed: false, attempted: false, reason });
    expect(g.pushes()).toEqual([]);
  });

  it("a refs/heads/ head is pushed as the plain branch", async () => {
    const f = make();
    const g = realGit({ [PUSH]: `file://${f.remote}` });
    const r = await pushHeadBranch({ ...opts(f), head: "refs/heads/off-1-fix", git: g.git });
    expect(r).toEqual({ pushed: true, attempted: true });
    expect(g.pushes()[0].args.at(-1)).toBe("refs/heads/off-1-fix:refs/heads/off-1-fix");
    expect(f.refs(f.remote)).toBe(`refs/heads/off-1-fix ${f.sha}`);
  });

  it("a fake git first on the run's PATH never runs and never sees the token", async () => {
    // No git seam: the real runner resolves git from the startup PATH. The
    // server is a closed local port, so the push fails without any network.
    const f = make({ origin: "https://127.0.0.1:9/owner/repo.git" });
    const fake = path.join(f.root, "fakebin");
    const canary = path.join(f.root, "fake-git-ran");
    mkdirSync(fake);
    writeFileSync(path.join(fake, "git"), `#!/bin/sh\nenv > "${canary}"\nexit 0\n`);
    chmodSync(path.join(fake, "git"), 0o755);
    const env = { ...f.env, PATH: `${fake}${path.delimiter}${f.env.PATH}`, GITHUB_SERVER_URL: "https://127.0.0.1:9" };
    const r = await pushHeadBranch({ ...opts(f), env });
    expect(existsSync(canary)).toBe(false);
    // The trusted git ran: it read the checkout and attempted the push.
    expect(r).toMatchObject({ pushed: false, attempted: true });
    expect(r.reason).not.toContain(TOKEN);
  }, 60_000);

  it("a TMPDIR the workspace .env introduced does not place the private push repo", async () => {
    const f = make();
    const evilTmp = path.join(f.work, "evil-tmp");
    mkdirSync(evilTmp);
    const dotenvDir = path.join(f.root, "dotenv-tmp");
    mkdirSync(dotenvDir);
    writeFileSync(path.join(dotenvDir, ".env"), `TMPDIR=${evilTmp}\n`);
    const fresh = process.env.TMPDIR === undefined;
    loadDotenv(dotenvDir);
    try {
      if (fresh) expect(process.env.TMPDIR).toBe(evilTmp);
      const g = realGit({ [PUSH]: `file://${f.remote}` });
      expect(await pushHeadBranch({ ...opts(f), git: g.git })).toEqual({ pushed: true, attempted: true });
      const [push] = g.pushes();
      expect(push.cwd.startsWith(evilTmp)).toBe(false);
      expect(path.dirname(push.cwd)).toBe(startupTmpdir());
      expect(readdirSync(evilTmp)).toEqual([]);
    } finally {
      if (fresh) {
        delete process.env.TMPDIR;
        unmarkWorkspaceEnv("TMPDIR");
      }
    }
  });

  it("transport settings and the server URL a workspace .env introduced are not used", async () => {
    const f = make();
    const introduced = ["HTTPS_PROXY", "https_proxy", "GIT_SSL_CAINFO", "SSL_CERT_FILE", "GITHUB_SERVER_URL"];
    const fresh = introduced.filter((k) => startupEnv()[k] === undefined && process.env[k] === undefined);
    const dotenvDir = path.join(f.root, "dotenv");
    mkdirSync(dotenvDir);
    writeFileSync(
      path.join(dotenvDir, ".env"),
      [
        "HTTPS_PROXY=http://evil-proxy.invalid:3128",
        "https_proxy=http://evil-proxy.invalid:3128",
        "GIT_SSL_CAINFO=/workspace/evil-ca.pem",
        "SSL_CERT_FILE=/workspace/evil-ca.pem",
        "GITHUB_SERVER_URL=https://evil.invalid",
      ].join("\n"),
    );
    loadDotenv(dotenvDir);
    try {
      for (const k of fresh) expect(process.env[k], k).toBeDefined();
      for (const env of [process.env, { ...process.env }]) {
        const g = realGit({ [PUSH]: `file://${f.remote}` });
        const r = await pushHeadBranch({ ...opts(f), env, git: g.git });
        // GITHUB_SERVER_URL=evil.invalid was ignored: origin github.com still matches.
        if (fresh.includes("GITHUB_SERVER_URL")) expect(r).toEqual({ pushed: true, attempted: true });
        expect(g.calls.length).toBeGreaterThan(0);
        for (const c of g.calls) {
          for (const k of fresh) expect(c.env[k], k).toBe(startupEnv()[k]);
          expect(JSON.stringify(c.env)).not.toContain("evil");
        }
        if (fresh.includes("GITHUB_SERVER_URL")) expect(g.pushes()[0].args).toContain(PUSH);
        run(["update-ref", "-d", "refs/heads/off-1-fix"], f.remote, f.env);
      }
    } finally {
      for (const k of fresh) {
        delete process.env[k];
        unmarkWorkspaceEnv(k);
      }
    }
  });

  it("skips when there is no origin", async () => {
    const f = make();
    expect(f.git(["remote", "remove", "origin"]).code).toBe(0);
    const g = realGit({});
    expect((await pushHeadBranch({ ...opts(f), git: g.git })).attempted).toBe(false);
    expect(g.pushes()).toEqual([]);
  });

  it("a failed push is reported with the token redacted", async () => {
    const f = make();
    const g = realGit({ [PUSH]: `file://${f.remote}` });
    const failing: GitRunner = async (args, o) =>
      args.includes("push")
        ? {
            code: 128,
            stdout: "",
            stderr: `fatal: unable to access 'https://x:${TOKEN}@github.com/': The requested URL returned error: 403`,
          }
        : g.git(args, o);
    const r = await pushHeadBranch({ ...opts(f), git: failing });
    expect(r).toMatchObject({ pushed: false, attempted: true });
    expect(r.reason).toContain("403");
    expect(r.reason).not.toContain(TOKEN);
  });
});

describe("helpers", () => {
  it("repoFromRemote", () => {
    expect(repoFromRemote("https://github.com/O/R.git")).toEqual({ host: "github.com", repo: "o/r", https: true });
    expect(repoFromRemote("https://x-access-token:t@github.com/o/r")).toEqual({
      host: "github.com",
      repo: "o/r",
      https: true,
    });
    expect(repoFromRemote("git@github.com:o/r.git")).toEqual({ host: "github.com", repo: "o/r", https: false });
    expect(repoFromRemote("ssh://git@github.com/o/r.git")).toEqual({ host: "github.com", repo: "o/r", https: false });
  });

  it("isSafeBranch", () => {
    expect(isSafeBranch("off-1234-fix-null")).toBe(true);
    expect(isSafeBranch("feature/x.y_z")).toBe(true);
    for (const bad of ["-x", "a..b", "a b", "a;b", "/a", "a/", "a//b", "x.lock", "$(id)"]) {
      expect(isSafeBranch(bad), bad).toBe(false);
    }
  });

  it("isSafeRepo", () => {
    expect(isSafeRepo("owner/repo")).toBe(true);
    expect(isSafeRepo("o-1/r.x_y")).toBe(true);
    for (const bad of ["owner", "o/r/x", "../r", "o/..", "o/-r", "o r/x", "o/r?x"])
      expect(isSafeRepo(bad), bad).toBe(false);
  });

  it("pushAuthConfig appends after existing GIT_CONFIG entries", () => {
    const env = pushAuthConfig("https://github.com", TOKEN, {
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "core.x",
      GIT_CONFIG_VALUE_0: "y",
    });
    expect(env.GIT_CONFIG_COUNT).toBe("3");
    expect(env.GIT_CONFIG_KEY_0).toBe("core.x");
    expect(env.GIT_CONFIG_KEY_1).toBe("http.https://github.com/.extraheader");
  });

  it("hardenedGitEnv drops inherited git settings, keeps proxies and CA, and takes PATH only from the caller", () => {
    const env = hardenedGitEnv(
      {
        PATH: "/workspace/evil-bin",
        HOME: "/h",
        HTTPS_PROXY: "http://proxy:3128",
        GIT_SSL_CAINFO: "/ca.pem",
        GIT_DIR: "/elsewhere",
        GIT_SSH_COMMAND: "evil",
        GIT_ASKPASS: "/evil",
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: "core.hooksPath",
        GIT_CONFIG_VALUE_0: "/evil",
        GIT_TRACE: "1",
        GITHUB_TOKEN: TOKEN,
      },
      "/usr/bin",
    );
    expect(env).toMatchObject({
      PATH: "/usr/bin",
      HOME: "/h",
      HTTPS_PROXY: "http://proxy:3128",
      GIT_SSL_CAINFO: "/ca.pem",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
    });
    for (const k of ["GIT_DIR", "GIT_SSH_COMMAND", "GIT_ASKPASS", "GIT_CONFIG_COUNT", "GIT_TRACE", "GITHUB_TOKEN"]) {
      expect(env, k).not.toHaveProperty(k);
    }
  });
});

describe.skipIf(!posix)("trusted git resolution", () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
  });

  it("never picks a git in the workspace, the temp dir or a writable dir, nor a relative entry", () => {
    const root = mkdtempSync(path.join(tmpdir(), "sweny-trusted-git-"));
    roots.push(root);
    const ws = path.join(root, "ws");
    const wsBin = path.join(ws, "bin");
    const tmpBin = path.join(root, "bin");
    for (const d of [wsBin, tmpBin]) {
      mkdirSync(d, { recursive: true });
      writeFileSync(path.join(d, "git"), "#!/bin/sh\nexit 0\n");
      chmodSync(path.join(d, "git"), 0o755);
    }
    const realPath = startupEnv().PATH ?? "";
    const pathValue = [wsBin, tmpBin, "bin", ".", realPath].join(path.delimiter);
    const dirs = trustedPathDirs(pathValue, ws);
    expect(dirs).not.toContain(wsBin);
    expect(dirs).not.toContain(tmpBin);
    expect(dirs).not.toContain("bin");
    expect(dirs).not.toContain(".");
    const git = resolveTrustedGit(pathValue, ws);
    expect(git).toBeDefined();
    expect(path.isAbsolute(git!)).toBe(true);
    expect(git!.startsWith(root)).toBe(false);
    expect(git).toBe(resolveTrustedGit(realPath, ws));
  });

  it("no trusted git on the PATH: nothing is resolved", () => {
    const root = mkdtempSync(path.join(tmpdir(), "sweny-trusted-git-"));
    roots.push(root);
    expect(resolveTrustedGit(root, path.join(root, "ws"))).toBeUndefined();
    expect(resolveTrustedGit("", root)).toBeUndefined();
  });
});

describe("branchName", () => {
  it("strips refs/heads/ only", () => {
    expect(branchName("refs/heads/develop")).toBe("develop");
    expect(branchName("develop")).toBe("develop");
    expect(branchName("refs/tags/v1")).toBe("refs/tags/v1");
  });
});

describe("github_create_pr pushes the head before it requests the PR", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls the run's pusher (ctx.pushBranch) with the skill's token, then the API", async () => {
    const order: string[] = [];
    const pusher = vi.fn(async (_opts: { repo: string; head: string; base: string; token?: string }) => {
      order.push("push");
      return { pushed: true, attempted: true };
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      if (String(url) === "https://api.github.com/repos/o/r" && !init?.method) {
        order.push("repo");
        return new Response(JSON.stringify({ default_branch: "trunk" }), { status: 200 });
      }
      order.push("api");
      return new Response(JSON.stringify({ number: 7, html_url: "https://github.com/o/r/pull/7" }), { status: 201 });
    });
    const createPr = github.tools.find((t) => t.name === "github_create_pr")!;
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    await createPr.handler(
      { repo: "o/r", title: "t", head: "x-1-fix" },
      { config: { GITHUB_TOKEN: TOKEN }, logger, pushBranch: pusher },
    );
    expect(pusher).toHaveBeenCalledWith({
      repo: "o/r",
      head: "x-1-fix",
      base: "main",
      defaultBranch: "trunk",
      token: TOKEN,
    });
    expect(order.slice(0, 2)).toEqual(["repo", "push"]);
    expect(order).toContain("api");
  });

  it("a failed default-branch lookup hands the pusher no default branch (it then refuses)", async () => {
    const pusher = vi.fn(async (_opts: { repo: string; head: string; base: string; defaultBranch?: string }) => ({
      pushed: false,
      attempted: false,
    }));
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) =>
      String(url) === "https://api.github.com/repos/o/r" && !init?.method
        ? new Response("boom", { status: 500 })
        : new Response(JSON.stringify({ number: 7 }), { status: 201 }),
    );
    const createPr = github.tools.find((t) => t.name === "github_create_pr")!;
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    await createPr.handler(
      { repo: "o/r", title: "t", head: "x-1-fix" },
      { config: { GITHUB_TOKEN: TOKEN }, logger, pushBranch: pusher },
    );
    expect(pusher).toHaveBeenCalledTimes(1);
    expect(pusher.mock.calls[0][0]).not.toHaveProperty("defaultBranch");
  });

  it("a failed push warns and still requests the PR", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => new Response(JSON.stringify({ number: 8 }), { status: 201 }));
    const createPr = github.tools.find((t) => t.name === "github_create_pr")!;
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    await createPr.handler(
      { repo: "o/r", title: "t", head: "x-1-fix" },
      {
        config: { GITHUB_TOKEN: TOKEN },
        logger,
        pushBranch: async () => ({ pushed: false, attempted: true, reason: "git push failed: 403" }),
      },
    );
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("git push failed: 403"));
    expect(fetchSpy).toHaveBeenCalled();
  });

  it("without a pusher (browser build) it only calls the API", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => new Response(JSON.stringify({ number: 9 }), { status: 201 }));
    const createPr = github.tools.find((t) => t.name === "github_create_pr")!;
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    await createPr.handler({ repo: "o/r", title: "t", head: "x-1-fix" }, { config: { GITHUB_TOKEN: TOKEN }, logger });
    expect(fetchSpy).toHaveBeenCalled();
  });
});
