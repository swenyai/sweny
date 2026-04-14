import * as fs from "node:fs";
import * as path from "node:path";
import chalk from "chalk";

/**
 * `sweny upgrade` — self-update the globally-installed `@sweny-ai/core` CLI.
 *
 * The hard parts are detection (which package manager owns this install?) and
 * permissions (global node_modules often require sudo). We keep the runtime
 * surface tiny via dependency injection so the whole flow is testable.
 */

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun" | "volta" | "brew" | "unknown";

export interface UpgradeOptions {
  /** Skip the "already latest" short-circuit. */
  force?: boolean;
  /** Don't install — just report what would happen. */
  check?: boolean;
  /** Override the tag pulled from the registry. Defaults to "latest". */
  tag?: string;
}

export interface UpgradeDeps {
  /** Version currently running (from `package.json`). */
  currentVersion: string;
  /** Absolute path to the current CLI entrypoint — used for PM detection. */
  installPath: string;
  /** Fetch latest version for `@sweny-ai/core@<tag>`. */
  fetchLatestVersion: (tag: string) => Promise<string>;
  /** Run the resolved install command. Returns the process exit code. */
  runInstall: (cmd: string, args: string[]) => number;
  /** Writable-dir probe for EACCES detection. */
  canWrite: (dir: string) => boolean;
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
  exit?: (code: number) => void;
}

/**
 * Detect the package manager that owns this install by walking the parent
 * chain of the CLI entrypoint. The rules are ordered by specificity — more
 * distinctive roots (bun, volta, pnpm, homebrew) beat the generic
 * `lib/node_modules` npm layout.
 */
export function detectPackageManager(installPath: string): PackageManager {
  // Normalize to forward slashes so Windows paths match the same patterns.
  const p = installPath.replace(/\\/g, "/").toLowerCase();

  if (p.includes("/homebrew/") || p.includes("/cellar/")) return "brew";
  if (p.includes("/.volta/")) return "volta";
  if (p.includes("/.bun/")) return "bun";
  // pnpm global store lives under ~/.local/share/pnpm or ~/Library/pnpm, and
  // the actual binary is a symlink — the resolved path typically contains
  // either `/pnpm/` or the global store marker `/pnpm-global/`.
  if (p.includes("/pnpm/") || p.includes("/pnpm-global/") || p.includes("/.pnpm-store/")) return "pnpm";
  // Yarn's global install folder is ~/.config/yarn/global or
  // ~/.yarn/global — check for both.
  if (p.includes("/.yarn/") || p.includes("/yarn/global/")) return "yarn";
  // Default: assume npm if we see node_modules — covers nvm, fnm, asdf,
  // vanilla Node, and every CI runner.
  if (p.includes("/node_modules/")) return "npm";
  return "unknown";
}

/**
 * Resolve the install-root directory for writability checks. For npm-style
 * layouts, walk up until we find `node_modules/@sweny-ai/core` and return
 * the parent of `node_modules` (the writable prefix). Returns null if the
 * install path doesn't look like a package-manager install.
 */
export function resolveInstallRoot(installPath: string): string | null {
  let cur = path.dirname(installPath);
  const visited = new Set<string>();
  while (cur && !visited.has(cur) && path.dirname(cur) !== cur) {
    visited.add(cur);
    if (path.basename(cur) === "@sweny-ai") {
      // cur = .../node_modules/@sweny-ai — parent of node_modules is the root
      const nodeModules = path.dirname(cur);
      if (path.basename(nodeModules) === "node_modules") {
        return path.dirname(nodeModules);
      }
    }
    cur = path.dirname(cur);
  }
  return null;
}

/** Build the (cmd, args) pair for a given package manager + tag. */
export function installCommandFor(pm: PackageManager, tag: string): { cmd: string; args: string[] } | null {
  const ref = `@sweny-ai/core@${tag}`;
  switch (pm) {
    case "npm":
      return { cmd: "npm", args: ["install", "-g", ref] };
    case "pnpm":
      return { cmd: "pnpm", args: ["add", "-g", ref] };
    case "yarn":
      return { cmd: "yarn", args: ["global", "add", ref] };
    case "bun":
      return { cmd: "bun", args: ["add", "-g", ref] };
    case "volta":
      return { cmd: "volta", args: ["install", `@sweny-ai/core@${tag}`] };
    case "brew":
    case "unknown":
      return null;
  }
}

/**
 * Compare two semver-ish version strings. Returns:
 *  - `>0` when `a > b`
 *  - `<0` when `a < b`
 *  - `0` when equal
 *
 * Handles numeric core (`major.minor.patch`) and pre-release strings
 * conservatively: any pre-release (`-alpha.1`) is treated as *lower* than
 * the same core without one, matching npm's semver ordering at the level
 * of precision we need for "is the registry newer than me."
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const [core, pre] = v.split("-", 2);
    const nums = core.split(".").map((n) => {
      const parsed = Number.parseInt(n, 10);
      return Number.isFinite(parsed) ? parsed : 0;
    });
    return { nums, pre: pre ?? "" };
  };
  const pa = parse(a);
  const pb = parse(b);
  const len = Math.max(pa.nums.length, pb.nums.length);
  for (let i = 0; i < len; i++) {
    const av = pa.nums[i] ?? 0;
    const bv = pb.nums[i] ?? 0;
    if (av !== bv) return av - bv;
  }
  // Core equal — a pre-release ranks lower than a release.
  if (pa.pre && !pb.pre) return -1;
  if (!pa.pre && pb.pre) return 1;
  if (pa.pre < pb.pre) return -1;
  if (pa.pre > pb.pre) return 1;
  return 0;
}

/**
 * Fetch the latest published version of `@sweny-ai/core` from the npm
 * registry. Uses the dist-tag endpoint which returns a small, cacheable JSON
 * document — no tarball download.
 */
export async function fetchLatestFromNpm(tag: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`https://registry.npmjs.org/@sweny-ai/core/${encodeURIComponent(tag)}`, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    if (!res.ok) {
      throw new Error(`npm registry returned ${res.status} ${res.statusText}`);
    }
    const body = (await res.json()) as { version?: unknown };
    if (typeof body.version !== "string" || body.version.length === 0) {
      throw new Error("npm registry response missing `version` field");
    }
    return body.version;
  } finally {
    clearTimeout(timeout);
  }
}

const BREW_HINT =
  "This CLI looks like it was installed via Homebrew. Run `brew upgrade sweny` or `brew update && brew upgrade sweny`.";

const UNKNOWN_HINT =
  "Couldn't detect your package manager. Install the latest manually with:\n    npm install -g @sweny-ai/core@latest";

/**
 * Main `sweny upgrade` entrypoint. Resolves the latest version, decides
 * whether an install is needed, dispatches to the right package manager,
 * and surfaces permission problems as actionable copy-paste commands.
 */
export async function runUpgrade(options: UpgradeOptions, deps: UpgradeDeps): Promise<void> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const exit = deps.exit ?? ((code: number) => process.exit(code));
  const tag = options.tag && options.tag.length > 0 ? options.tag : "latest";

  let latest: string;
  try {
    latest = await deps.fetchLatestVersion(tag);
  } catch (err) {
    stderr.write(
      chalk.red(`  Error: couldn't reach the npm registry — ${err instanceof Error ? err.message : String(err)}`) +
        "\n",
    );
    stderr.write(chalk.dim("  Check your network connection and try again.") + "\n");
    exit(1);
    return;
  }

  const current = deps.currentVersion;
  const cmp = compareVersions(current, latest);

  if (cmp >= 0 && !options.force) {
    if (cmp === 0) {
      stdout.write(chalk.green(`  ✓ sweny ${current} is already the latest.`) + "\n");
    } else {
      stdout.write(
        chalk.yellow(`  You're running sweny ${current}, which is newer than the published ${latest}. Nothing to do.`) +
          "\n",
      );
    }
    exit(0);
    return;
  }

  const pm = detectPackageManager(deps.installPath);

  // Homebrew has its own update cadence — we don't try to drive it from here.
  if (pm === "brew") {
    stdout.write(chalk.cyan(`  sweny ${latest} is available (you have ${current}).`) + "\n");
    stderr.write(chalk.dim(`  ${BREW_HINT}`) + "\n");
    exit(options.check ? 0 : 1);
    return;
  }

  const installCmd = installCommandFor(pm, tag);
  if (!installCmd) {
    stdout.write(chalk.cyan(`  sweny ${latest} is available (you have ${current}).`) + "\n");
    stderr.write(chalk.dim(`  ${UNKNOWN_HINT}`) + "\n");
    exit(options.check ? 0 : 1);
    return;
  }

  const fullCmd = [installCmd.cmd, ...installCmd.args].join(" ");

  if (options.check) {
    stdout.write(chalk.cyan(`  sweny ${latest} is available (you have ${current}).`) + "\n");
    stdout.write(chalk.dim(`  Run: ${fullCmd}`) + "\n");
    exit(0);
    return;
  }

  // Permissions probe — for npm-style layouts, the user needs write access to
  // the prefix. If not, we print the exact sudo-prefixed command so they can
  // copy-paste without guessing.
  const root = resolveInstallRoot(deps.installPath);
  if (root && !deps.canWrite(root)) {
    stderr.write(chalk.red(`  Error: no write permission on ${root}`) + "\n");
    stderr.write(chalk.dim(`  Try: sudo ${fullCmd}`) + "\n");
    stderr.write(chalk.dim(`  Or reinstall Node with a user-writable prefix (nvm, fnm, volta) to avoid sudo.`) + "\n");
    exit(1);
    return;
  }

  stdout.write(chalk.cyan(`  Upgrading sweny ${current} → ${latest} via ${pm}…`) + "\n");
  stdout.write(chalk.dim(`  $ ${fullCmd}`) + "\n");

  const code = deps.runInstall(installCmd.cmd, installCmd.args);
  if (code !== 0) {
    stderr.write(chalk.red(`  Error: ${installCmd.cmd} exited with code ${code}`) + "\n");
    exit(code);
    return;
  }

  stdout.write(chalk.green(`  ✓ Upgraded sweny to ${latest}.`) + "\n");
  exit(0);
}
