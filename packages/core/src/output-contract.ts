/**
 * The node output contract (#357, #573): a node's emitted data checked
 * against its declared `output` JSON Schema, at every depth.
 *
 * One standard validator (ajv) does the checking, so nested objects, arrays
 * of objects, enums, `required` at any depth, `additionalProperties`,
 * `oneOf` and the rest mean what JSON Schema says they mean. The check runs
 * in the executor on the data every harness returns, so a violation reads
 * the same whichever harness ran the node. Each problem carries the exact
 * path of the value that broke the schema (`findings[1].severity`).
 *
 * Dialect: JSON Schema 2020-12, or the draft a schema names in `$schema`
 * (draft-07, 2019-09). `format` is an annotation, as 2020-12 defines it by
 * default, and is not asserted. Keywords ajv does not know (sweny's `x-`
 * keywords among them) are ignored by ajv; `x-sweny-count-of` is checked
 * here after the schema itself.
 *
 * No harness or skill imports.
 */

import { Ajv } from "ajv";
import { Ajv2019 } from "ajv/dist/2019.js";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { ErrorObject, SchemaObject, ValidateFunction } from "ajv";
import type { JSONSchema } from "./types.js";

/** One way a node's emitted data breaks its declared output contract. */
export interface ContractProblem {
  /**
   * The top-level output field the problem sits under, or {@link ROOT_PATH}
   * for the output object itself. Routing tolerance keys on it: a route that
   * reads this field falls through instead of failing the node.
   */
  field: string;
  /** Where the broken value is, e.g. `findings[1].severity` ({@link ROOT_PATH} for the object itself). */
  path: string;
  /**
   * `missing`: a top-level `required` field is absent. `invalid`: any other
   * break, a `required` field missing at depth included. `schema`: the
   * declared schema itself cannot be compiled, so no output can satisfy it.
   */
  kind: "missing" | "invalid" | "schema";
  problem: string;
}

/** The path that names the output object itself. */
export const ROOT_PATH = "(output)";

/** Keyword on an integer output property: the count sweny cross-checks against an array in the same output. */
export const COUNT_OF_KEYWORD = "x-sweny-count-of";

/**
 * Prose every harness puts in `data.summary` next to the parsed output. It is
 * not the agent's structured answer, so it is checked only when the schema
 * names it (a declared or required `summary`).
 */
const HARNESS_SUMMARY_KEY = "summary";

/** Problems listed in one message before the rest are counted. */
const MAX_LISTED = 20;

const hasOwn = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

// ─── Compilation ─────────────────────────────────────────────────

/**
 * `strict: false`: unknown keywords (descriptions, `x-` keywords) are not
 * errors. `validateFormats: false`: `format` is an annotation (2020-12
 * default), so no format plugin is needed. `allErrors`: report every
 * problem at once, so one repair request names them all.
 */
const AJV_OPTIONS = { allErrors: true, strict: false, validateFormats: false, logger: false } as const;

type Validator = Pick<Ajv, "compile" | "removeSchema">;
const validators = new Map<string, Validator>();

function validatorFor(schema: JSONSchema): Validator {
  const dialect = typeof schema.$schema === "string" ? schema.$schema : "";
  const key = /draft-07/.test(dialect) ? "draft-07" : /2019-09/.test(dialect) ? "2019-09" : "2020-12";
  let v = validators.get(key);
  if (!v) {
    v =
      key === "draft-07"
        ? new Ajv(AJV_OPTIONS)
        : key === "2019-09"
          ? new Ajv2019(AJV_OPTIONS)
          : new Ajv2020(AJV_OPTIONS);
    validators.set(key, v);
  }
  return v;
}

type Compiled = { validate: ValidateFunction } | { error: string };
const compiled = new WeakMap<object, Compiled>();

/** Compile once per schema object. The schema is released from ajv afterwards, so two schemas may share an `$id`. */
function compile(schema: JSONSchema): Compiled {
  const hit = compiled.get(schema);
  if (hit) return hit;
  const v = validatorFor(schema);
  let out: Compiled;
  try {
    out = { validate: v.compile(schema as SchemaObject) };
  } catch (err) {
    out = { error: err instanceof Error ? err.message : String(err) };
  } finally {
    try {
      v.removeSchema(schema as SchemaObject);
    } catch {
      // never added
    }
  }
  compiled.set(schema, out);
  return out;
}

/** Why a declared output schema cannot be used, or undefined when it compiles. */
export function outputSchemaError(output: JSONSchema | undefined): string | undefined {
  if (!output || typeof output !== "object" || Array.isArray(output)) return undefined;
  const c = compile(output);
  return "error" in c ? c.error : undefined;
}

// ─── Paths and messages ──────────────────────────────────────────

function pointerSegments(pointer: string): string[] {
  if (pointer === "") return [];
  return pointer
    .slice(1)
    .split("/")
    .map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"));
}

/** `["findings", "1", "severity"]` over the data -> `findings[1].severity`. Array indexes only where the value is an array. */
function renderPath(segments: string[], data: unknown): string {
  if (segments.length === 0) return ROOT_PATH;
  let out = "";
  let cur: unknown = data;
  for (const seg of segments) {
    if (Array.isArray(cur) && /^(0|[1-9]\d*)$/.test(seg)) {
      out += `[${seg}]`;
      cur = cur[Number(seg)];
      continue;
    }
    out += /^[A-Za-z_$][\w$-]*$/.test(seg) ? (out === "" ? seg : `.${seg}`) : `[${JSON.stringify(seg)}]`;
    cur = cur && typeof cur === "object" && hasOwn(cur, seg) ? (cur as Record<string, unknown>)[seg] : undefined;
  }
  return out;
}

function valueAt(segments: string[], data: unknown): unknown {
  let cur: unknown = data;
  for (const seg of segments) {
    if (!cur || typeof cur !== "object" || !hasOwn(cur, seg)) return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

function preview(v: unknown): string {
  let s: string;
  try {
    s = JSON.stringify(v) ?? String(v);
  } catch {
    s = String(v);
  }
  return s.length > 80 ? `${s.slice(0, 77)}...` : s;
}

const isScalar = (v: unknown) => v === null || (typeof v !== "object" && typeof v !== "undefined");

function toProblem(e: ErrorObject, data: unknown): ContractProblem {
  const at = pointerSegments(e.instancePath);
  const value = valueAt(at, data);
  const segs = [...at];
  const p = e.params as Record<string, unknown>;
  let problem: string;
  switch (e.keyword) {
    case "required":
      segs.push(String(p.missingProperty));
      problem = "required but missing";
      break;
    case "dependentRequired":
    case "dependencies":
      segs.push(String(p.missingProperty));
      problem = `required when '${String(p.property)}' is present, but missing`;
      break;
    case "additionalProperties":
      segs.push(String(p.additionalProperty));
      problem = "not allowed (additionalProperties: false)";
      break;
    case "unevaluatedProperties":
      segs.push(String(p.unevaluatedProperty));
      problem = "not allowed (unevaluatedProperties: false)";
      break;
    case "type": {
      const types = Array.isArray(p.type) ? p.type : String(p.type).split(",");
      problem = `expected ${types.join(" or ")}, got ${preview(value)}`;
      break;
    }
    case "enum":
      problem = `expected one of ${preview(p.allowedValues)}, got ${preview(value)}`;
      break;
    case "const":
      problem = `expected ${preview(p.allowedValue)}, got ${preview(value)}`;
      break;
    default:
      problem = `${e.message ?? `fails '${e.keyword}'`}${isScalar(value) ? `, got ${preview(value)}` : ""}`;
  }
  const missingTopLevel = e.keyword === "required" && segs.length === 1;
  return {
    field: segs.length === 0 ? ROOT_PATH : segs[0],
    path: renderPath(segs, data),
    kind: missingTopLevel ? "missing" : "invalid",
    problem,
  };
}

// ─── x-sweny-count-of ────────────────────────────────────────────

interface CountOf {
  /** Top-level array property whose items are counted. */
  array: string;
  /** Item field -> allowed values; an item counts only when every listed field has one of them. */
  where?: Record<string, unknown[]>;
  /** Item fields that must be non-empty strings for the item to count. */
  non_empty?: string[];
}

function countOf(spec: CountOf, data: Record<string, unknown>): number | undefined {
  const items = hasOwn(data, spec.array) ? data[spec.array] : undefined;
  if (!Array.isArray(items)) return undefined;
  let n = 0;
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const it = item as Record<string, unknown>;
    const whereOk = Object.entries(spec.where ?? {}).every(
      ([k, allowed]) => hasOwn(it, k) && Array.isArray(allowed) && allowed.some((a) => a === it[k]),
    );
    const nonEmptyOk = (spec.non_empty ?? []).every(
      (k) => hasOwn(it, k) && typeof it[k] === "string" && (it[k] as string).trim() !== "",
    );
    if (whereOk && nonEmptyOk) n++;
  }
  return n;
}

function countProblems(
  output: JSONSchema,
  data: Record<string, unknown>,
  alreadyBroken: Set<string>,
): ContractProblem[] {
  const props = output.properties;
  if (!props || typeof props !== "object") return [];
  const problems: ContractProblem[] = [];
  for (const [k, raw] of Object.entries(props as Record<string, unknown>)) {
    if (!hasOwn(data, k) || alreadyBroken.has(k) || !raw || typeof raw !== "object") continue;
    const spec = (raw as Record<string, unknown>)[COUNT_OF_KEYWORD];
    if (!spec || typeof spec !== "object" || typeof (spec as CountOf).array !== "string") continue;
    const want = countOf(spec as CountOf, data);
    const path = renderPath([k], data);
    if (want === undefined) {
      problems.push({
        field: k,
        path,
        kind: "invalid",
        problem: `cannot be checked: '${(spec as CountOf).array}' is not a list`,
      });
    } else if (data[k] !== want) {
      problems.push({
        field: k,
        path,
        kind: "invalid",
        problem: `is ${preview(data[k])} but '${(spec as CountOf).array}' has ${want} matching item(s)`,
      });
    }
  }
  return problems;
}

// ─── The check ───────────────────────────────────────────────────

/** The data the schema is checked against: the harness's `summary` prose left out unless the schema names it. */
function structuredView(output: JSONSchema, data: Record<string, unknown>): Record<string, unknown> {
  if (!hasOwn(data, HARNESS_SUMMARY_KEY)) return data;
  const props = output.properties;
  const declared =
    (props && typeof props === "object" && hasOwn(props, HARNESS_SUMMARY_KEY)) ||
    (Array.isArray(output.required) && output.required.includes(HARNESS_SUMMARY_KEY));
  if (declared) return data;
  const { [HARNESS_SUMMARY_KEY]: _summary, ...rest } = data;
  return rest;
}

/**
 * Check emitted data against the declared output contract: the whole JSON
 * Schema at every depth, then every `x-sweny-count-of` integer against the
 * count it declares over its array. One problem per broken path, in schema
 * order. Empty when the node declares no schema or the data conforms.
 */
export function outputContractProblems(data: unknown, output: JSONSchema | undefined): ContractProblem[] {
  if (!output || typeof output !== "object" || Array.isArray(output)) return [];
  const c = compile(output);
  if ("error" in c) {
    return [
      {
        field: ROOT_PATH,
        path: ROOT_PATH,
        kind: "schema",
        problem: `the declared output schema cannot be used: ${c.error}`,
      },
    ];
  }
  const obj = structuredView(output, (data && typeof data === "object" ? data : {}) as Record<string, unknown>);
  const problems: ContractProblem[] = [];
  const seen = new Set<string>();
  if (!c.validate(obj)) {
    for (const e of c.validate.errors ?? []) {
      const p = toProblem(e, obj);
      if (seen.has(p.path)) continue;
      seen.add(p.path);
      problems.push(p);
    }
  }
  const brokenFields = new Set(problems.filter((p) => p.path === p.field).map((p) => p.field));
  return [...problems, ...countProblems(output, obj, brokenFields)];
}

function capped(lines: string[]): string[] {
  if (lines.length <= MAX_LISTED) return lines;
  return [...lines.slice(0, MAX_LISTED), `and ${lines.length - MAX_LISTED} more`];
}

/** The problems as `path: problem` lines, at most {@link MAX_LISTED} of them. */
export function listContractProblems(problems: ContractProblem[]): string[] {
  return capped(problems.map((p) => `${p.path}: ${p.problem}`));
}

/**
 * The node error for a contract still broken after the repair request.
 * Missing top-level fields are named together, the way the required-field
 * gate always has; every other problem follows as `path: problem`.
 */
export function contractFailureMessage(problems: ContractProblem[]): string {
  const missing = problems.filter((p) => p.kind === "missing").map((p) => p.path);
  const rest = problems.filter((p) => p.kind !== "missing");
  const parts = [
    ...(missing.length > 0 ? [`required field(s) missing from emitted data: ${missing.join(", ")}`] : []),
    ...listContractProblems(rest),
  ];
  return `output schema violation: ${parts.join("; ")}`;
}
