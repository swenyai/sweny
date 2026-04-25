---
"@sweny-ai/core": minor
---

Rename `verify:` to `eval:` and reshape into named evaluators with three kinds (value, function, judge). Aligns sweny with the rest of the agent-eval ecosystem (LangSmith, Promptfoo, OpenAI Evals, DeepEval, Ragas) and unlocks the LLM-as-judge case the old shape couldn't express.

**Breaking changes:**

- `node.verify` is removed. Use `node.eval` (an array of named evaluators) instead.
- `NodeResult.evals` is new (one structured `EvalResult` per evaluator).
- The `evaluateVerify()` export is gone. Use `evaluateAll()` and `aggregateEval()` from `@sweny-ai/core/eval`.
- The retry preamble now renders a structured `name (kind): reasoning` bullet list instead of a single concatenated string. Header text changed from "Previous attempt failed verification" to "Previous attempt failed evaluation".

**Migration:**

A single-rule verify block translates one-to-one to a single eval entry:

```yaml
# Before
verify:
  any_tool_called: [github_create_pr]

# After
eval:
  - name: pr_was_created
    kind: function
    rule:
      any_tool_called: [github_create_pr]
```

A verify block with both tool-call AND data fields splits into two evaluators (one `function`, one `value`).

The `judge` kind is new. Use it for conditional or semantic checks the old verify primitives couldn't express:

```yaml
eval:
  - name: tests_present_when_pass_claimed
    kind: judge
    rubric: |
      If test_status is "pass", does test_files_changed contain at least
      one real test file path? Empty array with status pass is a contract
      violation. Otherwise pass vacuously.
    pass_when: yes
```

Workflows that still ship a `verify:` block fail at parse time with a clear migration error pointing at the spec. Full reference: https://spec.sweny.ai/nodes/#eval.
