# Fix Landing Page Completeness + Navigation Gaps

## Why this matters
`index.mdx` lists incomplete provider sets (missing OpsGenie, CSI storage) — users with those
tools think SWEny doesn't support them. `getting-started/providers.md` lists Incident and
Messaging in the table but never tells users what they're for or links to the docs.

## What to do

### 1. Fix `packages/web/src/content/docs/index.mdx`
- Incident card: "PagerDuty" → "PagerDuty, OpsGenie"
- Storage card: "Filesystem, S3" → "Filesystem, S3, Kubernetes PVC"
- Notification card: add "Console, File" to the list (for CLI/testing users)

### 2. Add Incident + Messaging guidance to `packages/web/src/content/docs/getting-started/providers.md`
Add two new sections after "### Source control":

```markdown
### Incident management

PagerDuty and OpsGenie are available for workflows that need to create or acknowledge incidents.
They're not used by the built-in Triage workflow by default — Triage opens PRs, not pages.
Use the incident provider when building custom workflows that should page on-call.
See [Incident Providers](/providers/incident/).

### Messaging

The messaging provider is used by the **interactive agent** (Slack bot) to send and update
threaded responses. It's different from the notification provider — messaging supports
bidirectional threads, while notification is fire-and-forget.
If you're using the GitHub Action or CLI, you don't need to configure a messaging provider.
See [Messaging Providers](/providers/messaging/).
```

### 3. Update the Getting Started sidebar in `packages/web/astro.config.mjs`
Add FAQ link when it exists:
- `{ label: "FAQ", slug: "getting-started/faq" }` (after Troubleshooting)
- This will be created in task 37

## Related files
- `packages/web/src/content/docs/index.mdx`
- `packages/web/src/content/docs/getting-started/providers.md`
- `packages/web/astro.config.mjs`
