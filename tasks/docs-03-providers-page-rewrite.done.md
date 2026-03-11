# docs-03: Rewrite "Provider Architecture" page

## Goal
`packages/web/src/content/docs/getting-started/providers.md` currently leads with TypeScript factory function patterns, subpath imports, type guard functions, and "implementing your own provider" instructions. Rewrite it as a user-facing reference that answers: "what providers does SWEny support and how do I pick one?"

## Context
Most users configure providers via GitHub Action inputs (`dd-api-key`, `linear-api-key`, etc.) or `.sweny.yml`. They never call `datadog({ apiKey })` directly. The current page feels like an SDK reference manual, not a user guide.

The page does have one valuable thing: the provider categories table. Keep and expand that. Everything else needs to be rewritten or moved.

## File to edit
`packages/web/src/content/docs/getting-started/providers.md`

## What the rewritten page should cover

### Opening paragraph
Replace the current opening (which talks about "factory function pattern") with a short explanation of what providers ARE in plain language: "Providers connect SWEny to your existing tools — your observability platform, issue tracker, source control, and notification channels. You choose one provider per category and configure it through Action inputs or `.sweny.yml`."

### Provider categories table
Keep the table but improve it:
- Remove the "Interface" column (e.g., `ObservabilityProvider`) — internal TypeScript types, not user-facing
- Keep "Category" and "Implementations"
- Add a "Configure via" column pointing to the relevant Action inputs or config key
- Example row: `| Observability | Datadog, Sentry, CloudWatch, Splunk, New Relic, Grafana Loki, Elasticsearch | `observability-provider` input |`

### Per-category section (new)
Add a short section under the table called `## Choosing a provider` with subsections for the most common categories:

**Observability** — "If you're already using Datadog, Sentry, or CloudWatch, point SWEny at it directly. No extra setup needed. See [Observability Providers](/providers/observability/) for full config."

**Issue Tracking** — "GitHub Issues is the default — no extra credentials needed. For Linear or Jira, add the relevant API key. See [Issue Tracking Providers](/providers/issue-tracking/)."

**Notifications** — "Configure a Slack webhook URL, Teams webhook, Discord webhook, email via SendGrid, or use GitHub Actions Summary (default, no setup). See [Notification Providers](/providers/notification/)."

### Remove entirely
- `## The pattern` section with the TypeScript factory function example
- `## Subpath imports` section — internal SDK detail
- `## Optional capabilities` section with `canLinkPr`, `canSearchByFingerprint` type guards — SDK detail
- `## Implementing your own provider` section — move a short mention to an "Advanced" callout box at the bottom

### Add a short "Advanced" callout at the bottom
Replace the removed "Implementing your own provider" section with a minimal callout:

> **Building on top of SWEny?** If you're extending SWEny programmatically, providers are TypeScript interfaces you can implement. See the [SDK Reference](https://github.com/swenyai/sweny/tree/main/packages/providers) on GitHub.

## No changeset needed
`packages/web` is private. No `.changeset/` file needed.

## Acceptance criteria
- Zero TypeScript code blocks on the page
- The provider categories table is still present and improved
- Page answers "which provider do I use for X?" clearly
- Passes `npm run build --workspace=packages/web` with no errors
