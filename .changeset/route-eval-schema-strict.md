---
"@sweny-ai/core": patch
---

Stop non-schema fields from biasing natural-language route decisions.

The LLM route evaluator was seeing every key on a prior node's `result.data`,
including prose narrative fields (the always-injected `summary` from the
reference Claude client, free-form rationale, internal commentary). On at
least one production run, a node correctly emitted `status: "pass"` but
also added a `summary` mentioning retries, and the evaluator pattern-matched
the retry mention to flip the routing decision. The workflow halted at a
notify_halt node despite every actual check passing.

Field run: https://github.com/letsoffload/offload/actions/runs/25775301135

Fix. When a node declares an `output` schema with a `properties` block, the
route-evaluator's view of that node's data is now restricted to those
declared properties. The declared schema is the routing contract; non-schema
fields stay out of the decision. Nodes without an `output` schema keep the
prior behavior (full data view).

The downstream node prompt is untouched. `run()` still sees the full prior
`data` including prose narrative, so workflows that consume narrative in
later steps keep working.

Belt-and-suspenders: the `evaluate()` prompt now explicitly instructs the
model to match conditions against structured fields and ignore prose
fields. This helps in the no-schema fallback case.

All bundled workflows audited; every conditional-edge source node already
declared an `output` schema with the routing fields as declared properties.
Zero behavior change for triage, implement, seed-content.
