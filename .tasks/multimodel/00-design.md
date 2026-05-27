# Multi-model cost tiering: per-step model selection + gateway/multi-auth support

## Summary

Let workflow authors run cheaper models on grunt steps and reserve the expensive model for the steps that need it, and let operators route the backend through an Anthropic-compatible gateway (e.g. LiteLLM) using API-key or bearer auth without our OAuth handling silently stripping their credentials. This is the cost lever users are asking for, delivered without breaking the "headless Claude Code is the only backend" thesis.

This issue was drafted from early-adopter feedback and hardened by three independent code reviews. The reviews surfaced a billing-safety hole in the original auth design (now removed), a missing auth variable that real LiteLLM setups need, and the fact that the canonical workflow schema lives in Zod (with `nodeZ` strict and `workflowZ` deliberately not) and the public JSON schema is generated, not hand-edited. Those corrections are baked in below.

## Motivation

> "I'm starting to use sweny now, it'll work really well for helm chart upgrades and terraform upgrade changes. I'm running the queries through litellm (a LLM proxy). I wish you had Gemini support too that way I could have dumber cheaper models do some of the grunt work."

Two real needs are bundled in that sentence:

1. **Cost tiering.** A DAG mixes hard reasoning steps with mechanical grunt steps (lint, format, summarize, file moves). Paying top-model rates for every step is wasteful. The user wants a cheap model on the grunt steps.
2. **Bring-your-own-gateway.** The user already runs LiteLLM. Through a gateway, "Gemini support" is a routing concern, not a sweny integration: the gateway exposes an Anthropic-compatible `/v1/messages` endpoint and maps a model name to any backend. sweny needs no native Gemini provider to satisfy this.

## Current behavior (verified against the code)

- **Single global execution model.** `ClaudeClientOptions.model` (`packages/core/src/claude.ts:21`) is the only execution-model knob, set once at client construction and applied to every node (`claude.ts:136`). The CLI never passes it (`packages/core/src/cli/main.ts:237,549,810,1104,1171`).
- **No per-node execution model.** The `Node` interface (`types.ts:290-324`) has `max_turns`, `disallowed_tools`, etc., but no `model`. The `Claude.run` interface (`types.ts:498-509`) likewise has no `model` per call.
- **Per-evaluator judge model already exists.** Judges resolve via a cascade in `resolveJudgeModel` (`eval/index.ts:26-27`): `evaluator.model ?? node.judge_model ?? workflow.judge_model ?? DEFAULT_JUDGE_MODEL` (`eval/index.ts:18`, default `claude-haiku-4-5`). `claude.ask` already takes a per-call `model` (`types.ts:526`, `claude.ts:305-316`). We have working precedent for per-call model; execution `run` just hasn't adopted it.
- **Gateway already works, undocumented.** `buildEnv` (`claude.ts:56-64`) copies all non-null `process.env` into the subprocess env, so `ANTHROPIC_BASE_URL` already reaches Claude Code. Pointing at LiteLLM works today; it is nowhere in the docs.
- **OAuth strips the API key, unconditionally.** `buildEnv` deletes `ANTHROPIC_API_KEY` whenever `CLAUDE_CODE_OAUTH_TOKEN` is truthy (`claude.ts:60-62`). Intent (comment `claude.ts:52-54`): stop a stray `.env` API key from silently overriding subscription auth and billing the API account. Side effect: a gateway user authenticating with an API key who *also* has an OAuth token in their environment (common after `claude setup-token`) gets their key stripped. The early adopter's connectivity check showed `CLAUDE_CODE_OAUTH_TOKEN set`, so they hit exactly this.
- **sweny does not decide the auth winner; the spawned agent does.** `buildEnv` only controls which vars *survive* into the subprocess env. The bundled `@anthropic-ai/claude-agent-sdk` (v0.2.114) passes our env through verbatim (`sdk.mjs`), but the spawned `claude` agent then ranks `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, env OAuth, and on-disk `~/.claude/.credentials.json` itself. Any design here must be framed as "what env we leave in place," not "which credential we select."

## Proposal

Three parts. Parts 1 and 2 are **independently landable** (different code paths: schema/executor vs `buildEnv`) and should be two reviewable commits, so the auth change with its billing blast radius gets isolated scrutiny. Part 3 (docs + connectivity) lands with them.

### Part 1: per-node execution model

Add an optional `model` field to `Node` and `Workflow`, resolved with the existing cascade shape:

```
node.model ?? workflow.model ?? client.model ?? <omit SDK model option → Claude Code default>
```

Field name is **`model`** (decided, not open): it sits next to `judge_model` on the same objects, disambiguating by axis (execution vs evaluation), and it is exactly the SDK option name the value feeds (`claude.ts:136`). When nothing is specified anywhere, omit the SDK `model` option entirely (current behavior) so Claude Code's default applies. No new hardcoded execution default.

`model` is **unvalidated free-text passthrough**, consistent with how `judge_model` / `evaluator.model` are handled today (`z.string().min(1)`, `schema.ts:167,237,284`). There is no model-name registry in core. State this explicitly so it is a decision, not an oversight.

Extract the resolution into an exported, unit-testable helper `resolveExecutionModel(node, workflow, clientDefault)`, mirroring `resolveJudgeModel`, so the executor and any future caller share one implementation.

### Part 2: intentional, explicit auth (support both tokens, safely)

The original draft inferred "use the API key" from the presence of `ANTHROPIC_BASE_URL`. **That is unsafe and is removed.** A base URL does not mean "non-billing gateway": corporate egress proxies and observability proxies (Helicone, Portkey, etc.) set `ANTHROPIC_BASE_URL` while still passing through to real Anthropic and billing the user's real `ANTHROPIC_API_KEY`. Inferring "honor the key" from base-URL presence would re-introduce exactly the surprise-billing event the current strip prevents. The error directions are asymmetric: guessing OAuth fails closed (a call errors, user fixes config), guessing API key fails open and silent (money leaves a metered account, discovered on the invoice). We do not leave that to inference.

Instead, make intent **explicit** and add the missing bearer variable:

- **`SWENY_AUTH` is the primary mechanism.** Values: `oauth | api-key | auto`. Default `auto` = today's protective behavior (when an OAuth token is truthy, strip `ANTHROPIC_API_KEY`). A gateway user sets `SWENY_AUTH=api-key` once, deliberately, and `buildEnv` then preserves the key (and `ANTHROPIC_AUTH_TOKEN`) and does not strip on account of a present OAuth token.
- **Add `ANTHROPIC_AUTH_TOKEN` to the model.** The bundled agent supports it (`Authorization: Bearer`, `sdk.mjs`/`assistant.mjs`), distinct from `ANTHROPIC_API_KEY` (`x-api-key`). Many LiteLLM deployments expect bearer auth, so the motivating use case fails without it. It is also not billing-sensitive against real Anthropic (not a console key), so it never needs the protective strip.
- **Truthy checks, not key presence.** `action.yml:98-99` sets `CLAUDE_CODE_OAUTH_TOKEN` and `ANTHROPIC_API_KEY` from inputs unconditionally, so the empty string `""` is present when an input is omitted. All precedence logic must treat empty string as unset (current code happens to, via `if (env.CLAUDE_CODE_OAUTH_TOKEN)` at `claude.ts:60`; preserve that).
- **Extract `resolveAuthEnv(env, opts)` as a pure function.** `buildEnv` is private and untested today. A pure helper makes every case unit-testable without constructing a `ClaudeClient` or spawning the agent.

What `buildEnv` leaves in the subprocess env (it never selects the winner, the agent does):

| `SWENY_AUTH` | OAuth truthy? | API key / bearer present? | `buildEnv` result |
|---|---|---|---|
| `auto` (default) | yes | yes | strip `ANTHROPIC_API_KEY` (unchanged; protects subscription from stray `.env` key) |
| `auto` | yes | no | leave OAuth |
| `auto` | no | yes | leave key/bearer |
| `api-key` | yes | yes | leave key + bearer, do **not** strip; OAuth still in env but user has chosen key |
| `api-key` | no | yes | leave key/bearer |
| `oauth` | * | * | leave OAuth, strip `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` |

Note: `~/.claude/.credentials.json` (on-disk OAuth) is read by the agent when no token is in env; `buildEnv` cannot strip it. Tests should assert *observed agent behavior* for the env we hand it, not claim sweny "chose" a credential it cannot enforce.

### Part 3: gateway support surface (Action, connectivity check, docs)

- **GitHub Action is the main entry point and currently cannot reach a gateway.** `action.yml` has no base-URL or auth-mode input. Add `anthropic-base-url` (and optionally `sweny-auth`) inputs, wire them to env, and document them. Without this the gateway story only works for the raw CLI.
- **Connectivity check lives in `sweny check` (`cli/check.ts`), not the SessionStart hook.** The hook (`packages/plugin/hooks/hooks.json`) just shells out to `sweny check`. The "skipping API check" line is `check.ts:27`. `checkAnthropic` hardcodes `https://api.anthropic.com/v1/models` with `x-api-key` (`check.ts:106-111`) and ignores any base URL; `CliConfig` does not even capture `ANTHROPIC_BASE_URL` (`config.ts:12-13,237-238`). Today a gateway user with both a key and OAuth has their real key probed against real Anthropic. Fix: add `anthropicBaseUrl` to `CliConfig` + `parseCliInputs` (`config.ts:206`, the config builder; there is no `loadConfig`), route the probe through the gateway when set (or report "gateway mode" and skip the upstream probe), and reorder so the *selected* auth mode drives the probe rather than "key first."
- **Two doc surfaces, both required:**
  - **The protocol spec at `spec/`** (normative; see the dedicated section below) for the `model` field.
  - **The docs site at `packages/web`** for the operator how-to: a "Using a model gateway (LiteLLM)" guide. New page under `packages/web/src/content/docs/...` plus sidebar registration in `packages/web/astro.config.mjs` (easy to forget). Cover `ANTHROPIC_BASE_URL`, `ANTHROPIC_API_KEY` vs `ANTHROPIC_AUTH_TOKEN`, `SWENY_AUTH`, and a worked example mapping a cheap model (incl. a non-Anthropic model like Gemini Flash) so grunt nodes route to it.
- **The docs gateway example will attract bug reports.** Claude Code's tool-use protocol and the `outputSchema` / JSON contract (`claude.ts:108-116`) assume Anthropic-model behavior. A Gemini-via-gateway example invites "tool use is flaky" / "output schema not honored" issues. The guide MUST carry an explicit banner: model-specific tool-use and JSON-mode behavior through a gateway is unsupported and at the user's risk.
- **Logging:** log the chosen auth mode at debug, never token/key values. Redact `ANTHROPIC_BASE_URL` to scheme + host before logging (it can legitimately carry a credential in userinfo or query). Note that `claude.ts:135` already pipes the agent's raw stderr to `logger.debug`; that is a separate, unbounded channel this issue's "no secrets logged" criterion cannot cover.

## Spec impact (`spec/`, normative, v1.0.0)

The canonical schema is **not** the TS interface and **not** the JSON file. Order of truth:

1. **Zod schemas in `packages/core/src/schema.ts`** are the runtime validator. `nodeZ` (`schema.ts:225`) is `.strict()`, so an unknown node `model` key is **rejected at parse time** by `parseWorkflow` until added there. `workflowZ` (`schema.ts:273`) is intentionally **not** `.strict()` (it strips unknown top-level keys for marketplace metadata, see the comment above its definition), so a workflow-level `model` key is silently **stripped** unless added. Either way `model` MUST be added to both Zod objects. The TS interface change alone has no runtime effect.
2. **The public JSON Schema** `spec/public/schemas/workflow.json` is **generated** from the `workflowJsonSchema` constant in `schema.ts` by `packages/core/scripts/write-public-schema.mjs`, run during `npm run build` and gated by `check:schema-drift` (`packages/core/package.json:49,53`). **Do not hand-edit the JSON file**; edit `workflowJsonSchema` and rebuild, or the drift check fails.
3. **Normative prose** in `spec/src/content/docs/`:
   - `nodes.mdx`: add a `model` row to the Node Fields table (alongside `max_turns` at `nodes.mdx:16`) and a **Model Selection** section with MUST/SHOULD conformance language, parallel to the existing "Max Turns Semantics" and the judge "Selecting the judge model" precedence list (`nodes.mdx:502-506`). The section must state the `node.model ?? workflow.model ?? executor-default` precedence and that the executor MUST forward the resolved model to the agent and MUST fall back to its implementation-defined default when absent.
   - `workflow.mdx`: document the workflow-level `model` default next to `judge_model`.
   - `execution.mdx`: step 6 ("Invoke the AI model", `execution.mdx:38`) should note model resolution as part of invocation.
4. **Schema parity tests must move in lockstep.** `schema-conformance.test.ts` compiles `workflowJsonSchema` with AJV and asserts Zod and AJV agree on every fixture; `contract-tests.test.ts` and `spec-conformance.test.ts` assert specific node properties exist. Adding `model` to Zod but not the JSON schema (or vice versa) breaks these.

Adding an optional field is a **non-breaking additive change** under the spec's semver policy (`index.mdx:66`), so no major version bump; v1.0.0 stays. The spec must still be updated so it remains true to the implementation.

## Non-goals

- **No native non-Anthropic provider.** No Gemini/OpenAI client, no provider-abstraction layer in core. The backend stays headless Claude Code (`claude.ts:1-9`); the agent loop, tool-use protocol, and system prompt remain Claude Code's. Multi-model and "Gemini support" are delivered through the gateway, at the user's risk (see the docs banner above).
- **No model-name validation / allowlist.** Consistent with `judge_model`. Open question: a load-time warning could mirror the `judge_budget` warning (`executor.ts:434-444`), but model aliasing in gateways makes any `gemini-*`-without-base-URL heuristic brittle. Recommend out of scope for v1.

## Backward compatibility

- `model` is optional everywhere; existing workflows are unaffected and keep using the Claude Code default.
- Auth: `auto` (the default) is byte-for-byte today's behavior, so no current user's auth or billing changes. The new behavior only engages when a user explicitly sets `SWENY_AUTH=api-key` (or `oauth`). (The earlier draft's claim that base-URL inference changed "no billing behavior" was wrong; that mechanism is gone.)

## Files to touch

Part 1 (per-node model):
- `packages/core/src/types.ts`: add `model?: string` to `Node` and `Workflow`; add `model?: string` to `run` opts in the `Claude` interface (`types.ts:498-509`).
- `packages/core/src/claude.ts`: add `model?` to `run` opts (`:66-74`); use `opts.model ?? this.model` at the SDK call (`:136`).
- `packages/core/src/executor.ts`: resolve via `resolveExecutionModel(node, workflow, clientDefault)` and pass to `run` at the call site (`:262`). (`run` has two other callers in `workflow-builder.ts:171,202`; they are meta workflow-generation and pass no model.)
- `packages/core/src/eval/index.ts` or a shared module: export `resolveExecutionModel`.
- `packages/core/src/schema.ts`: add `model` to `nodeZ` (`:225`), `workflowZ` (`:273`), and the `workflowJsonSchema` node + workflow `properties`.
- `spec/public/schemas/workflow.json`: regenerated by build (do not hand-edit).
- `spec/src/content/docs/nodes.mdx`, `workflow.mdx`, `execution.mdx`: normative prose (see Spec impact).

Part 2 (auth):
- `packages/core/src/claude.ts`: extract `resolveAuthEnv(env, opts)`; implement the table; debug-log chosen mode.

Part 3 (gateway surface):
- `action.yml`: add `anthropic-base-url` (and optional `sweny-auth`) inputs + env wiring.
- `packages/core/src/cli/config.ts`: add `anthropicBaseUrl` to `CliConfig` + `parseCliInputs`.
- `packages/core/src/cli/check.ts`: gateway-aware Anthropic check; auth-mode-driven probe.
- `packages/web/src/content/docs/...`: new "Model gateway (LiteLLM)" page.
- `packages/web/astro.config.mjs`: register the page in the sidebar.

## Testing

- Unit: `resolveExecutionModel` cascade (`node ?? workflow ?? client ?? undefined`), mirroring judge-model coverage.
- Unit: `resolveAuthEnv` for every row of the table, including empty-string-as-unset and `ANTHROPIC_AUTH_TOKEN`.
- Schema: `model` accepted/rejected on node and workflow root in `schema.test.ts`; the Zod-vs-AJV parity suites (`schema-conformance.test.ts`, `contract-tests.test.ts`, `spec-conformance.test.ts`) updated.
- Executor integration: a two-node workflow asserts each node calls `run` with the expected resolved model.
- `check.ts`: gateway-mode probe routes to the base URL (or skips upstream) and reports the selected auth mode; no secrets in output.

## Open questions

1. `SWENY_AUTH` as a config field as well as an env var, for `.sweny` config files? Or env-only for v1?
2. Surface per-node model in run output / the cloud renderer and Studio node panel so users see where spend goes? `workflow_type` already drives a typed cloud renderer (`types.ts:336-340`); a new node field has display/edit implications in Studio. Likely a follow-up.
3. Prompt-cache caveat to document: mixing models across nodes means grunt nodes do not share prompt cache with the expensive node, and a gateway may disable Anthropic prompt caching entirely. Worth a sentence in the cost guide to keep the cost claim honest.

## Acceptance criteria

- [ ] `Node.model` and `Workflow.model` exist in `types.ts`, `nodeZ`/`workflowZ` (`schema.ts`), and the generated `workflow.json`, and validate.
- [ ] `Claude.run` interface + `ClaudeClient.run` accept `model`; executor resolves and threads it; absent = Claude Code default (no SDK `model` emitted).
- [ ] `resolveExecutionModel` and `resolveAuthEnv` are exported pure functions with unit tests.
- [ ] `buildEnv`/`resolveAuthEnv` implement the `SWENY_AUTH` table; base-URL presence does NOT change auth precedence; `ANTHROPIC_AUTH_TOKEN` is handled; empty string treated as unset.
- [ ] `action.yml` exposes `anthropic-base-url` (and `sweny-auth` if adopted) and wires them.
- [ ] `sweny check` is gateway-aware: probes the base URL or reports gateway mode, never probes real Anthropic with a key meant for a gateway, reports the selected auth mode, logs no secrets, redacts base-URL userinfo/query.
- [ ] Spec prose (`nodes.mdx`, `workflow.mdx`, `execution.mdx`) updated with normative `model` semantics; generated JSON schema regenerated; parity suites green.
- [ ] Docs site has a model-gateway guide with the unsupported-behavior banner and a worked cost-tiering example, registered in the sidebar.
- [ ] Auth default (`auto`) is unchanged from today; verified no behavior change for existing users.
