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
} from "./types.js";

export { consoleLogger } from "./types.js";

// Skills (browser-safe — no filesystem access, no `process.env` reads)
export {
  github,
  linear,
  slack,
  sentry,
  datadog,
  notification,
  builtinSkills,
  createSkillMap,
  allSkills,
  isSkillConfigured,
  configuredBuiltinSkills,
  validateWorkflowSkills,
} from "./skills/index.js";
export type { SkillValidationResult } from "./skills/index.js";

// Schema & validation
export { workflowZ, nodeZ, edgeZ, skillZ, parseWorkflow, validateWorkflow, workflowJsonSchema } from "./schema.js";
export type { WorkflowError } from "./schema.js";

// Studio adapter
export { workflowToFlow, flowToWorkflow, applyExecutionEvent, exportAsTypescript, getSkillCatalog } from "./studio.js";
export type { FlowNode, SkillNodeData, FlowEdge } from "./studio.js";
