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
 * import { execute, createHarness, createSkillMap, github, sentry, slack } from '@sweny-ai/core'
 * import { triageWorkflow } from '@sweny-ai/core/workflows'
 *
 * const skills = createSkillMap([github, sentry, slack])
 * const harness = createHarness("claude-code")
 *
 * const results = await execute(triageWorkflow, alertPayload, {
 *   skills,
 *   harness,
 *   observer: (event) => console.log(event),
 * })
 * ```
 */

// Core types
export type {
  Skill,
  SkillCategory,
  SkillDefinition,
  Tool,
  ToolContext,
  ConfigField,
  JSONSchema,
  Workflow,
  Node,
  Edge,
  EdgeWhen,
  WhenExpression,
  NodeResult,
  ToolCall,
  ExecutionEvent,
  Observer,
  Claude,
  Logger,
  TraceStep,
  TraceEdge,
  ExecutionTrace,
  ExecutionResult,
  Source,
  ResolvedSource,
  SourceKind,
  SourceResolutionMap,
  WorkflowInputs,
  WorkflowInputField,
  WorkflowInputType,
  InputValidationError,
  InputValidationResult,
  // Core public field types (the types of Node's own fields)
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
  NodeOnFail,
  McpTransport,
  WorkflowType,
  SkillHarnessKey,
  NodeAccess,
  NodePermissions,
  NodePermissionsSpec,
  SafeOutputType,
  SafeOutputDeclaration,
  SafeOutputsPolicy,
  SafeOutputReceipt,
  SafeOutputPin,
  AuthorAssociation,
} from "./types.js";

export { WORKFLOW_INPUT_TYPES } from "./types.js";

// Runtime enum constants + skill-id helpers
export {
  EVALUATOR_KINDS,
  EVAL_POLICIES,
  REQUIRES_ON_FAIL,
  NODE_ON_FAIL,
  MCP_TRANSPORTS,
  SKILL_CATEGORIES,
  SKILL_HARNESSES,
  SKILL_ID_PATTERN,
  SKILL_ID_MAX_LENGTH,
  isValidSkillId,
  NODE_ACCESS,
  TOOL_CLASSES,
  SAFE_OUTPUT_TYPES,
  SAFE_OUTPUT_APPLIERS,
  AUTHOR_ASSOCIATIONS,
} from "./types.js";

export { consoleLogger } from "./types.js";

// Executor
export { execute, RouteEvaluationError } from "./executor.js";
export type { ExecuteOptions } from "./executor.js";

// Decision models (#357): decide routes before the agent when confident
export {
  systemOneProvider,
  DecideError,
  gateVerdict,
  resolveThresholds,
  RunDecider,
  DECIDER_MIN_CONFIDENCE,
  DECIDER_MIN_MARGIN,
  DECIDER_CONFIDENCE_FLOOR,
  DECIDER_MARGIN_FLOOR,
} from "./decider.js";
export type { DecisionProvider, DeciderConfig, DeciderRecord, DeciderThresholds, SystemOneOptions } from "./decider.js";
export type { RouteRung } from "./types.js";

// Least-privilege nodes and safe outputs (#365)
export { BudgetGuard, describeOverrun, minLimits, toLimits } from "./budget.js";
export type { Budget, BudgetOverrun, BudgetUnit, SpendLimits } from "./budget.js";
export { resolveNodePermissions, buildNodePolicy } from "./node-policy.js";
export type { ResolvedPermissions } from "./node-policy.js";
export { applySafeOutputs, createEmitOutputTool, resolveActor, EMIT_OUTPUT_TOOL } from "./safe-outputs.js";
export type { SafeOutputIntent, ActorInfo, WriteStageState } from "./safe-outputs.js";

// Agent harness (the seam) and its adapters: Claude Code, Codex and pi
export {
  createHarness,
  claudeCompat,
  asClaude,
  policyGate,
  ClaudeCodeHarness,
  CodexHarness,
  PiHarness,
  SUPPORTED_AGENTS,
} from "./harness/index.js";
export type {
  AgentHarness,
  HarnessCapabilities,
  HarnessId,
  HarnessInfo,
  HarnessRunRequest,
  HarnessRunResult,
  NodePolicy,
  PolicyGateResult,
  PolicyWrappers,
  ToolClass,
  ClaudeCodeHarnessOptions,
  CodexHarnessOptions,
  PiHarnessOptions,
} from "./harness/index.js";

// Claude client (back-compat: ClaudeClient is ClaudeCodeHarness, @deprecated)
export { ClaudeClient, resolveAuthEnv } from "./harness/claude-code.js";
export type { ClaudeClientOptions, SwenyAuthMode, ResolveAuthEnvOpts } from "./harness/claude-code.js";

// Execution model resolution
export { resolveExecutionModel } from "./model.js";

// Skills
export {
  github,
  linear,
  slack,
  sentry,
  datadog,
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

// Node-only skill discovery (filesystem-based)
export { loadCustomSkills, discoverSkills, configuredSkills } from "./skills/custom-loader.js";

// Schema & validation
export {
  workflowZ,
  nodeZ,
  edgeZ,
  skillZ,
  mcpServerConfigZ,
  skillDefinitionZ,
  sourceZ,
  workflowInputsZ,
  parseWorkflow,
  validateWorkflow,
  workflowJsonSchema,
  skillJsonSchema,
} from "./schema.js";
export type { WorkflowError } from "./schema.js";

// Deterministic `when` expressions (#461). Pure, browser-safe.
export {
  isWhenExpression,
  whenLabel,
  parseExpression,
  evaluateExpression,
  checkExpression,
  ExpressionSyntaxError,
} from "./when.js";
export type { ExprNode, ExpressionScope, ExpressionResult } from "./when.js";

// Loader — canonical read → parse → structural-validate pipeline (the path
// the CLI uses for `workflow run`, `workflow validate`, and `publish`).
// Node-only: loader.ts imports `node:fs`, so this is NOT mirrored in browser.ts.
export { loadAndValidateWorkflow, validateParsed } from "./loader.js";
export type { LoaderResult, LoaderError, LoaderOptions } from "./loader.js";
export { CURRENT_SPEC_VERSION, MIGRATIONS, migrateWorkflow } from "./migrations.js";
export type { Migration, MigrationConfig, MigrateResult } from "./migrations.js";

// Workflow input validation
export { validateRuntimeInput, summarizeInputShape } from "./inputs.js";

// MCP auto-injection
export { buildAutoMcpServers, buildSkillMcpServers, buildProviderContext } from "./mcp.js";
export type { ProviderContextOptions, SkillMcpOptions } from "./mcp.js";
export type { McpServerConfig, McpAutoConfig } from "./types.js";

// Workflow builder
export { buildWorkflow, refineWorkflow } from "./workflow-builder.js";
export type { BuildWorkflowOptions } from "./workflow-builder.js";

// Templates
export { resolveTemplates, loadAdditionalContext, loadTemplate } from "./templates.js";
export type { Templates } from "./templates.js";

// Mermaid export
export { toMermaid, toMermaidBlock } from "./mermaid.js";
export type { MermaidOptions, NodeStatus } from "./mermaid.js";

// Visual tokens (#479): palette, color roles, glyphs, diagram classDefs. Browser-safe.
export {
  SWENY_TAGLINE,
  PALETTE,
  ROLE_COLORS,
  SURFACE_COLORS,
  GLYPHS,
  SPINNER_FRAMES,
  SPINNER_INTERVAL_MS,
  TICKET_BOX,
  MERMAID_CLASS_DEFS,
  MERMAID_EDGE_STYLES,
} from "./theme.js";
export type { ColorRole, GlyphKey, GlyphSet, TicketBox, DiagramNodeStatus } from "./theme.js";

// Config file
export { loadConfigFile } from "./cli/config-file.js";
export type { FileConfig } from "./cli/config-file.js";
