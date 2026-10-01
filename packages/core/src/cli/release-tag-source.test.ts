import { describe, it, expect, beforeEach } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const script = path.resolve(__dirname, "../../../../scripts/verify-tag-source.mjs");

let repo: string;
const git = (...a: string[]) =>
  execFileSync("git", a, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const write = (f: string, v: unknown) => {
  fs.mkdirSync(path.dirname(path.join(repo, f)), { recursive: true });
  fs.writeFileSync(path.join(repo, f), typeof v === "string" ? v : JSON.stringify(v, null, 2) + "\n");
};
const commit = (msg: string) => {
  git("add", "-A");
  git("commit", "-q", "-m", msg);
  return git("rev-parse", "HEAD");
};
const pkg = (version: string, extra: object = {}) => ({ name: "@sweny-ai/core", version, ...extra });
const lock = (version: string, extra: object = {}) => ({
  lockfileVersion: 3,
  packages: { "": { name: "root" }, "packages/core": { version, ...extra } },
});
const check = (v: string, c: string) => spawnSync("node", [script, v, c], { cwd: repo, encoding: "utf8" });

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "sweny-tagsrc-"));
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  git("config", "commit.gpgsign", "false");
  write("packages/core/package.json", pkg("1.0.0"));
  write("package-lock.json", lock("1.0.0"));
  write("action.yml", "name: x\n");
});

describe("scripts/verify-tag-source.mjs", () => {
  it("accepts the verified commit itself", () => {
    const a = commit("A");
    const r = check(a, a);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe(a);
  });

  it("accepts a version-only writeback directly on the verified commit", () => {
    const a = commit("A");
    write("packages/core/package.json", pkg("1.0.1"));
    write("package-lock.json", lock("1.0.1"));
    const w = commit("chore: release packages [skip ci]");
    expect(check(a, w).status).toBe(0);
  });

  it("rejects when an unverified commit B landed between A and the writeback", () => {
    const a = commit("A");
    write("action.yml", "name: y\n");
    commit("B");
    write("packages/core/package.json", pkg("1.0.1"));
    const w = commit("chore: release packages [skip ci]");
    const r = check(a, w);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("action.yml");
  });

  it("rejects a writeback that changes more than version fields", () => {
    const a = commit("A");
    write("packages/core/package.json", pkg("1.0.1", { scripts: { postinstall: "evil" } }));
    const w = commit("chore: release packages [skip ci]");
    const r = check(a, w);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("more than version fields");
  });

  it("rejects lockfile changes beyond workspace versions", () => {
    const a = commit("A");
    write("package-lock.json", lock("1.0.1", { dependencies: { evil: "1.0.0" } }));
    const w = commit("chore: release packages [skip ci]");
    expect(check(a, w).status).toBe(1);
  });

  it("rejects a candidate that does not descend from the verified commit", () => {
    const a = commit("A");
    git("checkout", "-q", "-b", "other");
    write("packages/core/package.json", pkg("1.0.1"));
    const o = commit("other");
    git("checkout", "-q", "main");
    write("action.yml", "name: z\n");
    const a2 = commit("A2");
    expect(check(a2, o).status).toBe(1);
    expect(check(a, o).status).toBe(0);
  });

  it("rejects merge commits in the chain", () => {
    const a = commit("A");
    git("checkout", "-q", "-b", "side");
    write("packages/core/package.json", pkg("1.0.1"));
    commit("side");
    git("checkout", "-q", "main");
    write("package-lock.json", lock("1.0.1"));
    commit("main");
    git("merge", "-q", "--no-ff", "-m", "merge", "side");
    expect(check(a, git("rev-parse", "HEAD")).status).toBe(1);
  });

  it("rejects an unknown commit", () => {
    const a = commit("A");
    expect(check(a, "deadbeef".repeat(5)).status).toBe(1);
  });
});
