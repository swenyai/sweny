/**
 * Browser-safe entry point for @sweny-ai/core
 *
 * Re-exports everything EXCEPT ClaudeClient (which depends on
 * @anthropic-ai/sdk, a Node-only package). Use this entry point
 * in browser environments (Vite, webpack, Astro, etc.).
 */

// Core types
export type {
  Skill,
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
  notification,
  builtinSkills,
  createSkillMap,
  allSkills,
} from "./skills/index.js";

// Schema & validation
export { workflowZ, nodeZ, edgeZ, skillZ, parseWorkflow, validateWorkflow, workflowJsonSchema } from "./schema.js";
export type { WorkflowError } from "./schema.js";

// Studio adapter
export { workflowToFlow, flowToWorkflow, applyExecutionEvent, exportAsTypescript, getSkillCatalog } from "./studio.js";
export type { FlowNode, SkillNodeData, FlowEdge } from "./studio.js";

// Testing utilities
export { MockClaude, createFileSkill } from "./testing.js";
