import {
  builtinSkills,
  configuredSkills,
  loadAndValidateWorkflow,
  skillEnvWarnings,
  type LoaderError,
} from "@sweny-ai/core";
import { confineWorkflowFile, oneLine } from "./workspace.js";
import { fail, type ToolOutput } from "./result.js";

export interface ValidateInput {
  /** Workflow file, relative to the workspace root (or absolute inside it). */
  file: string;
  root: string;
  env?: Record<string, string | undefined>;
}

/** Same shape as `sweny workflow validate --json`, with error text made safe to show. */
export interface ValidationErrorOut {
  code?: string;
  message: string;
  nodeId?: string;
}

export function cleanErrors(errors: LoaderError[]): ValidationErrorOut[] {
  return errors.map((e) => ({
    ...(e.code ? { code: e.code } : {}),
    message: oneLine(e.message, 500),
    ...(e.nodeId !== undefined ? { nodeId: oneLine(e.nodeId, 120) } : {}),
  }));
}

/**
 * `sweny workflow validate` over MCP: the same loader (read, parse, schema,
 * structural checks) and the same skill-environment warnings, against a file
 * confined to the workspace root. An invalid workflow is a successful check
 * with `valid: false`; only a path that cannot be read is a tool error.
 */
export function validateWorkflowFile(input: ValidateInput): ToolOutput {
  const confined = confineWorkflowFile(input.root, input.file);
  if (!confined.ok) return fail(confined.error);

  const env = input.env ?? process.env;
  const result = loadAndValidateWorkflow(confined.file);

  if (!result.ok) {
    const errors = cleanErrors(result.errors);
    const n = errors.length;
    return {
      isError: false,
      summary:
        `${oneLine(input.file, 120)} has ${n} validation error${n === 1 ? "" : "s"}:\n` +
        errors.map((e) => `- ${e.code ? `${e.code}: ` : ""}${e.message}`).join("\n"),
      data: { valid: false, errors },
    };
  }

  const warnings = [
    ...(result.warnings ?? []),
    ...skillEnvWarnings(result.workflow, env, builtinSkills.concat(configuredSkills(env, input.root))),
  ].map((w) => oneLine(w, 500));
  const w = result.workflow;
  const nodes = Object.keys(w.nodes).length;
  const edges = w.edges.length;
  return {
    isError: false,
    summary:
      `${oneLine(input.file, 120)} is valid (${oneLine(w.id, 64)}: ${nodes} nodes, ${edges} edges)` +
      (warnings.length ? `\n${warnings.map((x) => `warning: ${x}`).join("\n")}` : ""),
    data: {
      valid: true,
      errors: [],
      ...(warnings.length ? { warnings } : {}),
      workflow: { id: oneLine(w.id, 64), name: oneLine(w.name, 120), nodes, edges },
    },
  };
}
