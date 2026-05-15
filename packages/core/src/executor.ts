/**
 * Workflow Executor
 *
 * Walks a workflow graph node-by-node. At each node, Claude gets
 * the node's instruction + available skill tools + context from
 * prior nodes. Claude does the work, then the executor resolves
 * which edge to follow next.
 *
 * Supports controlled cycles via max_iterations on edges — when
 * an edge has been followed max_iterations times, it is excluded
 * from routing, causing flow to fall through to alternative paths.
 *
 * This replaces ~8k lines of engine + recipe step code.
 */

import type {
  Workflow,
  Node,
  NodeSources,
  Skill,
  SkillDefinition,
  Tool,
  Claude,
  Observer,
  NodeResult,
  Logger,
  ToolContext,
  ConfigField,
  ExecutionEvent,
  ExecutionTrace,
  ExecutionResult,
  JSONSchema,
  Source,
  ResolvedSource,
} from "./types.js";
import { consoleLogger } from "./types.js";
import { resolveSources } from "./source-resolver.js";
import { evaluateAll, aggregateEval } from "./eval/index.js";
import { evaluateRequires } from "./requires.js";
import { buildRetryPreamble } from "./retry.js";
import { buildToolAliases } from "./skills/index.js";

export interface ExecuteOptions {
  /** Registered skills (id → Skill) */
  skills: Map<string, Skill>;
  /** Config values — env vars + explicit overrides */
  config?: Record<string, string>;
  /** Claude client */
  claude: Claude;
  /** Event observer for streaming/logging */
  observer?: Observer;
  /** Logger */
  logger?: Logger;
  /** Working directory for resolving file Sources (default: process.cwd()) */
  cwd?: string;
  /** Environment variables for Source resolution auth lookup */
  env?: NodeJS.ProcessEnv;
  /** Host → env-var-name map for URL Source authentication */
  fetchAuth?: Record<string, string>;
  /** When true, URL Sources throw instead of fetching */
  offline?: boolean;
}

/**
 * Execute a workflow from entry to completion.
 *
 * Returns an ExecutionResult with:
 * - `results`: map of node ID → final result (last execution if retried)
 * - `trace`: full ordered execution trace including loops and routing decisions
 */
export async function execute(workflow: Workflow, input: unknown, options: ExecuteOptions): Promise<ExecutionResult> {
  const { claude, observer } = options;

  // Merge inline workflow skills into the skill map so they resolve at runtime.
  // Inline skills (instruction/mcp only) become Skill objects with empty tools/config.
  // The caller's skill map takes precedence — inline skills only fill gaps.
  const skills = mergeInlineSkills(options.skills, workflow.skills);

  const config = resolveConfig(skills, options.config);
  const logger = options.logger ?? consoleLogger;
  const results = new Map<string, NodeResult>();
  const edgeCounts = new Map<string, number>(); // "from→to" → times followed
  const nodeRunCounts = new Map<string, number>(); // node → times executed
  const trace: ExecutionTrace = { steps: [], edges: [], sources: {} };

  validate(workflow, skills);

  // Build an eval-time alias table from the loaded skills. Each skill owns
  // its own mapping between skill-tool names and equivalent MCP names. Core
  // stays vendor-neutral; this call just unions what the skills declare.
  const toolAliases = buildToolAliases(skills.values(), logger);

  // Soft-cap warning: count declared judge evaluators across all nodes and
  // warn if the total exceeds workflow.judge_budget (default 50). Spec says
  // this is informational, not a hard runtime cap; users hit the warning
  // when they unintentionally fan out judges (e.g. 10 judges × 50 nodes).
  warnOnJudgeBudget(workflow, logger);

  // ── Source resolution phase ─────────────────────────────────────
  // Resolve all Source values (node instructions + rules/context at every
  // level) into plain text before the main execution loop. This eagerly
  // fetches file/URL content so the execution path is pure-compute.
  const sourceMap: Record<string, Source> = {};

  // Node instructions
  for (const [nodeId, node] of Object.entries(workflow.nodes)) {
    sourceMap[`nodes.${nodeId}.instruction`] = node.instruction;
  }

  // Runtime input rules/context (accepts Source | Source[])
  const inputRules = extractRuntimeInputSources(input, "rules");
  const inputContext = extractRuntimeInputSources(input, "context");
  inputRules.forEach((s, i) => (sourceMap[`input.rules.${i}`] = s));
  inputContext.forEach((s, i) => (sourceMap[`input.context.${i}`] = s));

  // Workflow-level rules/context
  (workflow.rules ?? []).forEach((s, i) => (sourceMap[`workflow.rules.${i}`] = s));
  (workflow.context ?? []).forEach((s, i) => (sourceMap[`workflow.context.${i}`] = s));

  // Node-level rules/context
  for (const [nodeId, node] of Object.entries(workflow.nodes)) {
    const nodeRules = nodeSourcesToArray(node.rules).sources;
    const nodeContext = nodeSourcesToArray(node.context).sources;
    nodeRules.forEach((s, i) => (sourceMap[`nodes.${nodeId}.rules.${i}`] = s));
    nodeContext.forEach((s, i) => (sourceMap[`nodes.${nodeId}.context.${i}`] = s));
  }

  const resolvedSources = await resolveSources(sourceMap, {
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? process.env,
    authConfig: options.fetchAuth ?? {},
    offline: options.offline ?? false,
    logger,
  });
  trace.sources = resolvedSources;
  safeObserve(observer, { type: "workflow:start", workflow: workflow.id }, logger);
  safeObserve(observer, { type: "sources:resolved", sources: resolvedSources }, logger);

  let currentId: string | null = workflow.entry;

  while (currentId) {
    const node = workflow.nodes[currentId];
    if (!node) throw new Error(`Unknown node: "${currentId}"`);

    const iteration = (nodeRunCounts.get(currentId) ?? 0) + 1;
    nodeRunCounts.set(currentId, iteration);

    const resolvedInstruction = resolvedSources[`nodes.${currentId}.instruction`].content;
    safeObserve(observer, { type: "node:enter", node: currentId, instruction: resolvedInstruction }, logger);
    logger.info(`→ ${node.name}`, { node: currentId });

    // Gather tools from the node's skills
    const tools = resolveTools(node.skills, skills);
    const skillInstructions = resolveSkillInstructions(node.skills, skills);

    // Runtime guard: if this node declares skills but none resolved, the node
    // cannot do its job (e.g. "create a Linear issue" with no linear skill).
    // The startup validate() warns about this possibility, but only throw when
    // the node is actually reached — unreachable nodes with missing skills are fine.
    // Instruction-only skills (no tools) are valid — they inject context into the prompt.
    if (node.skills.length > 0 && tools.length === 0 && skillInstructions.length === 0) {
      throw new Error(
        `Node "${currentId}" requires skills [${node.skills.join(", ")}] but none are configured. ` +
          `Set the required environment variables and try again.`,
      );
    }

    // Build context: input + all prior node results.
    // Each prior node entry is the node's `data` augmented with `evals`
    // (a Record<name, EvalResult> for downstream lookup like
    // `priorNode.evals.tests_run_clean.pass`). When `data` already has an
    // `evals` key, the data field wins (back-compat with existing workflows).
    const context: Record<string, unknown> = {
      input,
      ...Object.fromEntries([...results.entries()].map(([k, v]) => [k, buildPriorNodeContext(v)])),
    };

    // Pre-condition gate: evaluate `requires` against the cross-node context
    // BEFORE invoking the LLM. Failure either marks the node failed (on_fail
    // default) or skipped (on_fail: "skip") and skips execution entirely.
    const requiresError = evaluateRequires(node.requires, context);
    if (requiresError) {
      const onFail = node.requires?.on_fail ?? "fail";
      const result: NodeResult =
        onFail === "skip"
          ? {
              status: "skipped",
              data: { skipped_reason: requiresError.replace(/^requires failed:/, "requires not met:") },
              toolCalls: [],
            }
          : {
              status: "failed",
              data: { error: requiresError },
              toolCalls: [],
            };
      results.set(currentId, result);
      trace.steps.push({ node: currentId, status: result.status, iteration });
      safeObserve(observer, { type: "node:exit", node: currentId, result }, logger);
      logger.warn(`  requires ${onFail === "skip" ? "skipped" : "failed"}: ${requiresError}`, { node: currentId });

      // Apply normal routing rules (dry run gate + resolveNext).
      // TODO: dedupe with requires path — see advanceFromNode helper below
      const next = await advanceFromNode(
        workflow,
        currentId,
        results,
        input,
        claude,
        observer,
        edgeCounts,
        logger,
        trace,
      );
      currentId = next;
      continue;
    }

    // Wrap tool handlers to emit events + inject context
    const trackedTools = tools.map((t) => ({
      ...t,
      handler: async (toolInput: any) => {
        safeObserve(observer, { type: "tool:call", node: currentId!, tool: t.name, input: toolInput }, logger);
        const toolCtx: ToolContext = { config, logger };
        const output = await t.handler(toolInput, toolCtx);
        safeObserve(observer, { type: "tool:result", node: currentId!, tool: t.name, output }, logger);
        return output;
      },
    }));

    // Prepend rules and context to instruction per cascade semantics
    const effectiveRules = assembleCascaded(
      "rules",
      currentId,
      workflow.nodes[currentId],
      inputRules.length,
      (workflow.rules ?? []).length,
      resolvedSources,
    );
    const effectiveContext = assembleCascaded(
      "context",
      currentId,
      workflow.nodes[currentId],
      inputContext.length,
      (workflow.context ?? []).length,
      resolvedSources,
    );
    const instruction = buildNodeInstruction(
      resolvedInstruction,
      effectiveRules,
      effectiveContext,
      input,
      skillInstructions,
    );

    // Run Claude on this node, with optional eval-failure retry loop.
    let attempt = 0;
    let result: NodeResult;
    let currentInstruction = instruction;
    const retry = node.retry;

    while (true) {
      result = await claude.run({
        instruction: currentInstruction,
        context,
        tools: trackedTools,
        outputSchema: node.output,
        maxTurns: node.max_turns,
        disallowedTools: node.disallowed_tools,
        onProgress: (message) => {
          safeObserve(observer, { type: "node:progress", node: currentId!, message }, logger);
        },
      });

      // Retry only triggers on eval failure. Bail on tool/API errors.
      if (result.status !== "success") break;

      const evalResults = await evaluateAll(node.eval, result, {
        aliases: toolAliases,
        claude,
        node,
        workflow,
      });
      result.evals = evalResults;
      const outcome = aggregateEval(evalResults, node.eval_policy ?? "all_pass");
      if (outcome.pass) break;

      // Apply eval failure to the result.
      result.status = "failed";
      result.data = { ...result.data, error: outcome.error };

      if (!retry || attempt >= retry.max) {
        logger.warn(`  eval failed: ${outcome.error}`, { node: currentId });
        break;
      }

      // Build retry preamble + record attempt in trace.
      trace.steps.push({ node: currentId, status: "failed", iteration, retryAttempt: attempt });
      logger.warn(`  eval failed (attempt ${attempt + 1}/${retry.max + 1}): ${outcome.error}`, {
        node: currentId,
      });

      const preamble = await buildRetryPreamble({
        retry,
        evalFailures: outcome.failures,
        toolCalls: result.toolCalls,
        nodeInstruction: resolvedInstruction,
        claude,
        logger,
        context,
      });
      currentInstruction = `${preamble}\n\n---\n\n${instruction}`;
      safeObserve(
        observer,
        { type: "node:retry", node: currentId, attempt: attempt + 1, reason: outcome.error ?? "eval failed", preamble },
        logger,
      );
      attempt++;
    }

    results.set(currentId, result);
    trace.steps.push(
      attempt > 0
        ? { node: currentId, status: result.status, iteration, retryAttempt: attempt }
        : { node: currentId, status: result.status, iteration },
    );
    safeObserve(observer, { type: "node:exit", node: currentId, result }, logger);
    logger.info(`  ✓ ${result.status}`, { node: currentId, toolCalls: result.toolCalls.length });

    // Dry run gate + routing — shared with requires path via advanceFromNode helper.
    currentId = await advanceFromNode(workflow, currentId, results, input, claude, observer, edgeCounts, logger, trace);
  }

  safeObserve(
    observer,
    {
      type: "workflow:end",
      results: Object.fromEntries(results),
    },
    logger,
  );

  return { results, trace };
}

// ─── Internals ───────────────────────────────────────────────────

/**
 * Build the full instruction for a node.
 *
 * Assembly order (each section separated by `---`):
 *   1. Rules (from runtime input + workflow + node, cascaded)
 *   2. Context (from runtime input + workflow + node, cascaded)
 *   3. Skill instructions (one per skill with an `instruction` field)
 *   4. The node's base instruction
 *
 * Preserves the legacy `input.additionalContext` fallback for callers
 * that predate the Source-based rules/context fields.
 */
function buildNodeInstruction(
  baseInstruction: string,
  effectiveRules: string,
  effectiveContext: string,
  input: unknown,
  skillInstructions?: { name: string; instruction: string }[],
): string {
  const sections: string[] = [];

  if (effectiveRules) {
    sections.push(`## Rules — You MUST Follow These\n\n${effectiveRules}`);
  }
  if (effectiveContext) {
    sections.push(`## Background Context\n\n${effectiveContext}`);
  }

  // Legacy fallback for `input.additionalContext` when no rules/context cascaded
  if (sections.length === 0) {
    const inp = input as Record<string, unknown> | null;
    const legacy = inp && typeof inp.additionalContext === "string" ? inp.additionalContext : "";
    if (legacy) {
      sections.push(`## Additional Context & Rules\n\n${legacy}`);
    }
  }

  if (skillInstructions && skillInstructions.length > 0) {
    for (const { name, instruction } of skillInstructions) {
      sections.push(`## Skill: ${name}\n\n${instruction}`);
    }
  }

  if (sections.length === 0) return baseInstruction;
  return `${sections.join("\n\n---\n\n")}\n\n---\n\n${baseInstruction}`;
}

/**
 * Normalize a NodeSources value into { sources, only }.
 * - Array form → additive (only = false)
 * - Object form → use its `only` and `sources`
 * - undefined → empty additive
 */
const DEFAULT_JUDGE_BUDGET = 50;

/**
 * Soft cap on judge calls per workflow run. Logs a warn when the count of
 * declared `kind: judge` evaluators exceeds the configured budget. This is
 * a load-time signal only; the executor does not refuse to run.
 *
 * Each judge counts once per node visit, but the executor counts judges
 * once at declaration time (a fan-out of repeated visits via cycles is the
 * author's responsibility, not core's).
 */
function warnOnJudgeBudget(workflow: Workflow, logger: Logger): void {
  const budget = workflow.judge_budget ?? DEFAULT_JUDGE_BUDGET;
  let total = 0;
  for (const node of Object.values(workflow.nodes)) {
    for (const evaluator of node.eval ?? []) {
      if (evaluator.kind === "judge") total++;
    }
  }
  if (total > budget) {
    logger.warn(
      `Workflow declares ${total} judge evaluators across all nodes (budget: ${budget}). ` +
        `Consider reducing the count or raising 'judge_budget' on the workflow. ` +
        `Each judge adds one model call per node attempt.`,
      { judgeCount: total, judgeBudget: budget },
    );
  }
}

/**
 * Build the context-map entry for a single prior node.
 *
 * Spec contract (https://spec.sweny.ai/nodes/#evalresult-type): downstream
 * nodes can read `priorNode.evals.<name>.pass` via the natural lookup path.
 * To honor this without breaking back-compat with workflows that read
 * `priorNode.<dataField>` directly, we spread `data` first and then attach
 * an `evals` namespace keyed by evaluator name. If the agent's structured
 * output happens to include a literal `evals` field, that field wins (and
 * the lookup degrades to "evals not available" for downstream readers).
 */
function buildPriorNodeContext(result: NodeResult): Record<string, unknown> {
  const data = (result.data ?? {}) as Record<string, unknown>;
  const evals = result.evals ?? [];
  if (evals.length === 0) return data;

  const evalsByName: Record<string, unknown> = {};
  for (const e of evals) {
    evalsByName[e.name] = e;
  }
  // Spread evals first so a data-side `evals` key shadows it (back-compat).
  return { evals: evalsByName, ...data };
}

/**
 * Build the prior-node entry shown to the LLM route evaluator.
 *
 * Differs from `buildPriorNodeContext` (which feeds downstream node `run()`
 * calls) in one way: when the source node declared an `output` schema with
 * a `properties` block, the data view is restricted to those declared
 * properties. The `evals` namespace is always preserved when present.
 *
 * Why this exists. The route evaluator is a natural-language model. Anything
 * it sees in the context can sway the decision, including prose narrative
 * fields like the always-injected `summary` from the reference Claude
 * client (claude.ts: `data: { summary: response, ...parsed }`). Real-world
 * symptom: a node correctly emits `status: "pass"` but also adds a
 * conversational `summary` like "the quality_retry_count is 1", and the
 * evaluator pattern-matches the retry mention to flip the routing decision.
 *
 * The fix is to treat the `output` schema as the routing contract. If the
 * author declared which fields matter, only those reach the route
 * evaluator. When no schema is declared we fall back to the full data
 * (back-compat for workflows without structured outputs).
 *
 * The downstream node prompt is untouched: nodes still see the full prior
 * `data` including any prose `summary`, so workflows that consume the
 * narrative in subsequent steps keep working.
 */
function buildRouteEvalEntry(result: NodeResult, sourceNode: Node | undefined): Record<string, unknown> {
  const fullData = (result.data ?? {}) as Record<string, unknown>;
  const declaredProps = getDeclaredOutputProperties(sourceNode?.output);

  const dataView: Record<string, unknown> = declaredProps ? pickKeys(fullData, declaredProps) : fullData;

  const evals = result.evals ?? [];
  if (evals.length === 0) return dataView;

  const evalsByName: Record<string, unknown> = {};
  for (const e of evals) {
    evalsByName[e.name] = e;
  }
  // Spread evals first so a data-side `evals` key shadows it (back-compat).
  return { evals: evalsByName, ...dataView };
}

/**
 * Return the declared output property names for a node, or null when the
 * node has no `output` schema or its schema does not declare a `properties`
 * block. Null signals "no contract" and routing falls back to the full
 * data view.
 *
 * Tolerant of malformed schemas because `output` is `JSONSchema =
 * Record<string, unknown>` and is not parsed further by the executor.
 */
function getDeclaredOutputProperties(output: JSONSchema | undefined): Set<string> | null {
  if (!output || typeof output !== "object") return null;
  const props = (output as Record<string, unknown>).properties;
  if (!props || typeof props !== "object") return null;
  const keys = Object.keys(props as Record<string, unknown>);
  if (keys.length === 0) return null;
  return new Set(keys);
}

function pickKeys(obj: Record<string, unknown>, keys: Set<string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    if (k in obj) out[k] = obj[k];
  }
  return out;
}

function nodeSourcesToArray(ns: NodeSources | undefined): { sources: Source[]; only: boolean } {
  if (!ns) return { sources: [], only: false };
  if (Array.isArray(ns)) return { sources: ns, only: false };
  return { sources: ns.sources, only: !!ns.only };
}

/**
 * Extract rules/context Sources from runtime input.
 *
 * Runtime input is typed `unknown` because workflows are polymorphic.
 * We accept `Source`, `Source[]`, or undefined. A single string is
 * classified via the usual Source prefix rules (inline by default).
 * Invalid shapes are ignored — input is caller-controlled and the
 * rest of the executor validates it elsewhere.
 */
function extractRuntimeInputSources(input: unknown, field: "rules" | "context"): Source[] {
  if (!input || typeof input !== "object") return [];
  const v = (input as Record<string, unknown>)[field];
  if (v == null) return [];
  if (Array.isArray(v)) return v as Source[];
  if (typeof v === "string") return [v as Source];
  if (typeof v === "object") return [v as Source]; // tagged form {inline}/{file}/{url}
  return [];
}

/**
 * Assemble the effective rules or context for a node per cascade semantics:
 *   runtime input  +  workflow-level  +  node-level
 * unless the node sets `only: true` for that field, which discards input
 * and workflow contributions and uses only the node's own sources.
 *
 * Returns the concatenated resolved content (empty string when nothing applies).
 */
function assembleCascaded(
  field: "rules" | "context",
  nodeId: string,
  node: Node,
  inputCount: number,
  workflowCount: number,
  resolved: Record<string, ResolvedSource>,
): string {
  const { sources: nodeSources, only } = nodeSourcesToArray(node[field]);
  const parts: string[] = [];

  if (!only) {
    for (let i = 0; i < inputCount; i++) parts.push(resolved[`input.${field}.${i}`]?.content ?? "");
    for (let i = 0; i < workflowCount; i++) parts.push(resolved[`workflow.${field}.${i}`]?.content ?? "");
  }
  for (let i = 0; i < nodeSources.length; i++) {
    parts.push(resolved[`nodes.${nodeId}.${field}.${i}`]?.content ?? "");
  }

  return parts.filter((s) => s.length > 0).join("\n\n");
}

/**
 * Call observer without letting exceptions crash the workflow.
 *
 * Accepts a typed ExecutionEvent so TypeScript catches mistakes in
 * event construction at compile time rather than silently at runtime.
 */
function safeObserve(observer: Observer | undefined, event: ExecutionEvent, logger?: Logger): void {
  if (!observer) return;
  try {
    observer(event);
  } catch (err: any) {
    (logger ?? consoleLogger).warn(`Observer error (non-fatal): ${err.message}`);
  }
}

/**
 * Merge inline workflow skill definitions into the skill map.
 * Inline skills (from workflow.skills) become Skill objects with empty tools/config.
 * The caller's skill map takes precedence — inline skills only fill gaps.
 */
function mergeInlineSkills(
  skills: Map<string, Skill>,
  inlineSkills?: Record<string, SkillDefinition>,
): Map<string, Skill> {
  if (!inlineSkills || Object.keys(inlineSkills).length === 0) return skills;

  const merged = new Map(skills);
  for (const [id, def] of Object.entries(inlineSkills)) {
    if (merged.has(id)) continue; // caller-provided skill takes precedence
    merged.set(id, {
      id,
      name: def.name ?? id,
      description: def.description ?? `Inline skill: ${id}`,
      category: "general",
      config: {},
      tools: [],
      instruction: def.instruction,
      mcp: def.mcp,
    });
  }
  return merged;
}

function resolveTools(skillIds: string[], skills: Map<string, Skill>): Tool[] {
  return skillIds
    .map((id) => skills.get(id))
    .filter((s): s is Skill => s != null)
    .flatMap((s) => s.tools);
}

/** Collect instruction strings from skills that have them, in array order. */
function resolveSkillInstructions(
  skillIds: string[],
  skills: Map<string, Skill>,
): { name: string; instruction: string }[] {
  return skillIds
    .map((id) => skills.get(id))
    .filter((s): s is Skill => s != null && s.instruction != null)
    .map((s) => ({ name: s.name, instruction: s.instruction! }));
}

/**
 * Resolve config values: check explicit overrides first, then env vars.
 * Throws if a required field is missing.
 */
function resolveConfig(skills: Map<string, Skill>, overrides?: Record<string, string>): Record<string, string> {
  const config: Record<string, string> = {};
  const missing: string[] = [];

  for (const skill of skills.values()) {
    for (const [key, field] of Object.entries(skill.config)) {
      const value = overrides?.[key] ?? (field.env ? process.env[field.env] : undefined);
      if (value) {
        config[key] = value;
      } else if (field.required) {
        missing.push(`${skill.id}.${key} (env: ${field.env ?? "none"})`);
      }
    }
  }

  if (missing.length > 0) {
    throw new Error(`Missing required config:\n  ${missing.join("\n  ")}`);
  }

  return config;
}

/**
 * Apply the dry-run gate and then resolve the next node via edge conditions.
 *
 * Used in both the normal execution path and the requires-failure path so
 * the dry-run guard + resolveNext + trace-edge recording logic lives in one place.
 *
 * Returns the next node ID, or null when execution should stop.
 */
async function advanceFromNode(
  workflow: Workflow,
  currentId: string,
  results: Map<string, NodeResult>,
  input: unknown,
  claude: Claude,
  observer: Observer | undefined,
  edgeCounts: Map<string, number>,
  logger: Logger,
  trace: ExecutionTrace,
): Promise<string | null> {
  // Dry run hard gate — stop at the first conditional routing decision.
  // Unconditional edges are analysis flow (prepare→gather→investigate);
  // conditional edges are action decisions (investigate→create_issue/skip).
  // Enforced in the executor so it cannot be bypassed by LLM evaluation.
  const isDryRun = input && typeof input === "object" && (input as Record<string, unknown>).dryRun === true;
  if (isDryRun) {
    const outEdges = workflow.edges.filter((e) => e.from === currentId);
    if (outEdges.some((e) => e.when)) {
      safeObserve(observer, { type: "route", from: currentId, to: "(end)", reason: "dry run" }, logger);
      return null;
    }
  }

  const prevId = currentId;
  const nextId = await resolveNext(workflow, currentId, results, input, claude, observer, edgeCounts, logger);
  if (nextId) {
    const reason = workflow.edges.find((e) => e.from === prevId && e.to === nextId)?.when ?? "only path";
    trace.edges.push({ from: prevId, to: nextId, reason });
  }
  return nextId;
}

/**
 * Resolve which edge to follow from the current node.
 *
 * - 0 out-edges → terminal (return null)
 * - 1 unconditional edge → follow it
 * - Multiple or conditional → Claude evaluates
 *
 * Edges with max_iterations are filtered out once exhausted.
 */
async function resolveNext(
  workflow: Workflow,
  current: string,
  results: Map<string, NodeResult>,
  input: unknown,
  claude: Claude,
  observer?: Observer,
  edgeCounts?: Map<string, number>,
  logger?: Logger,
): Promise<string | null> {
  // Filter out edges that have exceeded their max_iterations
  const outEdges = workflow.edges.filter((e) => {
    if (e.from !== current) return false;
    if (e.max_iterations && edgeCounts) {
      const key = `${e.from}→${e.to}`;
      const count = edgeCounts.get(key) ?? 0;
      if (count >= e.max_iterations) return false;
    }
    return true;
  });

  if (outEdges.length === 0) return null;

  // Single unconditional edge — just follow it
  if (outEdges.length === 1 && !outEdges[0].when) {
    if (edgeCounts) {
      const key = `${current}→${outEdges[0].to}`;
      edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
    }
    safeObserve(observer, { type: "route", from: current, to: outEdges[0].to, reason: "only path" }, logger);
    return outEdges[0].to;
  }

  // Check for a default (unconditional) edge among conditionals
  const defaultEdge = outEdges.find((e) => !e.when);
  const conditionalEdges = outEdges.filter((e) => e.when);

  // Claude evaluates which condition matches. Include input so conditions
  // can reference workflow-level flags like dryRun, and expose evals so
  // routing edges can read `priorNode.evals.X.pass`.
  //
  // Crucial difference from the run() context: when a prior node declared
  // an `output` schema, the routing view of its data is restricted to the
  // declared properties. Without this, non-schema fields (notably the
  // always-injected `summary` prose from the reference Claude client) can
  // sway the natural-language route evaluator and override the actual
  // structured result. See `buildRouteEvalEntry` for the full rationale.
  const context: Record<string, unknown> = {
    input,
    ...Object.fromEntries([...results.entries()].map(([k, v]) => [k, buildRouteEvalEntry(v, workflow.nodes[k])])),
  };

  const choices = conditionalEdges.map((e) => ({
    id: e.to,
    description: e.when!,
  }));

  if (defaultEdge) {
    choices.push({ id: defaultEdge.to, description: "None of the above / default path" });
  }

  const chosen = await claude.evaluate({
    question: "Based on the results so far, which condition is true?",
    context,
    choices,
  });

  // Validate that Claude returned a valid target
  const validTargets = new Set(outEdges.map((e) => e.to));
  const resolved = validTargets.has(chosen) ? chosen : (defaultEdge?.to ?? outEdges[0].to); // fall back to default or first edge

  // Track edge usage for max_iterations
  if (edgeCounts) {
    const key = `${current}→${resolved}`;
    edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
  }

  safeObserve(
    observer,
    {
      type: "route",
      from: current,
      to: resolved,
      reason: choices.find((c) => c.id === resolved)?.description ?? "default",
    },
    logger,
  );

  return resolved;
}

/**
 * Validate a workflow definition before execution.
 */
function validate(workflow: Workflow, skills: Map<string, Skill>): void {
  if (!workflow.nodes[workflow.entry]) {
    throw new Error(`Entry node "${workflow.entry}" not found`);
  }

  for (const edge of workflow.edges) {
    if (!workflow.nodes[edge.from]) throw new Error(`Edge references unknown node: "${edge.from}"`);
    if (!workflow.nodes[edge.to]) throw new Error(`Edge references unknown node: "${edge.to}"`);
  }

  // Check that each node has at least one available skill (if it lists any)
  for (const [nodeId, node] of Object.entries(workflow.nodes)) {
    if (node.skills.length === 0) continue;
    const available = node.skills.filter((id) => skills.has(id));
    if (available.length === 0) {
      consoleLogger.warn(`Node "${nodeId}" has no available skills (needs one of: ${node.skills.join(", ")})`);
    }
  }
}
