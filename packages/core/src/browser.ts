/**
 * Browser-safe entry point for @sweny-ai/core
 *
 * Exports only APIs that bundle cleanly in browser environments (Vite,
 * webpack, Astro, etc.). Anything that pulls `node:fs`, `node:path`, or the
 * Claude Code SDK lives in the Node entry (`@sweny-ai/core`).
 *
 * Not exported from here:
 *   - `ClaudeClient` — depends on `@anthropic-ai/claude-agent-sdk` (Node-only).
 *   - `execute` / `ExecuteOptions` — `executor.ts` → `source-resolver.ts`
 *     imports `node:fs/promises` for URL/file Source fetching. Import from
 *     the Node entry when you need to run a workflow.
 *   - `buildWorkflow` / `refineWorkflow` — depend on the Claude interface.
 *   - Testing helpers — `MockClaude`, `createFileSkill` use `node:fs`.
 */

// Core types
export type {
  Skill,
  SkillCategory,
  Tool,
  ToolContext,
  ConfigField,
  JSONSchema,
  Workflow,
  Node,
  Edge,
  NodeResult,
  ToolCall,
  ExecutionEvent,
  Observer,
  Claude,
  Logger,
  // Core public field types (the types of Node's own fields). Pure types,
  // zero runtime, browser-safe. Studio builds/edits Node objects and needs
  // to name node.eval / node.requires / node.retry field types.
  Evaluator,
  EvaluatorRule,
  EvalResult,
  EvaluatorKind,
  NodeRequires,
  NodeRetry,
  NodeToolFilter,
  OutputMatch,
  NodeSources,
  EvalPolicy,
  RequiresOnFail,
  McpTransport,
  WorkflowType,
  SkillHarnessKey,
} from "./types.js";

export { consoleLogger } from "./types.js";

// Runtime enum constants + skill-id helpers. Pure data / regex / pure
// function from types.ts, which is already proven browser-safe (schema.ts
// imports it). A Studio dropdown rendering evaluator kinds, or validating a
// skill id, needs these without hardcoding the members.
export {
  EVALUATOR_KINDS,
  EVAL_POLICIES,
  REQUIRES_ON_FAIL,
  MCP_TRANSPORTS,
  SKILL_CATEGORIES,
  SKILL_HARNESSES,
  SKILL_ID_PATTERN,
  SKILL_ID_MAX_LENGTH,
  isValidSkillId,
} from "./types.js";

// Skills (browser-safe — no filesystem access, no `process.env` reads)
export {
  github,
  linear,
  slack,
  sentry,
  datadog,
  betterstack,
  notification,
  supabase,
  builtinSkills,
  createSkillMap,
  allSkills,
  isSkillConfigured,
  configuredBuiltinSkills,
  validateWorkflowSkills,
} from "./skills/index.js";
export type { SkillValidationResult } from "./skills/index.js";

// Schema & validation
export {
  workflowZ,
  nodeZ,
  edgeZ,
  skillZ,
  parseWorkflow,
  validateWorkflow,
  workflowJsonSchema,
  skillJsonSchema,
} from "./schema.js";
export type { WorkflowError } from "./schema.js";

// Studio adapter
export { workflowToFlow, flowToWorkflow, applyExecutionEvent, exportAsTypescript, getSkillCatalog } from "./studio.js";
export type { FlowNode, SkillNodeData, FlowEdge } from "./studio.js";
