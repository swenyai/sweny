import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse } from "yaml";
import { TESTED_CODEX_VERSION } from "../harness/codex.js";

const repoRoot = path.resolve(__dirname, "../../../..");
const actionText = fs.readFileSync(path.join(repoRoot, "action.yml"), "utf8");
const action = parse(actionText);
const steps = action.runs.steps as Array<Record<string, any>>;

describe("action.yml version pins", () => {
  it("installs the tested Codex by default", () => {
    expect(action.inputs["codex-version"].default).toBe(TESTED_CODEX_VERSION);
  });

  it("keeps cli-version at latest in the tree; release tags stamp the tested version", () => {
    // Branch refs (@main) install latest. v5 and v5.<version> point at a stamped
    // commit, see "release tag-action" below.
    expect(action.inputs["cli-version"].default).toBe("latest");
  });

  it("pins every action it uses to a commit SHA", () => {
    for (const s of steps) {
      if (typeof s.uses === "string") expect(s.uses).toMatch(/@[0-9a-f]{40}$/);
    }
  });
});

describe("release verification checkout", () => {
  it("does not persist credentials while running the agent policy tests", () => {
    const release = parse(fs.readFileSync(path.join(repoRoot, ".github/workflows/release.yml"), "utf8"));
    const checkout = release.jobs.verify.steps.find((step: Record<string, any>) =>
      String(step.uses).startsWith("actions/checkout@"),
    );
    expect(checkout.with?.["persist-credentials"]).toBe(false);
  });
});

// Runs the real tag-action step script against a throwaway repo and bare
// origin. npm is faked through `curl` (the step reads the registry with curl),
// `gh` only records its arguments, and `sleep` is a no-op so the npm poll
// finishes at once.
// Each case makes a few repos and polls a fake registry 60 times; give it room on a busy runner.
describe("release tag-action", { timeout: 30_000 }, () => {
  const release = parse(fs.readFileSync(path.join(repoRoot, ".github/workflows/release.yml"), "utf8"));
  const step = (release.jobs["tag-action"].steps as Array<Record<string, any>>).find((s) =>
    String(s.name).startsWith("Tag v5"),
  )!;
  const stampScript = fs.readFileSync(path.join(repoRoot, "scripts/stamp-action-version.mjs"), "utf8");

  const gitEnv = {
    ...process.env,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@example.com",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@example.com",
  };
  const git = (cwd: string, ...args: string[]) => {
    const r = spawnSync("git", args, { cwd, encoding: "utf8", env: gitEnv });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
    return r.stdout.trim();
  };

  function setup(coreVersion: string, existingTags: string[] = []) {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "sweny-tag-action-"));
    const origin = path.join(d, "origin.git");
    const work = path.join(d, "work");
    const bin = path.join(d, "bin");
    git(d, "init", "-q", "--bare", "-b", "main", origin);
    git(d, "init", "-q", "-b", "main", work);
    fs.mkdirSync(path.join(work, "scripts"));
    fs.mkdirSync(path.join(work, "packages/core"), { recursive: true });
    fs.writeFileSync(path.join(work, "action.yml"), actionText);
    fs.writeFileSync(path.join(work, "scripts/stamp-action-version.mjs"), stampScript);
    fs.writeFileSync(path.join(work, "packages/core/package.json"), JSON.stringify({ version: coreVersion }));
    git(work, "add", "-A");
    git(work, "commit", "-q", "-m", "base");
    git(work, "remote", "add", "origin", origin);
    git(work, "push", "-q", "origin", "main");
    for (const t of existingTags) {
      git(work, "tag", t);
      git(work, "push", "-q", "origin", t);
    }
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, "curl"), '#!/bin/sh\nprintf "%s" "$FAKE_NPM_JSON"\n', { mode: 0o755 });
    fs.writeFileSync(path.join(bin, "sleep"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    fs.writeFileSync(path.join(bin, "gh"), '#!/bin/sh\necho "$*" >> "$GH_LOG"\n', { mode: 0o755 });
    return { d, origin, work, bin, base: git(work, "rev-parse", "HEAD"), ghLog: path.join(d, "gh.log") };
  }

  function run(
    ctx: ReturnType<typeof setup>,
    opts: { published?: string; served: string[]; latest: string },
  ): { status: number | null; out: string } {
    const npm = {
      "dist-tags": { latest: opts.latest },
      versions: Object.fromEntries(opts.served.map((v) => [v, { version: v }])),
    };
    const script = path.join(ctx.d, "step.sh");
    fs.writeFileSync(script, step.run);
    const r = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", script], {
      cwd: ctx.work,
      encoding: "utf8",
      env: {
        ...gitEnv,
        PATH: `${ctx.bin}:${process.env.PATH}`,
        BASE_SHA: ctx.base,
        PUBLISHED_CORE_VERSION: opts.published ?? "",
        FAKE_NPM_JSON: JSON.stringify(npm),
        GH_LOG: ctx.ghLog,
        GH_TOKEN: "x",
      },
    });
    return { status: r.status, out: r.stdout + r.stderr };
  }

  const cliDefaultAt = (ctx: ReturnType<typeof setup>, ref: string) =>
    parse(git(ctx.origin, "show", `${ref}:action.yml`)).inputs["cli-version"].default;
  const ghCalls = (ctx: ReturnType<typeof setup>) =>
    fs.existsSync(ctx.ghLog) ? fs.readFileSync(ctx.ghLog, "utf8") : "";

  it("on a core release, points v5 and v5.<version> at one commit pinned to that version, with a GitHub Release", () => {
    const ctx = setup("0.1.200", ["v5.0.1.199"]);
    const r = run(ctx, { published: "0.1.200", served: ["0.1.199", "0.1.200"], latest: "0.1.200" });
    expect(r.status, r.out).toBe(0);
    const v5 = git(ctx.origin, "rev-parse", "v5^{commit}");
    expect(git(ctx.origin, "rev-parse", "v5.0.1.200^{commit}")).toBe(v5);
    expect(git(ctx.origin, "rev-parse", `${v5}^`)).toBe(ctx.base);
    expect(cliDefaultAt(ctx, "v5")).toBe("0.1.200");
    // main is untouched: the stamp lives on no branch.
    expect(git(ctx.origin, "rev-parse", "main")).toBe(ctx.base);
    const gh = ghCalls(ctx);
    expect(gh).toContain("release create v5.0.1.200");
    expect(gh).toContain("--generate-notes");
    expect(gh).toContain("--notes-start-tag v5.0.1.199");
  });

  it("on an action-only change, moves v5 to a new commit pinned to the current core and leaves v5.<version> alone", () => {
    const ctx = setup("0.1.200", ["v5.0.1.200"]);
    const before = git(ctx.origin, "rev-parse", "v5.0.1.200^{commit}");
    const r = run(ctx, { served: ["0.1.200"], latest: "0.1.200" });
    expect(r.status, r.out).toBe(0);
    expect(git(ctx.origin, "rev-parse", "v5.0.1.200^{commit}")).toBe(before);
    expect(git(ctx.origin, "rev-parse", "v5~1")).toBe(ctx.base);
    expect(cliDefaultAt(ctx, "v5")).toBe("0.1.200");
    expect(ghCalls(ctx)).toBe("");
  });

  it("when npm never serves the tree's core, pins v5 to npm's latest and cuts no immutable tag", () => {
    const ctx = setup("0.1.201");
    const r = run(ctx, { published: "0.1.201", served: ["0.1.200"], latest: "0.1.200" });
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain("not served by npm");
    expect(cliDefaultAt(ctx, "v5")).toBe("0.1.200");
    expect(git(ctx.origin, "tag", "-l", "v5.*")).toBe("");
    expect(ghCalls(ctx)).toBe("");
  });

  it("when the published core is not in the verified tree, pins v5 to the published version and cuts no immutable tag", () => {
    const ctx = setup("0.1.200", ["v5.0.1.200"]);
    const r = run(ctx, { published: "0.1.201", served: ["0.1.200", "0.1.201"], latest: "0.1.201" });
    expect(r.status, r.out).toBe(0);
    expect(cliDefaultAt(ctx, "v5")).toBe("0.1.201");
    expect(git(ctx.origin, "tag", "-l", "v5.*")).toBe("v5.0.1.200");
  });

  it("never leaves v5 on latest: with no version to pin it fails and leaves v5 where it was", () => {
    const ctx = setup("0.1.201");
    const r = run(ctx, { served: [], latest: "" });
    expect(r.status).not.toBe(0);
    expect(git(ctx.origin, "tag", "-l", "v5")).toBe("");
  });
});

describe("post-release docs", () => {
  it("reads the commits since the previous tag, not the retired CHANGELOG.md", () => {
    const wf = parse(fs.readFileSync(path.join(repoRoot, ".github/workflows/post-release-docs.yml"), "utf8"));
    const steps = wf.jobs["update-docs"].steps as Array<Record<string, any>>;
    const claude = steps.find((s) => String(s.uses).startsWith("anthropics/claude-code-action@"))!;
    expect(claude.with.prompt).not.toContain("CHANGELOG");
    expect(claude.with.prompt).toContain("${{ steps.changes.outputs.list }}");
    expect(steps.findIndex((s) => s.id === "changes")).toBeLessThan(steps.indexOf(claude));
  });
});

describe("release publish pins @sweny-ai/core exactly in dependent packages", () => {
  const release = parse(fs.readFileSync(path.join(repoRoot, ".github/workflows/release.yml"), "utf8"));
  const publishRun = String(
    (release.jobs.publish.steps as Array<Record<string, any>>).find((s) => s.id === "release")!.run,
  );

  it("pin_core_dep rewrites a core range to the exact version and leaves packages without core alone", () => {
    const fn = /^ *pin_core_dep\(\) \{\n[\s\S]*?^ *\}$/m.exec(publishRun)?.[0];
    expect(fn).toBeDefined();
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "sweny-pin-core-"));
    const withCore = path.join(d, "with");
    const without = path.join(d, "without");
    fs.mkdirSync(withCore);
    fs.mkdirSync(without);
    fs.writeFileSync(
      path.join(withCore, "package.json"),
      JSON.stringify({ name: "a", version: "1.0.0", dependencies: { "@sweny-ai/core": "*", yaml: "^2.0.0" } }, null, 2),
    );
    const plain = JSON.stringify({ name: "b", version: "1.0.0", dependencies: { yaml: "^2.0.0" } }, null, 2);
    fs.writeFileSync(path.join(without, "package.json"), plain);
    for (const dir of [withCore, without]) {
      const r = spawnSync("bash", ["-eo", "pipefail", "-c", `${fn}\npin_core_dep 0.1.200`], {
        cwd: dir,
        encoding: "utf8",
      });
      expect(r.status, r.stderr).toBe(0);
    }
    const pinned = JSON.parse(fs.readFileSync(path.join(withCore, "package.json"), "utf8"));
    expect(pinned.dependencies).toEqual({ "@sweny-ai/core": "0.1.200", yaml: "^2.0.0" });
    expect(fs.readFileSync(path.join(without, "package.json"), "utf8")).toBe(plain);
  });

  it("pins every non-core package before npm publish, to the core version settled after core publishes", () => {
    const body = /^bump_and_publish\(\) \{\n([\s\S]*?)\n\}$/m.exec(publishRun)![1];
    const pinAt = body.indexOf('pin_core_dep "$CORE_PIN"');
    expect(pinAt).toBeGreaterThan(-1);
    expect(pinAt).toBeLessThan(body.indexOf("npm publish"));
    const coreBlock = publishRun.indexOf('bump_and_publish packages/core "@sweny-ai/core"');
    const pinSet = publishRun.indexOf("CORE_PIN=$(");
    expect(pinSet).toBeGreaterThan(coreBlock);
    expect(pinSet).toBeLessThan(publishRun.indexOf('bump_and_publish packages/studio "@sweny-ai/studio"'));
    expect(pinSet).toBeLessThan(publishRun.indexOf('bump_and_publish packages/mcp "@sweny-ai/mcp"'));
  });
});

describe("scripts/stamp-action-version.mjs", () => {
  const script = path.join(repoRoot, "scripts/stamp-action-version.mjs");

  it("rewrites only the cli-version default", () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "sweny-stamp-"));
    const f = path.join(d, "action.yml");
    fs.writeFileSync(f, actionText);
    const r = spawnSync("node", [script, "5.123.4", f], { encoding: "utf8" });
    expect(r.status).toBe(0);
    const stamped = parse(fs.readFileSync(f, "utf8"));
    expect(stamped.inputs["cli-version"].default).toBe("5.123.4");
    // everything else is untouched
    stamped.inputs["cli-version"].default = "latest";
    expect(stamped).toEqual(action);
  });

  it("refuses a non-exact version", () => {
    const r = spawnSync("node", [script, "latest", path.join(repoRoot, "action.yml")], { encoding: "utf8" });
    expect(r.status).toBe(2);
  });
});

describe("agent sandbox wrapper step", () => {
  const step = steps.find((s) => s.name === "Install and probe the agent sandbox wrapper (srt)")!;

  it("runs only for non-Claude agents and sits before the workflow", () => {
    expect(step.if).toBe("inputs.agent != 'claude'");
    expect(steps.indexOf(step)).toBeLessThan(steps.findIndex((s) => s.name === "Run workflow"));
  });

  it("uses the same srt pin as the ci.yml sandbox-wrapper job", () => {
    const ci = fs.readFileSync(path.join(repoRoot, ".github/workflows/ci.yml"), "utf8");
    const ciPin = /@anthropic-ai\/sandbox-runtime@(\d+\.\d+\.\d+)/.exec(ci)![1];
    expect(step.env.SRT_VERSION).toBe(ciPin);
  });

  it("installs ripgrep, probes srt, and fails with a message", () => {
    expect(step.run).toContain("ripgrep");
    expect(step.run).toContain("kernel.apparmor_restrict_unprivileged_userns=0");
    expect(step.run).toContain('srt --settings "$SETTINGS" -- true');
    expect(step.run).toContain("::error title=SWEny sandbox wrapper::");
  });

  it("relaxes AppArmor only on GitHub-hosted runners or strict, with the same env", () => {
    expect(step.env.RUNNER_ENVIRONMENT).toBe("${{ runner.environment }}");
    expect(step.run).toContain(
      '[ "${SWENY_SANDBOX:-}" = "strict" ] || [ "${RUNNER_ENVIRONMENT:-}" = "github-hosted" ]',
    );
    expect(step.run).toContain("::notice title=SWEny agent sandbox::");
    expect(step.run).toContain("::warning title=SWEny agent sandbox::srt still cannot");
  });

  it("setup-only skips the run and the PR comment", () => {
    expect(steps.find((s) => s.name === "Run workflow")!.if).toBe("inputs.setup-only != 'true'");
    expect(steps.find((s) => s.name === "Post PR comment")!.if).toContain("inputs.setup-only != 'true'");
  });
});

describe("agent sandbox dependencies step", () => {
  const step = steps.find((s) => s.name === "Install agent sandbox dependencies")!;

  it("relaxes AppArmor on GitHub-hosted runners or strict, never under off", () => {
    expect(step.env.RUNNER_ENVIRONMENT).toBe("${{ runner.environment }}");
    expect(step.run).toContain('[ "${SWENY_SANDBOX:-}" != "off" ]');
    expect(step.run).toContain('[ "${RUNNER_ENVIRONMENT:-}" = "github-hosted" ]');
    expect(step.run).toContain('[ "${SWENY_SANDBOX:-}" = "strict" ]');
    expect(step.run).toContain("kernel.apparmor_restrict_unprivileged_userns=0");
    expect(step.run).toContain("::notice title=SWEny agent sandbox::");
    expect(step.run).toContain("::warning title=SWEny agent sandbox::bubblewrap still cannot");
  });
});
