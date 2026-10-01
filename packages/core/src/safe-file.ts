/**
 * Files the sweny process writes into an agent-writable workspace.
 *
 * An agent can leave a symlink or a hard link where sweny is about to write
 * (`.sweny/runs/<id>/output.md` -> `~/.bashrc`), or swap a directory on the
 * path for a link. These helpers never follow a link: every directory between
 * the trusted root and the file must be a real directory owned by this user,
 * a replaced file is unlinked and created fresh (`O_CREAT | O_EXCL |
 * O_NOFOLLOW`), and an appended file must be a regular file with one link.
 * Data goes through the descriptor that was checked; the mode is set on it.
 *
 * Node only.
 */

import fs from "node:fs";
import path from "node:path";

const NOFOLLOW = fs.constants.O_NOFOLLOW ?? 0;

/** The process uid, or undefined where there is none (Windows). */
function uid(): number | undefined {
  return typeof process.getuid === "function" ? process.getuid() : undefined;
}

/** True when `child` is `root` or inside it. */
function within(root: string, child: string): boolean {
  const rel = path.relative(root, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function assertOwnedDir(dir: string): void {
  const st = fs.lstatSync(dir);
  if (st.isSymbolicLink()) throw new Error(`${dir} is a symlink`);
  if (!st.isDirectory()) throw new Error(`${dir} is not a directory`);
  const me = uid();
  if (me !== undefined && st.uid !== me) throw new Error(`${dir} is not owned by this user`);
}

/**
 * Create `dir` and its missing parents below `root`, checking each component
 * under `root` with lstat: a real directory, owned by this user. `root` itself
 * is trusted. A `dir` outside `root` is created as usual and only its last
 * component is checked.
 */
export function ensureDirNoFollow(dir: string, root: string, mode = 0o700): void {
  const absRoot = path.resolve(root);
  const absDir = path.resolve(dir);
  if (!within(absRoot, absDir)) {
    fs.mkdirSync(absDir, { recursive: true, mode });
    assertOwnedDir(absDir);
    return;
  }
  let cur = absRoot;
  for (const part of path.relative(absRoot, absDir).split(path.sep).filter(Boolean)) {
    cur = path.join(cur, part);
    try {
      fs.mkdirSync(cur, { mode });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
    assertOwnedDir(cur);
  }
}

export interface NoFollowOptions {
  /**
   * Trusted base dir (the workspace root): every component below it, and the
   * file, must be owned by this user. Default: the file's own dir, with no
   * ownership check (a runner-owned GITHUB_STEP_SUMMARY, say).
   */
  root?: string;
  /** File mode, set on the descriptor. Default 0o600. */
  mode?: number;
  /** Mode for directories created on the way. Default 0o700. */
  dirMode?: number;
  /** Append to an existing regular file instead of replacing it. */
  append?: boolean;
  /** Create missing directories. Default true. */
  mkdirs?: boolean;
}

/**
 * Open `file` for writing without following a link. Replace mode unlinks what
 * is there and creates a fresh file; append mode refuses anything but a
 * regular, singly linked file (owned by this user when under `root`).
 * Returns the descriptor; the caller closes it.
 */
export function openNoFollow(file: string, opts: NoFollowOptions = {}): number {
  const abs = path.resolve(file);
  const root = path.resolve(opts.root ?? path.dirname(abs));
  if (opts.mkdirs !== false) {
    if (opts.root === undefined) fs.mkdirSync(root, { recursive: true, mode: opts.dirMode ?? 0o700 });
    ensureDirNoFollow(path.dirname(abs), root, opts.dirMode ?? 0o700);
  } else if (opts.root !== undefined) {
    // Check the existing chain without creating anything.
    let cur = root;
    for (const part of path.relative(root, path.dirname(abs)).split(path.sep).filter(Boolean)) {
      cur = path.join(cur, part);
      assertOwnedDir(cur);
    }
  }
  const mode = opts.mode ?? 0o600;
  const { O_WRONLY, O_CREAT, O_EXCL, O_TRUNC, O_APPEND } = fs.constants;
  let fd: number;
  if (opts.append) {
    // O_NONBLOCK: a FIFO left in place fails fast instead of blocking the open.
    fd = fs.openSync(abs, O_WRONLY | O_APPEND | O_CREAT | NOFOLLOW | (fs.constants.O_NONBLOCK ?? 0), mode);
  } else {
    try {
      const st = fs.lstatSync(abs);
      if (st.isDirectory()) throw new Error(`${abs} is a directory`);
      fs.unlinkSync(abs);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    fd = fs.openSync(abs, O_WRONLY | O_CREAT | O_EXCL | O_TRUNC | NOFOLLOW, mode);
  }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile()) throw new Error(`${abs} is not a regular file`);
    if (st.nlink !== 1) throw new Error(`${abs} has ${st.nlink} links`);
    const me = uid();
    if (me !== undefined && opts.root !== undefined && st.uid !== me) {
      throw new Error(`${abs} is not owned by this user`);
    }
    // An operator's existing file (a runner's step summary) keeps its mode.
    if (!opts.append || opts.root !== undefined) fs.fchmodSync(fd, mode);
  } catch (err) {
    fs.closeSync(fd);
    throw err;
  }
  return fd;
}

/**
 * `{ root: cwd }` when `file` is inside `cwd` (the workspace, where the agent
 * can write), else `{}`: an operator path elsewhere is only opened without
 * following a final link.
 */
export function workspaceRoot(file: string, cwd: string = process.cwd()): { root?: string } {
  const root = path.resolve(cwd);
  return within(root, path.resolve(cwd, file)) ? { root } : {};
}

/** Write (or append) `data` to `file` through {@link openNoFollow}. Throws on any refusal. */
export function writeFileNoFollow(file: string, data: string | Uint8Array, opts: NoFollowOptions = {}): void {
  const fd = openNoFollow(file, opts);
  try {
    const buf = typeof data === "string" ? Buffer.from(data) : data;
    for (let off = 0; off < buf.length;) off += fs.writeSync(fd, buf, off, buf.length - off);
  } finally {
    fs.closeSync(fd);
  }
}
