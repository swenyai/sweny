# Task: Add Actionable Hints to Validation Error Messages

## Goal
When credential validation fails in `validateInputs()`, the error message should tell the user *where* to find the missing value — not just say "LINEAR_TEAM_ID is required".

## Problem
Current error messages in `packages/cli/src/config.ts` (`validateInputs()`) are bare:
- `"LINEAR_TEAM_ID is required when provider is linear"`
- `"JIRA_API_TOKEN is required"`

Users see this, open their terminal, and have no idea where to get these values. They churn on setup.

## Files to Change

### `packages/cli/src/config.ts` — `validateInputs()` credential checks

Update each error string to include a URL hint. Example pattern:

**Current:**
```typescript
if (!process.env.LINEAR_TEAM_ID) {
  errors.push("LINEAR_TEAM_ID is required when provider is linear");
}
```

**Improved:**
```typescript
if (!process.env.LINEAR_TEAM_ID) {
  errors.push(
    "LINEAR_TEAM_ID is required — find it at: Linear > Settings > Workspace > Teams > [your team] > copy ID from URL"
  );
}
```

Apply the same pattern to every credential check. Suggested hints per provider:

| Env var | Hint |
|---------|------|
| `LINEAR_API_KEY` | `Linear > Settings > API > Personal API keys` |
| `LINEAR_TEAM_ID` | `Linear > Settings > Workspace > Teams > [team] > ID in URL` |
| `JIRA_HOST` | `Your Atlassian domain, e.g. https://your-org.atlassian.net` |
| `JIRA_EMAIL` | `Your Atlassian account email address` |
| `JIRA_API_TOKEN` | `https://id.atlassian.com/manage-profile/security/api-tokens` |
| `DATADOG_API_KEY` | `Datadog > Organization Settings > API Keys` |
| `DATADOG_APP_KEY` | `Datadog > Organization Settings > Application Keys` |
| `SENTRY_AUTH_TOKEN` | `Sentry > User Settings > Auth Tokens` |
| `GITHUB_TOKEN` | `https://github.com/settings/tokens — needs repo + issues scopes` |
| `SLACK_BOT_TOKEN` | `Slack API > Your App > OAuth & Permissions > Bot User OAuth Token` |

## Tests to Add

File: `packages/cli/src/config.test.ts`

```typescript
describe("validation error hints", () => {
  it("LINEAR_TEAM_ID error includes a hint URL/path", () => {
    process.env.LINEAR_API_KEY = "sk_test";
    delete process.env.LINEAR_TEAM_ID;
    const errors = validateInputs({ provider: "linear" } as CliConfig);
    const teamIdError = errors.find((e) => e.includes("LINEAR_TEAM_ID"));
    expect(teamIdError).toBeDefined();
    expect(teamIdError).toMatch(/settings|Settings|linear\.app/i);
    delete process.env.LINEAR_API_KEY;
  });

  it("JIRA_API_TOKEN error includes Atlassian token URL", () => {
    process.env.JIRA_HOST = "https://test.atlassian.net";
    process.env.JIRA_EMAIL = "test@test.com";
    delete process.env.JIRA_API_TOKEN;
    const errors = validateInputs({ provider: "jira" } as CliConfig);
    const tokenError = errors.find((e) => e.includes("JIRA_API_TOKEN"));
    expect(tokenError).toMatch(/atlassian/i);
    delete process.env.JIRA_HOST;
    delete process.env.JIRA_EMAIL;
  });
});
```

## Acceptance Criteria
- Each credential validation error includes a hint showing where to find the value
- Hints are part of the error string (no separate output mechanism needed)
- Errors still start with the env var name so they're greppable
- Tests pass: `npm test` in `packages/cli`

## Changeset Required
File: `.changeset/validation-error-hints.md`
```md
---
"@sweny-ai/cli": patch
---

Credential validation errors now include hints pointing to where each API key or ID can be found.
```
