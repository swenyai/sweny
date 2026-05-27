# Task 04 — Verify the docs + spec actually deployed (Vercel)

**Context:** Vercel deploys `packages/web` (docs.sweny.ai) and `spec/` (spec.sweny.ai) on push to `main` via its own git integration, independent of the failed Release workflow. The multi-model PR (#208) added a docs page (`advanced/model-gateway`) and a normative "Model Selection" spec section. Confirm they are live, so we know the npm/Release failure did not also take docs down.

**This task:** Verify the new content is served in production.

## Steps
- `curl -sS -o /dev/null -w "%{http_code}" https://docs.sweny.ai/advanced/model-gateway/` expects `200`.
- Fetch the page and confirm it contains the gateway content (e.g. "Model gateway" and "SWENY_AUTH").
- `curl` the spec node page (`https://spec.sweny.ai/nodes/` or `/nodes`) and confirm it contains "Model Selection".
- If any return non-200 or lack the content, note it: Vercel may still be building, or the deploy is misconfigured. Record findings.

## Acceptance
- Both URLs return 200 and contain the new content, OR a clear note of what is missing and the likely cause.
- No code change in this task; record the result in the `.done.md`.
