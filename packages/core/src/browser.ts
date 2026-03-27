/**
 * Browser-safe entry point for @sweny-ai/core
 *
 * Re-exports everything EXCEPT ClaudeClient (which depends on
 * @anthropic-ai/claude-agent-sdk, a Node-only package). Use this entry point
 * in browser environments (Vite, webpack, Astro, etc.).
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

// Executor
export { execute } from "./executor.js";
export type { ExecuteOptions } from "./executor.js";

// Skills
export {
  github,
  linear,
  slack,
  sentry,
  datadog,
  betterstack,
  notification,
  builtinSkills,
  createSkillMap,
  allSkills,
  isSkillConfigured,
  configuredSkills,
  validateWorkflowSkills,
} from "./skills/index.js";
export type { SkillValidationResult } from "./skills/index.js";

// Schema & validation
export { workflowZ, nodeZ, edgeZ, skillZ, parseWorkflow, validateWorkflow, workflowJsonSchema } from "./schema.js";
export type { WorkflowError } from "./schema.js";

// Studio adapter
export { workflowToFlow, flowToWorkflow, applyExecutionEvent, exportAsTypescript, getSkillCatalog } from "./studio.js";
export type { FlowNode, SkillNodeData, FlowEdge } from "./studio.js";

// Workflow builder (browser-safe, uses fetch)
export { buildWorkflow, refineWorkflow } from "./workflow-builder.js";
export type { BuildWorkflowOptions } from "./workflow-builder.js";

// Testing utilities — NOT included in browser entry.
// MockClaude and createFileSkill depend on node:fs.
// Import from "@sweny-ai/core/testing" in Node environments.
