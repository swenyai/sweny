import { afterEach, describe, expect, it, vi } from "vitest";
import { isSafeBranch, pushAuthConfig, pushHeadBranch, repoFromRemote, type GitRunner } from "./git-push.js";
import { github, setBranchPusher } from "./github.js";

// #473: with `persist-credentials: false` the checkout holds no token, so
// sweny pushes the PR head itself, from its own process, with the github
// skill's token. These specs drive a scripted git; no network.
const TOKEN = "ghs_pushCanaryPushCanary0473";

type Call = { args: string[]; env: NodeJS.ProcessEnv };

function scriptedGit(opts: {
  origin?: string;
  local?: boolean;
  originHead?: string;
  pushCode?: number;
  pushErr?: string;
}) {
  const calls: Call[] = [];
  const git: GitRunner = async (args, o) => {
    calls.push({ args, env: o.env });
    if (args[0] === "rev-parse") return { code: opts.local === false ? 1 : 0, stdout: "abc\n", stderr: "" };
    if (args[0] === "remote") {
      return opts.origin ? { code: 0, stdout: `${opts.origin}\n`, stderr: "" } : { code: 2, stdout: "", stderr: "" };
    }
    if (args[0] === "symbolic-ref") {
      return opts.originHead
        ? { code: 0, stdout: `${opts.originHead}\n`, stderr: "" }
        : { code: 1, stdout: "", stderr: "" };
    }
    if (args[0] === "push") return { code: opts.pushCode ?? 0, stdout: "", stderr: opts.pushErr ?? "" };
    return { code: 0, stdout: "", stderr: "" };
  };
  return { git, calls, pushes: () => calls.filter((c) => c.args[0] === "push") };
}

const base = { repo: "Owner/Repo", head: "off-1-fix", base: "main", token: TOKEN, cwd: "/w", env: { PATH: "/bin" } };

/** The command-scope config git sees, as key -> values. */
function gitConfig(env: NodeJS.ProcessEnv): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (let i = 0; i < Number(env.GIT_CONFIG_COUNT ?? 0); i++) {
    (out[env[`GIT_CONFIG_KEY_${i}`]!] ??= []).push(env[`GIT_CONFIG_VALUE_${i}`]!);
  }
  return out;
}

describe("pushHeadBranch", () => {
  it("pushes the head to origin with the token in command-scope config, never argv, never forced", async () => {
    const s = scriptedGit({ origin: "https://github.com/owner/repo.git", originHead: "origin/main" });
    const r = await pushHeadBranch({ ...base, git: s.git });
    expect(r).toEqual({ pushed: true, attempted: true });
    const [push] = s.pushes();
    expect(push.args).toEqual(["push", "--porcelain", "origin", "refs/heads/off-1-fix:refs/heads/off-1-fix"]);
    expect(push.args.join(" ")).not.toContain(TOKEN);
    expect(push.args.some((a) => a.startsWith("-f") || a.startsWith("--force") || a.startsWith("+"))).toBe(false);
    const basic = Buffer.from(`x-access-token:${TOKEN}`).toString("base64");
    // The empty value first resets any header the checkout persisted, so the token is sent once.
    expect(gitConfig(push.env)).toEqual({
      "http.https://github.com/.extraheader": ["", `AUTHORIZATION: basic ${basic}`],
    });
    expect(push.env.GIT_TERMINAL_PROMPT).toBe("0");
  });

  it("appends after existing GIT_CONFIG entries", () => {
    const env = pushAuthConfig("https://github.com", TOKEN, {
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "core.x",
      GIT_CONFIG_VALUE_0: "y",
    });
    expect(env.GIT_CONFIG_COUNT).toBe("3");
    expect(env.GIT_CONFIG_KEY_0).toBe("core.x");
    expect(env.GIT_CONFIG_KEY_1).toBe("http.https://github.com/.extraheader");
  });

  it("an ssh origin pushes with the operator's own key, no token", async () => {
    const s = scriptedGit({ origin: "git@github.com:owner/repo.git" });
    expect((await pushHeadBranch({ ...base, git: s.git })).pushed).toBe(true);
    expect(s.pushes()[0].env.GIT_CONFIG_COUNT).toBeUndefined();
  });

  it.each([
    ["origin is another repo", { origin: "https://github.com/someone/else.git" }, {}],
    ["no local branch", { origin: "https://github.com/owner/repo", local: false }, {}],
    ["head is the base", { origin: "https://github.com/owner/repo" }, { head: "release", base: "release" }],
    ["head is main", { origin: "https://github.com/owner/repo" }, { head: "main", base: "develop" }],
    [
      "head is the remote default",
      { origin: "https://github.com/owner/repo", originHead: "origin/trunk" },
      { head: "trunk" },
    ],
    ["head is an option", { origin: "https://github.com/owner/repo" }, { head: "--force" }],
    ["head walks up", { origin: "https://github.com/owner/repo" }, { head: "a/../b" }],
    ["no origin", {}, {}],
  ])("skips without pushing: %s", async (_label, script, over) => {
    const s = scriptedGit(script);
    const r = await pushHeadBranch({ ...base, ...over, git: s.git });
    expect(r.pushed).toBe(false);
    expect(r.attempted).toBe(false);
    expect(s.pushes()).toEqual([]);
  });

  it("a failed push is reported with the token redacted", async () => {
    const s = scriptedGit({
      origin: "https://github.com/owner/repo",
      pushCode: 128,
      pushErr: `fatal: unable to access 'https://x:${TOKEN}@github.com/': The requested URL returned error: 403`,
    });
    const r = await pushHeadBranch({ ...base, git: s.git });
    expect(r).toMatchObject({ pushed: false, attempted: true });
    expect(r.reason).toContain("403");
    expect(r.reason).not.toContain(TOKEN);
  });

  it("GITHUB_SERVER_URL scopes the header to a GHES host", async () => {
    const s = scriptedGit({ origin: "https://ghe.example.com/owner/repo.git" });
    await pushHeadBranch({ ...base, env: { GITHUB_SERVER_URL: "https://ghe.example.com" }, git: s.git });
    expect(Object.keys(gitConfig(s.pushes()[0].env))).toEqual(["http.https://ghe.example.com/.extraheader"]);
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
});

describe("github_create_pr pushes the head before it requests the PR", () => {
  afterEach(() => {
    setBranchPusher(undefined);
    vi.restoreAllMocks();
  });

  it("calls the registered pusher with the skill's token, then the API", async () => {
    const order: string[] = [];
    const pusher = vi.fn(async (_opts: { repo: string; head: string; base: string; token?: string }) => {
      order.push("push");
      return { pushed: true, attempted: true };
    });
    setBranchPusher(pusher);
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      order.push("api");
      return new Response(JSON.stringify({ number: 7, html_url: "https://github.com/o/r/pull/7" }), { status: 201 });
    });
    const createPr = github.tools.find((t) => t.name === "github_create_pr")!;
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    await createPr.handler({ repo: "o/r", title: "t", head: "x-1-fix" }, { config: { GITHUB_TOKEN: TOKEN }, logger });
    expect(pusher).toHaveBeenCalledWith({ repo: "o/r", head: "x-1-fix", base: "main", token: TOKEN });
    expect(order[0]).toBe("push");
    expect(order).toContain("api");
  });

  it("a failed push warns and still requests the PR", async () => {
    setBranchPusher(async () => ({ pushed: false, attempted: true, reason: "git push failed: 403" }));
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => new Response(JSON.stringify({ number: 8 }), { status: 201 }));
    const createPr = github.tools.find((t) => t.name === "github_create_pr")!;
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    await createPr.handler({ repo: "o/r", title: "t", head: "x-1-fix" }, { config: { GITHUB_TOKEN: TOKEN }, logger });
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("git push failed: 403"));
    expect(fetchSpy).toHaveBeenCalled();
  });
});
