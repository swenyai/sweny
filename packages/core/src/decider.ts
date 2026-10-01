/**
 * Decision models (#357): a fast typed classifier that decides routes.
 *
 * A System One decision model (Ollama `/v1/systemone`, TypeSafe Jev) answers
 * one Choice question over a state in milliseconds. For a node whose
 * conditional out-edges are natural language, the route ladder is:
 *
 *   1. `when` expressions: sweny evaluates them, no model call (executor.ts).
 *   2. The decider, when the workflow declares `decider`: its answer is the
 *      route only when the label is one of the node's out-edges, confidence is
 *      at least `min_confidence` and the top label leads the runner-up by at
 *      least `min_margin`. Then the agent is never asked.
 *   3. The agent's route evaluation, exactly as without a decider.
 *
 * Any decider failure (timeout, HTTP error, malformed answer, unknown label,
 * low confidence or margin, open breaker, spent cap) falls through to rung 3.
 *
 * Privacy: the state goes only to the provider the workflow configured, never
 * to a default or fallback URL. It is the routing view (declared output
 * fields, eval verdicts, node statuses), redacted and fenced; never env,
 * secrets or tool outputs. What this module logs is metadata only (edge target
 * ids, numbers and a hash).
 */

import crypto from "node:crypto";
import {
  DECIDER_CONFIDENCE_FLOOR,
  DECIDER_MARGIN_FLOOR,
  DECIDER_MIN_CONFIDENCE,
  DECIDER_MIN_MARGIN,
  DECIDER_MODE_REMOVED,
} from "./types.js";

export {
  DECIDER_CONFIDENCE_FLOOR,
  DECIDER_MARGIN_FLOOR,
  DECIDER_MIN_CONFIDENCE,
  DECIDER_MIN_MARGIN,
  DECIDER_MODE_REMOVED,
};

/** Per-call timeout. */
export const DECIDER_DEFAULT_TIMEOUT_MS = 2000;
/** Consecutive failed calls that open the breaker for the rest of the run. */
export const DECIDER_BREAKER_FAILURES = 3;
/** Decider calls one run may make. */
export const DECIDER_DEFAULT_MAX_CALLS = 200;

/** Workflow-level `decider` block. Presence enables it. */
export interface DeciderConfig {
  provider: {
    /** Server root, e.g. `http://localhost:11434` or `https://api.typesafe.ai`. */
    base_url: string;
    model: string;
    /** Name of the env var holding the bearer key. Never the key itself. */
    api_key_env?: string;
  };
  /** Default 0.85, never below 0.7. */
  min_confidence?: number;
  /** Default 0.2, never below 0.1. */
  min_margin?: number;
}

// ─── Provider contract ──────────────────────────────────────────

/** One Choice question: pick a key of `criteria`. */
export interface ChoiceAsk {
  kind: "choice";
  instructions: string;
  criteria: Record<string, string>;
}

/** Only Choice exists today. Noul and Score arrive as further union members. */
export type Ask = ChoiceAsk;

export interface ChoiceVerdict {
  kind: "choice";
  label: string;
  probabilities: Record<string, number>;
  confidence: number;
}
export type Verdict = ChoiceVerdict;

export type DecideErrorCode =
  | "timeout"
  | "aborted"
  | "network"
  | "unauthorized"
  | "invalid_request"
  | "rate_limited"
  | "overloaded"
  | "http_error"
  | "malformed"
  | "unknown_label";

export class DecideError extends Error {
  constructor(
    readonly code: DecideErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DecideError";
  }
}

export interface DecideRequest {
  state: unknown;
  asks: Record<string, Ask>;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface DecisionProvider {
  /** Short provider family label for logs, e.g. `systemone`. */
  id: string;
  model: string;
  /** Throws {@link DecideError}; never returns a partial answer. */
  decide(req: DecideRequest): Promise<Record<string, Verdict>>;
}

// ─── systemOneProvider ──────────────────────────────────────────

export interface SystemOneOptions {
  baseUrl: string;
  model: string;
  apiKey?: string;
  /** Default timeout when `decide()` is not given one. Default 2000 ms. */
  timeoutMs?: number;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isProb = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;

/**
 * `POST {baseUrl}/v1/systemone`. Ollama (local) and TypeSafe Jev (hosted)
 * share this wire shape; only base URL, key and model differ. Response
 * validation is strict: any deviation is a `malformed` or `unknown_label`
 * error, never a guess.
 */
export function systemOneProvider(opts: SystemOneOptions): DecisionProvider {
  const url = `${opts.baseUrl.replace(/\/+$/, "")}/v1/systemone`;

  return {
    id: "systemone",
    model: opts.model,
    async decide(req) {
      const timeoutMs = req.timeoutMs ?? opts.timeoutMs ?? DECIDER_DEFAULT_TIMEOUT_MS;
      const questions: Record<string, unknown> = {};
      for (const [name, ask] of Object.entries(req.asks)) {
        questions[name] = { type: ask.kind, instructions: ask.instructions, criteria: ask.criteria };
      }

      const ctl = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        ctl.abort();
      }, timeoutMs);
      const onAbort = () => ctl.abort();
      if (req.signal?.aborted) ctl.abort();
      req.signal?.addEventListener("abort", onAbort, { once: true });

      try {
        let res: Response;
        try {
          res = await fetch(url, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              ...(opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {}),
            },
            body: JSON.stringify({ model: opts.model, state: req.state, questions }),
            signal: ctl.signal,
          });
        } catch (err) {
          if (timedOut) throw new DecideError("timeout", `no answer within ${timeoutMs}ms`);
          if (ctl.signal.aborted) throw new DecideError("aborted", "request aborted");
          throw new DecideError("network", err instanceof Error ? err.name : "fetch failed");
        }

        if (!res.ok) {
          const s = res.status;
          const code: DecideErrorCode =
            s === 401 || s === 403
              ? "unauthorized"
              : s === 400 || s === 422
                ? "invalid_request"
                : s === 429
                  ? "rate_limited"
                  : s === 529 || s === 503
                    ? "overloaded"
                    : "http_error";
          throw new DecideError(code, `HTTP ${s}`);
        }

        let body: unknown;
        try {
          body = await res.json();
        } catch {
          if (timedOut) throw new DecideError("timeout", `no answer within ${timeoutMs}ms`);
          throw new DecideError("malformed", "response is not JSON");
        }
        return parseAnswers(body, req.asks);
      } finally {
        clearTimeout(timer);
        req.signal?.removeEventListener("abort", onAbort);
      }
    },
  };
}

function parseAnswers(body: unknown, asks: Record<string, Ask>): Record<string, Verdict> {
  if (!isRecord(body) || !isRecord(body.answers)) throw new DecideError("malformed", "missing answers object");
  const out: Record<string, Verdict> = {};
  for (const [name, ask] of Object.entries(asks)) {
    const a = body.answers[name];
    if (!isRecord(a)) throw new DecideError("malformed", `no answer for question '${name}'`);
    if (a.type !== undefined && a.type !== ask.kind) throw new DecideError("malformed", "answer type mismatch");
    if (typeof a.choice !== "string") throw new DecideError("malformed", "choice is not a string");
    if (!isProb(a.confidence)) throw new DecideError("malformed", "confidence is not a number in 0..1");
    if (!isRecord(a.probabilities)) throw new DecideError("malformed", "probabilities is not an object");
    const probabilities: Record<string, number> = {};
    for (const [k, v] of Object.entries(a.probabilities)) {
      if (!isProb(v)) throw new DecideError("malformed", "probability is not a number in 0..1");
      probabilities[k] = v;
    }
    const known = Object.keys(ask.criteria);
    if (
      !known.includes(a.choice) ||
      !(a.choice in probabilities) ||
      Object.keys(probabilities).some((k) => !known.includes(k))
    ) {
      throw new DecideError("unknown_label", "answer names a label outside the criteria");
    }
    out[name] = { kind: "choice", label: a.choice, probabilities, confidence: a.confidence };
  }
  return out;
}

// ─── Gates ──────────────────────────────────────────────────────

export type FallThroughReason = DecideErrorCode | "low_confidence" | "low_margin" | "label_outside_edge_set";

export interface DeciderThresholds {
  minConfidence: number;
  minMargin: number;
}

export interface GateResult {
  accepted: boolean;
  reason?: FallThroughReason;
  /** Top probability minus the runner-up (0 when there is no runner-up). */
  margin: number;
}

/**
 * The thresholds a run uses: the workflow's, else the defaults, and never
 * looser than the floors (a programmatic caller can skip schema validation).
 */
export function resolveThresholds(config?: Pick<DeciderConfig, "min_confidence" | "min_margin">): DeciderThresholds {
  const pick = (v: number | undefined, dflt: number, floor: number) =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(floor, v)) : dflt;
  return {
    minConfidence: pick(config?.min_confidence, DECIDER_MIN_CONFIDENCE, DECIDER_CONFIDENCE_FLOOR),
    minMargin: pick(config?.min_margin, DECIDER_MIN_MARGIN, DECIDER_MARGIN_FLOOR),
  };
}

/** All gates must pass: label in the edge set, confidence, then top-two margin. */
export function gateVerdict(
  v: ChoiceVerdict,
  edgeSet: ReadonlySet<string>,
  thresholds: DeciderThresholds = resolveThresholds(),
): GateResult {
  const top = v.probabilities[v.label] ?? 0;
  const second = Math.max(
    0,
    ...Object.entries(v.probabilities)
      .filter(([k]) => k !== v.label)
      .map(([, p]) => p),
  );
  const margin = top - second;
  if (!edgeSet.has(v.label)) return { accepted: false, reason: "label_outside_edge_set", margin };
  if (!(v.confidence >= thresholds.minConfidence)) return { accepted: false, reason: "low_confidence", margin };
  if (!(margin >= thresholds.minMargin)) return { accepted: false, reason: "low_margin", margin };
  return { accepted: true, margin };
}

// ─── One run's decider ──────────────────────────────────────────

/** One decider call. Metadata only: no state, no prompts, no prose. */
export interface DeciderRecord {
  /** Node the route was decided at. */
  node: string;
  /** `decided`: the decider's label is the route. `fell_through`: the agent was asked, see `reason`. */
  outcome: "decided" | "fell_through";
  reason?: FallThroughReason;
  /** Edge target the decider picked (a node id). Null when it gave no answer. */
  label: string | null;
  confidence: number | null;
  margin: number | null;
  latency_ms: number;
  model: string;
  /** First 16 hex chars of sha256 over the state and criteria sent. */
  input_hash: string;
}

export function hashDecisionInput(state: unknown, criteria: Record<string, string>): string {
  let json: string;
  try {
    json = JSON.stringify({ state, criteria }) ?? "";
  } catch {
    json = "unserializable";
  }
  return crypto.createHash("sha256").update(json).digest("hex").slice(0, 16);
}

export interface RouteQuestion {
  node: string;
  question: string;
  /** The fenced, redacted routing view. */
  state: unknown;
  /** Every live out-edge target of the node, with its condition. */
  choices: { id: string; description: string }[];
  signal?: AbortSignal;
}

export interface RunDeciderOptions {
  thresholds?: DeciderThresholds;
  maxCalls?: number;
  breakerFailures?: number;
  timeoutMs?: number;
  /** Operator-facing messages (breaker opened, cap reached). Metadata only. */
  warn?: (msg: string) => void;
  /** Per-call log line. Metadata only. */
  info?: (msg: string, data?: Record<string, unknown>) => void;
}

/**
 * The decider for one run: thresholds, a circuit breaker and a call cap.
 * `decide()` returns the edge target to take, or null to ask the agent. It
 * never throws.
 */
export class RunDecider {
  readonly records: DeciderRecord[] = [];
  readonly thresholds: DeciderThresholds;
  private calls = 0;
  private failures = 0;
  private open = false;
  private capped = false;
  private readonly maxCalls: number;
  private readonly breakerFailures: number;
  private readonly timeoutMs: number;

  constructor(
    readonly provider: DecisionProvider,
    private readonly opts: RunDeciderOptions = {},
  ) {
    this.thresholds = opts.thresholds ?? resolveThresholds();
    this.maxCalls = opts.maxCalls ?? DECIDER_DEFAULT_MAX_CALLS;
    this.breakerFailures = opts.breakerFailures ?? DECIDER_BREAKER_FAILURES;
    this.timeoutMs = opts.timeoutMs ?? DECIDER_DEFAULT_TIMEOUT_MS;
  }

  /** Calls made this run. */
  get callCount(): number {
    return this.calls;
  }

  /** True once the breaker opened: no further calls this run. */
  get breakerOpen(): boolean {
    return this.open;
  }

  async decide(q: RouteQuestion): Promise<string | null> {
    if (this.open) return null;
    if (this.calls >= this.maxCalls) {
      if (!this.capped) {
        this.capped = true;
        this.opts.warn?.(`  decider: reached the ${this.maxCalls}-call cap for this run; the agent routes the rest.`);
      }
      return null;
    }
    this.calls++;

    const criteria: Record<string, string> = {};
    for (const c of q.choices) if (!(c.id in criteria)) criteria[c.id] = c.description;
    const edgeSet = new Set(Object.keys(criteria));
    const input_hash = hashDecisionInput(q.state, criteria);
    const started = Date.now();
    const base = { node: q.node, model: this.provider.model, input_hash };

    let rec: DeciderRecord;
    try {
      const out = await this.provider.decide({
        state: q.state,
        asks: { route: { kind: "choice", instructions: q.question, criteria } },
        timeoutMs: this.timeoutMs,
        signal: q.signal,
      });
      const v = out.route;
      if (!v || v.kind !== "choice") throw new DecideError("malformed", "no route answer");
      this.failures = 0;
      const gate = gateVerdict(v, edgeSet, this.thresholds);
      rec = {
        ...base,
        outcome: gate.accepted ? "decided" : "fell_through",
        ...(gate.reason ? { reason: gate.reason } : {}),
        label: v.label,
        confidence: v.confidence,
        margin: gate.margin,
        latency_ms: Date.now() - started,
      };
    } catch (err) {
      const code: FallThroughReason = err instanceof DecideError ? err.code : "malformed";
      // An aborted run is not the provider's fault.
      if (code !== "aborted") this.failures++;
      rec = {
        ...base,
        outcome: "fell_through",
        reason: code,
        label: null,
        confidence: null,
        margin: null,
        latency_ms: Date.now() - started,
      };
      if (this.failures >= this.breakerFailures && !this.open) {
        this.open = true;
        this.opts.warn?.(
          `  decider: ${this.failures} failed calls in a row (last: ${code}); not calling it again this run.`,
        );
      }
    }

    this.records.push(rec);
    try {
      const what =
        rec.outcome === "decided"
          ? `'${q.node}' -> '${rec.label}'`
          : `'${q.node}' fell through (${rec.reason}); asking the agent`;
      this.opts.info?.(`  route decider: ${what}`, { ...rec });
    } catch {
      // logging never affects a route
    }
    return rec.outcome === "decided" ? rec.label : null;
  }
}

/**
 * Resolve the run's decider, or null (no `decider` block, disabled for the
 * run, or a declared key env var is unset). No hosted fallback exists: null
 * means no HTTP at all.
 */
export function createRunDecider(
  config: DeciderConfig | undefined,
  enabled: boolean | undefined,
  env: NodeJS.ProcessEnv,
  opts: Omit<RunDeciderOptions, "thresholds"> = {},
): RunDecider | null {
  if (enabled === false || !config?.provider) return null;
  const p = config.provider;
  let apiKey: string | undefined;
  if (p.api_key_env) {
    apiKey = env[p.api_key_env];
    if (!apiKey) {
      opts.warn?.(`  decider: env var ${p.api_key_env} is not set; the agent routes this run.`);
      return null;
    }
  }
  return new RunDecider(systemOneProvider({ baseUrl: p.base_url, model: p.model, apiKey }), {
    ...opts,
    thresholds: resolveThresholds(config),
  });
}
