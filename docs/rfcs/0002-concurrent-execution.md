# RFC 0002: Concurrent execution and durable state (rev 4)

Status: accepted 2026-11-09 (owner accepted all ten recommendations in the owner summary). Milestones are tracked as GitHub issues.
Author: drafted by Claude (SWEny brain session, opus lanes) for Nate; decisions accepted by Nate 2026-11-09. Date: 2026-11-06. Code read at `origin/main` `0d2c5ef1`. Paths are under `packages/core/src/` unless shown otherwise.
History: four revisions, each reviewed adversarially (Codex astra, fresh-context Opus, Codex sol). Findings from earlier rounds are folded into this text; the dispositions table below covers the last round.
Amendment 2026-11-10: spec v2 shipped as the safe-defaults version (#598, PR #607): a node that declares no `permissions` and no `outputs` is read-only, and the v1 to v2 migration declares `permissions: write` where v1 relied on the old default. Everything this RFC adds to the spec (the `map` node and the other spec additions) moves to spec v3, with an identity v2 to v3 migration. The spec-version statements below are updated to match.

## Owner summary

**What we build.** A `map` node (spec v3) fans a workflow out by running one complete child SWEny run per item.
- Each child gets its own journal, budget guard and results.
- A shared spend tally caps the whole map.
- The parent journal keeps today's v3 grammar unchanged.

Approval comes later. A run freezes the exact writes it wants into a bundle with a digest, and a separate publisher sends that bundle once a human approves it: from the CLI first, then in CI through GitHub Environments.

**M1 day-one value for Offload.** The morning todo-prompt run becomes one workflow over all items:
- **Before:** one serial run per item.
- **After:**
  - up to 4 items run at once;
  - each item resumes on its own after a crash;
  - one spend cap covers the batch;
  - results are ordered and keyed by item id, and a normal downstream node stores the prompts.

Each child sees only its item plus the inputs passed to it explicitly.

**Decisions needed:**

| # | Decision | Recommendation |
|---|---|---|
| 1 | Adopt child-run composition as the fan-out design (§1) | Yes. It reuses resume, the journal and the budget per run. The alternatives lost on grammar and recovery (§8). |
| 2 | Add `p-limit` as a runtime dependency of core | Yes. It is the maintained limiter, and cancellation is handled explicitly (§1.4). |
| 3 | Let read-only nodes and children use MCP servers through an explicit, read-only opt-in. Today they get none (`executor.ts:842`). | Not in M1. Decide after M1. Risk: sweny cannot classify an MCP server's tools as read or write, so "read-only" would rest on the server and a `tools.allow` list, not on sweny. |
| 4 | Default for `on_empty` | `succeed`, with empty results |
| 5 | Email transport for approved sends | `nodemailer` over the already-declared `SMTP_URL`, at most once, never resent on doubt |
| 6 | Self-approval | CLI: allowed (the local user is the trust root). CI: turn on the environment's "prevent self-review". |
| 7 | Should `pending` receipts block downstream nodes? | No. Downstream nodes see `pending` and the digest. |
| 8 | Default concurrency and `max_items` | 4 (ceiling 16) and 50 (ceiling 1000) |
| 9 | Slack and email approval in CI on public repositories, where bundle bytes are readable by anyone who can read the repo | Refuse non-GitHub writes in CI on public repos |
| 10 | Nested maps | Later, after M3, if a workflow needs them |

**Out of scope:**
- Concurrent visits inside one run, which was rev 1's design.
- Selective `--force` and per-visit input hashes.
- Resuming a crashed producer run in CI: no journal export, no HKDF key, no external tag-ref ledger.
- A hosted engine.
- Nested maps.
- MCP for read-only children (decision 3).
- Children that write, until M5.
- Evidence-isolated lanes on Codex and pi, until the read carve-out is proven.

## What the stack already provides

| Need | Already there |
|---|---|
| Per-run isolation | `results`, the trace and `at` are local to each `execute()` call (`executor.ts:213-216`). So are the write state (`:289`) and `BudgetGuard` (`:298`). |
| Journal per run, owned by the host | `RunJournal.create` and `openForResume` (`journal.ts:1821-1827`) bind the run id (`:362`). The CLI creates the journal (`cli/main.ts:1162-1168`). |
| Harness per run | `createHarness(id, {cwd})` (`harness/index.ts:55-63`) |
| Replay without model calls | `journal.ts:2011`, `executor.ts:449` |
| Idempotent writes | Write wrapping, with marker lookup for GitHub and Linear (`journal.ts:1403-1556`) |
| Read confinement building blocks | srt `denyRead` and its carve-outs (`harness/sandbox-wrapper.ts:199-212`); `native: none` on Claude Code (`capabilities.ts:25`); `fileRoot` (`source-resolver.ts:445`) |
| Write checks and trust | `applySafeOutputs` (`safe-outputs.ts:470`) and `actorTrusted` (`:210`) |
| Top-level output contract | `outputContractProblems` (`executor.ts:1653`) |
| Spec gate | `migrations.ts:9-35` |

## 1. Map: fan-out as child runs (M1)

`CURRENT_SPEC_VERSION` becomes 3 (`migrations.ts`), with an identity v2 to v3 migration after the v1 to v2 one (#598). v1 and v2 files run unchanged, and v3 fields in an older file fail to load. An older sweny refuses a v3 file with `TOO_NEW`.

```yaml
spec_version: "3"
nodes:
  list: { name: List todos, instruction: ..., skills: [linear], output: { ... } }
  draft_all:
    kind: map
    over: list.items          # array path, checked at load; or items: [ ...literal ]
    key: id                   # unique item field, or $index
    workflow: ./draft-one.yml # or inline { entry, nodes, edges }
    result: draft             # child node whose output is the item's result
    with: { team: input.team } # the only parent values a child receives
    concurrency: 4            # ceiling 16
    max_items: 50             # ceiling 1000
    on_item_fail: fail_fast   # or collect
    min_success: all          # or an integer (collect only)
    on_empty: succeed         # or fail
edges:
  - { from: list, to: draft_all }
  - { from: draft_all, to: store }   # an ordinary write node reads draft_all's results
```

### 1.1 Slots and generations

- **Logical id.** Each child's logical id is `<parent run>/<map node>#<iteration>/<item key>`.
  - Keys must match `[A-Za-z0-9_-]{1,64}`.
  - Duplicate keys fail the map before any spend.
- **Slot.** Each child gets a slot at `runs/<ws>/<parent>/children/<sha256(id)[:16]>/`, holding generations `g1/`, `g2/` and so on.
  - Each generation is an ordinary run directory, with its run id `<id>@g<N>` bound by the chain MAC.
  - Its `run:start` carries `parent: {run, node, iteration, key, generation, items_hash}`.
  - `pruneJournals` (`journal.ts:1740`) removes slots together with the parent.
- **Registration.** Children are registered before any of them launches, with no format bump.
  - The map visit's `node:start` carries `children: {items_hash, keys[], workflow_hash}`.
  - A new record *type* would break older readers (`journal.ts:840-842`, `:1034`). A new *field* does not.
  - The parent sequence is unchanged: `node:start(map)` → children → `node:checkpoint` → `node:end` → `route`.

### 1.2 Resume and child lifecycle

The parent replays up to the map, then restarts it under the existing rule for an unfinished visit (`journal.ts:1108-1121`). It then re-derives the items and compares `items_hash` with the value journaled in `children`. If they differ, the resume is refused unless `--force` is given. With `--force`, every slot starts a new generation, and the spend of earlier generations is still seeded.

| Latest generation | Action |
|---|---|
| None | Create `g1` and launch it. |
| Head at `seq: 0`, no records (the crash came after `createRunKey`, `journal.ts:1975-1978`, so nothing was spent) | Delete it under the slot lock and recreate it. |
| No `run:end`. This covers a crash, and also a **cancel**: the host writes no `run:end` for a cancelled child. | Resume this generation in place. |
| `run:end success` | Replay it through `execute()`, with no model calls. |
| `run:end failed` | Start generation N+1. |

**Why a failed generation is not resumed.** Plain resume reruns the last visit only when that visit failed and was not routed on (`journal.ts:1321`). If a failed node routed on (`on_fail: continue`) and the run then ended, every visit replays and nothing reruns. A new generation reruns the item whichever way it failed.

**Cancel.** `RunJournal` gains `detach()`. It closes the file and releases the lock without appending `run:end` (unlike `end()`, `journal.ts:2114-2124`). The host calls `detach()` on any child whose `execute()` rejected because of the map's abort.

All generations are kept. An item's outcome is the outcome of its latest generation.

### 1.3 What a child can reach

**Isolation in M1 is `isolation: inputs`.** A child's run input is exactly `{item, item_key, ...with}`. It sees no parent results, no parent rules and no parent context.

Children run read-only (`resolveNodePermissions`). Three things still reach a read-only child:
1. **Skill read tools.** `access: "read"` tools from the child node's own `skills` are kept on read-only nodes (`executor.ts:512`, `:527`). They run in sweny with sweny's credentials. A child with `skills: [linear]` can therefore read anything that token can read, including other items or a parent's earlier comments.
2. **Built-in read tools.** Read, Grep and Glob stay available to a read-only Claude (`claude-code.ts:104-110`).
3. **`file:` sources.** These read anywhere unless `fileRoot` is set (`source-resolver.ts:445`).

So `inputs` isolates memory, not reads. It does **not** make a verdict lane context-clean. That is `isolation: evidence`, in M3 (§3).

MCP servers do not reach read-only nodes today (`executor.ts:842`). Changing that is decision 3.

### 1.4 Pool, cancellation, results

**Pool.**
- `runMap` (a new file, `map.ts`) runs the children through `p-limit(concurrency)`.
- Each child is `execute(childWorkflow, input, childOptions)`, with the options coming from an injected `ExecuteOptions.children: ChildRunHost`. The host supplies the generation's journal and a fresh harness instance.
- The child's signal is `AbortSignal.any([mapSignal, runSignal])`. Engines move to Node 22 with #533.
- `execute()` refuses map nodes when no host is given. A child workflow may not contain a map.

**Fail-fast.**
- `p-limit` does not cancel running promises.
- `clearQueue()` leaves dropped promises unsettled, so it is not used.
- Instead, each task checks a `stopping` flag before it launches. If the flag is set, the task returns `cancelled` without creating a generation.
- The first failure sets `stopping` and aborts `mapSignal`. The map then awaits `Promise.allSettled` over all tasks. Every aborted child settles its spend (§2) and is detached (§1.2).

**Collect.** Every item runs. Each item ends `success`, `failed`, `skipped` or `cancelled`, and the map succeeds when the success count meets `min_success`. An empty input with `on_empty: succeed` gives empty results. A missing or non-array `over` fails before any spend.

**Results.**
- `data.items[<key>]` holds `{status, data}`.
- `data.order` holds the keys in input order, and `data.results` holds each child's `result:` output in input order.
- `data.counts` holds the outcome counts.
- Completion order never changes any of this.
- The output schema is derived, so `when` and `requires` paths validate at load.

**Validation.** M1 checks each item's result with today's top-level contract (`outputContractProblems`, `executor.ts:1653`). It fails the item on any problem it reports, not only on `missing` as the node gate does (`executor.ts:983-985`). Nested shapes are not checked in M1. Full validation (plan item 4) gates M2, because approved payloads must be fully valid, and M3.

**No child outputs in M1.** A child node or map that declares `outputs` fails to load. Writes happen in ordinary parent nodes that read the map's results.

## 2. Budget

**Prerequisite: #549.**
- `BudgetAttempt.settle(final?)` is idempotent and commits `max(live, final)` exactly once.
- It is called as soon as `run()` resolves, before the fallible journal appends (`executor.ts:862`, `:872`), and again in the catch and finally paths.
- `finish()` becomes `settle()` plus the breach check.

**Shared tally.**
- `BudgetGuard` takes an optional `SpendTally`. This is additive; the class is public (`index.ts:117`).
- A settled spend is committed once to the child's local counters and once to the tally.
- The run cap is checked against `tally.committed + Σ live`.
- A breach aborts the tally's signal, which reaches every running child.

**Seeding on resume.**
- The parent seeds the tally once: its own journaled spend plus `journaledSpend` (`journal.ts:1216`) of every generation.
- A child's own `priorSpend` (`executor.ts:410-411`) seeds only its local counters.

**What the code can promise.**
- **Admission stops at the cap.** No child attempt starts once the settled spend has reached the run cap (`runExhausted`, `budget.ts:135`).
- **Live reports are not authoritative.** Claude Code's live token count is a lower bound until its final `result` message (`claude-code.ts:661-664`). An aborted attempt counts only what it reported before the abort. Codex reports tokens only at the end (`capabilities.ts:62`). Codex USD and ACP tokens are never reported (`:62`, `:146`).
- **So no harness gives a hard bound on spend above the cap for concurrent children.** The rule is:

| Policy | Budgeted map, unit reported (live or at end) | Budgeted map, unit never reported |
|---|---|---|
| `strict` | Runs serially (`concurrency: 1`), so admission is checked against settled spend before each child | Refused (`harness/policy.ts:202`) |
| default | Runs at the declared concurrency, with warning `budget_concurrent`: the cap is checked at admission and on live reports, so concurrent children can overrun it | Runs, with the existing `budget_<unit>: ... not enforced` warning |

Judge, route, reflection and screen calls stay unmetered until plan item 3.

## 3. Evidence isolation (M3)

`isolation: evidence` makes each child context-clean, or the map is refused before any spend:

**Evidence directory.**
- A fresh `cwd` outside the workspace holds copies of only the declared `evidence: [paths]`.
- Their sha256 values are recorded on the child's `run:start`.

**Sources.**
- `fileRoot` is set to that directory, with no way out.
- URL sources are refused unless they are declared as evidence.

**Skills.** `evidence_skills: [ids]` lists the only skills whose read tools a child may call.
- A child node naming any other skill fails to load.
- The isolation claim is stated as exactly this: *the child can read the evidence directory plus whatever the listed skills' read tools can reach with sweny's credentials.* An empty list means evidence only.

**Reads.** A new capability, `readConfine: native | wrapper | none`, is set by contract tests.

| Harness | Evidence isolation |
|---|---|
| Claude Code | `native: none`: no built-in file, search or web tools; evidence is inlined in the input. Supported. |
| Codex, pi | Only under the srt wrapper, with `denyRead` over the workspace, HOME, temp and the state root, plus an `allowRead` carve-out for the evidence directory. The carve-out exists (`sandbox-wrapper.ts:203`), but using it this way is unproven, so these harnesses are refused until the contract test passes. |
| ACP | Refused for any map (`readOnly: none`, `capabilities.ts:144`) |

## 4. Approval: bundle and publisher (M2 CLI, M4 CI)

**Producer.**
- With `safe_outputs.approval.required`, a node checkpoints and then runs `planSafeOutputs`. That is the check-and-screen half of `applySafeOutputs`, split out of `safe-outputs.ts:470`.
- The node then writes a bundle to `runs/<ws>/<run>/bundles/<digest>.json` with `O_EXCL`.
- The bundle holds:
  - the proposal identity `(run, visit, attempt generation)`;
  - per write, the frozen destination and the **exact applier arguments**, including any reconciliation marker, computed up front from `hash(proposal, n)` with `markerToken` (`journal.ts:1418`);
  - for `pr` writes, the commit sha;
  - `created_at`, taken from the checkpoint record;
  - `expires_at`.
- The visit ends with receipts in status `pending` that carry the digest. Only the digest named in the visit's authenticated `node:end` is publishable. A bundle orphaned by a crash before `node:end` is refused.

**Child intents (M2).** Children may emit intents in collect mode:
- Intents ride on `NodeResult.intents`, which `journalResult` (`journal.ts:2180`) must copy.
- The map re-plans them in item order.
- Caps are keyed `${map}[${key}]:${type}` (today `${nodeId}:${type}`, `safe-outputs.ts:649-650`).

**CLI publisher.** `sweny publish <run>`:
1. Verifies the digest.
2. Refuses expired bundles and runs that ran unsandboxed.
3. Prints the exact arguments.
4. Authenticates `local:<os user>` with `actorTrusted`.
5. Consumes the approval by creating `<state>/approvals/<sha256(proposal)>` with `O_EXCL`.
6. Sends the arguments byte for byte, without `withMarker` (`journal.ts:1422`), inside a publisher journal.

The consumption marker protects one state root on one machine against a restored run directory and against an old bundle. It does not protect against a copied state root (`journal.ts:216`), clock rollback, or the OS user deleting it.

**Uncertain outcomes.**
- GitHub and Linear writes reconcile by marker lookup (`journal.ts:1440-1556`).
- PRs reconcile by looking up their head branch (`skills/github.ts:359`).
- Slack and email have no lookup (`journal.ts:1550`). They are sent at most once, and a doubtful send gets an `unknown: not resent` receipt.
- `--allow-repeat-writes` is refused for bundles.
- Slack assumes the channel-pinned applier from the separate bug fix (`skills/slack.ts:45-75`).

**PR writes.**
- The publisher refuses to open a PR unless the push succeeded or the remote head already equals the approved sha. Today a PR is opened after a failed push (`skills/github.ts:333-336`).
- The code itself is approved by GitHub PR review. The owner enables required reviews and "dismiss stale approvals on new commits" on the base branch, which binds review to commits on the server. The bundle approval covers only opening the PR: destination, title and body.

**CI (M4): GitHub Environments.**
- The producer job uploads the bundle and prints its exact bytes and digest to the job summary.
- A separate publisher job, `environment: sweny-publish`, which needs required reviewers and "prevent self-review", downloads the bundle, checks that its digest matches the producer job's output, and publishes.
- The environment's reviewer gate supplies the authenticated approver and single approval per job run.

One thing Environments cannot do: they keep no publisher state across a rerun. A rerun of the publisher job (`GITHUB_RUN_ATTEMPT > 1`) therefore:
- reconciles GitHub and Linear writes by marker;
- records Slack and email writes as `unknown: not resent`.

That is the whole CI design: no journal export, no HKDF key and no external ledger.

## 5. Write lanes (M5)

A host workspace-provider hook gives each child its own `cwd`. The default provider uses git worktrees, and Offload registers its own provider.

At the end of each child, sweny collects the patch with `git diff --binary`, using the no-hooks posture of `skills/git-push.ts`, and journals its sha256. The map applies the patches in item order with `git apply --3way`. A conflict fails the map and names the keys involved.

## 6. Upgrade policy

The identity v2 to v3 migration changes `workflowHashOf`, because the hash includes the effective `spec_version` (`journal.ts:146`, `migrations.ts:119`). Fresh runs are unaffected.

A journal written before v3 is **refused**. It already fails the tools hash, which includes the sweny version (`journal.ts:206`). The message names both versions and the retry command: `npx @sweny-ai/core@<journaled version> workflow resume <run>`. No hash recompute is planned.

## 7. Events and boundaries

**Events.** `ExecutionEvent` (`types.ts:865`) gains optional `run`, `parent_run` and `generation` fields, the events `map:start`, `child:start`, `child:end` and `map:end`, and `events_version: 2`. The change is additive. `check:schema-drift` guards the published `events.json`. Studio, the cloud observer (`cli/cloud-lifecycle.ts:532-535`) and MCP progress key on run plus node.

**Boundaries.**
- ESLint `no-restricted-imports` on `executor.ts` and `map.ts` forbids harness adapters, `cli/*`, and all of `skills/*` except `index.js` and `git-push.js`.
- A vitest check fails on any harness-id or skill-id string literal in those files.
- Hosts inject journals, harnesses and workspaces; the executor never imports them.

## 8. Rollout

Every milestone ships live, behind spec v3 or a CLI verb, with docs and an example. Nothing is observe-only.

| # | Milestone | Depends on | Fail-on-revert tests | Size |
|---|---|---|---|---|
| M1 | `map` (`isolation: inputs`): slots, generations, `detach()`, p-limit pool, fail-fast and collect, shared tally, read-only children with no outputs, top-level result check, events, boundary checks, upgrade refusal | #549 | 2×60 against a 100 cap: no third child starts; serial under strict; init-only slot recreated; failed child gets g2; cancelled child resumes in place; finished child replays with zero harness calls; stopping launches no generation; `items_hash` mismatch refused; empty input; duplicate keys; stable order; child input holds only item and `with`; `outputs` in a child refused; v1 trace unchanged; pre-v3 journal refused with the versioned message | L |
| M2 | CLI bundle and publisher, child intents and per-item caps, `slack_message` and `email` types, PR push refusal | plan item 4, Slack applier fix | Publisher sends bytes with no added marker; orphan bundle refused; second publish refused; failed push opens no PR; Slack crash leaves `unknown: not resent`; three items each publish one comment | L |
| M3 | Per-node `harness`/`model` (`harnessFor` injected), `isolation: evidence`, `evidence_skills`, `readConfine`, join verifier (sandboxed opt-in script node, plan item 7) | plan items 4 and 7 | Evidence child cannot read a parent file by absolute path; a skill outside `evidence_skills` refused; Codex/pi refused until the carve-out test passes; item harness outside the allowlist refused | L |
| M4 | CI approval through GitHub Environments | M2 | Digest mismatch refused; rerun reconciles GitHub writes and does not resend Slack | M |
| M5 | Write lanes in workspaces | M1 | Same-file conflict names both keys; patch hash mismatch refused | L |

## 9. Alternatives considered

| Option | Why not |
|---|---|
| Rev 1: concurrent visits in one run | The grammar could not express its own recovery, and selective `--force` replayed stale routes. |
| Host-side batch command (sol 1) | It splits one logical run across files. A `map` keeps one workflow and one parent anchor. |
| Job queue (sol 2) / batch runner in one node (sol 3) | A persistent worker service / no per-item resume. |
| Temporal, Inngest | A server on every run, and imperative code. We borrow event history and child ids. |
| LangGraph `Send` | An imperative library with shared mutable state. We borrow reducers by key. |
| In-node subagents | Unjournaled, one harness. We keep them as today's prototype. |
| Hand-built CI consumption (HKDF, export, tag ref) | GitHub Environments already provide the authenticated, single-use gate. |

## 10. Review dispositions (fresh-eyes on rev 3)

| Finding | Disposition |
|---|---|
| H1: the budget bound overstated live usage | Accepted, §2. Only admission-at-cap is claimed. Strict runs serially or refuses; the default warns. |
| H2/H3: M1 too large; dependency on validation | Accepted, §8. M1 slimmed. Top-level check in M1; plan item 4 gates M2 and M3. |
| H4: read-only children get no MCP | Accepted as owner decision 3, with the risk stated. Not decided. |
| M1: `evidence_skills` undefined; skill read tools reach children | Accepted, §1.3 and §3. Defined, and the isolation claim is reworded. |
| M2: cancelled generations | Accepted, §1.2. `detach()` writes no `run:end`, so resume continues the generation. |
| M3: CI approval should use Environments; PR review should bind code | Accepted, §4. The hand-built M4 design is dropped. The one gap (rerun state) is named. |
| M4: drop the `--force` recompute | Accepted, §6 |
| Use `AbortSignal.any` and `p-limit` | Accepted, §1.4. `p-limit` is owner decision 2. |
| L2: wrong reasoning for new generations | Accepted, §1.2. Corrected against `journal.ts:1321`. |

No finding was rejected.

## Findings

- `executor.ts:862`, `:872` vs `:882`: a failed final-usage append drops spend today, in single runs too. Filed as #549.
- `skills/github.ts:333-336`: a PR is opened after a failed push, on every run.
- `safe-outputs.ts:495`: intent `expires` counts from `recordedAt` on crash resume too. This is undocumented.
- `journal.ts:2180`: `journalResult` drops unknown `NodeResult` fields.
