/**
 * Decision models (#357): a fast typed classifier that decides routes.
 *
 * A System One decision model (Ollama `/v1/systemone`, TypeSafe Jev) answers
 * one Choice question over a state in milliseconds. For a node that sets
 * `route_by: decider` and whose conditional out-edges are natural language,
 * the route ladder is:
 *
 *   1. `when` expressions: sweny evaluates them, no model call (executor.ts).
 *   2. The decider: its answer is the route only when the label is one of the
 *      node's live out-edges, confidence is at least `min_confidence` and the
 *      top label leads the runner-up by at least `min_margin`. Then the agent
 *      is never asked.
 *   3. The agent's route evaluation, exactly as without a decider.
 *
 * Any decider problem (timeout, HTTP error, malformed answer, unknown label,
 * low confidence or margin, no routable state, open breaker, spent cap) falls
 * through to rung 3.
 *
 * Trust boundary: the endpoint, model and key come only from operator config
 * (`.sweny.yml` or SWENY_DECIDER_* env), never from the workflow, and the
 * URL must not point at a private, link-local or metadata address unless the
 * operator allows private addresses. The state sent is an explicit projection
 * of declared typed fields (see executor.ts), redacted and fenced. What this
 * module logs is metadata only (edge target ids, numbers and a hash).
 */

import crypto from "node:crypto";
import { DECIDER_CONFIDENCE_FLOOR, DECIDER_MARGIN_FLOOR, DECIDER_MIN_CONFIDENCE, DECIDER_MIN_MARGIN } from "./types.js";

/** Per-call timeout. */
export const DECIDER_DEFAULT_TIMEOUT_MS = 2000;
/** Consecutive failed calls that open the breaker for the rest of the run. */
export const DECIDER_BREAKER_FAILURES = 3;
/** Decider calls one logical run (resumes included) may make. */
export const DECIDER_DEFAULT_MAX_CALLS = 200;
/** Probabilities must sum to 1 within this. */
export const DECIDER_SUM_TOLERANCE = 0.01;
/** Float slack for the threshold comparisons (0.6 - 0.4 is 0.19999999999999996). */
const EPS = 1e-9;

/** Workflow-level `decider` block: thresholds only. */
export interface DeciderConfig {
  /** Default 0.85, never below 0.7. */
  min_confidence?: number;
  /** Default 0.2, never below 0.1. */
  min_margin?: number;
}

/**
 * Operator config: where the decision model lives. From `.sweny.yml`
 * `decider: { url, model, allow_private }` and SWENY_DECIDER_URL /
 * SWENY_DECIDER_MODEL / SWENY_DECIDER_API_KEY in the CLI, or passed by a
 * library caller. Never read from a workflow file.
 */
export interface DeciderOperatorConfig {
  /** Server root serving POST /v1/systemone. http or https only. */
  url: string;
  model: string;
  /** Bearer key. The CLI reads it only from SWENY_DECIDER_API_KEY. */
  apiKey?: string;
  /** Allow loopback and private addresses (local Ollama). Link-local and metadata addresses stay refused. */
  allowPrivate?: boolean;
  /** Per-call timeout in ms. Default 2000. */
  timeoutMs?: number;
  /** Calls per logical run. Default 200. */
  maxCalls?: number;
}

// ─── Provider contract ──────────────────────────────────────────

/** One Choice question: pick a key of `criteria`. */
export interface ChoiceAsk {
  kind: "choice";
  instructions: string;
  criteria: Record<string, string>;
}

export type Ask = ChoiceAsk;

export interface ChoiceVerdict {
  kind: "choice";
  label: string;
  /** Exactly the criteria keys (null prototype). */
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

// ─── URL policy ─────────────────────────────────────────────────

function ipv4(host: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every((p) => p <= 255) ? parts : null;
}

function ipv6(host: string): number[] | null {
  if (!host.includes(":")) return null;
  let h = host;
  // Trailing dotted IPv4 (::ffff:1.2.3.4).
  const tail = /:(\d+\.\d+\.\d+\.\d+)$/.exec(h);
  if (tail) {
    const v4 = ipv4(tail[1]);
    if (!v4) return null;
    h = h.slice(0, -tail[1].length) + ((v4[0] << 8) | v4[1]).toString(16) + ":" + ((v4[2] << 8) | v4[3]).toString(16);
  }
  const halves = h.split("::");
  if (halves.length > 2) return null;
  const parse = (s: string) =>
    s === "" ? [] : s.split(":").map((g) => (/^[0-9a-f]{1,4}$/i.test(g) ? parseInt(g, 16) : NaN));
  const head = parse(halves[0]);
  const rest = halves.length === 2 ? parse(halves[1]) : [];
  if ([...head, ...rest].some((n) => Number.isNaN(n))) return null;
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  return [...head, ...Array<number>(fill).fill(0), ...rest];
}

type AddressClass = "public" | "private" | "forbidden";

function classifyV4([a, b]: number[]): AddressClass {
  if (a === 169 && b === 254) return "forbidden"; // link-local, cloud metadata (169.254.169.254)
  if (a === 0) return "forbidden";
  if (a === 100 && b === 100) return "forbidden"; // 100.100.100.200 metadata
  if (a === 127 || a === 10) return "private";
  if (a === 172 && b >= 16 && b <= 31) return "private";
  if (a === 192 && b === 168) return "private";
  if (a === 100 && b >= 64 && b <= 127) return "private"; // CGNAT
  if (a >= 224) return "forbidden"; // multicast, reserved
  return "public";
}

function classifyHost(hostname: string): AddressClass {
  const host = hostname
    .replace(/^\[|\]$/g, "")
    .toLowerCase()
    .replace(/\.$/, "");
  if (host === "localhost" || host.endsWith(".localhost")) return "private";
  if (host === "metadata" || host === "metadata.google.internal" || host === "instance-data") return "forbidden";
  if (host.endsWith(".internal") || host.endsWith(".local")) return "private";
  const v4 = ipv4(host);
  if (v4) return classifyV4(v4);
  const v6 = ipv6(host);
  if (v6) {
    if (v6.every((g) => g === 0)) return "forbidden"; // ::
    if (v6.slice(0, 7).every((g) => g === 0) && v6[7] === 1) return "private"; // ::1
    if (v6.slice(0, 5).every((g) => g === 0) && v6[5] === 0xffff) {
      return classifyV4([v6[6] >> 8, v6[6] & 0xff, v6[7] >> 8, v6[7] & 0xff]); // IPv4-mapped
    }
    if ((v6[0] & 0xffc0) === 0xfe80) return "forbidden"; // link-local
    if (v6[0] === 0xfd00 && v6[1] === 0x0ec2) return "forbidden"; // AWS metadata fd00:ec2::254
    if ((v6[0] & 0xfe00) === 0xfc00) return "private"; // unique local
    if ((v6[0] & 0xff00) === 0xff00) return "forbidden"; // multicast
    return "public";
  }
  return "public";
}

/**
 * Why the operator's decider URL is refused, or null when it may be used.
 * Only http(s), no credentials in the URL, no link-local or metadata address
 * ever, and loopback or private addresses only with `allowPrivate`. A DNS
 * name is judged by its text: it is operator config, not workflow input.
 */
export function deciderUrlProblem(raw: string, allowPrivate = false): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "decider url is not a valid URL";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "decider url must be http or https";
  if (url.username || url.password) return "decider url must not carry credentials (use SWENY_DECIDER_API_KEY)";
  const cls = classifyHost(url.hostname);
  if (cls === "forbidden") return "decider url points at a link-local, metadata or reserved address";
  if (cls === "private" && !allowPrivate) {
    return "decider url is a loopback or private address; set allow_private: true in the .sweny.yml decider block to use a local server";
  }
  return null;
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
const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/**
 * `POST {baseUrl}/v1/systemone`. Ollama (local) and TypeSafe Jev (hosted)
 * share this wire shape; only base URL, key and model differ. Response
 * validation is strict: any deviation is a `malformed` or `unknown_label`
 * error, never a guess. Error messages carry no URL and no key.
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
            redirect: "error",
          });
        } catch {
          if (timedOut) throw new DecideError("timeout", `no answer within ${timeoutMs}ms`);
          if (ctl.signal.aborted) throw new DecideError("aborted", "request aborted");
          throw new DecideError("network", "request failed");
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
          if (ctl.signal.aborted) throw new DecideError("aborted", "request aborted");
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

/**
 * Strict: `probabilities` holds exactly the criteria keys, each finite in
 * [0, 1], summing to 1 within {@link DECIDER_SUM_TOLERANCE}; the chosen label
 * is a criteria key, compared exactly (no normalization), and the unique
 * maximum. Anything else throws.
 */
export function parseAnswers(body: unknown, asks: Record<string, Ask>): Record<string, Verdict> {
  if (!isRecord(body) || !isRecord(body.answers)) throw new DecideError("malformed", "missing answers object");
  const answers = body.answers;
  const out: Record<string, Verdict> = Object.create(null);
  for (const [name, ask] of Object.entries(asks)) {
    const a = own(answers, name) ? answers[name] : undefined;
    if (!isRecord(a)) throw new DecideError("malformed", `no answer for question '${name}'`);
    if (a.type !== undefined && a.type !== ask.kind) throw new DecideError("malformed", "answer type mismatch");
    if (typeof a.choice !== "string") throw new DecideError("malformed", "choice is not a string");
    if (!isProb(a.confidence)) throw new DecideError("malformed", "confidence is not a number in 0..1");
    if (!isRecord(a.probabilities)) throw new DecideError("malformed", "probabilities is not an object");
    const known = new Set(Object.keys(ask.criteria));
    if (!known.has(a.choice)) throw new DecideError("unknown_label", "answer names a label outside the criteria");
    const got = Object.keys(a.probabilities);
    if (got.some((k) => !known.has(k)))
      throw new DecideError("unknown_label", "probabilities name a label outside the criteria");
    if (got.length !== known.size) throw new DecideError("malformed", "probabilities do not cover every label");
    const probabilities: Record<string, number> = Object.create(null);
    let sum = 0;
    for (const k of got) {
      const v = a.probabilities[k];
      if (!isProb(v)) throw new DecideError("malformed", "probability is not a number in 0..1");
      probabilities[k] = v;
      sum += v;
    }
    if (Math.abs(sum - 1) > DECIDER_SUM_TOLERANCE) throw new DecideError("malformed", "probabilities do not sum to 1");
    const top = probabilities[a.choice];
    if (got.some((k) => k !== a.choice && probabilities[k] >= top)) {
      throw new DecideError("malformed", "the chosen label is not the unique most probable one");
    }
    out[name] = { kind: "choice", label: a.choice, probabilities, confidence: a.confidence };
  }
  return out;
}

// ─── Gates ──────────────────────────────────────────────────────

export type FallThroughReason =
  DecideErrorCode | "low_confidence" | "low_margin" | "label_outside_edge_set" | "no_routable_state";

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

/** The workflow's thresholds, else the defaults, never looser than the floors, never above 1. */
export function resolveThresholds(config?: DeciderConfig): DeciderThresholds {
  const pick = (v: number | undefined, dflt: number, floor: number) =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(floor, v)) : dflt;
  return {
    minConfidence: pick(config?.min_confidence, DECIDER_MIN_CONFIDENCE, DECIDER_CONFIDENCE_FLOOR),
    minMargin: pick(config?.min_margin, DECIDER_MIN_MARGIN, DECIDER_MARGIN_FLOOR),
  };
}

/** All gates must pass: label in the edge set, confidence, then top-two margin (each with float slack). */
export function gateVerdict(
  v: ChoiceVerdict,
  edgeSet: ReadonlySet<string>,
  thresholds: DeciderThresholds = resolveThresholds(),
): GateResult {
  const top = own(v.probabilities, v.label) ? v.probabilities[v.label] : 0;
  let second = 0;
  for (const [k, p] of Object.entries(v.probabilities)) if (k !== v.label && p > second) second = p;
  const margin = top - second;
  if (!edgeSet.has(v.label)) return { accepted: false, reason: "label_outside_edge_set", margin };
  if (!(v.confidence >= thresholds.minConfidence - EPS)) return { accepted: false, reason: "low_confidence", margin };
  if (!(margin >= thresholds.minMargin - EPS)) return { accepted: false, reason: "low_margin", margin };
  return { accepted: true, margin };
}

// ─── One run's decider ──────────────────────────────────────────

/** One decider consultation. Metadata only: no state, no prompts, no prose. */
export interface DeciderRecord {
  /** Node the route was decided at. */
  node: string;
  /** `decided`: the label is the route. `fell_through`: the agent was asked. `skipped`: no call was made. */
  outcome: "decided" | "fell_through" | "skipped";
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

/** The breaker and cap counters, journaled so they span resumes. */
export interface DeciderCounters {
  calls: number;
  failures: number;
  open: boolean;
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
  /** The fenced, redacted routing projection. */
  state: unknown;
  /** Every live out-edge target of the node, with its condition. */
  choices: { id: string; description: string }[];
  signal?: AbortSignal;
}

export interface RunDeciderOptions {
  /** Raw workflow thresholds; clamped to the floors here. */
  config?: DeciderConfig;
  maxCalls?: number;
  breakerFailures?: number;
  timeoutMs?: number;
  /** Counters carried over from an earlier attempt of the same run (resume). */
  counters?: DeciderCounters;
  /** Operator-facing messages (breaker opened, cap reached). Metadata only. */
  warn?: (msg: string) => void;
  /** Per-call log line. Metadata only. */
  info?: (msg: string, data?: Record<string, unknown>) => void;
}

/**
 * The decider for one logical run: thresholds, a circuit breaker and a call
 * cap. `decide()` returns the edge target to take, or null to ask the agent.
 * It never throws.
 */
export class RunDecider {
  readonly records: DeciderRecord[] = [];
  readonly thresholds: DeciderThresholds;
  /** Set when the breaker opened or the cap was reached. */
  offReason?: string;
  private calls: number;
  private failures: number;
  private open: boolean;
  private capped = false;
  private readonly maxCalls: number;
  private readonly breakerFailures: number;
  private readonly timeoutMs: number;

  constructor(
    readonly provider: DecisionProvider,
    private readonly opts: RunDeciderOptions = {},
  ) {
    this.thresholds = resolveThresholds(opts.config);
    this.maxCalls = Math.max(0, Math.floor(opts.maxCalls ?? DECIDER_DEFAULT_MAX_CALLS));
    this.breakerFailures = Math.max(1, Math.floor(opts.breakerFailures ?? DECIDER_BREAKER_FAILURES));
    this.timeoutMs = opts.timeoutMs ?? DECIDER_DEFAULT_TIMEOUT_MS;
    this.calls = opts.counters?.calls ?? 0;
    this.failures = opts.counters?.failures ?? 0;
    this.open = opts.counters?.open ?? false;
    if (this.open) this.offReason = `breaker open after ${this.breakerFailures} failed calls`;
  }

  get counters(): DeciderCounters {
    return { calls: this.calls, failures: this.failures, open: this.open };
  }

  /** Record that a route skipped the decider without a call (no HTTP). */
  skip(node: string, reason: FallThroughReason): void {
    const rec: DeciderRecord = {
      node,
      outcome: "skipped",
      reason,
      label: null,
      confidence: null,
      margin: null,
      latency_ms: 0,
      model: this.provider.model,
      input_hash: "",
    };
    this.records.push(rec);
    this.log(`  route decider: '${node}' skipped (${reason}); asking the agent`, rec);
  }

  async decide(q: RouteQuestion): Promise<string | null> {
    if (this.open) return null;
    if (this.calls >= this.maxCalls) {
      if (!this.capped) {
        this.capped = true;
        this.offReason = `call cap of ${this.maxCalls} reached`;
        this.opts.warn?.(`  decider: reached the ${this.maxCalls}-call cap for this run; the agent routes the rest.`);
      }
      return null;
    }
    this.calls++;

    const criteria: Record<string, string> = Object.create(null);
    for (const c of q.choices) if (!own(criteria, c.id)) criteria[c.id] = c.description;
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
      const v = own(out, "route") ? out.route : undefined;
      if (!v || v.kind !== "choice") throw new DecideError("malformed", "no route answer");
      // A valid answer, even a low-confidence one, means the provider works.
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
        this.offReason = `breaker open after ${this.failures} failed calls`;
        this.opts.warn?.(
          `  decider: ${this.failures} failed calls in a row (last: ${code}); not calling it again this run.`,
        );
      }
    }

    this.records.push(rec);
    this.log(
      rec.outcome === "decided"
        ? `  route decider: '${q.node}' -> '${rec.label}'`
        : `  route decider: '${q.node}' fell through (${rec.reason}); asking the agent`,
      rec,
    );
    return rec.outcome === "decided" ? rec.label : null;
  }

  private log(msg: string, rec: DeciderRecord): void {
    try {
      this.opts.info?.(msg, { ...rec });
    } catch {
      // logging never affects a route
    }
  }
}

/** True when some node opts into the decider. */
export function wantsDecider(nodes: Record<string, { route_by?: string }>): boolean {
  return Object.values(nodes).some((n) => n.route_by === "decider");
}

/**
 * Resolve the run's decider. `decider` is null with `off` set to the reason
 * when the workflow opted nodes in but the decider cannot run; both are empty
 * when no node opted in. No hosted fallback exists: null means no HTTP.
 */
export function createRunDecider(
  operator: DeciderOperatorConfig | false | undefined,
  workflow: { decider?: DeciderConfig; nodes: Record<string, { route_by?: string }> },
  opts: Omit<RunDeciderOptions, "config" | "maxCalls" | "timeoutMs"> = {},
): { decider: RunDecider | null; off?: string } {
  if (!wantsDecider(workflow.nodes)) return { decider: null };
  if (operator === false) return { decider: null, off: "disabled for this run (--no-decider)" };
  if (!operator || !operator.url || !operator.model) {
    return {
      decider: null,
      off: "no operator config (set SWENY_DECIDER_URL and SWENY_DECIDER_MODEL, or decider: in .sweny.yml)",
    };
  }
  const problem = deciderUrlProblem(operator.url, operator.allowPrivate === true);
  if (problem) return { decider: null, off: problem };
  const provider = systemOneProvider({
    baseUrl: operator.url,
    model: operator.model,
    ...(operator.apiKey ? { apiKey: operator.apiKey } : {}),
  });
  return {
    decider: new RunDecider(provider, {
      ...opts,
      config: workflow.decider,
      ...(operator.maxCalls !== undefined ? { maxCalls: operator.maxCalls } : {}),
      ...(operator.timeoutMs !== undefined ? { timeoutMs: operator.timeoutMs } : {}),
    }),
  };
}
