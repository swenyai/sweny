# Task 23 — CLI: `sweny check` provider connectivity validation

## Goal

New users often spend hours debugging why SWEny can't connect to Datadog or
Linear. The CLI should have a `sweny check` command that:
1. Reads the current config (same as `sweny triage` would)
2. Performs a lightweight connectivity test for each configured provider
3. Prints ✓/✗ for each, with exactly what to fix

This is a **conversion** feature: the time from "I installed SWEny" to
"I confirmed it's wired up" should be under 30 seconds.

## Context

- **`packages/cli/src/main.ts`** — Add a new `check` command alongside `init`, `triage`, `implement`, `workflow`
- **`packages/cli/src/config.ts`** — `parseCliInputs` + `validateInputs` handle config; `check` uses them
- **`packages/cli/src/output.ts`** — Add `formatCheckResults(results)` function for ✓/✗ display
- Provider connectivity tests are simple API calls (HEAD or minimal GET):
  - **Datadog**: `GET https://api.{site}/api/v2/validate` with `DD-API-KEY` + `DD-APPLICATION-KEY` headers
  - **Sentry**: `GET https://sentry.io/api/0/` with `Authorization: Bearer {token}`
  - **Linear**: `POST https://api.linear.app/graphql` body `{"query":"{viewer{id}}"}` with auth header
  - **GitHub**: `GET https://api.github.com/user` with `Authorization: token {token}`
  - **Anthropic**: `GET https://api.anthropic.com/v1/models` with `x-api-key` header (check for 200 or 401 to confirm the key is recognized)

## What to implement

### 1. `checkProviderConnectivity(config: CliConfig): Promise<CheckResult[]>`

Create `packages/cli/src/check.ts`:

```typescript
export interface CheckResult {
  name: string;       // "Anthropic (claude agent)"
  status: "ok" | "fail" | "skip";
  detail: string;     // "authenticated as user@example.com" | "401 Unauthorized — check DD_API_KEY"
}

export async function checkProviderConnectivity(config: CliConfig): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  // For each configured provider, do a lightweight check
  // ...
  return results;
}
```

Each check should:
- Return `skip` if the provider is not configured (e.g., `file` provider)
- Return `ok` with a confirmation detail on success
- Return `fail` with the HTTP status + actionable hint on failure
- Catch network errors and return `fail` with message

Use the native `fetch` API (Node 18+ has it built-in). Do NOT import provider
packages — this is a CLI-only connectivity check using raw HTTP.

### 2. `formatCheckResults` in output.ts

```typescript
export function formatCheckResults(results: CheckResult[]): string {
  // Box format matching the existing SWEny UI
  // ✓ green for ok, ✗ red for fail, − gray for skip
  // Include detail text for each
}
```

### 3. `sweny check` command in main.ts

```typescript
program
  .command("check")
  .description("Verify provider credentials and connectivity")
  .action(async () => {
    const fileConfig = loadConfigFile();
    const config = parseCliInputs({}, fileConfig);
    // Run structural validation first
    const validationErrors = validateInputs(config);
    if (validationErrors.length > 0) {
      console.error(formatValidationErrors(validationErrors));
      process.exit(1);
    }
    console.log(chalk.dim("\n  Checking provider connectivity...\n"));
    const results = await checkProviderConnectivity(config);
    console.log(formatCheckResults(results));
    const hasFailure = results.some((r) => r.status === "fail");
    process.exit(hasFailure ? 1 : 0);
  });
```

## Providers to check

| Config | Test call | Skip when |
|--------|-----------|-----------|
| `codingAgentProvider=claude` | GET Anthropic /v1/models | No key |
| `observabilityProvider=datadog` | GET DD /api/v2/validate | provider=file/none |
| `observabilityProvider=sentry` | GET Sentry /api/0/ | provider=file/none |
| `issueTrackerProvider=linear` | POST Linear GraphQL `{viewer{id}}` | provider=file |
| `issueTrackerProvider=github-issues` | GET GitHub /user | provider=file |
| `sourceControlProvider=github` | GET GitHub /user | same token as above |

Note: GitHub source control + GitHub issues use the same `GITHUB_TOKEN` — only
check once if both are configured.

## Changeset

```md
---
"@sweny-ai/cli": minor
---
New `sweny check` command verifies provider credentials and connectivity
before you run a workflow. Prints ✓/✗ for each configured provider with
actionable hints when a check fails.
```

## Tests

Add `packages/cli/tests/check.test.ts`:
- `checkProviderConnectivity` with all providers set to `file` → all results `skip`
- Mock `fetch` to return 200 for Datadog → result `ok`
- Mock `fetch` to return 401 for Datadog → result `fail` with hint
- Mock `fetch` to throw ENOTFOUND → result `fail` with network error message
- `formatCheckResults` renders ✓ for ok, ✗ for fail, − for skip

Use `vi.spyOn(globalThis, "fetch").mockImplementation(...)` for fetch mocks.

## Done when

- [ ] `packages/cli/src/check.ts` with `checkProviderConnectivity`
- [ ] `formatCheckResults` in `output.ts`
- [ ] `sweny check` command in `main.ts`
- [ ] Tests passing
- [ ] `npx tsc --noEmit` clean
- [ ] Changeset created
