---
"@sweny-ai/core": minor
---

Complete the public API surface and harden runtime input validation.

- Re-export the loader pipeline (`loadAndValidateWorkflow`, `validateParsed`, and the `LoaderResult` / `LoaderError` / `LoaderOptions` types) so programmatic consumers can load workflows the same way the CLI does.
- Export the core public field types (`Evaluator`, `EvaluatorRule`, `EvalResult`, `EvaluatorKind`, `NodeRequires`, `NodeRetry`, `OutputMatch`, `NodeSources`, `EvalPolicy`, `RequiresOnFail`, `McpTransport`, `WorkflowType`, `SkillHarnessKey`).
- Export the runtime enum constants and skill-id helpers (`EVALUATOR_KINDS`, `EVAL_POLICIES`, `REQUIRES_ON_FAIL`, `MCP_TRANSPORTS`, `SKILL_CATEGORIES`, `SKILL_HARNESSES`, `SKILL_ID_PATTERN`, `SKILL_ID_MAX_LENGTH`, `isValidSkillId`, `skillJsonSchema`).
- Harden `validateRuntimeInput` against prototype pollution: the unknown-key passthrough now skips `__proto__`, `constructor`, and `prototype` so untrusted input can never mutate the result's prototype chain.

All changes are additive. No existing export was removed or renamed.
