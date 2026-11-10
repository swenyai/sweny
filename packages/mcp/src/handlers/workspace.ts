/**
 * Workspace confinement and output hygiene shared by the read-only tools
 * (validate, diagram, runs, runs diff).
 *
 * The workspace is agent-writable, so a path an agent names, and any file or
 * history record it left behind, is untrusted: paths must resolve (symlinks
 * followed) to a regular file inside the workspace root, and text read back
 * from the workspace is stripped of terminal control sequences before it
 * reaches the calling model.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { RUN_HISTORY_DIR, sanitizeTerminal } from "@sweny-ai/core";

export type Confined = { ok: true; file: string } | { ok: false; error: string };

const WORKFLOW_EXTS = new Set([".yml", ".yaml", ".json"]);
/** Workflow files are small; refuse to parse anything bigger. */
export const WORKFLOW_MAX_BYTES = 1024 * 1024;

function within(root: string, child: string): boolean {
  const rel = path.relative(root, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

const outside = (input: string): string =>
  `"${sanitizeTerminal(input, 120)}" is outside the workspace root. Pass a path inside the project.`;

/**
 * Resolve a user-supplied workflow path to a real file inside `root`.
 *
 * Refuses: traversal (`../x`), absolute paths outside the root, and any link
 * on the path (file or directory) whose target leaves the root. Only
 * `.yml`, `.yaml` and `.json` files up to {@link WORKFLOW_MAX_BYTES} are read.
 * The returned path is the real path, so what is read is what was checked.
 */
export function confineWorkflowFile(root: string, input: string): Confined {
  if (input.includes("\0")) return { ok: false, error: "Path contains a NUL byte." };
  let realRoot: string;
  try {
    realRoot = fs.realpathSync(root);
  } catch {
    return { ok: false, error: "Workspace root is not readable." };
  }
  const candidate = path.resolve(realRoot, input);
  // Lexical check first, against the root as given and as resolved (macOS /tmp is a link).
  if (!within(realRoot, candidate) && !within(path.resolve(root), candidate)) {
    return { ok: false, error: outside(input) };
  }
  let real: string;
  try {
    real = fs.realpathSync(candidate);
  } catch {
    return { ok: false, error: `"${sanitizeTerminal(input, 120)}" not found in the workspace.` };
  }
  if (!within(realRoot, real)) return { ok: false, error: outside(input) };
  if (!WORKFLOW_EXTS.has(path.extname(real).toLowerCase())) {
    return { ok: false, error: "Only workflow files (.yml, .yaml or .json) can be read." };
  }
  const st = fs.statSync(real);
  if (!st.isFile()) return { ok: false, error: `"${sanitizeTerminal(input, 120)}" is not a file.` };
  if (st.size > WORKFLOW_MAX_BYTES) return { ok: false, error: "Workflow file is larger than 1 MB." };
  return { ok: true, file: real };
}

export type History = { ok: true; cwd: string } | { ok: false; error: string };

/**
 * The directory to read run history from. `.sweny/runs` may not exist (an
 * empty history), but when it does no link on its path may lead out of the
 * root: the real path must be exactly where the root says it is.
 */
export function confineHistory(root: string): History {
  let realRoot: string;
  try {
    realRoot = fs.realpathSync(root);
  } catch {
    return { ok: false, error: "Workspace root is not readable." };
  }
  const dir = path.join(realRoot, RUN_HISTORY_DIR);
  let real: string;
  try {
    real = fs.realpathSync(dir);
  } catch {
    return { ok: true, cwd: realRoot };
  }
  if (real !== dir) {
    return { ok: false, error: `Run history (${RUN_HISTORY_DIR}) resolves outside the workspace root.` };
  }
  return { ok: true, cwd: realRoot };
}

const STRING_MAX = 2000;
const MAX_DEPTH = 32;

/**
 * Deep copy of JSON-shaped data with every string (keys included) passed
 * through {@link sanitizeTerminal}. Keys are set with defineProperty so a
 * key like `__proto__` becomes plain data. Nesting past a bound is dropped.
 */
export function sanitizeDeep(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return sanitizeTerminal(value, STRING_MAX);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value === null || typeof value === "boolean") return value;
  if (depth >= MAX_DEPTH) return null;
  if (Array.isArray(value)) return value.map((v) => sanitizeDeep(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue;
      Object.defineProperty(out, sanitizeTerminal(k, 200), {
        value: sanitizeDeep(v, depth + 1),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return out;
  }
  return null;
}

/** One-line, bounded, escape-free text for a summary. */
export const oneLine = (s: unknown, max = 200): string => sanitizeTerminal(s, max);

/** Per-line {@link sanitizeTerminal} that keeps each line's indentation and the line breaks. */
export function sanitizeLines(text: string): string {
  return text
    .split("\n")
    .map((line) => (/^[ \t]*/.exec(line)?.[0] ?? "") + sanitizeTerminal(line, 10_000))
    .join("\n");
}
