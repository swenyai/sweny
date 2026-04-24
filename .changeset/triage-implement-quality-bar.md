---
"@sweny-ai/core": patch
---

Tighten the bundled triage workflow's `implement` node to make tests
non-negotiable.

Background: the previous instruction said "Run any existing tests if available
to verify the fix doesn't break anything" and explicitly told the agent to
"fix the bug, nothing more." A real production fix shipped via the agent
landed without a single new test case, even though the affected file already
had a `*.spec.ts` next to it. The instruction was actively discouraging
authoring tests.

This rewrite:

- Adds a top-of-instruction Quality Bar covering correctness, completeness,
  industry-standard idiom (e.g. NestJS exception subclasses, not
  `throw new Error`), best practices, no hacky shortcuts, and well-tested.
- Adds an explicit Test Requirements section: tests must fail on the unfixed
  code, assert the user-facing contract not implementation details, cover
  edge cases, and live next to the source file.
- Tells the agent to read the nearest existing test file before writing new
  tests so they match the existing conventions (framework, mock style,
  describe/it shape, naming).
- Adds an output schema requiring `branch`, `commit_sha`, `files_changed`,
  `test_files_changed`, `test_status` — so the agent has to declare what it
  actually did, not just say "done".
- Adds a verify gate: `test_status` must be exactly `pass` AND
  `test_files_changed` must be non-empty. No escape valve — repos without
  test infrastructure should require human attention, not silent skipping.
- Adds `retry: { max: 1, instruction: { auto: true } }` so a first attempt
  that forgets tests gets one auto-reflected retry to write them.
