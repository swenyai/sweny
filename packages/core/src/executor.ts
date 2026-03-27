/**
 * DAG Workflow Executor
 *
 * Walks a workflow graph node-by-node. At each node, Claude gets
 * the node's instruction + available skill tools + context from
 * prior nodes. Claude does the work, then the executor resolves
 * which edge to follow next.
 *
 * This replaces ~8k lines of engine + recipe step code.
 */

import type { Workflow, Skill, Tool, Claude, Observer, NodeResult, Logger, ToolContext, ConfigField } from "./types.js";
import { consoleLogger } from "./types.js";

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
}

/**
 * Execute a workflow from entry to completion.
 *
 * Returns a map of node ID → result for every node that ran.
 */
export async function execute(
  workflow: Workflow,
  input: unknown,
  options: ExecuteOptions,
): Promise<Map<string, NodeResult>> {
  const { skills, claude, observer } = options;
  const config = resolveConfig(skills, options.config);
  const logger = options.logger ?? consoleLogger;
  const results = new Map<string, NodeResult>();

  validate(workflow, skills);

  safeObserve(observer, { type: "workflow:start", workflow: workflow.id }, logger);

  let currentId: string | null = workflow.entry;

  while (currentId) {
    const node = workflow.nodes[currentId];
    if (!node) throw new Error(`Unknown node: "${currentId}"`);

    safeObserve(observer, { type: "node:enter", node: currentId, instruction: node.instruction }, logger);
    logger.info(`→ ${node.name}`, { node: currentId });

    // Gather tools from the node's skills
    const tools = resolveTools(node.skills, skills);

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
    const instruction = buildNodeInstruction(node.instruction, input);

    // Run Claude on this node
    const result = await claude.run({
      instruction,
      context,
      tools: trackedTools,
      outputSchema: node.output,
      onProgress: (message) => {
        safeObserve(observer, { type: "node:progress", node: currentId!, message }, logger);
      },
    });

    results.set(currentId, result);
    safeObserve(observer, { type: "node:exit", node: currentId, result }, logger);
    logger.info(`  ✓ ${result.status}`, { node: currentId, toolCalls: result.toolCalls.length });

    // Resolve next node via edge conditions
    currentId = await resolveNext(workflow, currentId, results, claude, observer);
  }

  safeObserve(
    observer,
    {
      type: "workflow:end",
      results: Object.fromEntries(results),
    },
    logger,
  );

  return results;
}

// ─── Internals ───────────────────────────────────────────────────

/**
 * Build the full instruction for a node by prepending rules and context.
 * Rules get "You MUST follow" framing; context gets "Background" framing.
 * Falls back to legacy `additionalContext` if rules/context aren't set.
 */
function buildNodeInstruction(baseInstruction: string, input: unknown): string {
  const inp = input as Record<string, unknown> | null;
  if (!inp) return baseInstruction;

  const sections: string[] = [];

  // New structured format
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

  if (sections.length === 0) return baseInstruction;
  return `${sections.join("\n\n")}\n\n---\n\n${baseInstruction}`;
}

/** Call observer without letting exceptions crash the workflow */
function safeObserve(observer: Observer | undefined, event: any, logger?: Logger): void {
  if (!observer) return;
  try {
    observer(event);
  } catch (err: any) {
    (logger ?? consoleLogger).warn(`Observer error (non-fatal): ${err.message}`);
  }
}

function resolveTools(skillIds: string[], skills: Map<string, Skill>): Tool[] {
  return skillIds
    .map((id) => skills.get(id))
    .filter((s): s is Skill => s != null)
    .flatMap((s) => s.tools);
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
 */
async function resolveNext(
  workflow: Workflow,
  current: string,
  results: Map<string, NodeResult>,
  claude: Claude,
  observer?: Observer,
): Promise<string | null> {
  const outEdges = workflow.edges.filter((e) => e.from === current);

  if (outEdges.length === 0) return null;

  // Single unconditional edge — just follow it
  if (outEdges.length === 1 && !outEdges[0].when) {
    safeObserve(observer, { type: "route", from: current, to: outEdges[0].to, reason: "only path" });
    return outEdges[0].to;
  }

  // Check for a default (unconditional) edge among conditionals
  const defaultEdge = outEdges.find((e) => !e.when);
  const conditionalEdges = outEdges.filter((e) => e.when);

  // Claude evaluates which condition matches
  const context = Object.fromEntries([...results.entries()].map(([k, v]) => [k, v.data]));

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

  safeObserve(observer, {
    type: "route",
    from: current,
    to: resolved,
    reason: choices.find((c) => c.id === resolved)?.description ?? "default",
  });

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
