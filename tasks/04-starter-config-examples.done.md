# Task: Add Example Values and Where-to-Find Hints to STARTER_CONFIG

## Goal
Reduce setup friction by annotating the generated `sweny.config.ts` with concrete example values and links explaining where to find each ID — so users don't have to guess or hunt through provider dashboards.

## Problem
`STARTER_CONFIG` in `packages/cli/src/config-file.ts` has helpful placeholder names (`"your-linear-team-id"`, `"your-jira-project-key"`) but no guidance on *where* to find these values. New users copy the config and then get stuck — they open Linear and have no idea how to find their team ID.

## Files to Change

### `packages/cli/src/config-file.ts` — `STARTER_CONFIG` string

Add inline comments to each ID/key field explaining where to find it. The comments should appear on the line *above* or *beside* the field so they show up in the generated file.

**Linear section — current:**
```typescript
// Linear
// teamId: "your-linear-team-id",
```

**Linear section — improved:**
```typescript
// Linear — https://linear.app
// teamId: "your-linear-team-id", // Settings > Workspace > Teams > [your team] > copy ID from URL
```

**Jira section — current:**
```typescript
// Jira
// projectKey: "YOUR-PROJECT",
```

**Jira section — improved:**
```typescript
// Jira — https://your-org.atlassian.net
// projectKey: "YOUR-PROJECT",   // The prefix before issue numbers (e.g. "ENG" in ENG-123)
// host: "https://your-org.atlassian.net",
// email: "you@company.com",     // Atlassian account email
// apiToken: "...",               // https://id.atlassian.com/manage-profile/security/api-tokens
```

**GitHub section — current:**
```typescript
// repository: "org/repo",
```

**GitHub section — improved:**
```typescript
// repository: "org/repo",       // e.g. "my-company/backend" (from the GitHub URL)
// token: "ghp_...",              // https://github.com/settings/tokens — needs repo + issues scopes
```

**Datadog section — improved:**
```typescript
// Datadog — https://app.datadoghq.com
// apiKey: "...",    // Organization Settings > API Keys
// appKey: "...",    // Organization Settings > Application Keys
// site: "datadoghq.com",  // or datadoghq.eu, us3.datadoghq.com, etc.
```

**Sentry section — improved:**
```typescript
// Sentry — https://sentry.io
// dsn: "https://...",            // Project Settings > Client Keys (DSN)
// authToken: "...",              // User Settings > Auth Tokens
// organization: "your-org-slug", // From your Sentry org URL: sentry.io/organizations/<slug>/
// project: "your-project-slug",  // Project Settings > General > Project Slug
```

## Tests to Add
No unit tests needed — this is a documentation/template change. Verify manually that `sweny init` generates a config file with the new comments.

Optionally: add a snapshot test that `STARTER_CONFIG` contains certain key phrases like `"id.atlassian.com"` or `"settings/tokens"`.

## Acceptance Criteria
- `sweny init` generates a `sweny.config.ts` where each provider block has at least one comment line explaining where to find the required ID/token
- Comments include direct URLs to the provider's token management page where applicable
- No functionality changed — this is comments/strings only

## Changeset Required
File: `.changeset/starter-config-examples.md`
```md
---
"@sweny-ai/cli": patch
---

Generated sweny.config.ts now includes inline comments showing where to find API keys, team IDs, and project slugs for each provider.
```
