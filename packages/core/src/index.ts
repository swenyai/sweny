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
  ToolRunContext,
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
  ChildWorkflow,
  MapNodeFields,
  NodeKind,
  MapOnItemFail,
  MapOnEmpty,
  MapIsolation,
  MapItemStatus,
  MapCounts,
  EventScope,
  ChildStartAction,
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
  NODE_KINDS,
  MAP_ON_ITEM_FAIL,
  MAP_ON_EMPTY,
  MAP_ISOLATION,
  MAP_CONCURRENCY_DEFAULT,
  MAP_CONCURRENCY_CEILING,
  MAP_MAX_ITEMS_DEFAULT,
  MAP_MAX_ITEMS_CEILING,
  EVENTS_VERSION,
} from "./types.js";

export { consoleLogger } from "./types.js";

// Executor
export { execute, RouteEvaluationError } from "./executor.js";
export type { ExecuteOptions } from "./executor.js";

// Map nodes (#575): child-run hosts and their contract
export { createJournalChildHost, createMemoryChildHost } from "./child-host.js";
export type { JournalChildHostOptions, MemoryChildHostOptions } from "./child-host.js";
export type { ChildRunHost, ChildRun, ChildRunRef, ChildAction } from "./map.js";

// Decision models (#357): config types and the provider adapter only
export { systemOneProvider } from "./decider.js";
export type { DeciderConfig, DeciderOperatorConfig } from "./decider.js";

// Least-privilege nodes and safe outputs (#365)
export { BudgetGuard, SpendTally, SPEND_KINDS, describeOverrun, minLimits, toLimits } from "./budget.js";
export type {
  Budget,
  BudgetOverrun,
  BudgetUnit,
  KindSpend,
  SeedSpend,
  SpendBreakdown,
  SpendKind,
  SpendLimits,
} from "./budget.js";
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
  reportCompletionUsage,
} from "./harness/index.js";
export type {
  AgentHarness,
  HarnessCapabilities,
  HarnessCompleteRequest,
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
  mapNodeZ,
  childWorkflowZ,
  workflowNodeZ,
  isAgentNode,
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
export type { WorkflowError, ParsedWorkflowNode, ParsedAgentNode, ParsedMapNode } from "./schema.js";

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

// Run history and `sweny runs` / `sweny runs diff` (read-only; history is untrusted, see run-history.ts)
export { listRuns, RUN_HISTORY_DIR } from "./cli/run-history.js";
export type { RunRecord, RunNodeRecord, RunTotals, RunStatus, RunKindSpend } from "./cli/run-history.js";
export { readRunAnswers, compareAnswers } from "./cli/run-answers.js";
export type { RunAnswers, AnswersComparison, AnswerDiff } from "./cli/run-answers.js";
export { printableRun, pickRunsForDiff, formatRunsTable } from "./cli/runs.js";
export { sanitizeTerminal } from "./cli/terminal.js";
// `sweny workflow validate`: skill-env warnings
export { skillEnvWarnings } from "./cli/skill-env.js";
