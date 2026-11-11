/**
 * Approval bundles (RFC 0002 M2, #576): the frozen form of one visit's writes.
 *
 * A bundle holds the exact applier calls a visit wants (skill, tool and the
 * arguments byte for byte, any reconciliation marker included), the proposal
 * identity `(run, node, iteration)`, and its lifetime. Its digest is the
 * sha256 of its bytes and names the file, so a changed byte is a different
 * bundle. Pure helpers: the run journal writes bundles, the publisher
 * (`approval.ts`) reads them.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** Bundle format version. */
export const BUNDLE_VERSION = 1;
/** Where a run keeps its bundles: `<run dir>/bundles/<digest>.json`. */
export const BUNDLES_DIR = "bundles";

/** One visit: the unit a human approves once. */
export interface Proposal {
  run: string;
  node: string;
  iteration: number;
}

/** One write as the write stage resolved it, before it is frozen. */
export interface ProposedWrite {
  type: string;
  /** Skill whose tool sends it. */
  via: string;
  /** That skill's write tool. */
  tool: string;
  /** Destination, for receipts and the printout. */
  target?: string;
  /** The tool's arguments, exactly as the publisher sends them. */
  args: Record<string, unknown>;
}

/** One frozen write: its position in the bundle and its exact call. */
export interface BundleWrite extends ProposedWrite {
  n: number;
}

export interface ApprovalBundle {
  bundle: typeof BUNDLE_VERSION;
  proposal: Proposal;
  workflow: string;
  /** The visit's checkpoint time: the same on a resumed visit, so its bundle is the same bytes. */
  created_at: string;
  expires_at: string;
  /** `safe_outputs.approval.approvers`, when declared. */
  approvers?: string[];
  writes: BundleWrite[];
}

/** The bytes a bundle is stored and hashed as. */
export function bundleBytes(b: ApprovalBundle): string {
  return JSON.stringify(b, null, 2) + "\n";
}

export function sha256Hex(data: string | Buffer): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

/** The key the approval of a proposal is consumed under: one approval per visit, whatever its digest. */
export function proposalKey(p: Proposal): string {
  return sha256Hex(JSON.stringify([p.run, p.node, p.iteration]));
}

const NOFOLLOW = fs.constants.O_NOFOLLOW ?? 0;

/**
 * Write a bundle as `<dir>/<digest>.json` with `O_EXCL`, fsynced. An existing
 * file with the same bytes is the same bundle (a resumed visit froze it
 * again) and is kept; anything else there is refused. Returns the digest.
 */
export function writeBundle(dir: string, b: ApprovalBundle): string {
  const bytes = bundleBytes(b);
  const digest = sha256Hex(bytes);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, `${digest}.json`);
  const c = fs.constants;
  let fd: number;
  try {
    fd = fs.openSync(file, c.O_WRONLY | c.O_CREAT | c.O_EXCL | NOFOLLOW, 0o600);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    const existing = fs.readFileSync(file);
    if (sha256Hex(existing) !== digest) throw new Error(`bundle ${digest} exists with other bytes`);
    return digest;
  }
  try {
    fs.writeSync(fd, bytes);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  return digest;
}
