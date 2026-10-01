---
title: Decision models (shadow mode)
description: Ask a fast local or hosted decision model the same route question the agent answers, and see how often they agree. The route stays the agent's.
---

When a node has conditional edges, the agent picks the route. A decision model (Ollama's `/v1/systemone`, TypeSafe Jev) answers the same multiple-choice question in milliseconds. In **shadow mode** SWEny asks it alongside the agent and records whether they agree. It never changes a route. Use it to measure whether a decision model is worth trusting before anything depends on it.

## Configure

Off by default. Declare the provider in the workflow:

```yaml
decider:
  mode: shadow
  provider:
    base_url: http://localhost:11434 # Ollama 0.35+
    model: nimble
```

Hosted (TypeSafe Jev) differs only in URL, model and key:

```yaml
decider:
  mode: shadow
  provider:
    base_url: https://api.typesafe.ai
    model: jev-latest
    api_key_env: TYPESAFE_API_KEY # name of the env var, never the key
```

`sweny workflow run --decider shadow|off` overrides `mode` for one run. It still needs `provider` in the workflow.

## What it does

- The decider gets the same routing view the agent gets, with one Choice question over the edge targets. It is called in parallel with the agent, with a 2 second timeout.
- An answer counts only if the label is one of the edge targets, confidence is at least 0.85, and the top label leads the runner-up by at least 0.2. Anything else (timeout, 401, 422, 429, 529, malformed response, low confidence, low margin, unknown label, agent evaluation failed) is logged as `fell_through` with the reason.
- The route is always the agent's. With `mode: off`, or no `decider` block, no HTTP request is made.

## Privacy

The routing state is sent only to `provider.base_url`. There is no default URL and no fallback from a local server to a hosted one: a hosted provider must be configured explicitly. Logs, the run receipt and `.sweny/runs/` hold metadata only: edge target ids, confidence, margin, latency, model, and a short hash of the input. No workflow content.

## Where you see it

The run receipt gets a segment, for example `· decider agreed 4/5` (4 of 5 passing decisions matched the agent). If none passed the gates it reads `· decider fell through 3/3`. The full per-decision records are in the execution trace (`trace.decisions`) and a counts-only summary is in the run history record.

Live mode (the decider choosing routes), a circuit breaker and a daily cap are tracked in [#357](https://github.com/swenyai/sweny/issues/357).
