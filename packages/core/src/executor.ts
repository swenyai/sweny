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
  Source,
  ResolvedSource,
} from "./types.js";
import { consoleLogger } from "./types.js";
import { resolveSources } from "./sources.js";

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

  // ── Source resolution phase ─────────────────────────────────────
  // Resolve all node instructions (which are Source values) into plain text
  // before the main execution loop. This eagerly fetches file/URL content.
  const sourceMap: Record<string, Source> = {};
  for (const [nodeId, node] of Object.entries(workflow.nodes)) {
    sourceMap[`nodes.${nodeId}.instruction`] = node.instruction;
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

    // Build context: input + all prior node results
    const context: Record<string, unknown> = {
      input,
      ...Object.fromEntries([...results.entries()].map(([k, v]) => [k, v.data])),
    };

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

    // Prepend rules and context to instruction if provided
    const instruction = buildNodeInstruction(resolvedInstruction, input, skillInstructions);

    // Run Claude on this node
    const result = await claude.run({
      instruction,
      context,
      tools: trackedTools,
      outputSchema: node.output,
      maxTurns: node.max_turns,
      onProgress: (message) => {
        safeObserve(observer, { type: "node:progress", node: currentId!, message }, logger);
      },
    });

    results.set(currentId, result);
    trace.steps.push({ node: currentId, status: result.status, iteration });
    safeObserve(observer, { type: "node:exit", node: currentId, result }, logger);
    logger.info(`  ✓ ${result.status}`, { node: currentId, toolCalls: result.toolCalls.length });

    // Dry run hard gate — stop at the first conditional routing decision.
    // Unconditional edges are analysis flow (prepare→gather→investigate);
    // conditional edges are action decisions (investigate→create_issue/skip).
    // Enforced in the executor so it cannot be bypassed by LLM evaluation.
    const isDryRun = input && typeof input === "object" && (input as Record<string, unknown>).dryRun === true;
    if (isDryRun) {
      const outEdges = workflow.edges.filter((e) => e.from === currentId);
      if (outEdges.some((e) => e.when)) {
        safeObserve(observer, { type: "route", from: currentId!, to: "(end)", reason: "dry run" }, logger);
        currentId = null;
        continue;
      }
    }

    // Resolve next node via edge conditions
    const prevId = currentId;
    currentId = await resolveNext(workflow, currentId, results, input, claude, observer, edgeCounts, logger);

    // Record the routing decision in the trace
    if (currentId) {
      const edgeKey = `${prevId}→${currentId}`;
      const reason = workflow.edges.find((e) => e.from === prevId && e.to === currentId)?.when ?? "only path";
      trace.edges.push({ from: prevId, to: currentId, reason });
    }
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
 * Build the full instruction for a node by prepending rules and context.
 * Rules get "You MUST follow" framing; context gets "Background" framing.
 * Falls back to legacy `additionalContext` if rules/context aren't set.
 */
function buildNodeInstruction(
  baseInstruction: string,
  input: unknown,
  skillInstructions?: { name: string; instruction: string }[],
): string {
  const inp = input as Record<string, unknown> | null;
  const sections: string[] = [];

  if (inp) {
    const rules = typeof inp.rules === "string" && inp.rules ? inp.rules : "";
    const context = typeof inp.context === "string" && inp.context ? inp.context : "";

    if (rules) {
      sections.push(`## Rules — You MUST Follow These\n\n${rules}`);
    }
    if (context) {
      sections.push(`## Background Context\n\n${context}`);
    }

    // Legacy fallback
    if (sections.length === 0) {
      const legacy = typeof inp.additionalContext === "string" ? inp.additionalContext : "";
      if (legacy) {
        sections.push(`## Additional Context & Rules\n\n${legacy}`);
      }
    }
  }

  // Skill instructions — injected between context and base instruction
  if (skillInstructions && skillInstructions.length > 0) {
    for (const { name, instruction } of skillInstructions) {
      sections.push(`## Skill: ${name}\n\n${instruction}`);
    }
  }

  if (sections.length === 0) return baseInstruction;
  return `${sections.join("\n\n---\n\n")}\n\n---\n\n${baseInstruction}`;
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

  // Claude evaluates which condition matches — include input so conditions
  // can reference workflow-level flags like dryRun
  const context: Record<string, unknown> = {
    input,
    ...Object.fromEntries([...results.entries()].map(([k, v]) => [k, v.data])),
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
