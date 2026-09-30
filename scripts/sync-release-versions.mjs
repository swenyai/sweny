#!/usr/bin/env node
// Reapply only published version fields to fresh main. Never rebase a stale
// package manifest/lockfile patch across concurrent dependency changes.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const packageDirs = new Set(["packages/core", "packages/studio", "packages/mcp"]);
const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const writeJson = (file, value) => writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

function validateManifest(manifest) {
  for (const [dir, versions] of Object.entries(manifest)) {
    if (
      !packageDirs.has(dir) ||
      !versions ||
      typeof versions.before !== "string" ||
      typeof versions.published !== "string" ||
      typeof versions.registry !== "string"
    ) {
      throw new Error(`Invalid release version entry: ${dir}`);
    }
  }
}

function git(cwd, ...args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, HUSKY: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function applyVersions(cwd, manifest) {
  const lockPath = join(cwd, "package-lock.json");
  const lock = readJson(lockPath);
  const changed = [];
  for (const [dir, versions] of Object.entries(manifest)) {
    const file = join(cwd, dir, "package.json");
    const pkg = readJson(file);
    // A concurrently landed explicit version choice belongs to that commit.
    // Do not roll it back or stamp it with this run's older published version.
    if (![versions.before, versions.published, versions.registry].includes(pkg.version)) continue;
    if (!lock.packages?.[dir]) throw new Error(`Missing workspace lock entry: ${dir}`);
    if (pkg.version !== versions.published) {
      pkg.version = versions.published;
      writeJson(file, pkg);
      changed.push(`${dir}/package.json`);
    }
    if (lock.packages[dir].version !== versions.published) {
      lock.packages[dir].version = versions.published;
      if (!changed.includes("package-lock.json")) changed.push("package-lock.json");
    }
  }
  if (changed.includes("package-lock.json")) writeJson(lockPath, lock);
  return changed;
}

function syncVersions(manifestPath) {
  const manifest = readJson(manifestPath);
  validateManifest(manifest);
  if (Object.keys(manifest).length === 0) return;
  const source = process.cwd();
  const temp = mkdtempSync(join(tmpdir(), "sweny-release-writeback-"));
  const checkout = join(temp, "checkout");
  let added = false;
  try {
    git(source, "fetch", "origin", "refs/heads/main:refs/remotes/origin/main");
    git(source, "worktree", "add", "--detach", checkout, "origin/main");
    added = true;
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (attempt > 1) {
        git(source, "fetch", "origin", "refs/heads/main:refs/remotes/origin/main");
        // This is the temporary checkout created above, never the caller's tree.
        git(checkout, "reset", "--hard", "origin/main");
      }
      const changed = applyVersions(checkout, manifest);
      if (changed.length === 0) return;
      git(checkout, "add", "--", ...changed);
      git(checkout, "commit", "-m", "chore: release packages [skip ci]");
      try {
        git(checkout, "push", "origin", "HEAD:refs/heads/main");
        return;
      } catch (error) {
        if (attempt === 3) throw error;
        console.error(`Release version push rejected (attempt ${attempt}); retrying from current main`);
      }
    }
  } finally {
    if (added) git(source, "worktree", "remove", "--force", checkout);
    rmSync(temp, { recursive: true, force: true });
  }
}

// The release tag points to published source, so the following diff includes
// automated version stamps. Skip a version-only diff only when that exact
// version is already on npm. A deliberate unpublished bump still releases.
function hasChanges(base, dir, registryVersion) {
  if (!packageDirs.has(dir)) throw new Error(`Invalid package directory: ${dir}`);
  const cwd = process.cwd();
  const files = git(cwd, "diff", "--name-only", `${base}..HEAD`, "--", dir).split("\n").filter(Boolean);
  if (files.length === 0) return false;
  const file = `${dir}/package.json`;
  if (files.some((path) => path !== file)) return true;
  let oldPkg, newPkg;
  try {
    oldPkg = JSON.parse(git(cwd, "show", `${base}:${file}`));
    newPkg = JSON.parse(git(cwd, "show", `HEAD:${file}`));
  } catch {
    return true; // Added/deleted/malformed manifests must not hide a change.
  }
  const version = newPkg.version;
  delete oldPkg.version;
  delete newPkg.version;
  if (JSON.stringify(oldPkg) !== JSON.stringify(newPkg)) return true;
  try {
    const registry =
      registryVersion ??
      execFileSync("npm", ["view", newPkg.name, "version"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
    return version !== registry;
  } catch {
    return true; // Registry failure is never evidence a change was published.
  }
}

const [command, manifestPath, dir, before, published, registry] = process.argv.slice(2);
if (!manifestPath)
  throw new Error("Usage: sync-release-versions.mjs record|sync <manifest> [package-dir before published]");
if (command === "record") {
  const manifest = readJson(manifestPath);
  manifest[dir] = { before, published, registry };
  validateManifest(manifest);
  writeJson(manifestPath, manifest);
} else if (command === "sync") {
  syncVersions(resolve(manifestPath));
} else if (command === "changed") {
  console.log(hasChanges(manifestPath, dir, before) ? "true" : "false");
} else {
  throw new Error(`Unknown command: ${command}`);
}
