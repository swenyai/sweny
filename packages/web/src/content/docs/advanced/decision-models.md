---
title: Decision models
description: Let a fast local or hosted decision model choose routes when it is confident, so most routes cost no agent call. Anything uncertain still goes to the agent.
---

When a node has natural-language conditional edges, something has to pick the branch. A decision model (Ollama's `/v1/systemone`, TypeSafe Jev) answers that multiple-choice question in milliseconds. With a `decider` in the workflow, SWEny asks it first and takes its answer when the answer is confident. When it is not, the agent decides exactly as it does without a decider.

## Configure

Declare the provider in the workflow. Its presence turns the decider on:

```yaml
decider:
  provider:
    base_url: http://localhost:11434 # Ollama 0.35+
    model: nimble
```

Hosted (TypeSafe Jev) differs only in URL, model and key:

```yaml
decider:
  provider:
    base_url: https://api.typesafe.ai
    model: jev-latest
    api_key_env: TYPESAFE_API_KEY # name of the env var, never the key
  min_confidence: 0.9 # optional, default 0.85, never below 0.7
  min_margin: 0.25 # optional, default 0.2, never below 0.1
```

`sweny workflow run --no-decider` (and `sweny workflow resume --no-decider`) skips the decider for one run: the agent decides every route.

## How a route is chosen

For each node with conditional out-edges, in order:

1. **`when` expressions.** A node whose conditions are [expressions](https://spec.sweny.ai/edges/#expressions) is routed by SWEny itself. No model is asked, not even the decider.
2. **The decider.** It gets one Choice question over the node's live out-edges (the default edge included). Its label becomes the route only when all three hold: the label is one of those edges, confidence is at least `min_confidence`, and the top label leads the runner-up by at least `min_margin`. Then the agent is not called for that route.
3. **The agent.** Anything else falls through to the agent's route evaluation, unchanged, including its fail-closed rules (default edge on failure, otherwise the run stops).

Every decider problem falls through to the agent: a timeout (2 seconds), 401, 403, 422, 429, any 5xx, a malformed response, a label that is not an out-edge of the node, low confidence, or a thin margin.

## Reliability

- **Circuit breaker.** After 3 failed calls in a row, the decider is not called again for the rest of the run. SWEny logs this once.
- **Call cap.** At most 200 decider calls per run. After that the agent routes.
- **No hidden fallback.** There is no default URL, and SWEny never falls back from a local server to a hosted one. A declared `api_key_env` that is unset turns the decider off for the run (with a warning) instead of sending an unauthenticated request.

## Privacy

The decider receives the routing view, nothing more: each earlier node's status, its declared `output` fields (only for nodes that declare `output.properties`), and its eval verdicts. It never receives the run input, undeclared node data, summaries, tool calls, instructions, environment values or skill config. The view is redacted with the same redactor as `--json` output and the run journal, and fenced as untrusted data. Declare `output` on the nodes your routes depend on so the decider has something to decide with.

Logs, the run receipt and `.sweny/runs/` hold metadata only: edge target ids, confidence, margin, latency, model, and a short hash of the input.

## Where you see it

The run receipt counts who decided the run's conditional routes, for example `· routes 5 (3 decider, 1 expr, 1 agent)`: four of five routes cost no agent call. Per-call records are in the execution trace (`trace.decisions`), each route's rung is in `trace.edges` and in the run history record.

## Resume

The run journal records which rung decided each route. `sweny workflow resume` replays a journaled route as is, without asking the decider or the agent again, so a resumed run takes the same path.

## Upgrading from shadow mode

Shadow mode (`mode: shadow`, `--decider shadow`, the `decider agreed N/M` receipt) is gone. A workflow that still declares `decider.mode` fails to load with an error that says what to do: delete the `mode` line to let the decider decide routes, or delete the whole `decider` block to keep routing with the agent only.
