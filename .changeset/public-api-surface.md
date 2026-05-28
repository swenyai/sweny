---
"@sweny-ai/core": minor
---

Complete the public API surface and harden runtime input validation.

- Re-export the loader pipeline (`loadAndValidateWorkflow`, `validateParsed`, and the `LoaderResult` / `LoaderError` / `LoaderOptions` types) so programmatic consumers can load workflows the same way the CLI does.
- Export the core public field types (`Evaluator`, `EvaluatorRule`, `EvalResult`, `EvaluatorKind`, `NodeRequires`, `NodeRetry`, `OutputMatch`, `NodeSources`, `EvalPolicy`, `RequiresOnFail`, `McpTransport`, `WorkflowType`, `SkillHarnessKey`).
- Export the runtime enum constants and skill-id helpers (`EVALUATOR_KINDS`, `EVAL_POLICIES`, `REQUIRES_ON_FAIL`, `MCP_TRANSPORTS`, `SKILL_CATEGORIES`, `SKILL_HARNESSES`, `SKILL_ID_PATTERN`, `SKILL_ID_MAX_LENGTH`, `isValidSkillId`, `skillJsonSchema`).
- Mirror the safe (non-node) constants, field types, and `skillJsonSchema` onto the browser entry (`@sweny-ai/core/browser`) so Studio and other browser consumers reach them without hardcoding members. The loader stays node-only (it imports `node:fs`).
- Harden `validateRuntimeInput` against prototype pollution: the unknown-key passthrough now skips `__proto__`, `constructor`, and `prototype` so untrusted input can never mutate the result's prototype chain. Covers both `JSON.parse` output and hand-built objects with an enumerable own `__proto__` key.

All changes are additive. No existing export was removed or renamed.
