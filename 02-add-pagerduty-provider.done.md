# Task: Add PagerDuty observability provider

## Goal

Implement a PagerDuty provider that satisfies the `ObservabilityProvider` interface so
SWEny can investigate incidents from PagerDuty the same way it does from Datadog, Sentry, etc.

## Interface to implement

```ts
// packages/providers/src/observability/types.ts
export interface ObservabilityProvider {
  verifyAccess(): Promise<void>;
  queryLogs(opts: LogQueryOptions): Promise<LogEntry[]>;
  aggregate(opts: Omit<LogQueryOptions, "severity">): Promise<AggregateResult[]>;
  getAgentEnv(): Record<string, string>;
  getPromptInstructions(): string;
}
```

Read the full interface at:
`/Users/nate/src/swenyai/sweny/packages/providers/src/observability/types.ts`

Use the Datadog provider as a reference:
`/Users/nate/src/swenyai/sweny/packages/providers/src/observability/datadog.ts`

Pattern: zod config schema → factory function → class implementing the interface.

## PagerDuty API details

- Base URL: `https://api.pagerduty.com`
- Auth header: `Authorization: Token token=<API_KEY>`
- Accept header: `application/vnd.pagerduty+json;version=2`

Key endpoints:
- `GET /incidents` — list incidents (`?statuses[]=triggered&statuses[]=acknowledged&time_zone=UTC&since=<ISO>&until=<ISO>&limit=100`)
- `GET /incidents/{id}/alerts` — alerts within an incident
- `GET /users/me` — verify access (returns 200 if token is valid)

### Mapping to `LogEntry`

An incident maps to a LogEntry like this:
```ts
{
  timestamp: incident.created_at,
  service: incident.service?.summary ?? "unknown",
  level: incident.urgency === "high" ? "error" : "warning",
  message: incident.title,
  attributes: {
    id: incident.id,
    status: incident.status,
    html_url: incident.html_url,
    urgency: incident.urgency,
  }
}
```

### `queryLogs` behavior

- Convert `opts.timeRange` ("1h", "24h", "7d") to ISO timestamps: `since = now - timeRange`
- Filter by urgency/severity using `opts.severity`:
  - `"error"` / `"critical"` → `urgency=high`
  - anything else → no urgency filter (return all)
- `opts.serviceFilter` → use `?service_names[]=<value>` if not `"*"`
- Return up to 100 incidents mapped to `LogEntry[]`

### `aggregate` behavior

Group returned incidents by `service` name and count them. Return `AggregateResult[]`.

### `getAgentEnv`

```ts
{ PAGERDUTY_API_KEY: this.apiKey }
```

### `getPromptInstructions`

Return a markdown string with:
- What env var to use
- Two curl examples: one for listing recent incidents, one for getting incidents by service

## Config schema

```ts
export const pagerdutyCon figSchema = z.object({
  apiKey: z.string().min(1, "PagerDuty API key is required"),
  logger: z.custom<Logger>().optional(),
});
export type PagerDutyConfig = z.infer<typeof pagerdutyConfigSchema>;
export function pagerduty(config: PagerDutyConfig): ObservabilityProvider { ... }
```

## Files to create/edit

1. **Create**: `packages/providers/src/observability/pagerduty.ts`
2. **Edit**: `packages/providers/src/observability/index.ts` — add export line:
   ```ts
   export { pagerduty, pagerdutyConfigSchema, type PagerDutyConfig } from "./pagerduty.js";
   ```
3. **Create**: `packages/providers/tests/observability/pagerduty.test.ts` — unit tests
   using `vi.spyOn(globalThis, "fetch").mockImplementation(...)` (NOT `mockResolvedValue`).

## Tests to write

- `verifyAccess` resolves when fetch returns 200
- `verifyAccess` throws `ProviderApiError` when fetch returns 401
- `queryLogs` maps incidents to `LogEntry[]` correctly
- `queryLogs` filters by urgency when severity is "error"
- `aggregate` groups incidents by service and returns counts
- `getAgentEnv` returns object with `PAGERDUTY_API_KEY`
- `getPromptInstructions` returns a non-empty string containing "PagerDuty"

## Running tests

```bash
cd /Users/nate/src/swenyai/sweny
npm test --workspace=packages/providers -- --reporter=verbose 2>&1 | tail -40
```

## Commit

After all tests pass:
```
feat(providers): add PagerDuty observability provider
```
