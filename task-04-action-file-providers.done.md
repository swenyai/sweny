# Task 04 — Add file providers to Action (parity with CLI)

## Context

The CLI supports `"file"` as a fallback option for issue tracking, source control, and
notification — these write operations to disk instead of calling real APIs, useful for
dry-run and local testing.

The Action does NOT import or expose these file providers:
- No `fileIssueTracking` in action issue tracker switch (falls through to error)
- No `fileSourceControl` in action source control switch (falls through to error)
- No `fileNotification` in action notification switch (falls through to github-summary default)

This inconsistency means `dry-run` mode in the Action doesn't have a clean file-based path,
and it's harder to write integration tests for the action.

## Changes required

### `packages/action/src/providers/index.ts`

Add imports:
```ts
import { linear, jira, githubIssues, fileIssueTracking } from "@sweny-ai/providers/issue-tracking";
import { github, gitlab, fileSourceControl } from "@sweny-ai/providers/source-control";
import { githubSummary, slackWebhook, teamsWebhook, discordWebhook, email, webhook, fileNotification } from "@sweny-ai/providers/notification";
```

Add `"file"` case to issue tracker switch:
```ts
case "file":
  registry.set("issueTracker", fileIssueTracking({ outputDir: config.outputDir ?? ".github/sweny-output", logger: actionsLogger }));
  break;
```

Add `"file"` case to source control switch:
```ts
case "file":
  registry.set("sourceControl", fileSourceControl({ outputDir: config.outputDir ?? ".github/sweny-output", baseBranch: config.baseBranch, logger: actionsLogger }));
  break;
```

Add `"file"` case to notification switch (before the default):
```ts
case "file":
  registry.set("notification", fileNotification({ outputDir: config.outputDir ?? ".github/sweny-output", logger: actionsLogger }));
  break;
```

### `packages/action/src/config.ts`

Check whether `ActionConfig` has an `outputDir` field. If not, add:
```ts
outputDir: string;
```
And parse it:
```ts
outputDir: core.getInput("output-dir") || ".github/sweny-output",
```

### `packages/action/action.yml`

If `output-dir` input doesn't already exist, add:
```yaml
output-dir:
  description: 'Directory for file-based provider output (dry-run / file providers)'
  required: false
  default: '.github/sweny-output'
```

## After changes

```
cd packages/action && npm run typecheck && npx vitest run
```

## Definition of done

- `issue-tracker-provider: file`, `source-control-provider: file`, `notification-provider: file`
  all work in the Action
- `npm run typecheck` passes
- No new test failures
