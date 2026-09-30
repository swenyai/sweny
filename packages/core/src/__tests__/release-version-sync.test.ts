import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const script = resolve(import.meta.dirname, "../../../../scripts/sync-release-versions.mjs");
let dir: string;
let remote: string;
let publisher: string;
let collaborator: string;
let manifest: string;
const writeJson = (file: string, value: unknown) => writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
function git(cwd: string, ...args: string[]) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, HUSKY: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}
function commit(cwd: string) {
  git(cwd, "add", ".");
  git(cwd, "commit", "-m", "fixture");
}
function configure(cwd: string) {
  git(cwd, "config", "user.name", "Release test");
  git(cwd, "config", "user.email", "release@example.invalid");
  git(cwd, "config", "core.hooksPath", "/dev/null");
  git(cwd, "config", "commit.gpgsign", "false");
}
function snapshot() {
  return {
    package: JSON.parse(git(remote, "show", "main:packages/core/package.json")),
    lock: JSON.parse(git(remote, "show", "main:package-lock.json")),
  };
}
function sync() {
  return spawnSync(process.execPath, [script, "sync", manifest], { cwd: publisher, encoding: "utf8" });
}
function changeMain(version = "1.0.0", dependency = "2.0.0") {
  writeJson(join(collaborator, "packages/core/package.json"), {
    name: "@sweny-ai/core",
    version,
    dependencies: { example: dependency },
  });
  writeJson(join(collaborator, "package-lock.json"), {
    lockfileVersion: 3,
    packages: {
      "packages/core": { version, dependencies: { example: dependency } },
      "node_modules/example": { version: dependency },
    },
  });
  commit(collaborator);
  git(collaborator, "push", "origin", "main");
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sweny-release-sync-test-"));
  remote = join(dir, "remote.git");
  publisher = join(dir, "publisher");
  collaborator = join(dir, "collaborator");
  manifest = join(dir, "published.json");
  git(dir, "init", "--bare", "--initial-branch=main", remote);
  git(dir, "clone", remote, publisher);
  configure(publisher);
  mkdirSync(join(publisher, "packages/core"), { recursive: true });
  writeJson(join(publisher, "packages/core/package.json"), {
    name: "@sweny-ai/core",
    version: "1.0.0",
    dependencies: { example: "1.0.0" },
  });
  writeJson(join(publisher, "package-lock.json"), {
    lockfileVersion: 3,
    packages: {
      "packages/core": { version: "1.0.0", dependencies: { example: "1.0.0" } },
      "node_modules/example": { version: "1.0.0" },
    },
  });
  commit(publisher);
  git(publisher, "push", "origin", "main");
  git(dir, "clone", remote, collaborator);
  configure(collaborator);
  writeJson(manifest, { "packages/core": { before: "1.0.0", published: "1.0.1", registry: "1.0.0" } });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("release version writeback", () => {
  it("advances a previous release stamp when this run was queued from older source", () => {
    changeMain("1.0.1");
    writeJson(manifest, { "packages/core": { before: "1.0.0", published: "1.0.2", registry: "1.0.1" } });
    const result = sync();
    expect(result.status, result.stderr).toBe(0);
    expect(snapshot().package.version).toBe("1.0.2");
    expect(snapshot().lock.packages["packages/core"].version).toBe("1.0.2");
  });

  it("ignores published version-only stamps but keeps deliberate bumps and content changes", () => {
    const base = git(publisher, "rev-parse", "HEAD");
    const changed = (registry: string) => {
      const result = spawnSync(process.execPath, [script, "changed", base, "packages/core", registry], {
        cwd: publisher,
        encoding: "utf8",
      });
      expect(result.status, result.stderr).toBe(0);
      return result.stdout.trim();
    };
    expect(changed("1.0.0")).toBe("false");
    const pkg = { name: "@sweny-ai/core", version: "1.0.1", dependencies: { example: "1.0.0" } };
    writeJson(join(publisher, "packages/core/package.json"), pkg);
    commit(publisher);
    expect(changed("1.0.1")).toBe("false");
    expect(changed("1.0.0")).toBe("true");
    pkg.dependencies.example = "2.0.0";
    writeJson(join(publisher, "packages/core/package.json"), pkg);
    commit(publisher);
    expect(changed("1.0.1")).toBe("true");
    pkg.dependencies.example = "1.0.0";
    writeJson(join(publisher, "packages/core/package.json"), pkg);
    writeFileSync(join(publisher, "packages/core/README.md"), "new content\n");
    commit(publisher);
    expect(changed("1.0.1")).toBe("true");
  });

  it("preserves concurrent dependency changes and the original publication checkout", () => {
    const original = git(publisher, "rev-parse", "HEAD");
    const publishedPackage = { name: "@sweny-ai/core", version: "1.0.1", dependencies: { example: "1.0.0" } };
    writeJson(join(publisher, "packages/core/package.json"), publishedPackage);
    changeMain();
    const result = sync();
    expect(result.status, result.stderr).toBe(0);
    const state = snapshot();
    expect(state.package).toEqual({ name: "@sweny-ai/core", version: "1.0.1", dependencies: { example: "2.0.0" } });
    expect(state.lock.packages["packages/core"]).toEqual({ version: "1.0.1", dependencies: { example: "2.0.0" } });
    expect(state.lock.packages["node_modules/example"].version).toBe("2.0.0");
    expect(git(publisher, "rev-parse", "HEAD")).toBe(original);
    expect(JSON.parse(readFileSync(join(publisher, "packages/core/package.json"), "utf8"))).toEqual(publishedPackage);
    const stamped = git(remote, "rev-parse", "main");
    expect(sync().status).toBe(0);
    expect(git(remote, "rev-parse", "main")).toBe(stamped);
  });

  it("preserves a deliberate newer version merged during publication", () => {
    changeMain("2.0.0");
    const result = sync();
    expect(result.status, result.stderr).toBe(0);
    expect(snapshot().package.version).toBe("2.0.0");
    expect(snapshot().lock.packages["packages/core"].version).toBe("2.0.0");
  });

  it("reapplies version fields after main moves between fetch and push", () => {
    const hooks = join(dir, "hooks");
    mkdirSync(hooks);
    const hook = `#!/usr/bin/env node\nconst fs = require('node:fs'); const cp = require('node:child_process');\nconst env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));\nconst marker = ${JSON.stringify(join(dir, "raced"))};\nif (!fs.existsSync(marker)) { fs.writeFileSync(marker, 'yes'); cp.execFileSync('git', ['-C', ${JSON.stringify(collaborator)}, 'commit', '--allow-empty', '-m', 'concurrent merge'], { env }); cp.execFileSync('git', ['-C', ${JSON.stringify(collaborator)}, 'push', 'origin', 'main'], { env }); }\n`;
    writeFileSync(join(hooks, "pre-push"), hook, { mode: 0o755 });
    git(publisher, "config", "core.hooksPath", hooks);
    const result = sync();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain("retrying from current main");
    expect(snapshot().package.version).toBe("1.0.1");
    expect(git(remote, "log", "-2", "--format=%s", "main")).toContain("concurrent merge");
  });

  it("fails after bounded rejected pushes instead of reporting a successful release", () => {
    writeFileSync(join(remote, "hooks/pre-receive"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    const result = sync();
    expect(result.status).not.toBe(0);
    expect(snapshot().package.version).toBe("1.0.0");
    expect(git(publisher, "worktree", "list", "--porcelain").match(/^worktree /gm)).toHaveLength(1);
  });
});
