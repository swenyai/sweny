/**
 * Lifecycle-endpoint reporter for SWEny Cloud.
 *
 * Posts run lifecycle events (start, finish, optional per-node updates) to
 * cloud's universal ingest API at `${cloudUrl}/api/runs[/:id/...]`. Auth via
 * the same `SWENY_CLOUD_TOKEN` that the legacy /api/report flow uses.
 *
 * This reporter is CI-agnostic: it works from GitHub Actions, GitLab CI,
 * CircleCI, a developer's laptop — anywhere a workflow runs and a token is
 * configured. The legacy `reportToCloud` (in cloud-report.ts) keeps working
 * for back-compat; new code paths should prefer this lifecycle flow.
 *
 * Source proposal: cloud/docs/proposals/02-cloud-architecture-for-any-run.md
 * (task 05).
 *
 * All errors are swallowed: cloud reporting MUST NEVER block the workflow.
 */

import { randomUUID } from "node:crypto";
import { summarizeInputShape } from "../inputs.js";
import type { ExecutionEvent, NodeResult, Observer, Workflow, WorkflowInputs } from "../types.js";

const CLOUD_URL_DEFAULT = "https://cloud.sweny.ai";
const TIMEOUT_MS = 10_000;
// startRun runs on the critical path BEFORE execute(), so a slow cloud
// would delay every workflow start. Cap it tighter than the general
// timeout — if cloud can't accept the run-start in 3s, skip and run
// uninstrumented rather than make the user wait.
const START_TIMEOUT_MS = 3_000;

export type TriggerSource =
  | "github_action"
  | "gitlab_ci"
  | "circleci"
  | "buildkite"
  | "other_ci"
  | "manual"
  | "cron"
  | "mcp"
  | "unknown";

export interface CloudReportConfig {
  cloudToken: string;
  cloudUrl?: string;
  repository?: string;
}

export interface StartRunInput {
  workflow_id: string;
  workflow_type?: string;
  trigger_source?: TriggerSource;
  trigger_metadata?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  run_uuid?: string;
  /**
   * Declared input shape for this run: key name → declared (or observed)
   * type. Values are intentionally NEVER included; per the workflow spec
   * (Telemetry shape), cloud renderers may display the input contract a
   * run was invoked with but must not receive the values themselves. A
   * workflow that takes a token as input therefore never leaks it.
   *
   * Omitted when the caller didn't pass an inputs shape (e.g. legacy
   * call sites pre-dating the inputs contract).
   */
  inputs_shape?: Record<string, string>;
}

export interface StartRunResult {
  run_id: string;
  dashboard_url?: string;
  stream_url?: string;
  idempotent_replay?: boolean;
}

export interface FinishRunInput {
  status: "success" | "failed" | "skipped" | "completed" | "partial";
  metrics?: Record<string, unknown>;
  duration_ms?: number;
  error?: string;
}

/**
 * Detect the CI trigger source from environment variables. Best-effort;
 * returns "unknown" if no signal is present.
 */
export function detectTriggerSource(env: NodeJS.ProcessEnv = process.env): TriggerSource {
  if (env.GITHUB_ACTIONS === "true") return "github_action";
  if (env.GITLAB_CI === "true") return "gitlab_ci";
  if (env.CIRCLECI === "true") return "circleci";
  if (env.BUILDKITE === "true") return "buildkite";
  if (env.CI === "true" || env.CI === "1") return "other_ci";
  return "manual";
}

/**
 * Build the trigger_metadata blob from env. Each CI provider exposes a
 * different set of variables; pick the ones that are useful for debugging
 * a specific run later (run id, actor, ref).
 */
export function buildTriggerMetadata(
  source: TriggerSource,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, unknown> {
  switch (source) {
    case "github_action":
      return {
        runner_id: env.RUNNER_NAME,
        workflow_run_id: env.GITHUB_RUN_ID,
        workflow_run_attempt: env.GITHUB_RUN_ATTEMPT,
        actor: env.GITHUB_ACTOR,
        event_name: env.GITHUB_EVENT_NAME,
        ref: env.GITHUB_REF,
        sha: env.GITHUB_SHA,
      };
    case "gitlab_ci":
      return {
        pipeline_id: env.CI_PIPELINE_ID,
        job_id: env.CI_JOB_ID,
        actor: env.GITLAB_USER_LOGIN,
        ref: env.CI_COMMIT_REF_NAME,
        sha: env.CI_COMMIT_SHA,
      };
    case "circleci":
      return {
        build_num: env.CIRCLE_BUILD_NUM,
        actor: env.CIRCLE_USERNAME,
        sha: env.CIRCLE_SHA1,
      };
    default:
      return {};
  }
}

/**
 * Generate a run UUID. Each call to startRun() should generate exactly one
 * and reuse it for the matching finishRun() — this is the idempotency key.
 */
export function newRunUuid(): string {
  return randomUUID();
}

/**
 * Build a run-start payload from a Workflow + env. Pure function; the caller
 * is responsible for passing it to `startRun()`.
 *
 * `inputsShape` (when provided) ships the key-name → declared-type map for
 * the run. Values are NEVER transmitted; callers compute the shape via
 * `summarizeInputShape` (or pass the workflow's declared `inputs` block
 * and resolved input bag and let this helper compute it). See the
 * Telemetry shape rule in spec/src/content/docs/workflow.mdx.
 */
export function buildStartRunPayload(
  workflow: Pick<Workflow, "id" | "workflow_type">,
  options: {
    runUuid: string;
    env?: NodeJS.ProcessEnv;
    declaredInputs?: WorkflowInputs;
    resolvedInputs?: Record<string, unknown>;
  },
): StartRunInput {
  const env = options.env ?? process.env;
  const trigger_source = detectTriggerSource(env);
  const trigger_metadata = buildTriggerMetadata(trigger_source, env);
  const metadata: Record<string, unknown> = {};
  if (env.GITHUB_REF) metadata.branch = env.GITHUB_REF.replace(/^refs\/heads\//, "");
  if (env.GITHUB_SHA) metadata.commit_sha = env.GITHUB_SHA;
  if (env.GITHUB_ACTOR) metadata.actor = env.GITHUB_ACTOR;
  const payload: StartRunInput = {
    workflow_id: workflow.id,
    workflow_type: workflow.workflow_type ?? "generic",
    trigger_source,
    trigger_metadata,
    metadata,
    run_uuid: options.runUuid,
  };
  // Compute the shape when caller provided either a declaration or a
  // resolved bag. Omit the key entirely when there's nothing to summarize
  // so old cloud builds that don't model `inputs_shape` aren't surprised
  // by an empty object.
  if (options.declaredInputs || options.resolvedInputs) {
    const shape = summarizeInputShape(options.declaredInputs, options.resolvedInputs);
    if (Object.keys(shape).length > 0) {
      payload.inputs_shape = shape;
    }
  }
  return payload;
}

/**
 * POST /api/runs — start a run, returning the run id (or null on failure).
 * Failure is silent: cloud reporting must not block workflow execution.
 */
export async function startRun(config: CloudReportConfig, payload: StartRunInput): Promise<StartRunResult | null> {
  const cloudUrl = config.cloudUrl ?? process.env.SWENY_CLOUD_URL ?? CLOUD_URL_DEFAULT;
  try {
    const res = await fetch(`${cloudUrl}/api/runs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.cloudToken}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(START_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = (await res.json().catch(() => ({}))) as StartRunResult;
    if (!data.run_id) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * POST /api/runs/:id/finish — record the final outcome + metrics.
 */
export async function finishRun(config: CloudReportConfig, runId: string, payload: FinishRunInput): Promise<boolean> {
  const cloudUrl = config.cloudUrl ?? process.env.SWENY_CLOUD_URL ?? CLOUD_URL_DEFAULT;
  try {
    const res = await fetch(`${cloudUrl}/api/runs/${encodeURIComponent(runId)}/finish`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.cloudToken}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * POST /api/runs/:id/node — record a node lifecycle event. Optional helper
 * for callers that want streaming updates; safe to skip if you only need
 * start + finish. Fire-and-forget.
 */
export async function postNodeEvent(
  config: CloudReportConfig,
  runId: string,
  event: {
    event: "enter" | "exit" | "progress";
    node: string;
    timestamp?: string;
    status?: "success" | "failed" | "skipped";
    duration_ms?: number;
    data?: Record<string, unknown>;
  },
): Promise<void> {
  const cloudUrl = config.cloudUrl ?? process.env.SWENY_CLOUD_URL ?? CLOUD_URL_DEFAULT;
  try {
    await fetch(`${cloudUrl}/api/runs/${encodeURIComponent(runId)}/node`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.cloudToken}`,
      },
      body: JSON.stringify({ ...event, timestamp: event.timestamp ?? new Date().toISOString() }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    // Silent — never block the workflow.
  }
}

/**
 * Derive a `metrics` blob from the executor's NodeResult map.
 *
 * For now this is intentionally minimal: total node count, failed-node
 * count, success rate. Per-workflow-type metric extraction (Caught /
 * Calibration / Missed for pr_review, flake rate for e2e_test, etc.) is
 * the renderer's job; the engine just ships what it has.
 */
export function deriveGenericMetrics(results: Map<string, NodeResult>, durationMs: number) {
  const nodeCount = results.size;
  const failedNodes = [...results.values()].filter((r) => r.status === "failed").length;
  return {
    duration_ms: durationMs,
    node_count: nodeCount,
    failed_nodes: failedNodes,
    success_rate: nodeCount > 0 ? (nodeCount - failedNodes) / nodeCount : 0,
  };
}

export interface CloudLifecycleHandle {
  runUuid: string;
  runId: string;
  dashboardUrl?: string;
}

/**
 * Open a cloud lifecycle session for an upcoming workflow run.
 *
 * Returns a handle if the cloud token is set AND `startRun()` succeeds; null
 * otherwise. Callers should ALWAYS handle the null case — cloud reporting
 * is opt-in and best-effort, the workflow must run regardless.
 *
 * Pair every successful call with `finishCloudLifecycle(handle, …)` once the
 * workflow completes (success or failure).
 */
export async function beginCloudLifecycle(
  config: { cloudToken?: string; repository?: string },
  workflow: Pick<Workflow, "id" | "workflow_type">,
  options?: { declaredInputs?: WorkflowInputs; resolvedInputs?: Record<string, unknown> },
): Promise<CloudLifecycleHandle | null> {
  if (!config.cloudToken) return null;
  const runUuid = newRunUuid();
  const payload = buildStartRunPayload(workflow, {
    runUuid,
    declaredInputs: options?.declaredInputs,
    resolvedInputs: options?.resolvedInputs,
  });
  const reportConfig: CloudReportConfig = {
    cloudToken: config.cloudToken,
    repository: config.repository,
  };
  const result = await startRun(reportConfig, payload);
  if (!result) return null;
  return {
    runUuid,
    runId: result.run_id,
    dashboardUrl: result.dashboard_url,
  };
}

/**
 * Close a cloud lifecycle session opened by `beginCloudLifecycle`.
 *
 * No-op when handle is null (cloud reporting was disabled or startRun
 * failed). Status maps the engine's `success | failed | partial` outcome
 * onto the cloud's accepted enum. Failure is silent — the workflow's
 * exit code already reflects the truth.
 */
export async function finishCloudLifecycle(
  config: { cloudToken?: string },
  handle: CloudLifecycleHandle | null,
  results: Map<string, NodeResult>,
  durationMs: number,
  status: "success" | "failed" | "partial" = "success",
): Promise<void> {
  if (!handle || !config.cloudToken) return;
  const reportConfig: CloudReportConfig = { cloudToken: config.cloudToken };
  await finishRun(reportConfig, handle.runId, {
    status,
    duration_ms: durationMs,
    metrics: deriveGenericMetrics(results, durationMs),
  });
}

/**
 * Build an Observer that ships per-node lifecycle events to cloud.
 *
 * Maps the engine's ExecutionEvent stream onto `POST /api/runs/:id/node`:
 *   node:enter   → { event: "enter",  node }
 *   node:exit    → { event: "exit",   node, status, duration_ms }
 *   node:progress → { event: "progress", node, data: { message } }
 *   node:retry   → { event: "progress", node, data: { retry: true, attempt, reason } }
 * Other events (workflow:start, tool:*, route, workflow:end) are dropped.
 *
 * Returns undefined when the handle is null (no cloud session) or the
 * token is missing. The observer captures `node:enter` timestamps in a
 * closure-scoped Map so it can compute duration_ms on the matching exit
 * without depending on any external state.
 *
 * Hot-path safety contract:
 *   1. The observer never throws synchronously. The whole body is
 *      wrapped in try/catch — any future ExecutionEvent shape change
 *      that breaks a field access cannot crash the engine.
 *   2. The observer never awaits. postNodeEvent is fired with .catch
 *      to swallow any rejection so node never sees an unhandledRejection.
 *   3. The Map is keyed by node id; collisions only happen if the same
 *      node id runs concurrently, which the engine does not do today.
 */
export function createCloudStreamObserver(
  config: { cloudToken?: string },
  handle: CloudLifecycleHandle | null,
): Observer | undefined {
  if (!handle || !config.cloudToken) return undefined;
  const reportConfig: CloudReportConfig = { cloudToken: config.cloudToken };
  // Single-threaded-per-node assumption: the engine doesn't run the
  // same node id twice concurrently, so node id alone is enough as a
  // key. A future parallelizing executor change would need to revisit.
  const enterTimes = new Map<string, number>();
  const fire = (event: Parameters<typeof postNodeEvent>[2]) => {
    postNodeEvent(reportConfig, handle.runId, event).catch(() => {
      // Cloud reporting must never bubble — postNodeEvent already
      // swallows internally, but this is belt-and-suspenders.
    });
  };
  return (event: ExecutionEvent) => {
    try {
      switch (event.type) {
        case "node:enter": {
          enterTimes.set(event.node, Date.now());
          fire({ event: "enter", node: event.node });
          break;
        }
        case "node:exit": {
          const enter = enterTimes.get(event.node);
          const duration_ms = typeof enter === "number" ? Date.now() - enter : undefined;
          enterTimes.delete(event.node);
          fire({
            event: "exit",
            node: event.node,
            status: event.result.status,
            duration_ms,
          });
          break;
        }
        case "node:progress": {
          fire({
            event: "progress",
            node: event.node,
            data: { message: event.message },
          });
          break;
        }
        case "node:retry": {
          fire({
            event: "progress",
            node: event.node,
            data: { retry: true, attempt: event.attempt, reason: event.reason },
          });
          break;
        }
        default:
          // Drop workflow:start, sources:resolved, tool:*, route,
          // workflow:end. Cloud only models the per-node lifecycle today.
          break;
      }
    } catch {
      // Hot-path defense: an unexpected event shape must not crash
      // the engine. Silent swallow is the correct behavior here.
    }
  };
}
