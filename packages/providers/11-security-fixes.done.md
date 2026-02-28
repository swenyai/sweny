# Security Fixes for New Providers

Fix 3 critical security issues in the new provider implementations.

## Working directory
`/Users/nate/src/swenyai/sweny/packages/providers`

## Test framework
Vitest. Run tests with `npx vitest run` from the providers directory.

## Fix 1: New Relic NRQL Injection

**File:** `src/observability/newrelic.ts`

User input is interpolated directly into NRQL query strings without escaping. If `opts.severity` or `opts.serviceFilter` contain single quotes, the NRQL query breaks or can be exploited.

**Current code (line 84):**
```ts
const nrqlQuery = `SELECT timestamp, service, level, message FROM Log WHERE level = '${opts.severity}' AND service LIKE '%${opts.serviceFilter}%' SINCE ${opts.timeRange} ago LIMIT 100`;
```

**Fix:** Add a helper function `escapeNrql(input: string): string` that escapes single quotes by doubling them (`'` → `''`) and also strips any backticks. Apply to all user inputs interpolated into NRQL strings in both `queryLogs` (line 84) and `aggregate` (line 124).

```ts
function escapeNrql(value: string): string {
  return value.replace(/'/g, "''").replace(/\\/g, "\\\\");
}
```

## Fix 2: GitLab Token in Git URL

**File:** `src/source-control/gitlab.ts`

The `pushBranch` method exposes the token in the git remote URL, which gets logged in shell history and git output.

**Fix:** Use the `GIT_ASKPASS` environment variable approach instead. Create a temporary script that echoes the token, set `GIT_ASKPASS` env var to point to it, and use `https://oauth2@<host>/<project>.git` (without the token in the URL). The git helper already uses `execFileAsync` so you can pass `env` options.

Alternatively, simpler fix: use `git -c http.extraHeader="Authorization: Bearer ${token}"` approach or use credential helper. The simplest safe approach is passing the token via the environment:

```ts
async pushBranch(name: string): Promise<void> {
  // Fetch project path for the remote URL
  const project = await glApi(...);
  const host = new URL(baseUrl).host;
  const remoteUrl = `https://gitlab-ci-token@${host}/${project.path_with_namespace}.git`;

  await git(["remote", "set-url", "origin", remoteUrl]);

  // Push using GIT_ASKPASS to provide the token without exposing it in the URL
  const { stdout } = await execFileAsync("git", ["push", "origin", name], {
    env: {
      ...process.env,
      GIT_ASKPASS: "/bin/echo",
      GIT_PASSWORD: token,
    },
  });
}
```

Actually, the simplest correct approach: use `-c http.extraheader` to inject auth:

```ts
await execFileAsync("git", [
  "-c", `http.extraheader=PRIVATE-TOKEN: ${token}`,
  "push", "origin", name,
]);
```

## Fix 3: Splunk SPL Injection + Loki LogQL Injection

**File:** `src/observability/splunk.ts`

User input in SPL queries is not escaped. Special chars in `opts.serviceFilter` could break or manipulate queries.

**Fix:** Add `escapeSpl(value: string): string` that escapes quotes and special SPL characters:
```ts
function escapeSpl(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}
```
Apply to serviceFilter and severity in query construction.

**File:** `src/observability/loki.ts`

Regex special characters in `opts.serviceFilter` are not escaped for LogQL regex patterns.

**Fix:** Add `escapeRegex(value: string): string`:
```ts
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
```
Apply where serviceFilter is used in regex patterns like `{job=~".*${serviceFilter}.*"}`.

## Completion

After fixing all files:
1. Run `npx vitest run` to ensure existing tests still pass
2. Run `npx tsc --noEmit` to check types
3. Rename this file: `mv packages/providers/11-security-fixes.todo.md packages/providers/11-security-fixes.done.md`
4. Stage and commit with message:
```
fix: patch query injection vulnerabilities in observability providers

Escape user input in NRQL, SPL, and LogQL queries to prevent injection.
Fix GitLab token exposure in git push URL.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
```
