/**
 * @sweny-ai/core — Skill library + DAG workflow orchestration
 *
 * Three concepts:
 *   Skill  — a group of tools Claude can call (replaces "providers")
 *   Workflow — a DAG of nodes connected by edges (replaces "engine + recipes")
 *   execute() — walk the DAG, run Claude at each node
 *
 * @example
 * ```ts
 * import { execute, ClaudeClient, createSkillMap, github, sentry, slack } from '@sweny-ai/core'
 * import { triageWorkflow } from '@sweny-ai/core/workflows'
 *
 * const skills = createSkillMap([github, sentry, slack])
 * const claude = new ClaudeClient()
 *
 * const results = await execute(triageWorkflow, alertPayload, {
 *   skills,
 *   claude,
 *   observer: (event) => console.log(event),
 * })
 * ```
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

// Claude client
export { ClaudeClient } from "./claude.js";
export type { ClaudeClientOptions } from "./claude.js";

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

// MCP auto-injection
export { buildAutoMcpServers } from "./mcp.js";
export type { McpServerConfig, McpAutoConfig } from "./types.js";

// Workflow builder
export { buildWorkflow, refineWorkflow } from "./workflow-builder.js";
export type { BuildWorkflowOptions } from "./workflow-builder.js";

// Templates
export { resolveTemplates, loadAdditionalContext, loadTemplate } from "./templates.js";
export type { Templates } from "./templates.js";
