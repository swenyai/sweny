import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse } from "yaml";
import { resolveSandboxMode } from "../agent-env.js";
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
// `gh` records its arguments and lists FAKE_GH_RELEASES as existing Releases,
// and `sleep` is a no-op so the npm poll finishes at once.
// Each case makes a few repos and may poll a fake registry 60 times; give it room on a busy runner.
describe("release tag-action reconciles v5 to main and npm", { timeout: 30_000 }, () => {
  const release = parse(fs.readFileSync(path.join(repoRoot, ".github/workflows/release.yml"), "utf8"));
  const tagSteps = release.jobs["tag-action"].steps as Array<Record<string, any>>;
  const step = tagSteps.find((s) => String(s.name).startsWith("Tag v5"))!;
  // Runs after the tag step whatever it did (`if: always()` in the job).
  const releaseStep = tagSteps.find((s) => String(s.name).startsWith("Reconcile GitHub Releases"));
  const gateStep = (release.jobs.publish.steps as Array<Record<string, any>>).find((s) => s.id === "gate");
  const stampScript = fs.readFileSync(path.join(repoRoot, "scripts/stamp-action-version.mjs"), "utf8");
  const tagSourceScript = fs.readFileSync(path.join(repoRoot, "scripts/verify-tag-source.mjs"), "utf8");
  const semverPath = path.join(repoRoot, "scripts/semver-compare.mjs");
  const semverScript = fs.existsSync(semverPath) ? fs.readFileSync(semverPath, "utf8") : null;

  const gitEnv = {
    ...process.env,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@example.com",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@example.com",
  };
  const git = (cwd: string, args: string[], env: Record<string, string> = {}) => {
    const r = spawnSync("git", args, { cwd, encoding: "utf8", env: { ...gitEnv, ...env } });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
    return r.stdout.trim();
  };

  interface Setup {
    /** Commits on main, oldest first; the last is main's tip. `readme` writes README.md, absent removes it. */
    main: Array<{ core: string; readme?: string; action?: string }>;
    /** Index into `main` of the commit this run verified (its event; re-runs keep it). Default: the tip. */
    event?: number;
    /** v5 today: main[at] stamped to `pin`, or main[at] itself when `pin` is null (action.yml says latest). */
    v5?: { at: number; pin: string | null };
    /** v5.<version> tags that already exist, all on main[0]. */
    tags?: string[];
  }

  function setup(o: Setup) {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "sweny-tag-action-"));
    const origin = path.join(d, "origin.git");
    const work = path.join(d, "work");
    const bin = path.join(d, "bin");
    git(d, ["init", "-q", "--bare", "-b", "main", origin]);
    git(d, ["init", "-q", "-b", "main", work]);
    git(work, ["remote", "add", "origin", origin]);
    fs.mkdirSync(path.join(work, "scripts"));
    fs.mkdirSync(path.join(work, "packages/core"), { recursive: true });
    fs.writeFileSync(path.join(work, "action.yml"), actionText);
    fs.writeFileSync(path.join(work, "scripts/stamp-action-version.mjs"), stampScript);
    fs.writeFileSync(path.join(work, "scripts/verify-tag-source.mjs"), tagSourceScript);
    if (semverScript) fs.writeFileSync(path.join(work, "scripts/semver-compare.mjs"), semverScript);
    // Past, increasing dates so tags on these commits sort before anything the step creates.
    const shas = o.main.map((c, i) => {
      // `action` appends a line to action.yml: an action-only change.
      fs.writeFileSync(path.join(work, "action.yml"), actionText + (c.action ?? ""));
      fs.writeFileSync(path.join(work, "packages/core/package.json"), JSON.stringify({ version: c.core }));
      if (c.readme === undefined) fs.rmSync(path.join(work, "README.md"), { force: true });
      else fs.writeFileSync(path.join(work, "README.md"), c.readme);
      const date = `2020-01-0${i + 1}T00:00:00Z`;
      git(work, ["add", "-A"]);
      git(work, ["commit", "-q", "--allow-empty", "-m", `c${i}`], { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
      return git(work, ["rev-parse", "HEAD"]);
    });
    git(work, ["push", "-q", "origin", "main"]);
    if (o.v5) {
      git(work, ["checkout", "-q", "--detach", shas[o.v5.at]]);
      if (o.v5.pin !== null) {
        const r = spawnSync(process.execPath, ["scripts/stamp-action-version.mjs", o.v5.pin], { cwd: work });
        if (r.status !== 0) throw new Error("stamp failed");
        git(work, ["commit", "-q", "-am", `stamp ${o.v5.pin}`], {
          GIT_AUTHOR_DATE: "2020-02-01T00:00:00Z",
          GIT_COMMITTER_DATE: "2020-02-01T00:00:00Z",
        });
      }
      git(work, ["tag", "v5"]);
      git(work, ["push", "-q", "origin", "v5"]);
    }
    for (const t of o.tags ?? []) {
      git(work, ["tag", t, shas[0]]);
      git(work, ["push", "-q", "origin", t]);
    }
    const event = shas[o.event ?? shas.length - 1];
    git(work, ["checkout", "-q", "--detach", event]);
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, "curl"), '#!/bin/sh\nprintf "%s" "$FAKE_NPM_JSON"\n', { mode: 0o755 });
    fs.writeFileSync(path.join(bin, "sleep"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    fs.writeFileSync(
      path.join(bin, "gh"),
      [
        "#!/bin/sh",
        'echo "$*" >> "$GH_LOG"',
        'if [ "$1 $2" = "release list" ]; then for t in $FAKE_GH_RELEASES; do echo "$t"; done; fi',
        "exit 0",
        "",
      ].join("\n"),
      { mode: 0o755 },
    );
    const v5Before = o.v5 ? git(origin, ["rev-parse", "v5^{commit}"]) : "";
    return { d, origin, work, bin, shas, tip: shas[shas.length - 1], event, v5Before, ghLog: path.join(d, "gh.log") };
  }

  type Ctx = ReturnType<typeof setup>;
  type RunOpts = { served?: string[]; releases?: string[]; published?: string; latest?: string };

  function runScript(ctx: Ctx, run: string, opts: RunOpts) {
    const served = opts.served ?? [];
    // npm's `latest` dist-tag defaults to the last served version.
    const latest = opts.latest ?? served[served.length - 1];
    const npm = {
      ...(latest ? { "dist-tags": { latest } } : {}),
      versions: Object.fromEntries(served.map((v) => [v, { version: v }])),
    };
    const script = path.join(ctx.d, "step.sh");
    fs.writeFileSync(script, run);
    const r = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", script], {
      cwd: ctx.work,
      encoding: "utf8",
      env: {
        ...gitEnv,
        PATH: `${ctx.bin}:${process.env.PATH}`,
        VERIFIED_SHA: ctx.event,
        // Read only by older versions of the step.
        BASE_SHA: ctx.event,
        PUBLISHED_CORE_VERSION: opts.published ?? "",
        FAKE_NPM_JSON: JSON.stringify(npm),
        FAKE_GH_RELEASES: (opts.releases ?? []).join(" "),
        GH_LOG: ctx.ghLog,
        GH_TOKEN: "x",
        GITHUB_OUTPUT: path.join(ctx.d, "github-output"),
      },
    });
    return { status: r.status, out: r.stdout + r.stderr };
  }

  // The tag step, then the Release step, as the job runs them.
  function run(ctx: Ctx, opts: RunOpts & { served: string[] }) {
    const tag = runScript(ctx, step.run, opts);
    if (!releaseStep) return tag;
    const rel = runScript(ctx, releaseStep.run, opts);
    return { status: tag.status || rel.status, out: tag.out + rel.out };
  }

  const v5Sha = (ctx: Ctx) => git(ctx.origin, ["rev-parse", "v5^{commit}"]);
  const pinAt = (ctx: Ctx, ref: string) =>
    parse(git(ctx.origin, ["show", `${ref}:action.yml`])).inputs["cli-version"].default;
  const tags = (ctx: Ctx) => git(ctx.origin, ["tag", "-l", "v5.*"]).split("\n").filter(Boolean);
  const created = (ctx: Ctx) =>
    (fs.existsSync(ctx.ghLog) ? fs.readFileSync(ctx.ghLog, "utf8") : "")
      .split("\n")
      .filter((l) => l.startsWith("release create"));

  it("pins v5 and cuts v5.<version> from main's tip once npm serves main's core, then creates the Release", () => {
    const ctx = setup({
      main: [{ core: "0.1.199" }, { core: "0.1.200" }],
      v5: { at: 0, pin: "0.1.199" },
      tags: ["v5.0.1.199"],
    });
    const r = run(ctx, { served: ["0.1.199", "0.1.200"], releases: ["v5.0.1.199"], published: "0.1.200" });
    expect(r.status, r.out).toBe(0);
    expect(git(ctx.origin, ["rev-parse", "v5~1"])).toBe(ctx.tip);
    expect(pinAt(ctx, "v5")).toBe("0.1.200");
    expect(git(ctx.origin, ["rev-parse", "v5.0.1.200^{commit}"])).toBe(v5Sha(ctx));
    // main is untouched: the stamp lives on no branch.
    expect(git(ctx.origin, ["rev-parse", "main"])).toBe(ctx.tip);
    expect(created(ctx)).toHaveLength(1);
    expect(created(ctx)[0]).toContain("release create v5.0.1.200");
    expect(created(ctx)[0]).toContain("--latest=true");
    expect(created(ctx)[0]).toContain("--generate-notes --notes-start-tag v5.0.1.199");
  });

  it("converges on main's tip when it is this run's verified commit plus the version writeback", () => {
    const ctx = setup({
      main: [{ core: "0.1.200" }, { core: "0.1.201" }],
      event: 0,
      v5: { at: 0, pin: "0.1.200" },
      tags: ["v5.0.1.200"],
    });
    const r = run(ctx, { served: ["0.1.200", "0.1.201"], releases: ["v5.0.1.200"] });
    expect(r.status, r.out).toBe(0);
    expect(git(ctx.origin, ["rev-parse", "v5~1"])).toBe(ctx.tip);
    expect(pinAt(ctx, "v5")).toBe("0.1.201");
    expect(tags(ctx)).toContain("v5.0.1.201");
  });

  it("does nothing when main has moved past this run's verified commit (a re-run, or a newer push)", () => {
    const ctx = setup({
      main: [{ core: "0.1.200" }, { core: "0.1.200", readme: "unverified" }],
      event: 0,
      v5: { at: 0, pin: "0.1.200" },
      tags: ["v5.0.1.200"],
    });
    const r = run(ctx, { served: ["0.1.200"], releases: ["v5.0.1.200"] });
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain("main has moved past");
    expect(v5Sha(ctx)).toBe(ctx.v5Before);
    expect(created(ctx)).toEqual([]);
  });

  it("reconciles Releases only for the 10 most recent v5.* tags", () => {
    const old = Array.from({ length: 12 }, (_, i) => `v5.0.1.${190 + i}`);
    const ctx = setup({ main: [{ core: "0.1.201" }], v5: { at: 0, pin: "0.1.201" }, tags: old });
    // Missing: v5.0.1.190 (outside the window) and v5.0.1.201 (inside it).
    const r = run(ctx, { served: ["0.1.201"], releases: old.slice(1, -1) });
    expect(r.status, r.out).toBe(0);
    expect(created(ctx)).toHaveLength(1);
    expect(created(ctx)[0]).toContain("release create v5.0.1.201");
    expect(created(ctx)[0]).toContain("--latest=true --generate-notes --notes-start-tag v5.0.1.200");
  });

  it("repairs a missing Release in the window even when the tag step exits early", () => {
    const ctx = setup({
      main: [{ core: "0.1.200" }, { core: "0.1.200", readme: "unverified" }],
      event: 0,
      v5: { at: 0, pin: "0.1.200" },
      tags: ["v5.0.1.199", "v5.0.1.200"],
    });
    const r = run(ctx, { served: ["0.1.200"], releases: ["v5.0.1.199"] });
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain("main has moved past");
    expect(v5Sha(ctx)).toBe(ctx.v5Before);
    expect(created(ctx)).toHaveLength(1);
    expect(created(ctx)[0]).toContain("release create v5.0.1.200");
  });

  it("pins the core this run published, not main's stale version, when a later publish step failed", () => {
    // core 0.1.201 reached npm, studio failed before the writeback: main still says 0.1.200.
    const ctx = setup({ main: [{ core: "0.1.200" }], v5: { at: 0, pin: "0.1.200" }, tags: ["v5.0.1.200"] });
    const r = run(ctx, { served: ["0.1.200", "0.1.201"], releases: ["v5.0.1.200"], published: "0.1.201" });
    expect(r.status, r.out).toBe(0);
    expect(pinAt(ctx, "v5")).toBe("0.1.201");
    expect(git(ctx.origin, ["rev-parse", "v5.0.1.201^{commit}"])).toBe(v5Sha(ctx));
  });

  it("publish gate: a re-run of a commit main has moved past publishes nothing", () => {
    const ctx = setup({ main: [{ core: "0.1.200" }, { core: "0.1.200", readme: "newer" }], event: 0 });
    expect(gateStep, "publish job has a gate step").toBeDefined();
    const r = runScript(ctx, gateStep!.run, {});
    expect(r.status, r.out).toBe(0);
    expect(fs.readFileSync(path.join(ctx.d, "github-output"), "utf8")).toContain("current=false");
  });

  it("publish gate: main's tip, or it plus a version-only writeback, publishes", () => {
    for (const event of [0, 1]) {
      const ctx = setup({ main: [{ core: "0.1.200" }, { core: "0.1.201" }], event });
      const r = runScript(ctx, gateStep!.run, {});
      expect(r.status, r.out).toBe(0);
      expect(fs.readFileSync(path.join(ctx.d, "github-output"), "utf8")).toContain("current=true");
    }
  });

  it("after a revert lands, a re-run of the reverted commit leaves v5 on the reverted-to state", () => {
    const ctx = setup({
      main: [{ core: "0.1.200" }, { core: "0.1.200", readme: "bad" }, { core: "0.1.200" }],
      event: 1,
      v5: { at: 0, pin: "0.1.200" },
      tags: ["v5.0.1.200"],
    });
    const r = run(ctx, { served: ["0.1.200"], releases: ["v5.0.1.200"] });
    expect(r.status, r.out).toBe(0);
    expect(v5Sha(ctx)).toBe(ctx.v5Before);
    expect(git(ctx.origin, ["ls-tree", "--name-only", "v5"])).not.toContain("README.md");
  });

  it("does nothing, and exits clean, until npm serves exactly main's core", () => {
    const ctx = setup({
      main: [{ core: "0.1.200" }, { core: "0.1.201" }],
      v5: { at: 0, pin: "0.1.200" },
      tags: ["v5.0.1.200"],
    });
    const r = run(ctx, { served: ["0.1.200"], releases: ["v5.0.1.200"], published: "0.1.201" });
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain("not served by npm");
    expect(v5Sha(ctx)).toBe(ctx.v5Before);
    expect(tags(ctx)).toEqual(["v5.0.1.200"]);
    expect(created(ctx)).toEqual([]);
  });

  it("an existing v5.<version> tag does not skip the npm check", () => {
    const ctx = setup({
      main: [{ core: "0.1.200" }, { core: "0.1.201" }],
      v5: { at: 0, pin: "0.1.200" },
      tags: ["v5.0.1.200", "v5.0.1.201"],
    });
    const r = run(ctx, { served: ["0.1.200"], releases: ["v5.0.1.200", "v5.0.1.201"] });
    expect(r.status, r.out).toBe(0);
    expect(v5Sha(ctx)).toBe(ctx.v5Before);
    expect(pinAt(ctx, "v5")).toBe("0.1.200");
  });

  it("moves v5 but leaves an existing v5.<version> tag where it is", () => {
    const ctx = setup({
      main: [{ core: "0.1.200" }, { core: "0.1.201" }],
      v5: { at: 0, pin: "0.1.200" },
      tags: ["v5.0.1.201"],
    });
    const r = run(ctx, { served: ["0.1.200", "0.1.201"], releases: ["v5.0.1.201"] });
    expect(r.status, r.out).toBe(0);
    expect(pinAt(ctx, "v5")).toBe("0.1.201");
    expect(git(ctx.origin, ["rev-parse", "v5.0.1.201^{commit}"])).toBe(ctx.shas[0]);
  });

  it("creates a missing Release for an older tag while v5 is already current", () => {
    const ctx = setup({
      main: [{ core: "0.1.200" }],
      v5: { at: 0, pin: "0.1.200" },
      tags: ["v5.0.1.199", "v5.0.1.200"],
    });
    const r = run(ctx, { served: ["0.1.200"], releases: ["v5.0.1.200"] });
    expect(r.status, r.out).toBe(0);
    expect(v5Sha(ctx)).toBe(ctx.v5Before);
    expect(created(ctx)).toHaveLength(1);
    expect(created(ctx)[0]).toContain("release create v5.0.1.199");
    expect(created(ctx)[0]).toContain("--latest=false");
  });

  it("is a no-op when v5, the tag and the Release already match main and npm", () => {
    const ctx = setup({ main: [{ core: "0.1.200" }], v5: { at: 0, pin: "0.1.200" }, tags: ["v5.0.1.200"] });
    const r = run(ctx, { served: ["0.1.200"], releases: ["v5.0.1.200"] });
    expect(r.status, r.out).toBe(0);
    expect(v5Sha(ctx)).toBe(ctx.v5Before);
    expect(tags(ctx)).toEqual(["v5.0.1.200"]);
    expect(created(ctx)).toEqual([]);
  });

  it("pins main's stable core even when v5 pins its prerelease (no version comparison)", () => {
    const ctx = setup({
      main: [{ core: "0.1.200-rc.1" }, { core: "0.1.200" }],
      v5: { at: 0, pin: "0.1.200-rc.1" },
      tags: ["v5.0.1.200-rc.1"],
    });
    const r = run(ctx, { served: ["0.1.200-rc.1", "0.1.200"], releases: ["v5.0.1.200-rc.1"] });
    expect(r.status, r.out).toBe(0);
    expect(pinAt(ctx, "v5")).toBe("0.1.200");
  });

  it("pins a prerelease in main exactly", () => {
    const ctx = setup({ main: [{ core: "0.1.201-rc.1" }] });
    const r = run(ctx, { served: ["0.1.201-rc.1"] });
    expect(r.status, r.out).toBe(0);
    expect(pinAt(ctx, "v5")).toBe("0.1.201-rc.1");
    expect(tags(ctx)).toEqual(["v5.0.1.201-rc.1"]);
  });

  it("never moves v5 below the core it pins: a re-run whose publish emitted nothing", () => {
    // C declared 0.1.200, its release published 0.1.201 and moved v5 there before the
    // writeback landed; a full re-run of C publishes nothing and main still says 0.1.200.
    const ctx = setup({ main: [{ core: "0.1.200" }], v5: { at: 0, pin: "0.1.201" }, tags: ["v5.0.1.201"] });
    const r = run(ctx, { served: ["0.1.200", "0.1.201"], releases: ["v5.0.1.201"] });
    expect(r.status, r.out).toBe(0);
    expect(v5Sha(ctx)).toBe(ctx.v5Before);
    expect(pinAt(ctx, "v5")).toBe("0.1.201");
    expect(tags(ctx)).toEqual(["v5.0.1.201"]);
  });

  it("never moves v5 to a prerelease of the stable core it pins", () => {
    const ctx = setup({ main: [{ core: "0.1.201-rc.1" }], v5: { at: 0, pin: "0.1.201" }, tags: ["v5.0.1.201"] });
    const r = run(ctx, { served: ["0.1.201-rc.1", "0.1.201"], releases: ["v5.0.1.201"] });
    expect(r.status, r.out).toBe(0);
    expect(v5Sha(ctx)).toBe(ctx.v5Before);
    expect(pinAt(ctx, "v5")).toBe("0.1.201");
  });

  it("moves v5 for an action-only change at the same core version", () => {
    const ctx = setup({
      main: [{ core: "0.1.201" }, { core: "0.1.201", action: "# action-only change\n" }],
      v5: { at: 0, pin: "0.1.201" },
      tags: ["v5.0.1.201"],
    });
    const r = run(ctx, { served: ["0.1.201"], releases: ["v5.0.1.201"] });
    expect(r.status, r.out).toBe(0);
    expect(git(ctx.origin, ["rev-parse", "v5~1"])).toBe(ctx.tip);
    expect(pinAt(ctx, "v5")).toBe("0.1.201");
    expect(git(ctx.origin, ["show", "v5:action.yml"])).toContain("# action-only change");
  });

  it("bootstrap: with v5 on cli-version latest, never pins below npm's latest", () => {
    const ctx = setup({ main: [{ core: "0.1.200" }], v5: { at: 0, pin: null }, tags: ["v5.0.1.201"] });
    const r = run(ctx, { served: ["0.1.200", "0.1.201"], latest: "0.1.201", releases: ["v5.0.1.201"] });
    expect(r.status, r.out).toBe(0);
    expect(v5Sha(ctx)).toBe(ctx.v5Before);
    expect(pinAt(ctx, "v5")).toBe("latest");
  });

  it("bootstrap: with v5 on cli-version latest, pins a core at npm's latest", () => {
    const ctx = setup({ main: [{ core: "0.1.201" }], v5: { at: 0, pin: null }, tags: ["v5.0.1.201"] });
    const r = run(ctx, { served: ["0.1.200", "0.1.201"], latest: "0.1.201", releases: ["v5.0.1.201"] });
    expect(r.status, r.out).toBe(0);
    expect(pinAt(ctx, "v5")).toBe("0.1.201");
    expect(git(ctx.origin, ["rev-parse", "v5~1"])).toBe(ctx.tip);
  });

  it("never creates v5 while npm serves nothing", () => {
    const ctx = setup({ main: [{ core: "0.1.201" }] });
    const r = run(ctx, { served: [] });
    expect(r.status, r.out).toBe(0);
    expect(git(ctx.origin, ["tag", "-l", "v5*"])).toBe("");
  });
});

describe("tag-action job", () => {
  const release = parse(fs.readFileSync(path.join(repoRoot, ".github/workflows/release.yml"), "utf8"));

  it("checks out and reconciles from the commit this run's verify job tested", () => {
    const steps = release.jobs["tag-action"].steps as Array<Record<string, any>>;
    const checkout = steps.find((st) => String(st.uses).startsWith("actions/checkout@"))!;
    const tag = steps.find((st) => String(st.name).startsWith("Tag v5"))!;
    expect(checkout.with.ref).toBe("${{ needs.verify.outputs.sha }}");
    expect(tag.env.VERIFIED_SHA).toBe("${{ needs.verify.outputs.sha }}");
  });

  it("publishes and moves the release-latest diff base only past the gate", () => {
    const steps = release.jobs.publish.steps as Array<Record<string, any>>;
    for (const name of ["Detect changes and publish", "Advance release-latest diff base"]) {
      expect(steps.find((st) => st.name === name)!.if).toBe("steps.gate.outputs.current == 'true'");
    }
    const gate = steps.findIndex((st) => st.id === "gate");
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(steps.findIndex((st) => st.name === "Detect changes and publish"));
  });

  it("repairs Releases in its own step that runs whatever the tag step did", () => {
    const steps = release.jobs["tag-action"].steps as Array<Record<string, any>>;
    const rel = steps.find((st) => String(st.name).startsWith("Reconcile GitHub Releases"))!;
    expect(rel.if).toBe("always() && steps.checkout.outcome == 'success'");
    expect(steps.indexOf(rel)).toBeGreaterThan(steps.findIndex((st) => String(st.name).startsWith("Tag v5")));
  });

  it("has no writeback_sha output left over from the old tag-source step", () => {
    expect(release.jobs.publish.outputs).not.toHaveProperty("writeback_sha");
  });

  it("serializes tagging runs without cancelling one in flight", () => {
    expect(release.jobs["tag-action"].concurrency).toEqual({ group: "release-tag", "cancel-in-progress": false });
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

  it("writes core's version back to main right after core publishes, before studio and mcp", () => {
    const sync = publishRun.indexOf("sync-release-versions.mjs sync");
    expect(sync).toBeGreaterThan(publishRun.indexOf('bump_and_publish packages/core "@sweny-ai/core"'));
    expect(sync).toBeLessThan(publishRun.indexOf('bump_and_publish packages/studio "@sweny-ai/studio"'));
  });

  it("emits core_version right after core publishes, before anything later in the job can fail", () => {
    const emits = publishRun.match(/core_version=/g) ?? [];
    expect(emits).toHaveLength(1);
    const at = publishRun.indexOf("core_version=");
    expect(at).toBeGreaterThan(publishRun.indexOf('bump_and_publish packages/core "@sweny-ai/core"'));
    expect(at).toBeLessThan(publishRun.indexOf('bump_and_publish packages/studio "@sweny-ai/studio"'));
    expect(at).toBeLessThan(publishRun.indexOf("sync-release-versions.mjs sync"));
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

const SANDBOX_USERNS = "${{ github.action_path }}/scripts/sandbox-userns.sh";

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
    expect(step.run).toContain('srt --settings "$SETTINGS" -- true');
    expect(step.run).toContain("::error title=SWEny sandbox wrapper::");
  });

  it("relaxes the host through the shared script, with the same env", () => {
    expect(step.env.RUNNER_ENVIRONMENT).toBe("${{ runner.environment }}");
    expect(step.env.SANDBOX_USERNS).toBe(SANDBOX_USERNS);
    expect(step.run).toContain('bash "$SANDBOX_USERNS" relax');
    expect(step.run).not.toContain("sysctl");
    expect(step.run).not.toContain("apparmor_parser");
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

  it("probes and relaxes through the shared script, never under off", () => {
    expect(step.env.RUNNER_ENVIRONMENT).toBe("${{ runner.environment }}");
    expect(step.env.SANDBOX_USERNS).toBe(SANDBOX_USERNS);
    expect(step.run).toContain('[ "$SANDBOX_MODE" != "off" ]');
    expect(step.run).toContain('! bash "$SANDBOX_USERNS" probe');
    expect(step.run).toContain('bash "$SANDBOX_USERNS" relax');
    expect(step.run).not.toContain("sysctl");
    expect(step.run).not.toContain("apparmor_parser");
    expect(step.run).toContain("::notice title=SWEny agent sandbox::");
    expect(step.run).toContain("::warning title=SWEny agent sandbox::bubblewrap still cannot");
  });

  // Runs the step's own script against a stub sandbox-userns.sh and stub bwrap/socat, on a
  // host that cannot sandbox (probe fails, relax refused).
  const runStep = (mode: string, explicit: string, probe = 1) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sweny-deps-step-"));
    for (const bin of ["bwrap", "socat"]) {
      fs.writeFileSync(path.join(dir, bin), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    }
    const stub = path.join(dir, "userns.sh");
    fs.writeFileSync(
      stub,
      `case "$1" in mode) echo ${mode} ;; explicit) echo ${explicit} ;; probe) exit ${probe} ;; relax) exit 3 ;; ` +
        `hint) bash '${path.join(repoRoot, "scripts/sandbox-userns.sh")}' hint ;; esac\n`,
    );
    const r = spawnSync("bash", ["-c", step.run], {
      env: { PATH: `${dir}${path.delimiter}${process.env.PATH ?? ""}`, SANDBOX_USERNS: stub },
      encoding: "utf8",
    });
    fs.rmSync(dir, { recursive: true, force: true });
    return { status: r.status, out: r.stdout };
  };

  it("an explicit SWENY_SANDBOX=strict on a host that cannot sandbox fails the step with the fix (#599)", () => {
    const r = runStep("strict", "strict");
    expect(r.status).toBe(1);
    expect(r.out).toContain(
      "::error title=SWEny agent sandbox::SWENY_SANDBOX is strict and this runner cannot sandbox agent commands.",
    );
    expect(r.out).toContain("sudo apt-get install -y bubblewrap socat");
    expect(r.out).toContain("apparmor_parser -R /etc/apparmor.d/bwrap-userns-restrict");
    expect(r.out).toContain("opt out with SWENY_SANDBOX: off (or sandbox: off in .sweny.yml) and harness-policy: warn");
  });

  it("the Action's strict default warns with the fix and leaves the refusal to the CLI, which reads .sweny.yml", () => {
    const r = runStep("strict", "");
    expect(r.status).toBe(0);
    expect(r.out).toContain(
      "::warning title=SWEny agent sandbox::This runner cannot sandbox agent commands, and the Action",
    );
    expect(r.out).toContain("harness-policy: warn");
    expect(r.out).not.toContain("::error");
  });

  it("auto warns that agents run unsandboxed; off and a host that sandboxes say nothing", () => {
    const auto = runStep("auto", "auto");
    expect(auto.status).toBe(0);
    expect(auto.out).toContain("under SWENY_SANDBOX=auto they run unsandboxed");
    for (const r of [runStep("off", "off"), runStep("strict", "strict", 0), runStep("strict", "", 0)]) {
      expect(r.status).toBe(0);
      expect(r.out).not.toContain("::warning");
      expect(r.out).not.toContain("::error");
    }
  });
});

describe("strict sandbox by default (#599)", () => {
  const DEFAULT = "${{ runner.os != 'Windows' && 'strict' || '' }}";

  it("every step that reads the sandbox mode gets SWENY_SANDBOX_DEFAULT=strict, except on Windows", () => {
    for (const name of [
      "Install agent sandbox dependencies",
      "Install and probe the agent sandbox wrapper (srt)",
      "Run workflow",
    ]) {
      expect(steps.find((s) => s.name === name)!.env.SWENY_SANDBOX_DEFAULT, name).toBe(DEFAULT);
    }
  });

  it("never sets SWENY_SANDBOX itself, so the caller's env and .sweny.yml keep precedence", () => {
    for (const s of steps) {
      expect(Object.keys(s.env ?? {})).not.toContain("SWENY_SANDBOX");
      expect(String(s.run ?? "")).not.toMatch(/export SWENY_SANDBOX=|SWENY_SANDBOX=strict sweny/);
    }
    expect(Object.keys(action.inputs)).not.toContain("sandbox");
  });
});

describe("scripts/sandbox-userns.sh", () => {
  const script = path.join(repoRoot, "scripts/sandbox-userns.sh");
  const text = fs.readFileSync(script, "utf8");
  const relax = (env: Record<string, string>) =>
    spawnSync("bash", [script, "relax"], { env: { PATH: process.env.PATH ?? "", ...env }, encoding: "utf8" });

  it("relaxes the sysctl and unloads bwrap-userns-restrict (anthropics/sandbox-runtime#429)", () => {
    expect(text).toContain("sysctl -w kernel.apparmor_restrict_unprivileged_userns=0");
    expect(text).toContain("apparmor_parser -R /etc/apparmor.d/bwrap-userns-restrict");
    expect(text).toContain("https://github.com/anthropics/sandbox-runtime/issues/429");
  });

  it("probes a user namespace nested inside bwrap, with system binaries and an empty env", () => {
    expect(text).toContain('run_clean "$bwrap" --ro-bind / / --dev /dev --proc /proc true');
    expect(text).toContain('run_clean "$unshare" --help 2>&1 | grep -q -- --map-root-user || return 0');
    expect(text).toContain(
      'run_clean "$bwrap" --ro-bind / / --dev /dev --proc /proc "$unshare" --user --map-root-user true',
    );
    expect(text).toContain('run_clean() { /usr/bin/env -i PATH=/usr/bin:/bin "$@"; }');
    expect(text).toContain("for d in /usr/bin /bin /usr/local/bin /usr/sbin; do");
  });

  it("relaxes nothing on self-hosted without strict, or under off", () => {
    expect(relax({ RUNNER_ENVIRONMENT: "self-hosted", SWENY_SANDBOX: "auto" }).status).toBe(3);
    expect(relax({ RUNNER_ENVIRONMENT: "self-hosted" }).status).toBe(3);
    // The Action's strict default is not the operator's strict: a persistent host is left alone (#599).
    expect(relax({ RUNNER_ENVIRONMENT: "self-hosted", SWENY_SANDBOX_DEFAULT: "strict" }).status).toBe(3);
    expect(
      relax({ RUNNER_ENVIRONMENT: "self-hosted", SWENY_SANDBOX: "bogus", SWENY_SANDBOX_DEFAULT: "strict" }).status,
    ).toBe(3);
    expect(relax({ RUNNER_ENVIRONMENT: "github-hosted", SWENY_SANDBOX_DEFAULT: "off" }).status).toBe(3);
    expect(relax({ RUNNER_ENVIRONMENT: "github-hosted", SWENY_SANDBOX: "off" }).status).toBe(3);
    expect(relax({ RUNNER_ENVIRONMENT: "self-hosted", SWENY_SANDBOX: "off" }).status).toBe(3);
  });

  it("reads SWENY_SANDBOX exactly as core does, for every alias", () => {
    const mode = (env: Record<string, string>) =>
      spawnSync("bash", [script, "mode"], {
        env: { PATH: process.env.PATH ?? "", ...env },
        encoding: "utf8",
      }).stdout.trim();
    const values = [
      "off",
      "OFF",
      " Off ",
      "false",
      "FALSE",
      "0",
      "no",
      "No",
      "strict",
      "STRICT",
      "on",
      "true",
      "1",
      "auto",
      "Auto",
      "",
      "bogus",
      "\noff",
      "off\n",
      "\t0\n",
      "\r\nno",
      "\nstrict\n",
    ];
    for (const ci of ["true", ""]) {
      for (const v of values) {
        for (const d of [undefined, "strict", " Off\n", "auto", "bogus", ""]) {
          const env: Record<string, string> = { SWENY_SANDBOX: v, CI: ci };
          if (d !== undefined) env.SWENY_SANDBOX_DEFAULT = d;
          const label = `${JSON.stringify(v)} default=${JSON.stringify(d)} CI=${ci}`;
          expect(`${label}: ${mode(env)}`).toBe(`${label}: ${resolveSandboxMode(env)}`);
        }
      }
    }
    expect(mode({ CI: "true" })).toBe(resolveSandboxMode({ CI: "true" }));
    expect(mode({ CI: "true", SWENY_SANDBOX_DEFAULT: "strict" })).toBe("strict");
  });

  it("explicit prints SWENY_SANDBOX's mode only, never the default", () => {
    const explicit = (env: Record<string, string>) =>
      spawnSync("bash", [script, "explicit"], {
        env: { PATH: process.env.PATH ?? "", ...env },
        encoding: "utf8",
      }).stdout.trim();
    expect(explicit({ SWENY_SANDBOX: " On " })).toBe("strict");
    expect(explicit({ SWENY_SANDBOX: "auto", SWENY_SANDBOX_DEFAULT: "strict" })).toBe("auto");
    expect(explicit({ SWENY_SANDBOX_DEFAULT: "strict", CI: "true" })).toBe("");
    expect(explicit({ SWENY_SANDBOX: "bogus", SWENY_SANDBOX_DEFAULT: "strict" })).toBe("");
  });

  it("never relaxes the host when sandboxing is off under any alias", () => {
    for (const v of ["off", "OFF", "false", "False", "0", "no", "NO", " off ", "\noff", "off\n", "\t0\n"]) {
      expect(relax({ RUNNER_ENVIRONMENT: "github-hosted", SWENY_SANDBOX: v }).status).toBe(3);
    }
  });

  it("the Action steps read the mode from the script, not the raw variable", () => {
    for (const name of ["Install agent sandbox dependencies", "Install and probe the agent sandbox wrapper (srt)"]) {
      const run = steps.find((s) => s.name === name)!.run as string;
      expect(run).toContain('bash "$SANDBOX_USERNS" mode');
      expect(run).not.toMatch(/\$\{SWENY_SANDBOX:-\}" (!=|=) "off"/);
    }
  });

  it("is what CI's sandbox jobs run, not a copy", () => {
    const ci = fs.readFileSync(path.join(repoRoot, ".github/workflows/ci.yml"), "utf8");
    expect(ci).toContain("bash scripts/sandbox-userns.sh relax");
    expect(ci).not.toContain("apparmor_parser");
    expect(ci).not.toContain("sysctl -w");
  });
});
