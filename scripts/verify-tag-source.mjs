#!/usr/bin/env node
// Check that a release tag source commit is safe: it is the verified commit, or
// descends from it only through version-only writeback commits (the commits
// scripts/sync-release-versions.mjs pushes). Every commit in verified..candidate
// must be a single-parent commit touching only the published packages'
// package.json and package-lock.json, changing nothing but version fields.
//
// usage: node scripts/verify-tag-source.mjs <verified-sha> <candidate-sha>
// exit 0 and prints the candidate sha when safe; exit 1 with a reason otherwise.
import { execFileSync } from "node:child_process";
import { isDeepStrictEqual } from "node:util";
import { pathToFileURL } from "node:url";

const dirs = ["packages/core", "packages/studio", "packages/mcp"];
const manifests = new Set(dirs.map((d) => `${d}/package.json`));

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function stripVersions(file, json) {
  if (file === "package-lock.json") {
    for (const d of dirs) if (json.packages?.[d]) delete json.packages[d].version;
  } else {
    delete json.version;
  }
  return json;
}

export function checkTagSource(verified, candidate, cwd = process.cwd()) {
  let v, c;
  try {
    v = git(cwd, "rev-parse", "--verify", `${verified}^{commit}`);
    c = git(cwd, "rev-parse", "--verify", `${candidate}^{commit}`);
  } catch {
    return { ok: false, reason: "unknown commit" };
  }
  if (v === c) return { ok: true, sha: c };
  try {
    git(cwd, "merge-base", "--is-ancestor", v, c);
  } catch {
    return { ok: false, reason: `${c} does not descend from verified ${v}` };
  }
  for (const commit of git(cwd, "rev-list", "--reverse", `${v}..${c}`).split("\n").filter(Boolean)) {
    if (git(cwd, "rev-list", "--parents", "-n", "1", commit).split(" ").length !== 2) {
      return { ok: false, reason: `${commit} is a merge or root commit` };
    }
    const files = git(cwd, "diff-tree", "--no-commit-id", "--name-only", "-r", commit).split("\n").filter(Boolean);
    if (files.length === 0) return { ok: false, reason: `${commit} changes no files` };
    for (const file of files) {
      if (file !== "package-lock.json" && !manifests.has(file)) {
        return { ok: false, reason: `${commit} touches ${file}, not a version-only writeback` };
      }
      let before, after;
      try {
        before = stripVersions(file, JSON.parse(git(cwd, "show", `${commit}^:${file}`)));
        after = stripVersions(file, JSON.parse(git(cwd, "show", `${commit}:${file}`)));
      } catch {
        return { ok: false, reason: `${commit} adds, removes or breaks ${file}` };
      }
      if (!isDeepStrictEqual(before, after)) {
        return { ok: false, reason: `${commit} changes more than version fields in ${file}` };
      }
    }
  }
  return { ok: true, sha: c };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [verified, candidate] = process.argv.slice(2);
  if (!verified || !candidate) {
    console.error("usage: verify-tag-source.mjs <verified-sha> <candidate-sha>");
    process.exit(2);
  }
  const r = checkTagSource(verified, candidate);
  if (!r.ok) {
    console.error(`verify-tag-source: ${r.reason}`);
    process.exit(1);
  }
  console.log(r.sha);
}
