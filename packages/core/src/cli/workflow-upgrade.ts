/**
 * `sweny workflow upgrade <file> [--dry-run]`
 *
 * Rewrites a workflow file at the current spec version by running the same
 * migration chain the loader applies in memory.
 *
 * Comment preservation (YAML): the file is edited as a YAML document, not
 * re-serialized from scratch. Comments, blank lines, key order and quoting on
 * everything a migration did not touch are kept. NOT preserved: a comment
 * attached to a value a migration replaced or removed, the original position of
 * keys a migration renamed (they are added at the end of their map), and
 * formatting of arrays whose length a migration changed (rewritten whole).
 * JSON files carry no comments and are rewritten with 2-space indentation.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { isMap, parseDocument, type Document } from "yaml";

import { DEFAULT_MIGRATION_CONFIG, migrateWorkflow, type MigrationConfig, type RawWorkflow } from "../migrations.js";
import { validateParsed } from "../loader.js";

export type UpgradeResult =
  | { status: "error"; message: string }
  | { status: "current"; version: number }
  | {
      status: "upgraded" | "dry-run";
      from: number;
      to: number;
      /** Migration descriptions applied, in order. Empty when only `spec_version` was stamped. */
      steps: string[];
      /** The full text that was (or, for dry-run, would be) written. */
      content: string;
    };

export interface UpgradeOptions {
  dryRun?: boolean;
  migration?: MigrationConfig;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function withoutSpecVersion(obj: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...obj };
  delete copy.spec_version;
  return copy;
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Apply the difference old -> next onto the YAML document, touching only what changed. */
function applyDiff(doc: Document, at: (string | number)[], old: unknown, next: unknown): void {
  if (sameJson(old, next)) return;
  if (isPlainObject(old) && isPlainObject(next)) {
    for (const key of Object.keys(old)) {
      if (!(key in next)) doc.deleteIn([...at, key]);
    }
    for (const key of Object.keys(next)) {
      if (key in old) applyDiff(doc, [...at, key], old[key], next[key]);
      else doc.setIn([...at, key], next[key]);
    }
    return;
  }
  if (Array.isArray(old) && Array.isArray(next) && old.length === next.length) {
    next.forEach((item, i) => applyDiff(doc, [...at, i], old[i], item));
    return;
  }
  if (at.length === 0) doc.contents = doc.createNode(next);
  else doc.setIn(at, next);
}

function setSpecVersion(doc: Document, version: string): void {
  const root = doc.contents;
  if (!isMap(root)) return;
  if (root.has("spec_version")) {
    root.set("spec_version", version);
    return;
  }
  // Insert as the first key. A comment sitting directly above the old first key
  // is the file's header comment; carry it onto the new pair so it stays on top.
  const first = root.items[0];
  const pair = doc.createPair("spec_version", version);
  const firstKey = first?.key as { commentBefore?: string | null } | undefined;
  if (firstKey && firstKey.commentBefore) {
    (pair.key as { commentBefore?: string | null }).commentBefore = firstKey.commentBefore;
    firstKey.commentBefore = undefined;
  }
  root.items.unshift(pair);
}

export function upgradeWorkflowFile(filePath: string, options: UpgradeOptions = {}): UpgradeResult {
  const config = options.migration ?? DEFAULT_MIGRATION_CONFIG;

  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch (err) {
    return { status: "error", message: `Could not read "${filePath}": ${err instanceof Error ? err.message : err}` };
  }

  const isYaml = [".yaml", ".yml"].includes(path.extname(filePath).toLowerCase());
  let doc: Document | undefined;
  let raw: unknown;
  try {
    if (isYaml) {
      doc = parseDocument(content);
      if (doc.errors.length > 0) throw doc.errors[0];
      raw = doc.toJS();
    } else {
      raw = JSON.parse(content);
    }
  } catch (err) {
    return { status: "error", message: `Could not parse "${filePath}": ${err instanceof Error ? err.message : err}` };
  }
  if (!isPlainObject(raw)) return { status: "error", message: `Expected a workflow object in "${filePath}"` };

  const migrated = migrateWorkflow(raw as RawWorkflow, config);
  if (!migrated.ok) return { status: "error", message: migrated.message };

  const versionText = String(migrated.to);
  if (migrated.applied.length === 0 && raw.spec_version === versionText) {
    return { status: "current", version: migrated.to };
  }

  // Never write a file that would not load.
  const check = validateParsed(migrated.workflow, { migration: config });
  if (!check.ok) {
    return {
      status: "error",
      message: `The upgraded workflow is not valid, so "${filePath}" was left unchanged:\n${check.errors
        .map((e) => `  ${e.message}`)
        .join("\n")}`,
    };
  }

  let out: string;
  if (doc) {
    applyDiff(doc, [], withoutSpecVersion(raw), withoutSpecVersion(migrated.workflow));
    setSpecVersion(doc, versionText);
    out = doc.toString();
  } else {
    out = JSON.stringify({ spec_version: versionText, ...withoutSpecVersion(migrated.workflow) }, null, 2) + "\n";
  }

  if (!options.dryRun) fs.writeFileSync(filePath, out, "utf-8");
  return {
    status: options.dryRun ? "dry-run" : "upgraded",
    from: migrated.from,
    to: migrated.to,
    steps: migrated.applied.map((m) => m.description),
    content: out,
  };
}
