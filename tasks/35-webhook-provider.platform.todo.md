# Add Generic Webhook Notification Provider

## Context
A generic outbound webhook is the "escape hatch" that makes the platform truly extensible. Users can wire SWEny to any system — internal dashboards, Zapier, n8n, custom alerting, PagerDuty alternatives, etc. — without us building a dedicated provider for each.

This task adds a generic webhook provider to `@sweny/providers` that POSTs notification payloads to any URL.

## Files to Create

### `packages/providers/src/notification/webhook.ts`

Generic outbound webhook implementation of `NotificationProvider`:

```typescript
import { z } from "zod";
import type { Logger } from "../logger.js";
import type { NotificationPayload, NotificationProvider } from "./types.js";

const WebhookConfigSchema = z.object({
  url: z.string().url(),
  /** Extra headers merged into the request (e.g., Authorization). */
  headers: z.record(z.string()).optional(),
  /** HTTP method — defaults to POST. */
  method: z.enum(["POST", "PUT"]).default("POST"),
  /** Optional HMAC secret for signing the payload (X-Signature-256 header). */
  signingSecret: z.string().optional(),
  logger: z.custom<Logger>().optional(),
});

export type WebhookConfig = z.input<typeof WebhookConfigSchema>;

export function webhook(raw: WebhookConfig): NotificationProvider;
```

Implementation:
- POST (or PUT) JSON body: `{ title, body, format, timestamp }` where `timestamp` is ISO 8601 now
- Set `Content-Type: application/json`
- Merge user-provided `headers`
- If `signingSecret` is set, compute HMAC-SHA256 of the body and add `X-Signature-256` header (same pattern as GitHub webhooks)
- Throw `ProviderApiError` on non-2xx response
- Use native `fetch` — no dependencies

### `packages/providers/src/notification/index.ts`
Add export:
```typescript
export { webhook } from "./webhook.js";
export type { WebhookConfig } from "./webhook.js";
```

### `packages/providers/src/index.ts`
Add to notification exports:
```typescript
export { githubSummary, slackWebhook, teamsWebhook, discordWebhook, email, webhook } from "./notification/index.js";
```
Add type export for `WebhookConfig`.

### `packages/providers/tests/notification/webhook.test.ts`
Tests (mock fetch):
- Sends POST with correct JSON body and content-type
- Merges custom headers
- Computes HMAC-SHA256 signature when signingSecret is set
- Supports PUT method
- Throws ProviderApiError on non-2xx
- Validates config (invalid URL, etc.)

## Verification
- `npm run build --workspace=packages/providers` passes
- `npm run test --workspace=packages/providers` passes
- `npm run typecheck --workspace=packages/providers` passes
- No new runtime dependencies
