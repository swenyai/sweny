/**
 * Decision models (#357), shadow mode.
 *
 * A System One decision model (Ollama `/v1/systemone`, TypeSafe Jev) answers
 * one typed Choice question over a state in milliseconds. In shadow mode the
 * executor asks it the same route question the agent answers, in parallel,
 * and records whether they agree. The route is ALWAYS the agent's.
 *
 * Privacy: the state goes only to the provider the workflow configured, never
 * to a default or fallback URL. What this module logs is metadata only
 * (labels are edge target node ids, plus numbers and a hash).
 */

import crypto from "node:crypto";

/** Accept a decider answer only at or above this confidence. */
export const DECIDER_MIN_CONFIDENCE = 0.85;
/** ... and only when the top label leads the runner-up by at least this much. */
export const DECIDER_MIN_MARGIN = 0.2;
/** Per-call timeout when the provider does not set one. */
export const DECIDER_DEFAULT_TIMEOUT_MS = 2000;

export type DeciderMode = "off" | "shadow";

/** Workflow-level `decider` block. */
export interface DeciderConfig {
  mode: DeciderMode;
  provider?: {
    /** Server root, e.g. `http://localhost:11434` or `https://api.typesafe.ai`. */
    base_url: string;
    model: string;
    /** Name of the env var holding the bearer key. Never the key itself. */
    api_key_env?: string;
  };
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

export interface GateResult {
  accepted: boolean;
  reason?: FallThroughReason;
  /** Top probability minus the runner-up (0 when there is no runner-up). */
  margin: number;
}

/** All gates must pass: label in the edge set, confidence, then top-two margin. */
export function gateVerdict(v: ChoiceVerdict, edgeSet: ReadonlySet<string>): GateResult {
  const top = v.probabilities[v.label] ?? 0;
  const second = Math.max(
    0,
    ...Object.entries(v.probabilities)
      .filter(([k]) => k !== v.label)
      .map(([, p]) => p),
  );
  const margin = top - second;
  if (!edgeSet.has(v.label)) return { accepted: false, reason: "label_outside_edge_set", margin };
  if (!(v.confidence >= DECIDER_MIN_CONFIDENCE)) return { accepted: false, reason: "low_confidence", margin };
  if (!(margin >= DECIDER_MIN_MARGIN)) return { accepted: false, reason: "low_margin", margin };
  return { accepted: true, margin };
}

// ─── Shadow decision ────────────────────────────────────────────

/** One logged shadow decision. Metadata only: no state, no prompts, no prose. */
export interface DeciderRecord {
  /** Node the route was decided at. */
  node: string;
  /** Edge target the decider picked (a node id). Null when it gave no answer. */
  decider_label: string | null;
  /** Edge target the agent picked. Null when the agent's evaluation failed. */
  agent_label: string | null;
  confidence: number | null;
  margin: number | null;
  /** `compared`: the decider passed every gate. `fell_through`: it did not, see `reason`. */
  outcome: "compared" | "fell_through";
  reason?: FallThroughReason | "agent_failed";
  /** Decider label equals agent label. Null unless `outcome` is `compared`. */
  agree: boolean | null;
  latency_ms: number;
  model: string;
  /** First 16 hex chars of sha256 over the state and criteria sent. */
  input_hash: string;
}

/** What the executor holds for one run in shadow mode. */
export interface ShadowDecider {
  provider: DecisionProvider;
  records: DeciderRecord[];
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

export interface PendingShadow {
  /** Never rejects. */
  settled: Promise<Omit<DeciderRecord, "agent_label" | "agree" | "node">>;
  edgeSet: ReadonlySet<string>;
}

/**
 * Start the decider call. Returns at once; the promise never rejects, so the
 * agent's own evaluation is never delayed or failed by it.
 */
export function startShadowDecision(
  provider: DecisionProvider,
  req: { question: string; state: unknown; choices: { id: string; description: string }[]; signal?: AbortSignal },
): PendingShadow {
  const criteria: Record<string, string> = {};
  for (const c of req.choices) if (!(c.id in criteria)) criteria[c.id] = c.description;
  const edgeSet = new Set(Object.keys(criteria));
  const input_hash = hashDecisionInput(req.state, criteria);
  const started = Date.now();
  const base = { model: provider.model, input_hash };

  const settled = (async () => {
    try {
      const out = await provider.decide({
        state: req.state,
        asks: { route: { kind: "choice", instructions: req.question, criteria } },
        timeoutMs: DECIDER_DEFAULT_TIMEOUT_MS,
        signal: req.signal,
      });
      const v = out.route;
      if (!v || v.kind !== "choice") throw new DecideError("malformed", "no route answer");
      const gate = gateVerdict(v, edgeSet);
      return {
        ...base,
        decider_label: v.label,
        confidence: v.confidence,
        margin: gate.margin,
        outcome: gate.accepted ? ("compared" as const) : ("fell_through" as const),
        ...(gate.reason ? { reason: gate.reason } : {}),
        latency_ms: Date.now() - started,
      };
    } catch (err) {
      return {
        ...base,
        decider_label: null,
        confidence: null,
        margin: null,
        outcome: "fell_through" as const,
        reason: err instanceof DecideError ? err.code : ("malformed" as const),
        latency_ms: Date.now() - started,
      };
    }
  })();

  return { settled, edgeSet };
}

/** Join the decider's settled result with the agent's choice. */
export async function finishShadowDecision(
  pending: PendingShadow,
  node: string,
  agentLabel: string | null,
): Promise<DeciderRecord> {
  const s = await pending.settled;
  if (s.outcome === "fell_through") return { node, agent_label: agentLabel, agree: null, ...s };
  if (agentLabel === null) {
    return { node, agent_label: null, agree: null, ...s, outcome: "fell_through", reason: "agent_failed" };
  }
  return { node, agent_label: agentLabel, agree: s.decider_label === agentLabel, ...s };
}

/** `{ compared, agreed, fell_through }` over a run's records. */
export function summarizeDecisions(records: readonly DeciderRecord[]): {
  compared: number;
  agreed: number;
  fell_through: number;
} {
  let compared = 0;
  let agreed = 0;
  for (const r of records) {
    if (r.outcome === "compared") {
      compared++;
      if (r.agree) agreed++;
    }
  }
  return { compared, agreed, fell_through: records.length - compared };
}

/**
 * Resolve the run's shadow decider, or null (mode off, nothing configured, or
 * a declared key env var is unset). No hosted fallback exists: null means no
 * HTTP at all.
 */
export function createShadowDecider(
  config: DeciderConfig | undefined,
  modeOverride: DeciderMode | undefined,
  env: NodeJS.ProcessEnv,
  warn: (msg: string) => void,
): ShadowDecider | null {
  const mode = modeOverride ?? config?.mode ?? "off";
  if (mode !== "shadow") return null;
  const p = config?.provider;
  if (!p) {
    warn("  decider: shadow mode needs decider.provider in the workflow; running without it.");
    return null;
  }
  let apiKey: string | undefined;
  if (p.api_key_env) {
    apiKey = env[p.api_key_env];
    if (!apiKey) {
      warn(`  decider: env var ${p.api_key_env} is not set; running without the decider.`);
      return null;
    }
  }
  return { provider: systemOneProvider({ baseUrl: p.base_url, model: p.model, apiKey }), records: [] };
}
