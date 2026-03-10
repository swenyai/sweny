#!/usr/bin/env node
/**
 * auto-changeset.mjs
 *
 * Automatically creates changeset files for published packages that have
 * unreleased commits but no pending changeset entry.
 *
 * Algorithm:
 * 1. Find the base commit — last "chore: release packages" merge or fallback to first commit
 * 2. Get all commits since base that touched a published package directory
 * 3. Determine the SemVer bump level from conventional commit prefixes
 * 4. Check which packages are already covered by an existing .changeset/*.md file
 * 5. For uncovered packages, write a new changeset file
 *
 * Bump rules (conventional commits):
 *   feat!  / BREAKING CHANGE in body → major
 *   feat                             → minor
 *   fix / refactor / perf            → patch
 *   everything else                  → patch (if it touches package source)
 */

import { execSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Published packages and the directories that belong to them
const PUBLISHED_PACKAGES = {
  "@sweny-ai/engine": "packages/engine",
  "@sweny-ai/studio": "packages/studio",
  "@sweny-ai/cli": "packages/cli",
  "@sweny-ai/providers": "packages/providers",
  "@sweny-ai/agent": "packages/agent",
};

// Directories that should NOT trigger a changeset on their own
const IGNORED_PATHS = ["packages/web", "packages/action", ".github", "docs", "scripts"];

function run(cmd) {
  return execSync(cmd, { cwd: ROOT, encoding: "utf8" }).trim();
}

// ── 1. Find base commit ──────────────────────────────────────────────────────

function findBaseCommit() {
  // Look for the most recent changeset release commit
  try {
    const log = run(`git log --oneline --grep="^chore: release packages" --max-count=1 --format="%H"`);
    if (log) return log;
  } catch {
    /* no match */
  }
  // Fall back to the first commit
  return run("git rev-list --max-parents=0 HEAD");
}

// ── 2. Get commits since base ────────────────────────────────────────────────

function getCommitsSince(base) {
  const raw = run(`git log --format="%H\t%s\t%b\t---END---" ${base}..HEAD`);
  if (!raw) return [];

  const commits = [];
  // Split on the sentinel including the hash line before it
  for (const block of raw.split("---END---\n")) {
    const line = block.trim();
    if (!line) continue;
    const [hash, subject, ...bodyParts] = line.split("\t");
    if (!hash || !subject) continue;
    commits.push({ hash: hash.trim(), subject: subject.trim(), body: bodyParts.join("\n").trim() });
  }
  return commits;
}

// ── 3. Map commits → packages ────────────────────────────────────────────────

function getChangedPackages(commit) {
  let files;
  try {
    files = run(`git diff-tree --no-commit-id -r --name-only ${commit.hash}`).split("\n");
  } catch {
    return [];
  }

  const touched = new Set();
  for (const file of files) {
    for (const [pkg, dir] of Object.entries(PUBLISHED_PACKAGES)) {
      if (file.startsWith(dir + "/")) {
        // Skip dist/, tests/, and docs-only changes
        const rel = file.slice(dir.length + 1);
        if (
          rel.startsWith("dist/") ||
          rel.startsWith("dist-lib/") ||
          rel.startsWith("dist-tsc/") ||
          rel === "CHANGELOG.md" ||
          rel === "package.json" // version bumps from release commits
        )
          continue;
        touched.add(pkg);
      }
    }
  }
  return [...touched];
}

// ── 4. Determine bump level ──────────────────────────────────────────────────

function bumpLevel(commits) {
  let level = "patch";
  for (const { subject, body } of commits) {
    const text = subject + "\n" + body;
    if (/BREAKING CHANGE/i.test(text) || /^[a-z]+!:/.test(subject)) return "major";
    if (/^feat(\(.+\))?:/.test(subject) && level === "patch") level = "minor";
  }
  return level;
}

// ── 5. Check existing changesets ─────────────────────────────────────────────

function coveredPackages() {
  const changesetDir = join(ROOT, ".changeset");
  const covered = new Set();
  try {
    for (const file of readdirSync(changesetDir)) {
      if (!file.endsWith(".md") || file === "README.md") continue;
      const content = readFileSync(join(changesetDir, file), "utf8");
      // Front-matter: ---\n"@pkg": level\n---
      const match = content.match(/^---\n([\s\S]*?)\n---/);
      if (!match) continue;
      for (const line of match[1].split("\n")) {
        const pkg = line.match(/^"(@[^"]+)":/)?.[1];
        if (pkg) covered.add(pkg);
      }
    }
  } catch {
    /* no .changeset dir */
  }
  return covered;
}

// ── 6. Write changeset ───────────────────────────────────────────────────────

function writeChangeset(packages, bump, commits) {
  const hash = createHash("sha1")
    .update(packages.sort().join(",") + Date.now())
    .digest("hex")
    .slice(0, 8);
  const filename = join(ROOT, ".changeset", `auto-${hash}.md`);

  // Summarise commits into bullet points (deduplicated, max 10)
  const bullets = [
    ...new Set(
      commits
        .filter((c) => !/^chore/.test(c.subject) && !/^style/.test(c.subject))
        .map((c) => `- ${c.subject}`)
        .slice(0, 10),
    ),
  ];

  const frontmatter = packages
    .sort()
    .map((p) => `"${p}": ${bump}`)
    .join("\n");

  const body = bullets.length ? bullets.join("\n") : "- Automated changeset from unreleased commits.";

  writeFileSync(filename, `---\n${frontmatter}\n---\n\n${body}\n`);
  return filename;
}

// ── Main ──────────────────────────────────────────────────────────────────────

const base = findBaseCommit();
console.log(`Base commit: ${base}`);

const commits = getCommitsSince(base);
console.log(`Commits since base: ${commits.length}`);

if (!commits.length) {
  console.log("No commits since base — nothing to do.");
  process.exit(0);
}

// Collect per-package commits
const packageCommits = {};
for (const commit of commits) {
  for (const pkg of getChangedPackages(commit)) {
    (packageCommits[pkg] ??= []).push(commit);
  }
}

const covered = coveredPackages();
console.log(`Already covered by changesets: ${[...covered].join(", ") || "none"}`);

// Find packages that have changes but no changeset
const uncovered = Object.entries(packageCommits).filter(([pkg]) => !covered.has(pkg));

if (!uncovered.length) {
  console.log("All changed packages are covered by existing changesets.");
  process.exit(0);
}

// Group all uncovered packages into one changeset (they share the same commit range)
const allUncoveredPkgs = uncovered.map(([pkg]) => pkg);
const allUncoveredCommits = [...new Set(uncovered.flatMap(([, c]) => c))];
const bump = bumpLevel(allUncoveredCommits);

console.log(`Uncovered packages: ${allUncoveredPkgs.join(", ")}`);
console.log(`Bump level: ${bump}`);

const file = writeChangeset(allUncoveredPkgs, bump, allUncoveredCommits);
console.log(`Created: ${file}`);
