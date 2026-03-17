# Create FAQ Page

## Why this matters
FAQ pages are the #1 conversion tool for dev tools. Users hit friction when evaluating SWEny
and leave without finding answers. An FAQ page reduces that friction and boosts trust.

## What to do
Create `packages/web/src/content/docs/getting-started/faq.md`
Add it to the sidebar in astro.config.mjs under Getting Started after Troubleshooting.

## Questions to answer (based on docs gaps and typical eval questions)

### General
- **What does SWEny cost?** — Free if you use Claude Max/Pro subscription. With Anthropic API key,
  ~$0.10–$0.50 per triage run at Sonnet pricing. No SWEny subscription fee.
- **Does SWEny store my code or logs?** — No. Logs are queried in-flight and passed to Claude.
  Nothing is persisted on SWEny servers. Runs in your CI, your data stays in your infra.
- **What Claude model does SWEny use?** — Claude Sonnet (latest) by default. Configurable via
  coding-agent-provider.

### Setup
- **Do I need Datadog? What if I use a different observability tool?** — Works with Sentry,
  CloudWatch, Splunk, Elasticsearch, New Relic, Grafana Loki, or a local JSON file.
- **Do I need Linear? I use Jira/GitHub Issues.** — GitHub Issues is the default (no setup).
  Jira supported with api-token.
- **Does it work with GitLab instead of GitHub?** — Yes. Set source-control-provider: gitlab.
  CLI works anywhere. GitHub Action requires triggering from GitHub Actions but can operate on
  GitLab repos via the GitLab provider.
- **How do I test without creating real tickets?** — Use dry-run: true or file-based providers
  (observability-provider: file with a JSON log file, issue-tracker-provider: file).

### Behavior
- **Why does SWEny say "no novel issues found" every run?** — See troubleshooting. Usually:
  time-range too narrow, issues already tracked (novelty-mode: true), or service-filter too narrow.
- **Will SWEny create duplicate tickets?** — No. It checks your issue tracker for recent matching
  issues before creating one. Use novelty-mode: false to override.
- **Can SWEny fix complex bugs or just simple ones?** — Depends on the codebase and investigation-depth.
  It's best at bugs with clear error messages and localized root causes. It won't redesign
  architecture or fix data model issues.
- **Does it auto-merge PRs?** — Only if review-mode: auto is set AND the change passes CI AND
  it's not high-risk (migrations, auth, large diffs). Default is review (human approval required).

### Security
- **Does SWEny have write access to my repo?** — Only when you grant it (contents: write,
  pull-requests: write permissions in your workflow). dry-run: true requires only read access.
- **Can I restrict what the agent can do?** — Yes. Use dry-run: true to prevent any writes.
  The agent runs with the permissions you grant in the workflow file.

### Custom workflows
- **Can I build my own workflows?** — Yes. See Workflow Authoring for the full TypeScript API,
  or write YAML workflow files and run them with sweny workflow run.
- **Can I use SWEny for things other than error triage?** — Yes. The engine is general-purpose.
  Triage and Implement are built-in workflows. You can build workflows for any repetitive
  engineering task that follows a Learn → Act → Report pattern.

## Related files
- `packages/web/src/content/docs/getting-started/troubleshooting.md` — don't duplicate, link instead
- `packages/web/astro.config.mjs` — add FAQ to sidebar
