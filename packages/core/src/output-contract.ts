/**
 * The node output contract (#357, #573): a node's emitted data checked
 * against its declared `output` JSON Schema, at every depth.
 *
 * One standard validator (ajv) does the checking, so nested objects, arrays
 * of objects, enums, `required` at any depth, `additionalProperties`,
 * `oneOf` and the rest mean what JSON Schema says they mean. The check runs
 * in the executor on the data every harness returns, so a violation reads
 * the same whichever harness ran the node. Each problem carries the exact
 * path of the value that broke the schema (`findings[1].severity`) and the
 * rule it broke, never the value itself: output can carry secrets.
 *
 * Dialect: JSON Schema 2020-12, or the draft a schema names in `$schema`
 * (draft-04, draft-06, draft-07, 2019-09). `format` is an annotation, as
 * 2020-12 defines it by default, and is not asserted. Keywords ajv does not
 * know (sweny's `x-` keywords among them) are ignored by ajv;
 * `x-sweny-count-of` is checked here after the schema itself.
 *
 * A schema ajv cannot compile (deprecated, see {@link outputSchemaError})
 * keeps the check sweny ran before #573: top-level `required`, and the
 * `type` and `enum` of each top-level property.
 *
 * Output nested deeper than {@link MAX_OUTPUT_DEPTH} levels, or holding more
 * than {@link MAX_OUTPUT_VALUES} values, is not checked: it is a problem in
 * itself.
 *
 * No harness or skill imports.
 */

import { Ajv } from "ajv";
import { Ajv2019 } from "ajv/dist/2019.js";
import { Ajv2020 } from "ajv/dist/2020.js";
import Ajv04Module from "ajv-draft-04";
import type { ErrorObject, SchemaObject, ValidateFunction } from "ajv";
import { DRAFT_06_META_SCHEMA } from "./output-contract-draft06.js";
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
   * break, a `required` field missing at depth included.
   */
  kind: "missing" | "invalid";
  /** The rule that broke and what it expects. Never the emitted value. */
  problem: string;
  /**
   * Found by the pre-#573 top-level check, because the schema does not
   * compile. As before #573, only a missing field fails the node.
   */
  fallback?: true;
}

/** The path that names the output object itself. */
export const ROOT_PATH = "(output)";

/** Keyword on an integer output property: the count sweny cross-checks against an array in the same output. */
export const COUNT_OF_KEYWORD = "x-sweny-count-of";

/** Deepest nesting checked: the output object is level 0. */
export const MAX_OUTPUT_DEPTH = 64;

/** Most values (objects, arrays and scalars together) checked in one output. */
export const MAX_OUTPUT_VALUES = 100_000;

/**
 * Prose every harness puts in `data.summary` next to the parsed output. It is
 * not the agent's structured answer, so it is checked only when the schema
 * names it (a declared or required `summary`).
 */
const HARNESS_SUMMARY_KEY = "summary";

/** Problems listed in one message, log line or event before the rest are counted. */
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

// ajv-draft-04 is CommonJS with only a default export; `.default` is the class under Node and bundlers alike.
const Ajv04 = Ajv04Module.default;

type Validator = Pick<Ajv, "compile" | "removeSchema">;
const DRAFT_04: Validator = new Ajv04(AJV_OPTIONS);
const DRAFT_07: Validator = new Ajv(AJV_OPTIONS).addMetaSchema(DRAFT_06_META_SCHEMA);
const DRAFT_2019: Validator = new Ajv2019(AJV_OPTIONS);
const DRAFT_2020: Validator = new Ajv2020(AJV_OPTIONS);

/** The validator for the dialect the schema names in `$schema`; 2020-12 when it names none. */
function validatorFor(schema: JSONSchema): Validator {
  const dialect = String(schema.$schema);
  if (/draft-04/.test(dialect)) return DRAFT_04;
  if (/draft-0[67]/.test(dialect)) return DRAFT_07;
  return /2019-09/.test(dialect) ? DRAFT_2019 : DRAFT_2020;
}

const INVALID_SCHEMA = "schema is invalid: ";

/** ajv repeats a meta-schema complaint once per branch it tried: say each once. */
function oneEach(message: string): string {
  const head = message.startsWith(INVALID_SCHEMA) ? INVALID_SCHEMA : "";
  return head + [...new Set(message.slice(head.length).split(", "))].join(", ");
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
    out = { error: oneEach((err as Error).message) };
  } finally {
    v.removeSchema(schema as SchemaObject);
  }
  compiled.set(schema, out);
  return out;
}

/**
 * Why a declared output schema cannot be compiled, or undefined when it
 * compiles (or there is none). Such a schema is deprecated: the node keeps
 * the pre-#573 top-level check, and a future minor will refuse to load it.
 */
export function outputSchemaError(output: JSONSchema | undefined): string | undefined {
  if (!output || typeof output !== "object") return undefined;
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

/** One step down the data. Every segment but a final missing or extra key exists, since ajv found it there. */
const step = (cur: unknown, seg: string): unknown => (cur as Record<string, unknown>)[seg];

/**
 * `["findings", "1", "severity"]` over the data -> `findings[1].severity`.
 * `[n]` only where the value is an array; a key that is not an identifier is
 * quoted (`["odd key"]`, `byIndex["0"]`).
 */
function renderPath(segments: string[], data: unknown): string {
  if (segments.length === 0) return ROOT_PATH;
  let out = "";
  let cur: unknown = data;
  for (const seg of segments) {
    if (Array.isArray(cur)) out += `[${seg}]`;
    else if (/^[A-Za-z_$][\w$-]*$/.test(seg)) out += out === "" ? seg : `.${seg}`;
    else out += `[${JSON.stringify(seg)}]`;
    cur = step(cur, seg);
  }
  return out;
}

/** A schema value (an enum list, a const) as JSON, cut to 80 characters. Never used on output data. */
function preview(v: unknown): string {
  const s = String(JSON.stringify(v));
  return s.length > 80 ? `${s.slice(0, 77)}...` : s;
}

function toProblem(e: ErrorObject, data: unknown): ContractProblem {
  const segs = pointerSegments(e.instancePath);
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
    case "type":
      problem = `expected ${[p.type].flat().join(" or ")}`;
      break;
    case "enum":
      problem = `expected one of ${preview(p.allowedValues)}`;
      break;
    case "const":
      problem = `expected ${preview(p.allowedValue)}`;
      break;
    default:
      // ajv's wording names the rule and its limit, never the value.
      problem = `${e.message}`;
  }
  const missingTopLevel = e.keyword === "required" && segs.length === 1;
  return {
    field: segs.length === 0 ? ROOT_PATH : segs[0],
    path: renderPath(segs, data),
    kind: missingTopLevel ? "missing" : "invalid",
    problem,
  };
}

// ─── The pre-#573 top-level check (schemas that do not compile) ──

function typeMatches(t: unknown, v: unknown): boolean {
  switch (t) {
    case "string":
      return typeof v === "string";
    case "number":
      return Number.isFinite(v);
    case "integer":
      return Number.isInteger(v);
    case "boolean":
      return typeof v === "boolean";
    case "array":
      return Array.isArray(v);
    case "object":
      return typeof v === "object" && v !== null && !Array.isArray(v);
    case "null":
      return v === null;
    default:
      return true; // unknown or absent type: not checked, as before
  }
}

/** Every `required` field present; every present top-level property of its declared `type` and in its `enum`. */
function topLevelProblems(output: JSONSchema, data: Record<string, unknown>): ContractProblem[] {
  const problems: ContractProblem[] = [];
  const required = Array.isArray(output.required) ? output.required : [];
  for (const k of required) {
    if (typeof k === "string" && !hasOwn(data, k)) {
      problems.push({ field: k, path: k, kind: "missing", problem: "required but missing", fallback: true });
    }
  }
  // This schema did not compile, so any part of it may be malformed: read it defensively.
  for (const [k, raw] of Object.entries(output.properties ?? {})) {
    if (!hasOwn(data, k)) continue;
    const p = (raw ?? {}) as { type?: unknown; enum?: unknown };
    // An absent or unknown type matches anything, as before #573.
    const types = [p.type].flat();
    let problem: string | undefined;
    if (!types.some((t) => typeMatches(t, data[k]))) problem = `expected ${types.join(" or ")}`;
    else if (Array.isArray(p.enum) && !p.enum.some((e) => e === data[k]))
      problem = `expected one of ${preview(p.enum)}`;
    if (problem) problems.push({ field: k, path: renderPath([k], data), kind: "invalid", problem, fallback: true });
  }
  return problems;
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
  const items = data[spec.array];
  if (!Array.isArray(items)) return undefined;
  let n = 0;
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const it = item as Record<string, unknown>;
    const whereOk = Object.entries(spec.where ?? {}).every(
      ([k, allowed]) => Array.isArray(allowed) && allowed.some((a) => a === it[k]),
    );
    const nonEmptyOk = (spec.non_empty ?? []).every(
      (k) => typeof it[k] === "string" && (it[k] as string).trim() !== "",
    );
    if (whereOk && nonEmptyOk) n++;
  }
  return n;
}

function countProblems(
  output: JSONSchema,
  data: Record<string, unknown>,
  alreadyBroken: Set<string>,
  fallback: boolean,
): ContractProblem[] {
  const problems: ContractProblem[] = [];
  for (const [k, raw] of Object.entries(output.properties ?? {})) {
    if (!hasOwn(data, k) || alreadyBroken.has(k)) continue;
    const spec = (raw as Record<string, unknown> | null)?.[COUNT_OF_KEYWORD] as CountOf | undefined;
    if (typeof spec?.array !== "string") continue;
    const want = countOf(spec, data);
    const problem =
      want === undefined
        ? `cannot be checked: '${spec.array}' is not a list`
        : data[k] !== want
          ? `does not match the count: '${spec.array}' has ${want} matching item(s)`
          : undefined;
    if (problem) {
      problems.push({
        field: k,
        path: renderPath([k], data),
        kind: "invalid",
        problem,
        ...(fallback ? { fallback: true as const } : {}),
      });
    }
  }
  return problems;
}

// ─── The check ───────────────────────────────────────────────────

/** The data the schema is checked against: the harness's `summary` prose left out unless the schema names it. */
function structuredView(output: JSONSchema, data: Record<string, unknown>): Record<string, unknown> {
  const declared =
    hasOwn(Object(output.properties), HARNESS_SUMMARY_KEY) ||
    (Array.isArray(output.required) && output.required.includes(HARNESS_SUMMARY_KEY));
  if (declared) return data;
  const { [HARNESS_SUMMARY_KEY]: _summary, ...rest } = data;
  return rest;
}

/** Why the output is too big to check, without recursion, or undefined. */
function tooBig(data: unknown): string | undefined {
  const stack: Array<[unknown, number]> = [[data, 0]];
  let values = 0;
  while (stack.length > 0) {
    const [v, depth] = stack.pop()!;
    if (depth > MAX_OUTPUT_DEPTH) return `not checked: the output nests deeper than ${MAX_OUTPUT_DEPTH} levels`;
    if (++values > MAX_OUTPUT_VALUES) return `not checked: the output holds more than ${MAX_OUTPUT_VALUES} values`;
    if (v !== null && typeof v === "object") for (const c of Object.values(v)) stack.push([c, depth + 1]);
  }
  return undefined;
}

/**
 * Check emitted data against the declared output contract: the whole JSON
 * Schema at every depth, then every `x-sweny-count-of` integer against the
 * count it declares over its array. One problem per broken path, in schema
 * order. Empty when the node declares no schema or the data conforms. A
 * schema that does not compile gets the pre-#573 top-level check instead.
 * Can throw (a hostile getter, an ajv fault): callers use
 * {@link checkOutputContract}.
 */
export function outputContractProblems(data: unknown, output: JSONSchema | undefined): ContractProblem[] {
  if (!output || typeof output !== "object") return [];
  const obj = structuredView(output, (data && typeof data === "object" ? data : {}) as Record<string, unknown>);
  const big = tooBig(obj);
  if (big) return [{ field: ROOT_PATH, path: ROOT_PATH, kind: "invalid", problem: big }];
  const c = compile(output);
  if ("error" in c) {
    const problems = topLevelProblems(output, obj);
    return [...problems, ...countProblems(output, obj, new Set(problems.map((p) => p.field)), true)];
  }
  const problems: ContractProblem[] = [];
  const seen = new Set<string>();
  c.validate(obj);
  for (const e of c.validate.errors ?? []) {
    const p = toProblem(e, obj);
    if (seen.has(p.path)) continue;
    seen.add(p.path);
    problems.push(p);
  }
  return [...problems, ...countProblems(output, obj, new Set(problems.map((p) => p.field)), false)];
}

/** The contract check that never throws: its problems, or why it could not run. */
export function checkOutputContract(
  data: unknown,
  output: JSONSchema | undefined,
): { problems: ContractProblem[] } | { error: string } {
  try {
    return { problems: outputContractProblems(data, output) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

function capped(lines: string[]): string[] {
  if (lines.length <= MAX_LISTED) return lines;
  return [...lines.slice(0, MAX_LISTED), `and ${lines.length - MAX_LISTED} more`];
}

/** The problems' paths, at most {@link MAX_LISTED} of them, for log lines and events. */
export function contractPaths(problems: ContractProblem[]): string[] {
  return capped(problems.map((p) => p.path));
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
    ...(missing.length > 0 ? [`required field(s) missing from emitted data: ${capped(missing).join(", ")}`] : []),
    ...listContractProblems(rest),
  ];
  return `output schema violation: ${parts.join("; ")}`;
}
