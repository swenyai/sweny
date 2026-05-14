/**
 * Workflow inputs — declared per-run parameter contract.
 *
 * A workflow YAML may declare a top-level `inputs` block describing the
 * per-run parameters it accepts. The CLI validates `--input <json>` against
 * this declaration, applies defaults, and rejects malformed runs at the
 * boundary so node prompts and conditional routing receive a well-shaped
 * `input` value.
 *
 * Design notes (the contract that matters for downstream consumers):
 *
 *   1. The `inputs` block is OPTIONAL. Workflows without one accept any
 *      JSON object (back-compat with every workflow shipped before this
 *      change). Author opts in by adding the block.
 *   2. Types are the JSON-native primitives we can validate without a
 *      schema engine: `string`, `number`, `boolean`, plus `string[]` for
 *      multi-value cases (labels, files, etc.). This is intentionally
 *      narrower than full JSON Schema. Authors who need richer shapes can
 *      still pass an arbitrary object; declaring it just opts into the
 *      validator. We can widen later without breaking existing YAML.
 *   3. `required: true` makes a field mandatory. Missing fields surface a
 *      single grouped error listing every gap, not one error per call.
 *   4. `default` fills in the value when the caller omits it. The default
 *      is type-checked against the field's `type` at parse time, so
 *      authors can't ship a YAML that injects a string into a number
 *      field at run time. `required: true` and `default` are mutually
 *      exclusive: declaring both is incoherent (the default either
 *      satisfies the required check, making it vestigial, or it doesn't,
 *      making the default dead code), so the schema rejects the
 *      combination at parse time.
 *   5. Telemetry redaction: the executor only ever sees the resolved
 *      `input` map. Cloud observers see the *shape* (key names + types)
 *      via `summarizeInputShape`, never the values, so a workflow that
 *      takes API tokens as input never leaks them.
 *
 * Out of scope on purpose:
 *   - No templating language (`{{input.foo}}` etc.). Workflow instructions
 *     are natural-language and the LLM already sees `input` in its context
 *     map; that path is good enough for v1 and avoids inventing a dialect.
 *   - No nested object schemas. If a single workflow needs deep input,
 *     pass a JSON blob through and document it; we can layer schemas in
 *     later. Most production use cases are flat (since_tag, until_tag,
 *     dry_run, repo, time_range, etc.).
 */

import { z } from "zod";

/**
 * Supported input field types.
 *
 * Kept narrow on purpose. See module docstring for rationale.
 */
export const WORKFLOW_INPUT_TYPES = ["string", "number", "boolean", "string[]"] as const;
export type WorkflowInputType = (typeof WORKFLOW_INPUT_TYPES)[number];

/** A single declared input field. */
export interface WorkflowInputField {
  /** JSON-native type. See {@link WORKFLOW_INPUT_TYPES}. */
  type: WorkflowInputType;
  /** Human-readable description. Surfaced by CLI help and cloud renderers. */
  description?: string;
  /** When true, the caller MUST provide a value. */
  required?: boolean;
  /**
   * Default applied when the caller omits the field. Type-checked against
   * `type` at YAML parse time (a string default on a number field is a
   * schema error, not a runtime surprise).
   */
  default?: unknown;
  /** Optional set of allowed values. Validated after type-check. */
  enum?: unknown[];
}

/** Declared input contract for a workflow. Keys are field names. */
export type WorkflowInputs = Record<string, WorkflowInputField>;

// ─── Zod schema ─────────────────────────────────────────────────

const workflowInputTypeZ = z.enum(WORKFLOW_INPUT_TYPES);

/**
 * Per-field validator. Cross-field checks (default matches type, enum
 * values match type) run in superRefine so all problems on a single field
 * surface together rather than one-at-a-time.
 */
const workflowInputFieldZ = z
  .object({
    type: workflowInputTypeZ,
    description: z.string().optional(),
    required: z.boolean().optional(),
    default: z.unknown().optional(),
    enum: z.array(z.unknown()).min(1).optional(),
  })
  .strict()
  .superRefine((field, ctx) => {
    // `required: true` together with a `default` is incoherent: if the
    // default substitutes for an omitted value, the field is effectively
    // optional; if the required check fires, the default is dead code.
    // Reject the combination at parse time so authors fix the YAML
    // instead of relying on undocumented runtime tie-breaking.
    if (field.required === true && field.default !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "field cannot declare both `required: true` and `default`; pick one (a default makes the field optional)",
        path: ["required"],
      });
    }
    if (field.default !== undefined) {
      const err = checkValueType(field.default, field.type);
      if (err) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `default ${err}`,
          path: ["default"],
        });
      }
    }
    if (field.enum) {
      for (let i = 0; i < field.enum.length; i++) {
        const err = checkValueType(field.enum[i], field.type);
        if (err) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `enum[${i}] ${err}`,
            path: ["enum", i],
          });
        }
      }
    }
  });

export const workflowInputsZ = z.record(workflowInputFieldZ);

// ─── Validation ─────────────────────────────────────────────────

/** A single validation error against the declared input contract. */
export interface InputValidationError {
  field: string;
  message: string;
}

/** Tagged result of validating raw runtime input against a declared contract. */
export type InputValidationResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; errors: InputValidationError[] };

/**
 * Validate the caller's raw input object against the workflow's declared
 * `inputs` block. Applies defaults for omitted optional fields. Surfaces
 * every problem in a single response so the CLI prints a useful message
 * instead of failing on the first error.
 *
 * When no `inputs` block is declared, returns the caller's object verbatim
 * (back-compat: every existing workflow passes through unchanged).
 */
export function validateRuntimeInput(declared: WorkflowInputs | undefined, raw: unknown): InputValidationResult {
  // Back-compat: no declaration → accept anything.
  if (!declared || Object.keys(declared).length === 0) {
    if (raw == null) return { ok: true, value: {} };
    if (typeof raw !== "object" || Array.isArray(raw)) {
      return { ok: false, errors: [{ field: "(root)", message: "input must be a JSON object" }] };
    }
    return { ok: true, value: raw as Record<string, unknown> };
  }

  if (raw != null && (typeof raw !== "object" || Array.isArray(raw))) {
    return { ok: false, errors: [{ field: "(root)", message: "input must be a JSON object" }] };
  }
  const provided = (raw ?? {}) as Record<string, unknown>;

  const errors: InputValidationError[] = [];
  const out: Record<string, unknown> = {};

  for (const [name, field] of Object.entries(declared)) {
    const has = Object.prototype.hasOwnProperty.call(provided, name);
    let value = has ? provided[name] : undefined;

    if (!has || value === undefined || value === null) {
      if (field.default !== undefined) {
        out[name] = field.default;
        continue;
      }
      if (field.required) {
        errors.push({ field: name, message: "required but not provided" });
      }
      // Optional and no default: leave unset. Downstream `priorNode.input.X`
      // reads will see `undefined`, which JSON-serializes as absent.
      continue;
    }

    const typeErr = checkValueType(value, field.type);
    if (typeErr) {
      errors.push({ field: name, message: typeErr });
      continue;
    }

    if (field.enum && !field.enum.some((v) => deepEqual(v, value))) {
      errors.push({
        field: name,
        message: `must be one of: ${field.enum.map((v) => JSON.stringify(v)).join(", ")}`,
      });
      continue;
    }

    out[name] = value;
  }

  // Pass through caller-provided keys that aren't in the declaration.
  // This is intentional: existing CLI flags (timeRange, dryRun, etc.)
  // and the cascade `rules`/`context` mechanism inject extra keys into
  // the input bag. The declaration narrows the contract for documented
  // fields without locking down the whole object.
  for (const [k, v] of Object.entries(provided)) {
    if (!Object.prototype.hasOwnProperty.call(declared, k)) {
      out[k] = v;
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: out };
}

/**
 * Summary of an input bag suitable for telemetry: keys + observed types,
 * never values. Cloud renderers use this to display the input contract a
 * run was invoked with, without leaking the values themselves.
 *
 * `declared` shapes the output when present (so the summary stays stable
 * across runs even when the caller omits optional fields). Falls back to
 * the resolved values' runtime shape when no declaration exists.
 */
export function summarizeInputShape(
  declared: WorkflowInputs | undefined,
  resolved: Record<string, unknown> | undefined,
): Record<string, WorkflowInputType | "object" | "null"> {
  const shape: Record<string, WorkflowInputType | "object" | "null"> = {};
  if (declared) {
    for (const [name, field] of Object.entries(declared)) {
      shape[name] = field.type;
    }
    return shape;
  }
  if (!resolved) return shape;
  for (const [name, value] of Object.entries(resolved)) {
    shape[name] = observedType(value);
  }
  return shape;
}

// ─── Internals ──────────────────────────────────────────────────

function checkValueType(value: unknown, type: WorkflowInputType): string | null {
  switch (type) {
    case "string":
      return typeof value === "string" ? null : `must be a string (got ${observedType(value)})`;
    case "number":
      return typeof value === "number" && Number.isFinite(value)
        ? null
        : `must be a finite number (got ${observedType(value)})`;
    case "boolean":
      return typeof value === "boolean" ? null : `must be a boolean (got ${observedType(value)})`;
    case "string[]":
      if (!Array.isArray(value)) return `must be an array of strings (got ${observedType(value)})`;
      for (let i = 0; i < value.length; i++) {
        if (typeof value[i] !== "string") {
          return `must be an array of strings (element ${i} is ${observedType(value[i])})`;
        }
      }
      return null;
  }
}

function observedType(value: unknown): WorkflowInputType | "object" | "null" {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    return value.every((v) => typeof v === "string") ? "string[]" : "object";
  }
  switch (typeof value) {
    case "string":
      return "string";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    default:
      return "object";
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a == null || b == null) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a === "object" && typeof b === "object") {
    const ak = Object.keys(a as Record<string, unknown>);
    const bk = Object.keys(b as Record<string, unknown>);
    if (ak.length !== bk.length) return false;
    return ak.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return false;
}
