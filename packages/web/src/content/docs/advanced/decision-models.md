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

3. Point SWEny at it in `.sweny.yml` (a URL there must be loopback):

   ```yaml
   decider:
     url: http://localhost:11434
     model: nimble
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

`.sweny.yml` is repo content: a pull request can change it. So each credential lives in one trust domain:

| Where the URL comes from | What it may reach | Key sent |
| --- | --- | --- |
| `SWENY_DECIDER_URL` in the CI or shell environment | any public address; loopback and private only with `SWENY_DECIDER_ALLOW_PRIVATE=true` (environment) | `SWENY_DECIDER_API_KEY`, the only name read |
| `decider: { url }` in `.sweny.yml`, or `SWENY_DECIDER_URL` set by the workspace `.env` | loopback only (local Ollama) | never |

The model comes from `SWENY_DECIDER_MODEL`, else `decider.model` in `.sweny.yml`. Never put the URL or key for a remote server in `.sweny.yml` or a committed `.env`: a `SWENY_DECIDER_API_KEY` or `SWENY_DECIDER_ALLOW_PRIVATE` that only the workspace `.env` sets is ignored.

The URL must be http or https with no credentials in it. SWEny resolves the host name itself, checks every address it resolves to, and connects to the address it checked, so a name cannot be rebound to another address between the check and the connection. Loopback and private addresses (127.0.0.0/8, ::1, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 100.64.0.0/10, fc00::/7) need the environment's allowance above. Link-local and cloud metadata addresses (169.254.0.0/16, fe80::/10, `metadata.google.internal`) are always refused. Redirects are not followed. There is no default URL and no fallback from a local server to a hosted one.

`sweny workflow run --no-decider` (and `sweny workflow resume --no-decider`) skips the decider for one run.

## Workflow config

A workflow may only opt nodes in and tighten the gates:

```yaml
decider:
  min_confidence: 0.9 # default 0.85, never below 0.7
  min_margin: 0.25 # default 0.2, never below 0.1
```

`route_by` on a node is `agent` (the default) or `decider`. Only nodes that say `route_by: decider` consult the model, so a route into a write action (an issue, a PR) never goes through it unless that node opted in explicitly. **Safety conditions belong in expressions**, not in natural language: an expression cannot be talked into a branch. A model, the decider or the agent, can pick an edge whose natural-language condition is in fact false; the gates make that unlikely, not impossible.

## How a route is chosen

For each node with conditional out-edges, in order:

1. **`when` expressions.** SWEny evaluates them itself. No model is asked, not even the decider. When a field an expression needs is missing or not of its declared type, SWEny first asks the node's agent once to return the output again with that field fixed. If it is still missing or invalid, the expressions that read it are unknown (an invalid field is unknown even to `exists`), and the route falls through to the next rung, which reads each edge's `description` (the condition in natural language; without one, the expression itself). It is offered only edges that could still be right: the unknown ones, plus the edge that is definitely true, or else the default edge. An edge whose expression is definitely false is never offered, and is refused if a model names it anyway. The repair request is part of the same node visit: it does not use a `max_steps` slot, but its spend counts.
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
