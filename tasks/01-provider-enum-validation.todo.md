# Task: Provider Enum Validation in CLI

## Goal
Add compile-time and runtime validation of provider names in `packages/cli/src/config.ts` so typos like `datdog` fail immediately with a clear error message — before the spinner starts, before any API calls are made.

## Problem
Currently `validateInputs()` in `packages/cli/src/config.ts` validates provider *credentials* via a `switch (config.provider)` block but never validates the provider name itself. If someone types `--provider datdog` (typo), the switch falls to `default: break` with no error and the workflow starts — only to fail later with a confusing "provider not found" runtime error.

## Files to Change

### `packages/cli/src/config.ts`

The `VALID_PROVIDERS` constant should be defined and used in `validateInputs()`.

**Add at the top of the file (near the imports/constants section):**
```typescript
export const VALID_PROVIDERS = [
  "datadog",
  "sentry",
  "honeycomb",
  "cloudwatch",
  "new-relic",
  "linear",
  "jira",
  "github",
  "slack",
  // extend as new providers are added
] as const;
export type ValidProvider = (typeof VALID_PROVIDERS)[number];
```

**In `validateInputs()`**, add a check before the credential switch block:
```typescript
if (config.provider && !VALID_PROVIDERS.includes(config.provider as ValidProvider)) {
  errors.push(
    `Unknown provider "${config.provider}". Valid providers: ${VALID_PROVIDERS.join(", ")}`
  );
}
```

The exact location: look for the comment `// Provider-specific credential checks` — add the enum check immediately before that comment.

## Tests to Add

File: `packages/cli/src/config.test.ts` (or wherever the CLI config tests live — search for `validateInputs`).

Add a `describe("provider enum validation")` block:
```typescript
it("rejects unknown provider name", () => {
  const errors = validateInputs({ provider: "datdog" } as CliConfig);
  expect(errors.some((e) => e.includes("Unknown provider"))).toBe(true);
  expect(errors.some((e) => e.includes("datadog"))).toBe(true); // shows valid list
});

it("accepts all known valid providers", () => {
  for (const p of VALID_PROVIDERS) {
    // Should not produce an "Unknown provider" error for known names
    const errors = validateInputs({ provider: p } as CliConfig);
    expect(errors.some((e) => e.includes("Unknown provider"))).toBe(false);
  }
});
```

## Acceptance Criteria
- `sweny triage --provider datdog` prints `Unknown provider "datdog". Valid providers: datadog, sentry, ...` and exits before starting the spinner
- All known provider names pass without the enum error
- Tests pass: `npm test` in `packages/cli`

## Changeset Required
File: `.changeset/provider-enum-validation.md`
```md
---
"@sweny-ai/cli": patch
---

Validate provider names at startup — unknown provider values now print a clear error with the valid provider list before the spinner starts.
```
