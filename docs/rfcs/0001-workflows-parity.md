# RFC 0001: What to borrow from Claude Code `/workflows`

Status: draft, planning only. No engine changes proposed for merge yet.
Author: Nate
Date: 2026-05-29

## Why this exists

Claude Code shipped a built-in `Workflow` tool (`/workflows`): a JS orchestration
runtime that fans out subagents, pipelines work, enforces structured output, and
resumes from a journal. It overlaps SWEny's engine at the orchestration layer. This
RFC reverse-engineers that tool, diffs it against what our executor does today, and
proposes which ideas are worth borrowing and which we should deliberately skip.

This is a planning doc. It picks no fights with the code yet. The goal is to agree on
direction before anyone touches `executor.ts`.

## What `/workflows` actually is

Source of truth: the `Workflow` tool contract exposed in the Claude Code system
prompt (the canonical spec), cross-checked against the shipped binary
(`~/.local/share/claude/versions/2.1.158`, a Bun single-file executable). The binary
confirms the runtime markers but is compiled, so the contract is the readable spec.
Confirmed strings include `StructuredOutput schema mismatch:` and `resumeFromRunId`.

It is an **imperative JS orchestrator**. You write a script that calls primitives:

- `agent(prompt, {schema, model, isolation, agentType, phase, label})` spawns a
  subagent and returns its text, or a schema-validated object.
- `parallel(thunks)` runs tasks concurrently with a **barrier** (awaits all).
- `pipeline(items, ...stages)` runs each item through all stages with **no barrier**
  between stages, so item A can be in stage 3 while item B is still in stage 1.
- `workflow(nameOrRef, args)` runs another workflow inline, one level deep.
- `log()` / `phase()` for progress narration.
- `budget` with `total`, `spent()`, `remaining()` as a **hard token ceiling**.

Runtime properties worth noting:

- Concurrency cap of `min(16, cores - 2)` per workflow; excess `agent()` calls queue.
- Lifetime cap of 1000 agents as a runaway backstop.
- Structured output is enforced at the tool-call layer: the subagent is forced to call
  a `StructuredOutput` tool, and the model **retries** on schema mismatch.
- `resumeFromRunId` replays the longest unchanged prefix of `agent()` calls from a
  journal, instantly, and only re-runs the first edited/new call onward.
- `isolation: 'worktree'` gives a file-mutating agent its own git worktree.

The thing to internalize: control flow is **code**, and steps are **generic Claude
subagents**. There is no persisted graph, no declarative definition, no per-step tool
scoping, no observability plane. It is a one-shot, in-session harness for a single
human task (review this PR, research this question, migrate these files).

## What SWEny does today

Evidence from `packages/core/src/executor.ts`:

- Execution is a **single-pointer sequential walk**: `let currentId = workflow.entry;
  while (currentId) { ... }` (`executor.ts:161-163`). One node is active at a time.
- The "DAG" is really a routed state machine. Conditional edges are resolved by an
  LLM picking one next node (`resolveNext` / `advanceFromNode`, `executor.ts:801-933`).
  Even with multiple out-edges, traversal follows **one** path.
- Budgets that exist: a **step budget** (total node executions, `max_steps`,
  `executor.ts:171-179`) and a **judge budget** (count of `kind: judge` evaluators,
  default 50, `warnOnJudgeBudget` at `executor.ts:483`). Neither is a token/cost budget.
- Structured output exists as a node `output` JSON schema, checked with
  `findMissingRequiredFields` (`executor.ts:635`). On a miss the node fails or retries
  per the node's `retry` policy; there is no force-and-retry at the model tool layer.
- `requires` pre-condition gates (`executor.ts:217`), evaluators (value / function /
  judge), and per-edge `max_iterations` for bounded loops.
- Per-node skill/MCP scoping: each node wires only its declared skills' MCP servers.
- No resume. No checkpoint/journal. A reran workflow starts from `entry` every time.
- No worktree isolation (single linear path means no concurrent file writers anyway).

SWEny's differentiators that `/workflows` has none of: a **declarative, persisted,
runner-agnostic** workflow definition; per-node tool scoping; evaluators as a
first-class audit mechanism; and the cloud intelligence plane that ingests every run.

## Gap analysis

| `/workflows` capability | SWEny today | Borrow? |
|---|---|---|
| `parallel()` / `pipeline()` + concurrency cap | single-path walk | **Yes**, highest value |
| Token budget as hard ceiling | step + judge budgets only | **Yes**, cheapest win |
| `resumeFromRunId` journal + cached prefix | none | **Yes**, high CI value |
| Structured output forced + model retry | validate-only, node fails | **Yes**, small |
| `workflow()` sub-workflow composition | separate top-level workflows | Maybe |
| Worktree isolation per agent | none | Only if we do parallel file writers |
| Imperative JS control flow | declarative YAML DAG | **No**, this is our moat |
| Generic ungoverned subagents | scoped skills per node | **No**, keep scoping |

## Proposals

Ordered by value-to-risk. Each notes the schema surface, the executor surface, and the
SWEny principle it has to respect (runner-agnostic, declarative, cloud-friendly).

### P1. Token budget (cheapest, self-contained)

**Motivation.** We already terminate on step count and warn on judge count. We do not
cap spend. A looping route or a fan-out (once P2 lands) can burn real money in CI with
no ceiling. `/workflows` treats `budget.total` as a hard stop.

**Design.**
- Schema: add optional `token_budget` to the workflow (sibling of `max_steps`,
  `judge_budget`). Units: total model tokens across all node invocations and judges.
- Executor: thread a running token tally through the run loop. The Claude client
  already returns usage per call (`claude.ts`); accumulate it. Before each node
  invocation, if `spent >= token_budget`, throw a loud `token budget exceeded` error in
  the same style as the step-budget throw (`executor.ts:172`).
- Emit `tokens_spent` on the trace and as an execution event so cloud and Studio can
  chart it. This doubles as a cloud-intelligence signal, which fits SOUL belief #1.

**Tradeoffs.** Token accounting depends on the provider returning usage. For agents
that do not (some coding-agent paths), fall back to step budget and `log()` that the
token ceiling is not enforced for that node rather than silently ignoring it.

**Risk.** Low. Additive field, additive accounting, no control-flow change.

### P2. Parallel fan-out (highest value, real surgery)

**Motivation.** The single-path walk blocks every multi-agent pattern that makes
`/workflows` useful: judge panels, multi-finder sweeps, per-item pipelines. A workflow
that wants to "review across 5 dimensions then verify each finding" cannot express it
today. This is the gap that matters.

**Design (declarative, not imperative).** Do not import JS control flow. Express
parallelism in the DAG:
- Allow a node to fan out over a collection: a `fan_out` node that takes an array from
  a prior node's output and runs the same downstream subgraph per item, with a
  `concurrency` cap (default `min(16, cores - 2)`, matching `/workflows`).
- Allow multiple unconditional out-edges to mean "run all targets concurrently" instead
  of "pick one." A `join` node waits for all its in-edges before running. This is the
  declarative equivalent of `parallel()`.
- Keep the routed-single-path semantics for **conditional** edges unchanged. Fan-out is
  opt-in via `fan_out` / multi-edge join, so existing workflows behave identically.

**Executor surface.** This is the big one. The `while (currentId)` walk becomes a
frontier: a set of ready nodes, a `p-limit`-style concurrency gate, and a join-barrier
that fires a node only when all its predecessors have completed. Results map stays
keyed by node id; fan-out items get indexed keys (`node[0]`, `node[1]`). The step and
token budgets become shared counters across the frontier, same as `/workflows` shares
its budget pool.

**Tradeoffs / risks.** High. Touches the core loop, the trace shape, and Studio's
renderer. Needs careful design of how `requires` and per-node `evals` compose with
indexed fan-out results. Worth its own follow-up RFC before any code. Recommend we
prototype the frontier executor behind the existing single-path one and switch only
when the trace and Studio handle indexed nodes.

### P3. Resume from journal (high CI value)

**Motivation.** Today a rerun starts at `entry` and re-pays for every node. `/workflows`
caches the unchanged prefix and only re-runs from the first changed step. For SWEny in
CI, where a flaky late node fails a 6-node workflow, this is direct money and time saved.

**Design.**
- Persist a per-run journal: for each completed node, store `{nodeId, iteration,
  inputHash, output, toolCalls, evals}`. Keyed by a run id.
- On rerun with `--resume <runId>` (CLI) or a resume input (Action), replay nodes whose
  `inputHash` (workflow def + node instruction + upstream outputs) is unchanged, and
  start live execution at the first changed/failed node.
- Storage must be **runner-agnostic** (SOUL: never assume GitHub Actions). Default to a
  local journal file under the working dir; let the Action cache it as an artifact.
  Optionally the cloud can store journals later, but the engine must not depend on it.

**Tradeoffs.** The hash has to be conservative: if anything upstream changed, do not
reuse. A wrong cache hit is worse than a cache miss. Determinism of LLM nodes means we
are caching the *recorded output*, not re-deriving it, which is exactly what we want for
a rerun.

**Risk.** Medium. Additive (`--resume` is opt-in), but the input-hash design needs care.

### P4. Force-and-retry structured output (small polish)

**Motivation.** We validate a node's `output` against its schema and fail/retry the
whole node. `/workflows` forces the subagent to emit through a `StructuredOutput` tool
and retries at the model layer on mismatch, which is tighter and cheaper than a full
node retry.

**Design.** When a node declares `output`, pass the schema to the Claude client as a
forced tool/structured-output constraint (the SDK supports this) rather than parsing
free text after the fact. Keep the existing post-validation as a backstop.

**Risk.** Low-medium. Depends on the coding-agent path supporting forced structured
output uniformly; where it does not, keep today's behavior.

### P5. Sub-workflow composition (maybe)

**Motivation.** `/workflows` `workflow()` runs another workflow inline. We have separate
top-level workflows but no compositional node.

**Design.** A `workflow` node type whose body is `{ ref: <workflow-id>, input: <mapping> }`,
executed by a nested `execute()` call, returning the sub-run's final output into the
parent context. One level deep, matching `/workflows`' nesting limit.

**Risk.** Low mechanically, but unclear demand. Hold until a real workflow needs it.

## What we should NOT borrow

1. **Imperative JS control flow.** The declarative YAML DAG is the product. It is what
   Studio renders, what the spec site documents, what the cloud ingests, and what a
   non-engineer can read. Trading that for "write a JS script" throws away the moat to
   match a tool that lives only inside one IDE session.
2. **Ungoverned generic subagents.** Per-node skill/MCP scoping is a feature, not a
   limitation. Keep it.
3. **Worktree isolation as a headline feature.** It only matters once P2 lets multiple
   nodes write files concurrently. Defer until then, and even so, prefer documenting
   "run the Action in a container" over building git-worktree management into the engine.
4. **In-session ephemerality.** `/workflows` is one-shot and forgotten. SWEny runs are
   durable signals. Resume (P3) and the cloud plane are the opposite design on purpose.

## Recommended sequencing

1. **P1 token budget** first. Small, self-contained, immediately useful, and produces a
   new cloud signal. Good warm-up that establishes the budget-accounting plumbing P2 reuses.
2. **P4 forced structured output** alongside or just after P1. Small, improves reliability.
3. **P3 resume** next. Mostly additive, big CI payoff, no control-flow change.
4. **P2 parallel fan-out** last and on its own RFC. Highest value, highest risk, needs a
   frontier-executor design and Studio/trace changes before any code lands.
5. **P5 sub-workflow** only if a concrete workflow demands it.

## Open questions

- Token budget units: model tokens vs a normalized cost? Tokens are simpler and
  provider-agnostic; cost needs a price table we would have to maintain. Lean tokens.
- Fan-out result addressing in `requires` / `evals`: how does a downstream node
  reference "all fan-out results" vs "this item"? Needs spec work in P2's RFC.
- Resume journal location and format: local file is the safe default; do we define a
  schema now so the cloud can later ingest it without a migration?
