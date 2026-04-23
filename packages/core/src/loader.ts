/**
 * Workflow loader — read, parse, validate.
 *
 * The canonical path for CLI flows that read a workflow off disk. Composes
 * file I/O + YAML/JSON parse + Zod schema parse + structural validation and
 * returns a single tagged result so callers can render errors uniformly.
 *
 * Use this instead of calling `parseWorkflow` / `validateWorkflow` directly
 * so the three user-facing surfaces (`sweny workflow run`, `sweny workflow
 * validate`, `sweny publish`) agree on what "valid" means.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import { ZodError } from "zod";

import type { Workflow } from "./types.js";
import { workflowZ, validateWorkflow, type WorkflowError } from "./schema.js";

/** Structural/schema error. `code` is present only for structural errors. */
export interface LoaderError {
  message: string;
  code?: WorkflowError["code"] | "IO" | "PARSE" | "SCHEMA";
  nodeId?: string;
}

export type LoaderResult = { ok: true; workflow: Workflow } | { ok: false; errors: LoaderError[] };

export interface LoaderOptions {
  /** Optional set of known skill IDs for UNKNOWN_SKILL validation. */
  knownSkills?: Set<string>;
}

/**
 * Load a workflow YAML or JSON file, parse with the canonical Zod schema,
 * and run structural validation. All three phases contribute to `errors`.
 */
export function loadAndValidateWorkflow(filePath: string, options: LoaderOptions = {}): LoaderResult {
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, errors: [{ message: `Could not read "${filePath}": ${msg}`, code: "IO" }] };
  }

  let raw: unknown;
  try {
    const ext = path.extname(filePath).toLowerCase();
    raw = ext === ".yaml" || ext === ".yml" ? parseYaml(content) : JSON.parse(content);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, errors: [{ message: `Could not parse "${filePath}": ${msg}`, code: "PARSE" }] };
  }

  return validateParsed(raw, options);
}

/**
 * Validate an already-parsed workflow object (e.g. from a marketplace fetch
 * or Studio import). Same schema + structural passes as the file loader.
 */
export function validateParsed(raw: unknown, options: LoaderOptions = {}): LoaderResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    const kind = raw === null ? "null" : Array.isArray(raw) ? "array" : typeof raw;
    return { ok: false, errors: [{ message: `Expected a workflow object, got ${kind}`, code: "SCHEMA" }] };
  }

  let parsed: Workflow;
  try {
    parsed = workflowZ.parse(raw) as Workflow;
  } catch (err: unknown) {
    if (err instanceof ZodError) {
      const errors: LoaderError[] = err.issues.map((iss) => ({
        message: `${iss.path.length > 0 ? iss.path.join(".") + ": " : ""}${iss.message}`,
        code: "SCHEMA",
      }));
      return { ok: false, errors };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, errors: [{ message: msg, code: "SCHEMA" }] };
  }

  const structural = validateWorkflow(parsed, options.knownSkills);
  if (structural.length > 0) {
    return {
      ok: false,
      errors: structural.map((e) => ({ message: e.message, code: e.code, nodeId: e.nodeId })),
    };
  }

  return { ok: true, workflow: parsed };
}
