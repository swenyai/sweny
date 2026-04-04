# `sweny init` Interactive Setup Wizard — Design Spec

**Goal:** Replace the static `sweny init` stub with an interactive CLI wizard that guides users through provider selection, writes a clean `.sweny.yml`, generates a `.env` credential template, and optionally scaffolds a GitHub Action workflow — making the first 5 minutes of SWEny delightful.

**Architecture:** A single new module (`init.ts`) with pure functions for file generation and a thin interactive layer using `@clack/prompts`. The existing Commander stub in `main.ts` delegates to `runInit()`. Auto-detection of the git remote pre-selects sensible defaults.

**Tech Stack:** `@clack/prompts` (TUI), `yaml` (serialization, already a dependency), Commander.js (existing CLI framework).

---

## 1. File Layout

| File | Action | Purpose |
|------|--------|---------|
| `packages/core/src/cli/init.ts` | Create | All init logic: wizard flow, file generators, git detection |
| `packages/core/src/cli/init.test.ts` | Create | Unit tests for pure functions (YAML gen, env gen, git detection) |
| `packages/core/src/cli/main.ts` | Modify (lines 86-99) | Replace sync stub with async `runInit()` call |
| `packages/core/package.json` | Modify | Add `@clack/prompts` dependency |

No new types needed. The wizard collects plain strings that map to existing `.sweny.yml` keys.

## 2. Wizard Flow

Seven screens, strictly linear. Each screen is one `@clack/prompts` call.

```
intro → source-control → observability → issue-tracker → notification → github-action → summary → write
```

### Screen 0: Intro

```
┌  Let's set up SWEny
│
│  Project: /Users/you/my-project
│  Git remote: github.com/you/my-project (detected)
│
└
```

Parse `.git/config` for `remote "origin"` URL. If it contains `github.com` → note GitHub detection. If `gitlab` → note GitLab. If neither → no detection, no pre-selection.

### Screen 1: Source Control

```
◆  Source control provider
│  ● GitHub  (detected from git remote)
│  ○ GitLab
└
```

Pre-select based on git remote detection. User can always override.

### Screen 2: Observability

```
◆  Observability provider
│  ○ Datadog
│  ○ Sentry
│  ○ BetterStack
│  ○ New Relic
│  ○ CloudWatch
│  ○ Other (enter provider name)
│  ○ None / skip
└
```

If "Other" is selected, show a text input for the provider name. Accept any string — `sweny check` validates later. If "None / skip", the `.sweny.yml` omits the observability line entirely.

### Screen 3: Issue Tracker

```
◆  Issue tracker
│  ● GitHub Issues  (pre-selected since source control is GitHub)
│  ○ Linear
│  ○ Jira
└
```

Pre-select GitHub Issues if source control is GitHub. Otherwise no pre-selection.

### Screen 4: Notification

```
◆  Where should SWEny send results?
│  ● Console  (default)
│  ○ Slack
│  ○ Discord
│  ○ Teams
│  ○ Webhook
└
```

Console is the default. Console requires no credentials, so it's the safe starting point.

### Screen 5: GitHub Action

```
◆  Set up a GitHub Action workflow?
│  ● Yes
│  ○ No
└
```

If yes, follow-up:

```
◆  Run schedule
│  ○ Daily (9am UTC)
│  ○ Weekly (Monday 9am UTC)
│  ○ Custom cron expression
└
```

If "Custom", show a text input for the cron expression.

### Screen 6: Summary + Confirm

```
◆  Here's what we'll create:

   .sweny.yml
     source-control-provider: github
     observability-provider: datadog
     issue-tracker-provider: linear
     notification-provider: slack

   .env  (credential template — fill in your keys)
     ANTHROPIC_API_KEY, GITHUB_TOKEN, DD_API_KEY, DD_APP_KEY, LINEAR_API_KEY, ...

   .github/workflows/sweny.yml
     Triage workflow, weekly (Monday 9am UTC)

│  Confirm? (Y/n)
└
```

### Screen 7: Write + Next Steps

```
✓  Created .sweny.yml
✓  Created .env
✓  Created .github/workflows/sweny.yml
⚠  .env is not in .gitignore — add it to avoid leaking secrets

   Next steps:
   1. Fill in your API keys in .env
      - Anthropic: https://console.anthropic.com/settings/api-keys
      - Datadog:   https://app.datadoghq.com/organization-settings
      - Linear:    https://linear.app/settings/api
   2. sweny check        (verify connectivity)
   3. sweny triage --dry-run  (test run)
```

## 3. Output Files

### `.sweny.yml`

Clean, minimal. Only the user's selections:

```yaml
# .sweny.yml — SWEny project configuration
# Secrets (API keys, tokens) go in .env (gitignored).
# Docs: https://docs.sweny.ai/cli

source-control-provider: github
observability-provider: datadog
issue-tracker-provider: linear
notification-provider: slack
```

No commented-out options, no walls of documentation. The old `STARTER_CONFIG` template remains in the codebase but is not used by the wizard.

### `.env`

Template grouped by provider selection. Only includes sections for selected providers. `ANTHROPIC_API_KEY` is always included.

```bash
# .env — SWEny credentials (DO NOT COMMIT)
# Fill in each value, then run: sweny check

# ── Claude (coding agent) ────────────────────────
# https://console.anthropic.com/settings/api-keys
ANTHROPIC_API_KEY=

# ── GitHub ────────────────────────────────────────
# https://github.com/settings/tokens (repo + issues scopes)
GITHUB_TOKEN=

# ── Datadog ───────────────────────────────────────
# https://app.datadoghq.com/organization-settings
DD_API_KEY=
DD_APP_KEY=
DD_SITE=datadoghq.com

# ── Linear ────────────────────────────────────────
# https://linear.app/settings/api
LINEAR_API_KEY=
LINEAR_TEAM_ID=
```

Empty values — no fake placeholders that could be mistaken for real keys. Fields with sensible defaults (like `DD_SITE`) are pre-filled.

### `.github/workflows/sweny.yml` (optional)

Only created if the user opted in at screen 5.

```yaml
name: SWEny Triage
on:
  schedule:
    - cron: "0 9 * * 1"
  workflow_dispatch:

jobs:
  triage:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: swenyai/sweny@v4
        with:
          workflow: triage
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          DD_API_KEY: ${{ secrets.DD_API_KEY }}
          DD_APP_KEY: ${{ secrets.DD_APP_KEY }}
          LINEAR_API_KEY: ${{ secrets.LINEAR_API_KEY }}
          LINEAR_TEAM_ID: ${{ secrets.LINEAR_TEAM_ID }}
```

The `env` block only includes `${{ secrets.X }}` entries for the selected providers. The cron expression matches their schedule choice.

## 4. Credential Mapping Table

A static lookup in `init.ts`. Each provider maps to its required credentials.

```ts
interface Credential {
  key: string;           // env var name
  hint?: string;         // where to find it
  url?: string;          // direct link to credential page
  default?: string;      // pre-filled value (e.g., DD_SITE)
  secret?: boolean;      // true = goes in .env and Action secrets; false = goes in .sweny.yml
}
```

Providers and their credentials:

| Provider | Env Vars | Doc URL |
|----------|----------|---------|
| *always* | `ANTHROPIC_API_KEY` | console.anthropic.com/settings/api-keys |
| `github` | `GITHUB_TOKEN` | github.com/settings/tokens |
| `gitlab` | `GITLAB_TOKEN`, `GITLAB_URL` | gitlab.com/-/profile/personal_access_tokens |
| `datadog` | `DD_API_KEY`, `DD_APP_KEY`, `DD_SITE` | app.datadoghq.com/organization-settings |
| `sentry` | `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` | sentry.io/settings/auth-tokens/ |
| `betterstack` | `BETTERSTACK_API_TOKEN` | betterstack.com/docs/logs/api |
| `newrelic` | `NR_API_KEY` | one.newrelic.com/api-keys |
| `cloudwatch` | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` | AWS IAM console |
| `linear` | `LINEAR_API_KEY`, `LINEAR_TEAM_ID` | linear.app/settings/api |
| `jira` | `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN` | id.atlassian.com/manage-profile/security/api-tokens |
| `slack` | `SLACK_BOT_TOKEN` | api.slack.com/apps |
| `discord` | `DISCORD_WEBHOOK_URL` | Discord server settings > Integrations |
| `teams` | `TEAMS_WEBHOOK_URL` | Teams channel > Connectors |
| `webhook` | `NOTIFICATION_WEBHOOK_URL` | Your webhook endpoint |

This table drives three outputs:
1. `.env` template sections
2. GitHub Action `env` block
3. "Next steps" credential doc links

## 5. Edge Cases

| Situation | Behavior |
|-----------|----------|
| `.sweny.yml` already exists | Clack confirm: "Overwrite existing .sweny.yml?" — Yes overwrites, No aborts wizard |
| `.env` already exists | Append new credential sections (don't clobber existing content). Skip sections that already have the key defined. |
| `.github/workflows/sweny.yml` exists | Clack confirm: "Overwrite existing workflow?" — Yes overwrites, No skips this file only |
| `.env` not in `.gitignore` | Print yellow warning after file creation |
| No `.git` directory | Skip auto-detection, no pre-selections |
| User hits Ctrl+C at any screen | Clack handles gracefully — clean exit, no files written |
| "Other" observability provider | Text input accepts any string; no validation at init time |
| "None / skip" observability | Omit `observability-provider` from `.sweny.yml` entirely |

## 6. Integration with Existing CLI

**Replacing the stub:** The current `sweny init` in `main.ts` (lines 86-99) is replaced with:

```ts
program
  .command("init")
  .description("Interactive setup wizard — creates .sweny.yml, .env template, and optional GitHub Action")
  .action(async () => {
    await runInit();
  });
```

**Complementary commands mentioned in next-steps output:**
- `sweny check` — verify provider connectivity
- `sweny setup github --repo owner/repo` — create agent labels
- `sweny setup linear --team-id ID` — create Linear labels
- `sweny triage --dry-run` — test run

**No flags for v1.** No `--minimal`, `--force`, or `--non-interactive`. The wizard is interactive-only. Flags can be added later if needed.

## 7. Testing Strategy

Pure functions are fully unit-tested. The interactive layer (clack prompts) is thin glue and not unit-tested.

| Function | Test Coverage |
|----------|--------------|
| `detectGitRemote(cwd)` | GitHub SSH URL, GitHub HTTPS URL, GitLab URL, no remote, no .git dir |
| `buildSwenyYml(selections)` | All providers set, some skipped, minimal config |
| `buildEnvTemplate(providers)` | Single provider, multiple providers, defaults pre-filled, always includes ANTHROPIC_API_KEY |
| `buildActionWorkflow(providers, cron)` | Daily cron, weekly cron, custom cron, correct secrets block |
| `shouldAppendEnv(existing, newSection)` | Existing .env with some keys, empty .env, key already defined |

## 8. Non-Goals

- **No credential validation during init.** That's what `sweny check` is for.
- **No network calls.** Init is 100% offline.
- **No custom workflow selection.** Init always scaffolds for `triage`. Users can edit the Action YAML to add `implement` or custom workflows later.
- **No secret storage.** Init writes `.env` templates with empty values. The user fills them in.
- **No `.gitignore` modification.** We warn if `.env` isn't gitignored but don't modify `.gitignore` — that's the user's responsibility.
