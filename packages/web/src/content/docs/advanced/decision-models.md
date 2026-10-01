---
title: Decision models
description: Route with an expression first. For the few conditions an expression cannot express, let a fast local decision model pick the branch when it is confident, before the agent is asked.
---

**Write an expression first.** A route whose condition compares declared output fields (`when: { expr: "triage.severity in ['high', 'critical']" }`) costs no model call and always goes the same way. Every route in SWEny's built-in workflows is an expression. See [Expressions](https://spec.sweny.ai/edges/#expressions).

A decision model is for the rest: a natural-language condition no declared field can express. A System One decision model (Ollama's `/v1/systemone`, TypeSafe Jev) answers that multiple-choice question in milliseconds. A node opts in with `route_by: decider`; SWEny asks the model first and takes its answer only when it is confident. Otherwise the agent decides, exactly as without a decider.

## Two-minute local setup

Needs Ollama 0.35 or later ([announcement](https://ollama.com/blog/ollama-now-supports-jev-style-decision-models)).

1. Pull a decision model:

   ```bash
   ollama pull nimble
   ```

2. Check the endpoint answers:

   ```bash
   curl http://localhost:11434/v1/systemone -d '{
     "model": "nimble",
     "state": { "ticket": "I was charged twice. Please refund the extra payment." },
     "questions": {
       "team": {
         "type": "choice",
         "instructions": "Which team should handle this ticket?",
         "criteria": { "billing": "Payments and refunds", "technical": "Bugs and integrations" }
       }
     }
   }'
   ```

3. Point SWEny at it in `.sweny.yml` (operator config, not the workflow):

   ```yaml
   decider:
     url: http://localhost:11434
     model: nimble
     allow_private: true # localhost is refused without this
   ```

4. Opt a node in, in the workflow:

   ```yaml
   nodes:
     review:
       name: Review
       instruction: ...
       route_by: decider
       output:
         type: object
         properties:
           verdict: { type: string, enum: [approve, revise, reject] }
           open_comments: { type: integer }
   ```

5. Run it. The receipt ends with who decided the routes, for example:

   ```
   ✓ 4/4 nodes · 12 tool calls · 41s · routes 3 (2 decider, 1 expr)
   ```

## Operator config

The endpoint, model and key never come from a workflow file. A workflow that sets `decider.provider` fails to load with a message saying where it goes now.

| Setting | `.sweny.yml` (`decider:` block) | Environment (wins over the file) |
| --- | --- | --- |
| Server root serving `POST /v1/systemone` | `url` | `SWENY_DECIDER_URL` |
| Model | `model` | `SWENY_DECIDER_MODEL` |
| Bearer key | not allowed in a file | `SWENY_DECIDER_API_KEY` (the only name read) |
| Allow loopback and private addresses | `allow_private: true` | none |

The URL must be http or https with no credentials in it. Loopback and private addresses (localhost, 127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, fc00::/7) are refused unless `allow_private: true`. Link-local and cloud metadata addresses (169.254.0.0/16, fe80::/10, `metadata.google.internal`) are always refused. A DNS name is judged by its text. Redirects are not followed. There is no default URL and no fallback from a local server to a hosted one.

`sweny workflow run --no-decider` (and `sweny workflow resume --no-decider`) skips the decider for one run.

## Workflow config

A workflow may only opt nodes in and tighten the gates:

```yaml
decider:
  min_confidence: 0.9 # default 0.85, never below 0.7
  min_margin: 0.25 # default 0.2, never below 0.1
```

`route_by` on a node is `agent` (the default) or `decider`. Only nodes that say `route_by: decider` consult the model, so a route into a write action (an issue, a PR) never goes through it unless that node opted in explicitly. **Safety conditions belong in expressions**, not in natural language: an expression cannot be talked into a branch.

## How a route is chosen

For each node with conditional out-edges, in order:

1. **`when` expressions.** SWEny evaluates them itself. No model is asked, not even the decider.
2. **The decider**, for a `route_by: decider` node. It gets one Choice question over the node's live out-edges (the default edge included; edges whose `max_iterations` is spent are left out). Its label is the route only when all of these hold: the label is exactly one of those edges, the probabilities cover exactly those edges and sum to 1, the label is the unique most probable one, confidence is at least `min_confidence`, and the top label leads the runner-up by at least `min_margin`. Then the agent is not called for that route.
3. **The agent.** Anything else falls through to the agent's route evaluation, unchanged, including its fail-closed rules.

Every decider problem falls through to the agent: a timeout (2 seconds), any HTTP error, a malformed or incomplete response, an unknown label, low confidence, or a thin margin.

## What the model sees

Only an explicit projection of declared typed fields: each earlier node's status, its `output` properties declared as `number`, `integer`, `boolean` or a string `enum` (a value that does not fit its declared type is sent as null), and its eval verdicts. Free-text strings, undeclared fields, the run input, summaries, tool calls, instructions, environment values and skill config are never sent. The projection is redacted with the same redactor as `--json` output and the run journal, and fenced as untrusted data.

The decider is skipped (reason `no_routable_state`, no call made) when a condition reads `input.*`, when the routed node declares no routable field, or when a condition names another node that declares none.

## Reliability

- **Circuit breaker.** After 3 failed calls in a row the decider is not called again for the rest of the run. A valid answer, even a low-confidence one, resets the count; an aborted run does not count.
- **Call cap.** At most 200 calls per run.
- Both are per logical run: the run journal records the decider's mode and counters, and `sweny workflow resume` continues them.

## Where you see it

The receipt counts who decided every conditional route, for example `· routes 5 (3 decider, 1 expr, 1 agent)`. When the decider could not run for some routes it says why, once: `· decider off: no operator config (...)`, `· decider off: breaker open after 3 failed calls`, `· decider off: call cap of 200 reached`. Per-call records are in the execution trace (`trace.decisions`) and each route's rung in `trace.edges` and the run history record. Logs hold metadata only: edge target ids, confidence, margin, latency, model and a short input hash.

## Resume

The run journal records which rung decided each route. `sweny workflow resume` replays a recorded route as is, without asking the decider or the agent again, so replay is deterministic for the routes the journal recorded. Routes after the resume point are decided fresh.

## Upgrading from shadow mode

Shadow mode (`mode: shadow`, `--decider shadow`, the `decider agreed N/M` receipt) is gone, and so is `decider.provider` in a workflow. A workflow that still declares either fails to load with an error that says what to do: move the provider to operator config, delete `mode`, and add `route_by: decider` to the nodes that should use it.
