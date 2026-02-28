# Task 23 — Tests for github-summary Notification Provider

## Objective

Add tests for the `githubSummary` notification provider. The other 3 notification providers (Slack webhook, Teams webhook, Discord webhook) all have tests in `packages/providers/tests/notification.test.ts`. GitHub Summary does not.

## File Under Test

`packages/providers/src/notification/github-summary.ts` (35 lines)

```ts
export function githubSummary(config?: GitHubSummaryConfig): NotificationProvider {
  return new GitHubSummaryProvider(config?.logger ?? consoleLogger);
}

class GitHubSummaryProvider implements NotificationProvider {
  async send(payload: NotificationPayload): Promise<void> {
    const core = await import("@actions/core");
    const summary = core.summary;
    if (payload.title) summary.addHeading(payload.title, 2);
    summary.addRaw(payload.body);
    await summary.write();
    this.log.info("GitHub Action summary written");
  }
}
```

### Config Schema

```ts
const githubSummaryConfigSchema = z.object({
  logger: z.custom<Logger>().optional(),
});
```

### NotificationPayload

```ts
interface NotificationPayload {
  title?: string;
  body: string;
  format?: "markdown" | "plain";
}
```

## Test File

Add tests to the existing `packages/providers/tests/notification.test.ts` OR create `packages/providers/tests/github-summary.test.ts`.

## Test Cases

### Config validation
1. Validates config with logger
2. Validates config without logger (undefined)

### Factory
3. Returns a `NotificationProvider` with `send` method
4. Uses default `consoleLogger` when no logger provided

### send()
5. Calls `summary.addHeading()` with title when title is provided
6. Does NOT call `summary.addHeading()` when title is omitted
7. Calls `summary.addRaw()` with body
8. Calls `summary.write()`

## Mock Strategy

Mock `@actions/core`:
```ts
vi.mock("@actions/core", () => ({
  summary: {
    addHeading: vi.fn().mockReturnThis(),
    addRaw: vi.fn().mockReturnThis(),
    write: vi.fn().mockResolvedValue(undefined),
  },
}));
```

Use `silentLogger` pattern from existing notification tests:
```ts
const silentLogger = { info: () => {}, debug: () => {}, warn: () => {} };
```

## Verification

1. `npm test --workspace=packages/providers` — new tests pass
2. `npm test` — all tests pass
