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
  NodeToolFilter,
  Skill,
  SkillDefinition,
  McpServerConfig,
  Tool,
  Claude,
  Observer,
  NodeResult,
  NodeUsage,
  Logger,
  ToolContext,
  ConfigField,
  ExecutionEvent,
  ExecutionTrace,
  ExecutionResult,
  JSONSchema,
  Source,
  ResolvedSource,
  EvalResult,
} from "./types.js";
import { consoleLogger } from "./types.js";
import { resolveSources } from "./source-resolver.js";
import { evaluateAll, aggregateEval } from "./eval/index.js";
import type { AggregateOutcome } from "./eval/index.js";
import { evaluateRequires } from "./requires.js";
import { evaluateExpression, isWhenExpression, parseExpression, whenLabel } from "./when.js";
import type { ExpressionResult, ExpressionScope } from "./when.js";
import { buildRetryPreamble } from "./retry.js";
import { resolveExecutionModel } from "./model.js";
import { buildToolAliases } from "./skills/index.js";
import { validateWorkflow } from "./schema.js";
import { grantedAgentEnv, resolveAgentAccess } from "./agent-env.js";
import { gitCredentialWarning, scanGitCredentials } from "./git-credentials.js";
// #473: the sweny-side branch push in `github_create_pr` (Node only; skills/ stays browser-safe).
import { bindBranchPusher } from "./skills/git-push.js";
import { trustedEnvValue } from "./startup-env.js";
import { fenceUntrusted } from "./untrusted.js";
import { asClaude } from "./harness/compat.js";
import { budgetGate, isToolClass, policyGate, resolveHarnessPolicy } from "./harness/policy.js";
import type { HarnessPolicyMode } from "./harness/policy.js";
import type { AgentHarness } from "./harness/types.js";
import { BudgetGuard, describeOverrun, minLimits, spendOf, toLimits } from "./budget.js";
import { createShadowDecider, finishShadowDecision, startShadowDecision } from "./decider.js";
import type { DeciderMode, ShadowDecider } from "./decider.js";
import type { Budget, BudgetOverrun } from "./budget.js";
import { buildNodePolicy, resolveNodePermissions } from "./node-policy.js";
import {
  applySafeOutputs,
  createEmitOutputTool,
  createWriteStageState,
  resolveActor,
  safeOutputsInstruction,
  unresolvedOutputs,
  SAFE_OUTPUT_SCREEN_INSTRUCTION,
  type ActorInfo,
  type SafeOutputIntent,
} from "./safe-outputs.js";
import { JournalWriteError, type ExecutionJournal, type JournalReplay } from "./journal.js";

export interface ExecuteOptions {
  /** Registered skills (id → Skill) */
  skills: Map<string, Skill>;
  /** Config values — env vars + explicit overrides */
  config?: Record<string, string>;
  /**
   * The agent harness that runs nodes (`createHarness("claude-code")`).
   * Required unless the deprecated `claude` option is given.
   */
  harness?: AgentHarness;
  /**
   * Claude client.
   * @deprecated Pass `harness`. Still accepted (see `claudeCompat()`); when both are set, `harness` wins.
   */
  claude?: Claude;
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
  /**
   * When set, `file:` Sources are sandboxed to this directory tree: a `file:`
   * source that resolves outside it (via `..` traversal, an absolute path, or a
   * symlink pointing out) is rejected with `SOURCE_FILE_OUTSIDE_ROOT`. The
   * sandbox is opt-in: when unset, `file:` sources may read anywhere on disk
   * (default), preserving the read-anywhere behavior workflow authors rely on
   * for files elsewhere in their own repo / machine.
   */
  fileRoot?: string;
  /**
   * Workflow-level hard cap on total node executions (the number of times the
   * main loop visits a node). Guards against unbounded cycles, e.g. a back-edge
   * with no `max_iterations` or an LLM route evaluator that keeps choosing the
   * loop-back edge. Defaults to {@link DEFAULT_MAX_STEPS}. When exceeded the
   * executor throws a clear "step budget exceeded" error rather than hanging.
   * Per-edge `max_iterations` behavior is unchanged.
   */
  max_steps?: number;
  /**
   * Caller-supplied abort signal. When it aborts, `execute()` rejects promptly
   * and issues no further node / eval / route model calls. The signal is also
   * threaded into every `claude.run` / `claude.evaluate` / `claude.ask` call so
   * the underlying query is interrupted rather than left running detached.
   * Default: no signal (back-compat).
   */
  signal?: AbortSignal;
  /**
   * Per-model-call wall-clock budget in ms, forwarded to every `claude.run` /
   * `claude.evaluate` / `claude.ask` call. This is a per-call timeout, not a
   * whole-run budget. Default: no timeout (back-compat).
   */
  timeoutMs?: number;
  /**
   * Safe outputs (#365): preview every write and apply none (CLI `--stage`).
   * A dry run always stages. Default: false.
   */
  stageOutputs?: boolean;
  /**
   * Who triggered the run, for `safe_outputs.trusted_actors` /
   * `trusted_associations`. Default: `GITHUB_ACTOR` and the author
   * association in the `GITHUB_EVENT_PATH` payload.
   */
  actor?: ActorInfo;
  /**
   * Run journal (#363): an append-only record of the run for `sweny workflow
   * resume`. In resume mode it also replays the visits an earlier attempt
   * finished, so their agents are not called again. Default: none.
   */
  journal?: ExecutionJournal;
  /**
   * Run-wide spend ceiling (#449), tightening `workflow.budget` (the lowest of
   * the two wins per unit). CLI: `--max-tokens`, `--max-cost`. Default: none.
   */
  budget?: Budget;
  /**
   * `strict` refuses a node whose spend budget the harness cannot enforce at
   * all (cost on Codex). Default: {@link resolveHarnessPolicy} from the run env.
   */
  harnessPolicy?: HarnessPolicyMode;
  /**
   * Override `workflow.decider.mode` (CLI `--decider`). `shadow` still needs
   * `decider.provider` in the workflow; there is no default URL. Default: the
   * workflow's own mode, else off (zero HTTP calls).
   */
  decider?: DeciderMode;
}

/**
 * Default workflow-level step budget. Counts total node executions across the
 * whole run (loop iterations included). Generous enough for legitimate deep
 * workflows with controlled cycles, tight enough to terminate a runaway loop
 * before it burns meaningful model spend.
 */
export const DEFAULT_MAX_STEPS = 200;

/** Abort/timeout plumbing threaded into routing model calls. */
interface AbortOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Shadow-mode decision model (#357). Observes route choices, never changes them. */
  shadow?: ShadowDecider | null;
}

/**
 * Throw a clear "workflow aborted" error if the caller's signal has aborted.
 * Used at the top of the run loop and before issuing any further model call so
 * an aborted run stops promptly instead of advancing to the next node.
 */
function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error("workflow aborted");
  }
}

/**
 * Execute a workflow from entry to completion.
 *
 * Returns an ExecutionResult with:
 * - `results`: map of node ID → final result (last execution if retried)
 * - `trace`: full ordered execution trace including loops and routing decisions
 */
export async function execute(workflow: Workflow, input: unknown, options: ExecuteOptions): Promise<ExecutionResult> {
  const results = new Map<string, NodeResult>();
  const trace: ExecutionTrace = { steps: [], edges: [], sources: {} };
  const at: VisitCursor = { node: null, iteration: 0 };
  // Resume of a journal an uncontained agent could have edited: the receipt says so.
  const journalDegraded = () => {
    const extra = options.journal?.degraded?.() ?? [];
    if (extra.length === 0) return;
    for (const [id, r] of results) results.set(id, { ...r, degraded: [...new Set([...(r.degraded ?? []), ...extra])] });
  };
  try {
    const out = await executeRun(workflow, input, options, results, trace, at);
    journalDegraded();
    return out;
  } catch (err) {
    // Resume (#363): a journal that cannot record the run stops it. The node
    // fails with the reason; nothing after it runs (no model call, no write).
    if (!(err instanceof JournalWriteError) || at.node === null) throw err;
    const logger = options.logger ?? consoleLogger;
    const result: NodeResult = {
      ...(results.get(at.node) ?? { toolCalls: [] }),
      status: "failed",
      data: { ...(results.get(at.node)?.data ?? {}), error: err.message, journal_failed: true },
    };
    results.set(at.node, result);
    trace.steps.push({ node: at.node, status: "failed", iteration: at.iteration });
    safeObserve(options.observer, { type: "node:exit", node: at.node, result }, logger);
    logger.error(`  ${err.message}`, { node: at.node });
    journalDegraded();
    safeObserve(options.observer, { type: "workflow:end", results: Object.fromEntries(results) }, logger);
    return { results, trace };
  }
}

/** The visit the executor is on, for {@link execute}'s journal-failure stop. */
interface VisitCursor {
  node: string | null;
  iteration: number;
}

async function executeRun(
  workflow: Workflow,
  input: unknown,
  options: ExecuteOptions,
  results: Map<string, NodeResult>,
  trace: ExecutionTrace,
  at: VisitCursor,
): Promise<ExecutionResult> {
  const { observer, signal, timeoutMs, journal } = options;
  // `harness` is the seam; a legacy `claude` object is used as-is (what `asClaude(claudeCompat(claude))` yields).
  const claude: Claude = options.harness ? asClaude(options.harness) : (options.claude as Claude);
  if (!claude) {
    throw new Error("execute() needs options.harness (or the deprecated options.claude)");
  }

  // If the caller already aborted before we started, fail fast.
  throwIfAborted(signal);

  const dryRun = isDryRunInput(input);

  // Merge inline workflow skills into the skill map so they resolve at runtime.
  // Inline skills (instruction/mcp only) become Skill objects with empty tools/config.
  // The caller's skill map takes precedence — inline skills only fill gaps.
  const skills = mergeInlineSkills(options.skills, workflow.skills);

  const config = resolveConfig(skills, options.config, options.env ?? process.env);
  const logger = options.logger ?? consoleLogger;
  const edgeCounts = new Map<string, number>(); // "from→to" → times followed
  const nodeRunCounts = new Map<string, number>(); // node → times executed
  const maxSteps = options.max_steps ?? DEFAULT_MAX_STEPS;
  let stepCount = 0; // total node executions across the run (loop iterations included)

  validate(workflow, skills);

  // Safe outputs (#365): run-wide caps and dedupe, the staged switch and the
  // triggering actor, resolved once per run.
  const writeState = createWriteStageState();
  const stageOutputs = dryRun || options.stageOutputs === true || workflow.safe_outputs?.staged === true;
  const runEnv = options.env ?? process.env;
  const usesOutputs = Object.values(workflow.nodes).some((n) => (n.outputs?.length ?? 0) > 0);
  const actor: ActorInfo = usesOutputs ? resolveActor(runEnv, options.actor) : {};
  // The run input, for `number: { input }` issue pins on outputs.
  const runInput = input && typeof input === "object" ? (input as Record<string, unknown>) : undefined;
  // Spend budgets (#449): the run ceiling is the lower of the workflow's
  // `budget` and the caller's (`--max-tokens`, `--max-cost`).
  const budgetGuard = new BudgetGuard(minLimits(toLimits(workflow.budget), toLimits(options.budget)));
  const harnessPolicy = options.harnessPolicy ?? resolveHarnessPolicy(runEnv);
  // #473: a checkout that persisted a git credential (actions/checkout's
  // default). Each harness masks it for read-only and staged nodes, or reports
  // the node degraded; this says so once per run. Paths and keys, never values.
  try {
    // The run's checkout (ExecuteOptions.cwd), not the embedding process's cwd.
    const credentialWarning = gitCredentialWarning(scanGitCredentials(options.cwd ?? process.cwd(), { env: runEnv }));
    if (credentialWarning) logger.warn(credentialWarning);
  } catch {
    // A scan failure never stops a run; each node scans again before it starts.
  }
  // Decision model (#357): shadow only. Null (the default) means no HTTP at all.
  const shadow = createShadowDecider(workflow.decider, options.decider, runEnv, (m) => logger.warn(m));
  if (shadow) trace.decisions = shadow.records;

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

  const resolveCwd = options.cwd ?? process.cwd();
  // #473: the PR head push runs in this run's checkout, never process.cwd() of
  // an embedding process. Tools get it through ToolContext.
  const pushBranch = bindBranchPusher(resolveCwd, runEnv);
  // GHES: the REST base for the github skill, never a value the workspace .env introduced.
  const githubApiUrl = trustedEnvValue(runEnv, "GITHUB_API_URL") || undefined;
  const resolvedSources = await resolveSources(sourceMap, {
    cwd: resolveCwd,
    env: options.env ?? process.env,
    authConfig: options.fetchAuth ?? {},
    offline: options.offline ?? false,
    // Opt-in `file:` sandbox: only engaged when the caller sets `fileRoot`.
    // When unset, `file:` sources read anywhere on disk (default).
    fileRoot: options.fileRoot,
    logger,
  });
  trace.sources = resolvedSources;
  journal?.begin({
    workflow,
    input,
    sources: resolvedSources,
    skills,
    config,
    writeState,
    harnessId: options.harness?.id,
  });
  // Resume (#363): the run budget is the logical run's, so it starts from what
  // earlier attempts already spent, not from zero.
  const priorSpend = journal?.priorSpend?.();
  if (priorSpend) budgetGuard.seed(priorSpend);
  safeObserve(observer, { type: "workflow:start", workflow: workflow.id }, logger);
  safeObserve(observer, { type: "sources:resolved", sources: resolvedSources }, logger);

  let currentId: string | null = workflow.entry;

  while (currentId) {
    // Abort before issuing the next node/eval/route model call. Aborting the
    // signal mid-run makes execute() reject promptly rather than advancing.
    throwIfAborted(signal);

    const node = workflow.nodes[currentId];
    if (!node) throw new Error(`Unknown node: "${currentId}"`);

    // Workflow-level hard cap. Per-edge max_iterations bounds individual
    // back-edges, but a self-loop (or LLM route) with no max_iterations is
    // otherwise unbounded. This budget terminates the run loudly instead of
    // hanging CI / the action and burning model spend.
    stepCount++;
    if (stepCount > maxSteps) {
      throw new Error(
        `step budget exceeded: workflow '${workflow.id}' ran ${stepCount} steps (max_steps: ${maxSteps}). ` +
          `This usually means an unbounded cycle, e.g. a back-edge with no 'max_iterations' or a route that keeps ` +
          `looping. Add 'max_iterations' to the offending edge or raise 'max_steps' if the workflow legitimately ` +
          `needs more steps.`,
      );
    }

    const iteration: number = (nodeRunCounts.get(currentId) ?? 0) + 1;
    nodeRunCounts.set(currentId, iteration);
    at.node = currentId;
    at.iteration = iteration;

    const resolvedInstruction = resolvedSources[`nodes.${currentId}.instruction`].content;
    safeObserve(observer, { type: "node:enter", node: currentId, instruction: resolvedInstruction }, logger);
    logger.info(`→ ${node.name}`, { node: currentId });

    // Resume (#363): a visit an earlier attempt finished is replayed from the journal, not re-run.
    const replay: JournalReplay | undefined = journal?.replay(currentId, iteration);
    if (replay?.kind === "complete") {
      results.set(currentId, replay.result);
      trace.steps.push({ node: currentId, status: replay.result.status, iteration });
      safeObserve(observer, { type: "node:exit", node: currentId, result: replay.result }, logger);
      logger.info(`  replayed from the run journal: ${replay.result.status}`, { node: currentId });
      const from: string = currentId;
      if (replay.next === undefined) {
        currentId = await advanceFromNode(workflow, from, results, input, claude, observer, edgeCounts, logger, trace, {
          signal,
          timeoutMs,
        });
        journal?.route(from, currentId);
      } else {
        if (replay.next !== null) {
          const key = `${from}→${replay.next}`;
          const edge = workflow.edges.find((e) => e.from === from && e.to === replay.next);
          const taken = (edgeCounts.get(key) ?? 0) + 1;
          // A replayed route must be a real edge its max_iterations still allows.
          if (!edge || (edge.max_iterations !== undefined && taken > edge.max_iterations)) {
            throw new Error(
              `run journal routes ${from} -> ${replay.next}, which ${edge ? "exceeds the edge's max_iterations" : "is not an edge of this workflow"}; refusing to replay it`,
            );
          }
          edgeCounts.set(key, taken);
          const reason = whenLabel(edge.when) ?? "only path";
          trace.edges.push({ from, to: replay.next, reason });
        }
        safeObserve(observer, { type: "route", from, to: replay.next ?? "(end)", reason: "replayed" }, logger);
        currentId = replay.next;
      }
      continue;
    }
    journal?.nodeStart(currentId, iteration);

    // Gather tools from the node's skills, then apply the node's optional
    // skill-tool filter (`tools.allow` / `tools.deny`). Filtered tools are
    // never registered for the run, so the model cannot see or call them.
    const resolvedSkillTools = resolveTools(node.skills, skills);
    const filteredTools = filterNodeTools(resolvedSkillTools, node.tools, currentId, logger);
    // Dry run (#380): only `access: "read"` tools reach the node. Write and
    // unclassified tools are withheld (never registered, so never callable)
    // and recorded on the node result as `skippedWrites`.
    // #365: `permissions: read` (explicit, inherited, or implied by `outputs`)
    // gets the same tool gate as a dry run.
    const permissions = resolveNodePermissions(node, workflow);
    const declaresPolicy =
      node.permissions !== undefined || workflow.permissions !== undefined || (node.outputs?.length ?? 0) > 0;
    const readOnlyNode = dryRun || permissions.access === "read";
    // A staged run (--stage, safe_outputs.staged) writes nothing either: its
    // write tools are withheld too, and the dispatcher below refuses any that
    // still reach a handler.
    const readTools = readOnlyNode || stageOutputs ? filteredTools.filter(isReadTool) : filteredTools;
    // A staged write node records what it lost, like a dry run.
    const stagedWriteNode = stageOutputs && !readOnlyNode;
    const skippedWrites =
      dryRun || stagedWriteNode ? filteredTools.filter((t) => !isReadTool(t)).map((t) => t.name) : [];
    if (skippedWrites.length > 0) {
      const why = dryRun ? "dry run" : "staged";
      logger.info(`  ${why}: withheld write tools: ${skippedWrites.join(", ")}`, { node: currentId });
    } else if (readOnlyNode && readTools.length < filteredTools.length) {
      const withheld = filteredTools.filter((t) => !isReadTool(t)).map((t) => t.name);
      logger.info(`  permissions: read: withheld write tools: ${withheld.join(", ")}`, { node: currentId });
    }
    // Safe outputs (#365): the agent records write intents with emit_output;
    // the write stage after the node applies them. One buffer per attempt.
    const outputDecls = node.outputs ?? [];
    const intents: SafeOutputIntent[] = [];
    const tools = outputDecls.length > 0 ? [...readTools, createEmitOutputTool(outputDecls, intents)] : readTools;
    if (outputDecls.length > 0 && !stageOutputs) {
      const missing = unresolvedOutputs(outputDecls, node.skills, skills);
      if (missing.length > 0) {
        throw new Error(
          `Node "${currentId}" declares outputs [${missing.join(", ")}] but no configured skill can apply them ` +
            `(github or linear). Set the skill's environment variables, or run with --stage to preview.`,
        );
      }
    }
    const skillInstructions = resolveSkillInstructions(node.skills, skills);
    const skillMcpServers = resolveSkillMcpServers(node.skills, skills, config);

    // Runtime guard: if this node declares skills but none resolved, the node
    // cannot do its job (e.g. "create a Linear issue" with no linear skill).
    // The startup validate() warns about this possibility, but only throw when
    // the node is actually reached — unreachable nodes with missing skills are fine.
    // Instruction-only and resolved MCP-only skills are valid capabilities.
    if (
      node.skills.length > 0 &&
      resolvedSkillTools.length === 0 &&
      skillInstructions.length === 0 &&
      Object.keys(skillMcpServers).length === 0
    ) {
      throw new Error(
        `Node "${currentId}" requires skills [${node.skills.join(", ")}] but none are configured. ` +
          `Set the required environment variables and try again.`,
      );
    }

    // Build context: input + all prior node results.
    // Each prior node entry is the node's `data` augmented with `evals`
    // (a Record<name, EvalResult> for downstream lookup like
    // `priorNode.evals.tests_run_clean.pass`). This namespace is reserved
    // for runtime verdicts; an agent-provided `data.evals` never overrides it.
    // `requires` always reads this full map: it is a deterministic gate, not
    // a prompt, so it costs no tokens and keeps every declared path working.
    const requiresContext: Record<string, unknown> = {
      input,
      ...Object.fromEntries([...results.entries()].map(([k, v]) => [k, buildPriorNodeContext(v)])),
    };
    // What the model sees (#337): only nodes this one can depend on, and a
    // schema'd node's declared fields instead of its prose. `context_mode:
    // full` keeps the old everything-prior map.
    const context: Record<string, unknown> =
      workflow.context_mode === "full"
        ? requiresContext
        : buildBoundedContext(workflow, currentId, results, input, resolvedInstruction);

    // Pre-condition gate: evaluate `requires` against the cross-node context
    // BEFORE invoking the LLM. Failure either marks the node failed (on_fail
    // default) or skipped (on_fail: "skip") and skips execution entirely.
    const requiresError = evaluateRequires(node.requires, requiresContext);
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
      journal?.nodeEnd(currentId, iteration, result, writeState);
      trace.steps.push({ node: currentId, status: result.status, iteration });
      safeObserve(observer, { type: "node:exit", node: currentId, result }, logger);
      logger.warn(`  requires ${onFail === "skip" ? "skipped" : "failed"}: ${requiresError}`, { node: currentId });

      // Fail closed here too: a requires failure with on_fail: fail yields a
      // failed node, which halts by default (same policy as a failed run).
      if (result.status === "failed" && (node.on_fail ?? "halt") === "halt") {
        logger.warn(`  requires failed; halting workflow (on_fail: halt)`, { node: currentId });
        safeObserve(
          observer,
          { type: "route", from: currentId, to: "(end)", reason: "node failed (on_fail: halt)" },
          logger,
        );
        break;
      }

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
        { signal, timeoutMs, shadow },
      );
      journal?.route(currentId, next);
      currentId = next;
      continue;
    }

    // Wrap tool handlers to emit events + inject context
    const trackedTools = tools.map((t) => ({
      ...t,
      handler: async (toolInput: any) => {
        safeObserve(observer, { type: "tool:call", node: currentId!, tool: t.name, input: toolInput }, logger);
        guardStagedWrite(t, stageOutputs);
        const toolCtx: ToolContext = {
          config,
          logger,
          cwd: resolveCwd,
          staged: stageOutputs,
          pushBranch,
          ...(githubApiUrl ? { githubApiUrl } : {}),
        };
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
    const baseInstruction = buildNodeInstruction(
      resolvedInstruction,
      effectiveRules,
      effectiveContext,
      input,
      skillInstructions,
    );
    const nodeInstruction =
      outputDecls.length > 0
        ? `${baseInstruction}\n\n${safeOutputsInstruction(outputDecls, runInput)}`
        : baseInstruction;
    const instruction = dryRun
      ? `${dryRunNotice(skippedWrites)}\n\n---\n\n${nodeInstruction}`
      : skippedWrites.length > 0
        ? `${stagedNotice(skippedWrites)}\n\n---\n\n${nodeInstruction}`
        : nodeInstruction;

    // Run Claude on this node, with optional eval-failure retry loop.
    let attempt = 0;
    let result: NodeResult;
    // Distinguishes an agent-level failure (claude.run returned non-success:
    // max turns, early termination, SDK error) from an eval failure. Only
    // agent-level failures are eligible for fail_soft below; evals are
    // correctness gates and are never softened.
    let agentRunFailed = false;
    let currentInstruction = instruction;
    const retry = node.retry;
    // Per-node execution model: node.model ?? workflow.model. When undefined,
    // claude.run falls back to its own client default (then Claude Code's).
    const nodeModel = resolveExecutionModel(node, workflow);
    // `tools.deny` entries that name a portable class (shell, write, edit, net,
    // subagent) also deny that class of built-in agent tools; the harness
    // compiles them or reports them in `degraded`.
    const denyClasses = (node.tools?.deny ?? []).filter(isToolClass);
    let degradedLogged = false;
    // #442: a staged or dry run cannot push. The harness blocks git push and
    // withholds write tokens in this node's agent env (see withPushBlocked).
    // Skill credentials stay in sweny: the agent gets only what the node grants
    // with `agent_env`, never on a read-only node or in a staged run.
    const granted = grantedAgentEnv(node.agent_env, { readOnly: readOnlyNode, staged: stageOutputs });
    if (granted.dropped) logger.warn(`  ${granted.dropped}`, { node: currentId });
    const agentAccess = {
      ...resolveAgentAccess(node.skills, skills, granted.grant),
      // A staged run loads no skill or external MCP server either: it may write.
      ...(stageOutputs ? { noPush: true, noMcp: true } : {}),
    };
    // #365: a node or workflow that declares `permissions` or `outputs` gets
    // one portable policy, compiled by each adapter. The gate also runs here so
    // a strict refusal holds on every harness, before any spend. Nodes that
    // declare neither pass no policy, so each harness keeps its own defaults.
    const nodePolicy = declaresPolicy
      ? buildNodePolicy({
          permissions: { ...permissions, deny: [...new Set([...permissions.deny, ...denyClasses])] },
          dryRun,
          disallowedTools: node.disallowed_tools,
          egress: agentAccess.domains,
        })
      : undefined;
    // Egress is left to the adapter: only it knows whether a process sandbox
    // wrapper covers what its native sandbox cannot.
    const gate =
      nodePolicy && options.harness
        ? policyGate(options.harness.capabilities, { ...nodePolicy, egress: [] })
        : undefined;

    // Spend budgets (#449): this node's own limits plus what is left of the
    // run's. The gate says whether the harness can keep them; a strict policy
    // refuses the node when it cannot report the budgeted unit at all.
    const nodeBudget = budgetGuard.node(toLimits(node.budget));
    const budgetOn = budgetGuard.active(nodeBudget.limits);
    const budgetCheck =
      budgetOn && options.harness
        ? budgetGate(
            options.harness.capabilities,
            minLimits(nodeBudget.limits, budgetGuard.runLimits),
            permissions.strict || harnessPolicy === "strict",
          )
        : undefined;
    // A budget stop: fail_soft and on_fail: continue never apply, the run halts.
    let budgetStop: BudgetOverrun | undefined;
    let previous: NodeResult | undefined;

    while (true) {
      if (replay?.kind === "checkpoint") {
        // Resume (#363): the agent finished this visit before the crash. Reuse its result and
        // write intents; the write stage below skips what the journal shows was already applied.
        ({ result, agentRunFailed, attempt } = replay);
        intents.push(...replay.intents);
        break;
      }
      const refusal = gate?.refuse ?? budgetCheck?.refuse;
      if (refusal) {
        // Not an agent failure: fail_soft never softens a policy refusal.
        logger.warn(`  harness refused the node: ${refusal}`, { node: currentId });
        result = {
          status: "failed",
          data: { error: refusal, refused: true },
          toolCalls: [],
          degraded: [...(gate?.degraded ?? []), ...(budgetCheck?.degraded ?? [])],
        };
        break;
      }
      // No attempt may start once a ceiling is reached (the run's budget spent
      // by earlier nodes, or this node's by an earlier attempt).
      const spent = budgetOn ? nodeBudget.exhausted() : undefined;
      if (spent) {
        const error = describeOverrun(spent, currentId);
        logger.warn(`  ${error}; not starting the node`, { node: currentId });
        result = {
          ...(previous ?? { toolCalls: [] }),
          status: "failed",
          data: { ...(previous?.data ?? {}), error, budget_exceeded: true },
          budget: spent,
        };
        agentRunFailed = true;
        budgetStop = spent;
        break;
      }
      // Only the final attempt's intents may be applied.
      intents.length = 0;
      const attemptBudget = budgetOn ? nodeBudget.attempt(signal) : undefined;
      // Resume (#363): spend is journaled as it is reported, so a crash mid-node
      // does not hand the resumed run a fresh budget.
      const usageNode: string = currentId;
      const usageAttempt = attempt;
      let liveUsage: NodeUsage | undefined;
      // A live usage record the journal cannot write stops the agent at once:
      // its spend would be invisible to a resume.
      let journalFault: unknown;
      const journalStop = journal?.usage ? new AbortController() : undefined;
      const parentSignal = attemptBudget?.signal ?? signal;
      const onParentAbort = () => journalStop?.abort(parentSignal?.reason);
      if (journalStop && parentSignal) {
        if (parentSignal.aborted) journalStop.abort(parentSignal.reason);
        else parentSignal.addEventListener("abort", onParentAbort, { once: true });
      }
      const journalUsage = journal?.usage
        ? (u: NodeUsage) => {
            liveUsage = { ...liveUsage, ...u };
            if (journalFault) return;
            try {
              journal!.usage!(usageNode, iteration, usageAttempt, liveUsage, false);
            } catch (err) {
              journalFault = err;
              journalStop?.abort(err);
            }
          }
        : undefined;
      const onUsage =
        attemptBudget || journalUsage
          ? (u: NodeUsage) => {
              attemptBudget?.onUsage(u);
              journalUsage?.(u);
            }
          : undefined;
      try {
        result = await claude.run({
          nodeId: currentId,
          instruction: currentInstruction,
          context,
          tools: trackedTools,
          outputSchema: node.output,
          maxTurns: node.max_turns,
          disallowedTools: node.disallowed_tools,
          ...(denyClasses.length > 0 ? { deny: denyClasses } : {}),
          model: nodeModel,
          signal: journalStop?.signal ?? parentSignal,
          timeoutMs,
          agentAccess,
          ...(nodePolicy ? { policy: nodePolicy } : {}),
          ...(readOnlyNode || stageOutputs ? {} : { mcpServers: skillMcpServers }),
          ...(readOnlyNode ? { readOnly: true } : {}),
          ...(onUsage ? { onUsage } : {}),
          onProgress: (message) => {
            safeObserve(observer, { type: "node:progress", node: currentId!, message }, logger);
          },
        });
      } catch (err) {
        if (journalFault) throw journalFault;
        // The attempt ended abnormally (abort, timeout, harness error): whether its agent was
        // contained is unknown, so the journal says it was not.
        journal?.uncontained?.(usageNode, iteration);
        throw err;
      } finally {
        parentSignal?.removeEventListener("abort", onParentAbort);
        attemptBudget?.dispose();
      }
      if (journalFault) throw journalFault;
      // Key secrecy (and so the journal's spend and write records) holds only for a contained agent.
      if (result.contained !== true && (result.data as Record<string, unknown> | undefined)?.refused !== true) {
        journal?.uncontained?.(usageNode, iteration);
      }
      previous = result;
      // The attempt's final spend: the larger of the result's usage and the last live report, per unit.
      if (journal?.usage) {
        const finalSpend = spendOf(result.usage);
        const seen = spendOf(liveUsage);
        const tokens = Math.max(finalSpend.tokens ?? 0, seen.tokens ?? 0);
        const costUsd = Math.max(finalSpend.costUsd ?? 0, seen.costUsd ?? 0);
        if (finalSpend.tokens !== undefined || finalSpend.costUsd !== undefined || liveUsage) {
          journal.usage(usageNode, iteration, usageAttempt, { inputTokens: tokens, outputTokens: 0, costUsd }, true);
        }
      }

      if (budgetCheck && budgetCheck.degraded.length > 0) {
        result = { ...result, degraded: [...new Set([...(result.degraded ?? []), ...budgetCheck.degraded])] };
      }
      if (attemptBudget) {
        // Commit this attempt's spend; a live stop, or a crossing visible only
        // in the final usage, fails the node whatever else it did.
        const breach = attemptBudget.finish(result.usage);
        if (breach) {
          const error = describeOverrun(breach, currentId);
          logger.warn(`  ${error}`, { node: currentId });
          const usage = result.usage ?? attemptBudget.lastUsage;
          result = {
            ...result,
            status: "failed",
            data: { ...result.data, error, budget_exceeded: true },
            ...(usage ? { usage } : {}),
            budget: breach,
          };
          agentRunFailed = true;
          budgetStop = breach;
          break;
        }
      }

      // Opinions the harness could not honor natively: said once per node, never silently dropped.
      if (!degradedLogged && result.degraded && result.degraded.length > 0) {
        degradedLogged = true;
        const who = result.harness?.id ?? "harness";
        logger.warn(`  ${who} could not honor natively: ${result.degraded.join("; ")}`, { node: currentId });
      }

      // Retry only triggers on eval failure. Bail on tool/API errors.
      if (result.status !== "success") {
        agentRunFailed = true;
        break;
      }

      // Required-field gate: if the source node's declared output schema
      // marks fields as `required`, those fields are the routing contract.
      // An agent that omits a required field has violated the contract; we
      // fail the node loudly rather than letting routing guess against a
      // half-built data view. See the offload release-notes field bug:
      // an optional quality_retry_count was declared in the schema but
      // omitted by the agent, the route view silently dropped the key,
      // and an "is 0 OR is undefined" condition ghost-matched.
      //
      // We only check declared `required` fields, not full JSON Schema
      // validation. Type mismatches, formats, additionalProperties, etc.
      // stay the workflow author's problem and don't have the same
      // routing-correctness blast radius.
      // A missing required field is a contract violation handled on the same
      // footing as an eval failure: an otherwise-recoverable one-off omission
      // should self-heal on a second attempt when the node has `retry`
      // configured. We synthesize an eval-shaped failure so the retry preamble
      // and trace bookkeeping below treat it identically. When no retry is
      // configured (or the budget is exhausted), it still hard-fails the node.
      const missingRequired = findMissingRequiredFields(result.data, node.output);

      let outcome: AggregateOutcome;
      if (missingRequired.length > 0) {
        const msg = `output schema violation: required field(s) missing from emitted data: ${missingRequired.join(", ")}`;
        const failure: EvalResult = { name: "output_required", kind: "value", pass: false, reasoning: msg };
        outcome = { pass: false, error: msg, failures: [failure] };
        // Still record the synthesized failure as the node's eval result so
        // observers and downstream context see the contract violation.
        result.evals = [failure];
      } else {
        const evalResults = await evaluateAll(node.eval, result, {
          aliases: toolAliases,
          claude,
          node,
          workflow,
        });
        result.evals = evalResults;
        outcome = aggregateEval(evalResults, node.eval_policy ?? "all_pass");
      }
      if (outcome.pass) break;

      // Apply the failure to the result.
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

      // #325: a retry attempt re-invokes the agent on this node (full model
      // spend) exactly like a fresh node visit, so it counts against the same
      // `stepCount`/`maxSteps` budget. Checked BEFORE buildRetryPreamble so no
      // paid reflection call happens once the budget is exhausted. On
      // exhaustion, record a failed result and emit node:exit so observers
      // never see node:enter without a matching node:exit.
      stepCount++;
      if (stepCount > maxSteps) {
        const budgetError =
          `step budget exceeded: workflow '${workflow.id}' ran ${stepCount} steps (max_steps: ${maxSteps}) ` +
          `while retrying node '${currentId}' (attempt ${attempt + 1}/${retry.max}). Lower 'retry.max' on the ` +
          `offending node or raise 'max_steps' if the workflow legitimately needs more steps.`;
        result = { ...result, status: "failed", data: { ...result.data, error: budgetError } };
        results.set(currentId, result);
        trace.steps.push({ node: currentId, status: "failed", iteration, retryAttempt: attempt });
        safeObserve(observer, { type: "node:exit", node: currentId, result }, logger);
        throw new Error(budgetError);
      }

      const preamble = await buildRetryPreamble({
        retry,
        evalFailures: outcome.failures,
        toolCalls: result.toolCalls,
        nodeInstruction: resolvedInstruction,
        claude,
        logger,
        context,
        model: nodeModel,
        signal,
        timeoutMs,
      });
      currentInstruction = `${preamble}\n\n---\n\n${instruction}`;
      safeObserve(
        observer,
        { type: "node:retry", node: currentId, attempt: attempt + 1, reason: outcome.error ?? "eval failed", preamble },
        logger,
      );
      attempt++;
    }

    // Fail-soft: when the node declares `fail_soft: true` and the failure was
    // agent-level (max turns, early termination, SDK error), downgrade to
    // success so the workflow proceeds with whatever partial output exists
    // instead of failing outright. The original error stays in `data.error`
    // and `data.fail_soft` marks the downgrade for downstream nodes and
    // observers. Eval failures never take this path (agentRunFailed guards it).
    // A strict-policy refusal (#331) is not an agent failure: fail_soft never softens it.
    const refused = (result.data as Record<string, unknown> | undefined)?.refused === true;
    if (agentRunFailed && result.status === "failed" && node.fail_soft === true && !refused && !budgetStop) {
      const failError = (result.data as Record<string, unknown> | undefined)?.error;
      logger.warn(
        `  fail_soft: node failed (${String(failError ?? "unknown error")}); continuing with partial output`,
        {
          node: currentId,
        },
      );
      result = {
        ...result,
        status: "success",
        data: { ...((result.data as Record<string, unknown> | undefined) ?? {}), fail_soft: true },
      };
    }

    // Safe outputs write stage (#365). Runs only after the agent finished and
    // every eval passed; deterministic checks first, an optional model screen
    // may veto, and only then does sweny call the skill's own write handler.
    if (outputDecls.length > 0) {
      if (result.status === "success" && !agentRunFailed) {
        journal?.checkpoint(currentId, iteration, { result, intents, agentRunFailed, attempt });
        const stage = await applySafeOutputs({
          nodeId: currentId,
          declarations: outputDecls,
          intents,
          policy: workflow.safe_outputs,
          nodeSkills: node.skills,
          skills: journal ? journal.wrapWrites(currentId, iteration, skills) : skills,
          config,
          env: runEnv,
          actor,
          staged: stageOutputs,
          cwd: resolveCwd,
          pushBranch,
          ...(githubApiUrl ? { githubApiUrl } : {}),
          state: writeState,
          logger,
          input: runInput,
          screen: async (writes) =>
            claude.ask({
              instruction: SAFE_OUTPUT_SCREEN_INSTRUCTION,
              context: { writes },
              model: nodeModel,
              signal,
              timeoutMs,
            }),
        });
        result = { ...result, outputs: stage.receipts };
        if (stage.error) {
          logger.warn(`  ${stage.error}`, { node: currentId });
          result = { ...result, status: "failed", data: { ...result.data, error: stage.error } };
        }
      } else if (intents.length > 0) {
        result = {
          ...result,
          outputs: intents.map((i) => ({ type: i.type, status: "skipped" as const, reason: "node did not succeed" })),
        };
      }
    }

    if (skippedWrites.length > 0) result = { ...result, skippedWrites };
    results.set(currentId, result);
    journal?.nodeEnd(currentId, iteration, result, writeState);
    trace.steps.push(
      attempt > 0
        ? { node: currentId, status: result.status, iteration, retryAttempt: attempt }
        : { node: currentId, status: result.status, iteration },
    );
    safeObserve(observer, { type: "node:exit", node: currentId, result }, logger);
    logger.info(`  ✓ ${result.status}`, { node: currentId, toolCalls: result.toolCalls.length });

    // Fail closed on node failure. A node that finishes `failed` (agent-level
    // failure, or an eval failure that exhausted retries and was not softened
    // by `fail_soft`) HALTS the workflow by default. This stops a broken node
    // from advancing down a conditional out-edge (e.g. filing an issue/PR) on
    // the back of a failure. The failed result stays in `results`, so the run
    // surfaces as failed to callers (CLI exit code, cloud status). Authors who
    // want the legacy fall-through opt in per-node with `on_fail: "continue"`.
    if (result.status === "failed" && ((node.on_fail ?? "halt") === "halt" || budgetStop)) {
      const why = budgetStop ? "budget exceeded" : "on_fail: halt";
      logger.warn(`  node failed; halting workflow (${why})`, { node: currentId });
      safeObserve(observer, { type: "route", from: currentId, to: "(end)", reason: `node failed (${why})` }, logger);
      break;
    }

    // Dry run gate + routing — shared with requires path via advanceFromNode helper.
    const routedFrom: string = currentId;
    currentId = await advanceFromNode(
      workflow,
      currentId,
      results,
      input,
      claude,
      observer,
      edgeCounts,
      logger,
      trace,
      {
        signal,
        timeoutMs,
        shadow,
      },
    );
    journal?.route(routedFrom, currentId);
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
 * Thrown when a conditional routing decision could not be made and there is
 * no explicit default (unconditional) edge to fall back to. Fails closed: the
 * executor refuses to guess an edge (the historical fail-open bug), so an LLM
 * outage terminates the run loudly instead of silently taking the first
 * conditional edge.
 */
export class RouteEvaluationError extends Error {
  constructor(
    public readonly node: string,
    message: string,
  ) {
    super(message);
    this.name = "RouteEvaluationError";
  }
}

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
    // Context Sources can be fetched pages or runtime input: fence as untrusted (#360).
    sections.push(`## Background Context\n\n${fenceUntrusted(effectiveContext, "background-context")}`);
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
 * Preserve ordinary data fields, but reserve `evals` for runtime verdicts.
 * Agent output must not forge a pass for downstream `requires` gates,
 * including when no evaluator ran (the trusted namespace is then empty).
 */
function buildPriorNodeContext(result: NodeResult): Record<string, unknown> {
  const { safe_outputs: _forged, ...data } = (result.data ?? {}) as Record<string, unknown>;
  const evals = result.evals ?? [];

  const evalsByName = Object.fromEntries(evals.map((e) => [e.name, e]));
  // Safe-output receipts (#365) are runtime facts, like evals: what sweny
  // actually wrote (type, status, ref, url). A downstream node reads the new
  // issue's identifier here. Agent data can never shadow them.
  return {
    ...data,
    evals: evalsByName,
    ...(result.outputs && result.outputs.length > 0 ? { safe_outputs: result.outputs } : {}),
  };
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
 * Downstream node prompts get a similar projection (see
 * `buildBoundedNodeEntry`), minus the null-fill, unless the workflow sets
 * `context_mode: full`.
 */
function buildRouteEvalEntry(
  result: NodeResult,
  sourceNode: Node | undefined,
): { view: Record<string, unknown>; missing: string[] } {
  const fullData = (result.data ?? {}) as Record<string, unknown>;
  const declaredProps = getDeclaredOutputProperties(sourceNode?.output);

  // When the source node declared an `output.properties` block, the routing
  // view is contract-shaped: every declared property is present in the
  // view, with an explicit `null` when the agent did not emit it. The
  // alternative (silently dropping the key) lets the LLM evaluator
  // ghost-match conditions like "is 0", "is N", or "is undefined" against
  // a structurally-absent field. That was the offload release-notes field
  // bug: an optional `quality_retry_count` declared in the schema but
  // omitted by the agent, evaluated against a condition like
  // `quality_retry_count is 0 OR is undefined`, took the wrong branch.
  //
  // Returning `missing` separately lets the caller emit a loud warning so
  // operators see the contract violation in the log stream.
  let dataView: Record<string, unknown>;
  const missing: string[] = [];
  if (declaredProps) {
    dataView = {};
    for (const k of declaredProps) {
      if (k in fullData) {
        dataView[k] = fullData[k];
      } else {
        dataView[k] = null;
        missing.push(k);
      }
    }
  } else {
    dataView = fullData;
  }

  const evals = result.evals ?? [];

  const evalsByName = Object.fromEntries(evals.map((e) => [e.name, e]));
  // Schema projection never grants agent data authority over runtime verdicts.
  return { view: { ...dataView, evals: evalsByName }, missing };
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

// ─── Bounded node context (#337) ─────────────────────────────────
//
// Full mode hands every node the whole results map: node N re-sends nodes
// 1..N-1 including each one's prose `summary`, so prompt bytes per run grow
// quadratically and one verbose node inflates every later prompt. Bounded
// mode (the default) keeps the same keys a node can depend on, and sends a
// schema'd node's declared fields only.

/** Keys the executor itself writes into data; kept when a view is projected. */
const RUNTIME_DATA_KEYS = ["error", "fail_soft", "skipped_reason"];

/**
 * The prompt-context entry for one prior node in bounded mode. A successful
 * node with a declared `output.properties` block contributes those fields
 * (plus executor-written error/fail_soft keys); everything else, including
 * the free-text `summary`, is dropped. Nodes without a schema, and nodes
 * that did not succeed, keep the full `buildPriorNodeContext` entry. The
 * trusted `evals` and `safe_outputs` namespaces always come from the runtime.
 */
function buildBoundedNodeEntry(result: NodeResult, sourceNode: Node | undefined): Record<string, unknown> {
  const full = buildPriorNodeContext(result);
  const declared = getDeclaredOutputProperties(sourceNode?.output);
  if (!declared || result.status !== "success") return full;
  const keep = new Set([...declared, ...RUNTIME_DATA_KEYS, "evals", "safe_outputs"]);
  return Object.fromEntries(Object.entries(full).filter(([k]) => keep.has(k)));
}

/** First segment of a requires path (`any:triage.findings[*].x` -> `triage`). */
function pathRoot(path: string): string | undefined {
  return /^(?:all:|any:)?([^.[\]]+)/.exec(path)?.[1];
}

function mentionsNode(text: string, nodeId: string): boolean {
  const escaped = nodeId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![A-Za-z0-9_-])${escaped}(?![A-Za-z0-9_-])`).test(text);
}

/**
 * Node ids whose results `nodeId` may read: its graph ancestors (every node
 * with an edge path into it, itself included when it sits on a cycle), any
 * node a `requires` path names, and any node id its instruction mentions.
 */
function contextDependencies(workflow: Workflow, nodeId: string, instruction = ""): Set<string> {
  const deps = new Set<string>();
  const stack = [nodeId];
  for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
    for (const e of workflow.edges) {
      if (e.to === id && !deps.has(e.from)) {
        deps.add(e.from);
        stack.push(e.from);
      }
    }
  }
  const requires = workflow.nodes[nodeId]?.requires;
  for (const p of [...(requires?.output_required ?? []), ...(requires?.output_matches ?? []).map((m) => m.path)]) {
    const root = pathRoot(p);
    if (root && root !== "input") deps.add(root);
  }
  for (const id of Object.keys(workflow.nodes)) {
    if (id !== nodeId && mentionsNode(instruction, id)) deps.add(id);
  }
  return deps;
}

/**
 * The bounded prompt context for one node: `input` plus its dependencies' entries.
 * Exported for the property tests only; not part of the package API (index.ts does not re-export it).
 * @internal
 */
export function buildBoundedContext(
  workflow: Workflow,
  nodeId: string,
  results: Map<string, NodeResult>,
  input: unknown,
  instruction: string,
): Record<string, unknown> {
  const deps = contextDependencies(workflow, nodeId, instruction);
  return {
    input,
    ...Object.fromEntries(
      [...results.entries()]
        .filter(([k]) => deps.has(k))
        .map(([k, v]) => [k, buildBoundedNodeEntry(v, workflow.nodes[k])]),
    ),
  };
}

/**
 * Return the declared `required` field names for a node's output schema,
 * or an empty array when no required block is declared. Tolerant of
 * malformed schemas (mirrors getDeclaredOutputProperties).
 */
function getDeclaredRequiredFields(output: JSONSchema | undefined): string[] {
  if (!output || typeof output !== "object") return [];
  const required = (output as Record<string, unknown>).required;
  if (!Array.isArray(required)) return [];
  return required.filter((r): r is string => typeof r === "string");
}

/**
 * Validate a node's emitted data against the declared output schema's
 * required fields. Returns the list of required-but-missing field names.
 *
 * This is intentionally narrow: we do NOT do full JSON Schema validation.
 * The routing impact comes from required fields being absent, so that's
 * what we check. Type mismatches, format violations, additionalProperties
 * etc. stay the workflow author's problem.
 */
function findMissingRequiredFields(data: unknown, output: JSONSchema | undefined): string[] {
  const required = getDeclaredRequiredFields(output);
  if (required.length === 0) return [];
  const obj = (data ?? {}) as Record<string, unknown>;
  return required.filter((k) => !(k in obj));
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

/** True when the run input requests a dry run (`dryRun === true`, strictly). */
function isDryRunInput(input: unknown): boolean {
  return input != null && typeof input === "object" && (input as Record<string, unknown>).dryRun === true;
}

/**
 * Dry-run tool gate (#380). Only an explicit `access: "read"` passes; a tool
 * with no `access` is treated as a write so new tools fail safe.
 */
export function isReadTool(tool: Pick<Tool, "access">): boolean {
  return tool.access === "read";
}

/**
 * The tool dispatcher's staged-run gate: in a staged or dry run no write (or
 * unclassified) tool handler runs, whatever reached the agent. Throws before
 * any side effect.
 */
export function guardStagedWrite(tool: Pick<Tool, "name" | "access">, staged: boolean): void {
  if (staged && !isReadTool(tool)) {
    throw new Error(`${tool.name} is a write tool and this run is staged: nothing was written`);
  }
}

/** Instruction section prepended to every node under dry-run. */
function dryRunNotice(skippedWrites: string[]): string {
  const withheld =
    skippedWrites.length > 0 ? `These write tools were withheld from this step: ${skippedWrites.join(", ")}. ` : "";
  return (
    `## Dry run\n\nThis is a dry run. Only read-only tools are available. ${withheld}` +
    `Do not create, modify, post, or send anything. Do the analysis, and where this step would ` +
    `normally write, describe exactly what it would have written instead.`
  );
}

/** Instruction section prepended to a staged write node whose write tools were withheld. */
function stagedNotice(skippedWrites: string[]): string {
  return (
    `## Staged run\n\nThis run is staged: nothing is written outside the workspace. These write tools were ` +
    `withheld from this step: ${skippedWrites.join(", ")}. Where this step would call one, describe ` +
    `exactly what it would have written instead.`
  );
}

/**
 * Only this node's resolved skills contribute external servers. A stdio
 * server gets its skill's declared credentials in its own `env` (explicit
 * server env wins): the agent env no longer carries them, so the server must
 * not rely on inheriting them from the agent process.
 */
function resolveSkillMcpServers(
  skillIds: string[],
  skills: Map<string, Skill>,
  config: Record<string, string> = {},
): Record<string, McpServerConfig> {
  const servers: Record<string, McpServerConfig> = {};
  for (const id of skillIds) {
    const skill = skills.get(id);
    const mcp = skill?.mcp;
    if (!skill || !mcp) continue;
    const type = mcp.type ?? (mcp.command ? "stdio" : "http");
    if (type !== "stdio") {
      servers[id] = { ...mcp, type };
      continue;
    }
    const declared: Record<string, string> = {};
    for (const [key, field] of Object.entries(skill.config ?? {})) {
      if (field.env && config[key] !== undefined) declared[field.env] = config[key];
    }
    const env = { ...declared, ...(mcp.env ?? {}) };
    servers[id] = { ...mcp, type, ...(Object.keys(env).length > 0 ? { env } : {}) };
  }
  return servers;
}

function resolveTools(skillIds: string[], skills: Map<string, Skill>): Tool[] {
  return skillIds
    .map((id) => skills.get(id))
    .filter((s): s is Skill => s != null)
    .flatMap((s) => s.tools);
}

/**
 * Apply a node's optional skill-tool filter (`tools.allow` / `tools.deny`).
 *
 * - No filter declared: all resolved tools pass through (back-compat).
 * - `allow` present: only tools whose name is in `allow` survive.
 * - `deny` present: tools whose name is in `deny` are removed. Applied
 *   after `allow` when both are declared, so deny always wins.
 *
 * Filter entries that match no resolved tool get a warn (typo detection;
 * also fires legitimately when a skill is unconfigured and its tools are
 * absent, which is informational rather than fatal).
 */
function filterNodeTools(tools: Tool[], filter: NodeToolFilter | undefined, nodeId: string, logger: Logger): Tool[] {
  if (!filter) return tools;

  const resolvedNames = new Set(tools.map((t) => t.name));
  // A deny entry that names a tool class (write, shell, ...) targets built-in
  // agent tools too, so it is not a typo when no skill tool has that name.
  const denyNames = (filter.deny ?? []).filter((n) => !isToolClass(n));
  for (const name of [...(filter.allow ?? []), ...denyNames]) {
    if (!resolvedNames.has(name)) {
      logger.warn(`  tools filter: '${name}' does not match any tool resolved for node '${nodeId}'`, {
        node: nodeId,
        tool: name,
      });
    }
  }

  const allow = filter.allow ? new Set(filter.allow) : null;
  const deny = new Set(filter.deny ?? []);
  return tools.filter((t) => (allow ? allow.has(t.name) : true) && !deny.has(t.name));
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
 *
 * `env` is the environment map to read `field.env` from. Callers thread
 * `options.env ?? process.env` so an explicit env map is honored consistently
 * with Source resolution (which reads the same map). Defaults to
 * `process.env` when omitted.
 *
 * Presence vs. truthiness: an explicitly-provided empty string is treated as
 * present, not absent. Resolution rules:
 *   - An override that is present (any string, including "") wins; the env
 *     var is not consulted. An explicit "" override does NOT silently fall
 *     through to env.
 *   - Otherwise the env var (when declared) is used.
 *   - A value that is `undefined` (no override, no env var) is absent: a
 *     required field reports "not provided".
 *   - A value that is "" is present-but-empty: a required field reports a
 *     distinct "set to empty" message (you set it, but to an unusable value),
 *     while an optional field passes the empty string through.
 */
function resolveConfig(
  skills: Map<string, Skill>,
  overrides?: Record<string, string>,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const config: Record<string, string> = {};
  const missing: string[] = [];

  for (const skill of skills.values()) {
    for (const [key, field] of Object.entries(skill.config)) {
      // Explicit override wins, including an empty string — `in` distinguishes
      // a present "" from an absent key, so an override never falls through to
      // env in a surprising way.
      const hasOverride = overrides != null && key in overrides;
      const value = hasOverride ? overrides![key] : field.env ? env[field.env] : undefined;
      const source = field.env ? ` (env: ${field.env})` : "";

      const label = `${skill.id}.${key}${source || " (env: none)"}`;
      if (value === undefined) {
        // Truly absent: no override and no env value.
        if (field.required) {
          missing.push(`${label}: not provided`);
        }
      } else if (value === "") {
        // Present but empty. An empty credential is unusable for a required
        // field; surface a distinct message so the user can tell "set to empty"
        // from "forgot it". Optional empty values pass through unchanged.
        if (field.required) {
          missing.push(`${label}: set to empty`);
        } else {
          config[key] = value;
        }
      } else {
        config[key] = value;
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
  abort?: AbortOptions,
): Promise<string | null> {
  // Dry run path gate: stop at the first natural-language routing decision.
  // Safety does not depend on this (#380): under dry-run every node already
  // runs read-only (see execute()). The stop keeps dry-run routing free of
  // model route evaluation, so the path is reproducible from the node outputs
  // alone. Expression edges (#461) are evaluated by sweny with no model call,
  // so dry-run follows them: a preview can reach the nodes past a
  // deterministic branch (still read-only, outputs staged) and stops only
  // where a model would have to pick the branch.
  if (isDryRunInput(input)) {
    const outEdges = workflow.edges.filter((e) => e.from === currentId);
    if (outEdges.some((e) => e.when && !isWhenExpression(e.when))) {
      safeObserve(observer, { type: "route", from: currentId, to: "(end)", reason: "dry run" }, logger);
      return null;
    }
  }

  const prevId = currentId;
  const nextId = await resolveNext(workflow, currentId, results, input, claude, observer, edgeCounts, logger, abort);
  if (nextId) {
    const reason = whenLabel(workflow.edges.find((e) => e.from === prevId && e.to === nextId)?.when) ?? "only path";
    trace.edges.push({ from: prevId, to: nextId, reason });
  }
  return nextId;
}

/**
 * Resolve which edge to follow from the current node.
 *
 * - 0 out-edges → terminal (return null)
 * - 1 unconditional edge → follow it
 * - Every conditional edge is an `{ expr }` expression → sweny evaluates them, no model call
 * - Otherwise multiple or conditional → Claude evaluates
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
  abort?: AbortOptions,
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

  // Defense-in-depth for AMBIGUOUS_EDGES (rejected by validateWorkflow): with
  // no conditional edges there is nothing for the route evaluator to decide.
  // Follow the (first) unconditional edge directly and skip the no-op
  // claude.evaluate call. validateWorkflow already rejects 2+ unconditional
  // edges, so a well-formed workflow reaching here has exactly one default.
  if (conditionalEdges.length === 0 && defaultEdge) {
    if (outEdges.length > 1) {
      logger?.warn(
        `  route eval: node '${current}' has ${outEdges.length} unconditional out-edges; following '${defaultEdge.to}' ` +
          `and ignoring the rest. Add 'when' clauses to make routing deterministic (see AMBIGUOUS_EDGES).`,
        { node: current },
      );
    }
    if (edgeCounts) {
      const key = `${current}→${defaultEdge.to}`;
      edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
    }
    safeObserve(observer, { type: "route", from: current, to: defaultEdge.to, reason: "only path" }, logger);
    return defaultEdge.to;
  }

  // Deterministic routing (#461): every conditional out-edge is an expression,
  // so sweny decides without a model call. validateWorkflow rejects a node
  // that mixes expression and natural-language edges.
  if (conditionalEdges.every((e) => isWhenExpression(e.when))) {
    return resolveByExpressions(
      workflow,
      current,
      results,
      conditionalEdges,
      defaultEdge,
      observer,
      edgeCounts,
      logger,
    );
  }

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
  const context: Record<string, unknown> = { input };
  for (const [k, v] of results.entries()) {
    const { view, missing } = buildRouteEvalEntry(v, workflow.nodes[k]);
    context[k] = view;
    // Only a successful node has an output contract to violate. A node that
    // was skipped (requires not met) or failed before producing output never
    // emitted its declared properties; its data is { skipped_reason } / { error }.
    // Warning that those nodes are "missing declared properties" is misleading
    // noise — it alarms operators and pollutes telemetry on every skip. Still
    // build the view above so routing can read the skipped/failed data; only
    // suppress the warning + node:warning for non-success nodes.
    if (missing.length > 0 && v.status === "success") {
      // Loud signal for the operator. The view itself already replaces the
      // missing keys with explicit `null`, so the LLM evaluator cannot
      // ghost-match "is N" or "is undefined" against a structurally-absent
      // field. The warning surfaces the contract violation in the log
      // stream and to observer-based telemetry.
      logger?.warn(`  route eval: source node '${k}' declared properties not in emitted data: ${missing.join(", ")}`, {
        node: k,
        fields: missing,
      });
      safeObserve(
        observer,
        {
          type: "node:warning",
          node: k,
          reason: `declared output properties missing from emitted data; routing view filled them with null`,
          fields: missing,
        },
        logger,
      );
    }
  }

  const choices = conditionalEdges.map((e) => ({
    id: e.to,
    description: whenLabel(e.when)!,
  }));

  if (defaultEdge) {
    choices.push({ id: defaultEdge.to, description: "None of the above / default path" });
  }

  const question = "Based on the results so far, which condition is true?";
  // Shadow mode (#357): the decider gets the same question in parallel. Its
  // promise never rejects and its answer is only logged, so the route below
  // is the agent's in every case.
  const pending = abort?.shadow
    ? startShadowDecision(abort.shadow.provider, { question, state: context, choices, signal: abort.signal })
    : undefined;

  const chosen = await claude.evaluate({
    question,
    context,
    choices,
    signal: abort?.signal,
    timeoutMs: abort?.timeoutMs,
  });

  if (pending && abort?.shadow) {
    try {
      const rec = await finishShadowDecision(pending, current, chosen);
      abort.shadow.records.push(rec);
      const verdict =
        rec.outcome === "compared" ? (rec.agree ? "agreed" : "disagreed") : `fell through (${rec.reason})`;
      logger?.info(`  decider (shadow): node '${current}' ${verdict}`, { ...rec });
    } catch {
      // shadow logging must never affect a route
    }
  }

  // Fail closed. `evaluate` returns null when the routing decision could not
  // be made (SDK error, timeout, non-success subtype, or an unparseable
  // answer). We must NOT fall through to a conditional edge: on a node with a
  // single conditional out-edge, "the first choice" IS that edge, so an outage
  // would always take it (the fail-open bug that silently filed real
  // issues/PRs instead of routing to `skip`). Take the author's explicit
  // default/else edge if one exists; otherwise terminate the run loudly.
  if (chosen === null) {
    if (defaultEdge) {
      logger?.warn(
        `  route eval: evaluation failed for node '${current}'; taking default (unconditional) edge '${defaultEdge.to}'.`,
        { node: current },
      );
      safeObserve(
        observer,
        { type: "route", from: current, to: defaultEdge.to, reason: "route evaluation failed; default edge" },
        logger,
      );
      if (edgeCounts) {
        const key = `${current}→${defaultEdge.to}`;
        edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
      }
      return defaultEdge.to;
    }
    logger?.error(
      `  route eval: evaluation failed for node '${current}' and there is no default (unconditional) edge; ` +
        `refusing to fail open. Terminating the run. Add a default edge or fix the model backend.`,
      { node: current },
    );
    safeObserve(
      observer,
      { type: "route", from: current, to: "(end)", reason: "route evaluation failed; no default edge" },
      logger,
    );
    throw new RouteEvaluationError(
      current,
      `route evaluation failed for node '${current}' and no default (unconditional) edge exists; ` +
        `refusing to fail open`,
    );
  }

  // Validate that Claude returned a valid target.
  const validTargets = new Set(outEdges.map((e) => e.to));
  if (!validTargets.has(chosen)) {
    // The evaluator returned a target that is not a live out-edge. If there's
    // an explicit default (unconditional) edge, take it as the documented
    // fallback. Otherwise this is a hard error: silently jumping to
    // `outEdges[0]` (often the loop-back edge) launders garbage model output
    // into a plausible-looking route and, combined with an unbounded cycle,
    // produces an infinite loop. Stop loudly instead.
    if (!defaultEdge) {
      logger?.warn(
        `  route eval: evaluator returned invalid target '${chosen}' for node '${current}' and there is no ` +
          `default (unconditional) edge; terminating this branch. Valid targets: ${[...validTargets].join(", ")}`,
        { node: current, chosen, validTargets: [...validTargets] },
      );
      safeObserve(
        observer,
        {
          type: "route",
          from: current,
          to: "(end)",
          reason: `invalid route target '${chosen}' with no default edge`,
        },
        logger,
      );
      return null;
    }
  }

  const resolved = validTargets.has(chosen) ? chosen : defaultEdge!.to;

  // Track edge usage for max_iterations
  if (edgeCounts) {
    const key = `${current}→${resolved}`;
    edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
  }

  // Report the matched choice's description. The `?? "default"` fallback now
  // only fires when a default edge genuinely exists (the no-default invalid
  // case returned null above), so it can no longer mislabel a garbage route.
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
 * Pick the out-edge whose `{ expr }` condition is true, with no model call
 * (#461). Exactly one true edge is taken. None true takes the unconditional
 * default edge when there is one. Otherwise (no edge true and no default, or
 * two or more true) it fails closed with a RouteEvaluationError, the same
 * contract as a failed model route evaluation: sweny never guesses an edge.
 *
 * An expression reads only successful nodes' outputs. A missing field, or a
 * node that did not run or did not succeed, makes that expression false and
 * is logged as a warning, never a silent true.
 */
function resolveByExpressions(
  workflow: Workflow,
  current: string,
  results: Map<string, NodeResult>,
  conditionalEdges: Workflow["edges"],
  defaultEdge: Workflow["edges"][number] | undefined,
  observer: Observer | undefined,
  edgeCounts: Map<string, number> | undefined,
  logger: Logger | undefined,
): string {
  const scope: ExpressionScope = {};
  for (const [id, r] of results.entries()) {
    if (r.status === "success") scope[id] = buildPriorNodeContext(r);
  }

  const matched: Array<{ to: string; expr: string }> = [];
  for (const edge of conditionalEdges) {
    const expr = whenLabel(edge.when)!;
    let outcome: ExpressionResult;
    try {
      outcome = evaluateExpression(parseExpression(expr), scope);
    } catch (err) {
      // validateWorkflow parses every expression before a run, so this only
      // fires for a workflow that skipped validation. Fail closed.
      const msg = err instanceof Error ? err.message : String(err);
      safeObserve(observer, { type: "route", from: current, to: "(end)", reason: `invalid when expression` }, logger);
      throw new RouteEvaluationError(current, `invalid when expression on edge '${current}' -> '${edge.to}': ${msg}`);
    }
    if (outcome.problem) {
      logger?.warn(`  route expr: '${current}' -> '${edge.to}' is false: ${outcome.problem} (${expr})`, {
        node: current,
        to: edge.to,
      });
      safeObserve(
        observer,
        {
          type: "node:warning",
          node: current,
          reason: `when expression on edge to '${edge.to}' evaluated false: ${outcome.problem}`,
          fields: [],
        },
        logger,
      );
    }
    if (outcome.value) matched.push({ to: edge.to, expr });
  }

  const take = (to: string, reason: string): string => {
    if (edgeCounts) {
      const key = `${current}→${to}`;
      edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
    }
    safeObserve(observer, { type: "route", from: current, to, reason }, logger);
    return to;
  };

  if (matched.length === 1) return take(matched[0].to, matched[0].expr);

  if (matched.length === 0 && defaultEdge) {
    logger?.info(`  route expr: no expression matched for '${current}'; taking default edge '${defaultEdge.to}'`, {
      node: current,
    });
    return take(defaultEdge.to, "no expression matched; default edge");
  }

  const why =
    matched.length === 0
      ? `no when expression on node '${current}' is true and there is no default (unconditional) edge`
      : `${matched.length} when expressions on node '${current}' are true (to ${matched.map((m) => m.to).join(", ")}); ` +
        `exactly one may match`;
  logger?.error(`  route expr: ${why}; refusing to guess. Terminating the run.`, { node: current });
  safeObserve(observer, { type: "route", from: current, to: "(end)", reason: why }, logger);
  throw new RouteEvaluationError(current, `${why}; refusing to guess`);
}

/**
 * Validate a workflow definition before execution.
 */
function validate(workflow: Workflow, skills: Map<string, Skill>): void {
  for (const [id, def] of Object.entries(workflow.skills ?? {})) {
    if (!def.instruction?.trim()) {
      throw new Error(`Inline skill "${id}" must provide a non-empty instruction`);
    }
    if (id === "sweny-core" && def.mcp) {
      throw new Error(`Skill "sweny-core" is reserved for the engine MCP server; use a different skill ID`);
    }
  }

  if (!workflow.nodes[workflow.entry]) {
    throw new Error(`Entry node "${workflow.entry}" not found`);
  }

  for (const edge of workflow.edges) {
    if (!workflow.nodes[edge.from]) throw new Error(`Edge references unknown node: "${edge.from}"`);
    if (!workflow.nodes[edge.to]) throw new Error(`Edge references unknown node: "${edge.to}"`);
  }

  // Same structural validation the CLI loader runs (reachability, self-loops,
  // ambiguous edges, unbounded cycles, reserved eval policies, retry and
  // max_iterations ceilings). Library callers, Studio's simulator and run.ts
  // reach execute() without the loader, so without this they got none of it
  // (#326). Runs once per execute() call, before any node runs. Skill
  // availability stays a warning below, so no knownSkills here.
  const structural = validateWorkflow(workflow);
  if (structural.length > 0) {
    throw new Error(
      `Invalid workflow "${workflow.id}":\n${structural.map((e) => `  ${e.code}: ${e.message}`).join("\n")}`,
    );
  }

  // Check that each node has at least one available skill (if it lists any)
  for (const [nodeId, node] of Object.entries(workflow.nodes)) {
    if (node.skills.length === 0) continue;
    for (const id of node.skills) {
      const skill = skills.get(id);
      if (id === "sweny-core" && skill?.mcp) {
        throw new Error(
          `Skill "sweny-core" is reserved for the engine MCP server; use a different skill ID (node "${nodeId}")`,
        );
      }
    }
    const available = node.skills.filter((id) => skills.has(id));
    if (available.length === 0) {
      consoleLogger.warn(`Node "${nodeId}" has no available skills (needs one of: ${node.skills.join(", ")})`);
    }
  }
}
