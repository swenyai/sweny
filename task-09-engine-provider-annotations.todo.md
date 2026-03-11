# Task 09: Add Provider Annotations to Engine StateDefinition

## Goal
Each state in a recipe can optionally declare which provider category it
uses. This is pure metadata — no runtime impact — but lets the Studio
surface configuration information.

## Changes

### packages/engine/src/types.ts
Add to StateDefinition:
```typescript
provider?: string;  // provider role key, e.g. "observability", "issueTracking"
```
This is intentionally loose (string not union) so custom recipes can use
custom provider roles.

### packages/engine/src/recipes/triage/definition.ts
Annotate each state with its provider category:
- dedup-check: provider: "observability" (queries recent issue labels)
- verify-access: no provider (checks all of them)
- build-context: provider: "observability"
- investigate: provider: "codingAgent"
- novelty-gate: provider: "observability" + "issueTracking" (checks for dupes)
- create-issue: provider: "issueTracking"
- cross-repo-check: provider: "sourceControl"
- implement-fix: provider: "codingAgent"
- create-pr: provider: "sourceControl"
- notify: provider: "notification"

Use the dominant provider for each step.

### packages/engine/src/recipes/implement/definition.ts
- verify-access: no provider
- create-issue (fetch): provider: "issueTracking"
- implement-fix: provider: "codingAgent"
- create-pr: provider: "sourceControl"
- notify: provider: "notification"

### Changeset
Create .changeset/engine-provider-annotations.md:
- @sweny-ai/engine: minor (new optional field on StateDefinition)

## Acceptance
- `StateDefinition` has optional `provider` field
- Both built-in recipe definitions have `provider` annotations on every state
- TypeScript builds without errors
