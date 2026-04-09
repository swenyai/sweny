---
"@sweny-ai/core": patch
---

Tighten the triage workflow's novelty check to reduce duplicate-ticket sprawl

The `investigate` node's novelty-check instruction previously told the agent to "search the issue tracker
with multiple keyword variations" and match on root cause, error pattern, or affected service. In practice
this matched on titles and surfaced candidates, but the agent rarely opened and read the full body of those
candidates — so issues whose "Recommended Fix" section already prescribed the change the agent was about to
propose were still classified as novel and filed as fresh tickets.

The updated instruction explicitly requires:

- **Broad search** across multiple query dimensions (affected file/module, error string verbatim, service
  name, symptom family) — not a single keyword.
- **Reading the full body of every promising candidate**, including any Recommended Fix / Proposed Fix /
  Action Items / Acceptance Criteria section. An existing open issue whose recommended fix already prescribes
  the proposed change is a duplicate even when the specific symptom is new.
- **Checking for meta-issues and bug families**, so parallel per-instance tickets don't accumulate when a
  single existing ticket already names the pattern.
- **Bias toward commenting, not filing**, when confidence is below ~80%. Ticket sprawl is more expensive for
  the team than an over-reported duplicate.

No schema or edge changes — this is a prompt-only update to `packages/core/src/workflows/triage.yml`.
