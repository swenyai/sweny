# Add Email Notification Provider

## Context
The "Report" pillar currently has 4 notification providers (GitHub Summary, Slack/Teams/Discord webhooks) but no email. Email is table-stakes for a platform — it covers async digests, alerts for teams not on Slack, and enterprise compliance.

This task adds a SendGrid-based email provider to `@sweny/providers`. It follows the existing `NotificationProvider` interface.

## Files to Create

### `packages/providers/src/notification/email.ts`

SendGrid implementation of `NotificationProvider`:

```typescript
import { z } from "zod";
import type { Logger } from "../logger.js";
import type { NotificationPayload, NotificationProvider } from "./types.js";

const EmailConfigSchema = z.object({
  apiKey: z.string().min(1),
  from: z.string().email(),
  to: z.union([z.string().email(), z.array(z.string().email())]),
  logger: z.custom<Logger>().optional(),
});

export type EmailConfig = z.input<typeof EmailConfigSchema>;

export function email(raw: EmailConfig): NotificationProvider;
```

Implementation:
- Use `fetch` directly against `https://api.sendgrid.com/v3/mail/send` — no SDK dependency needed
- Set `Authorization: Bearer ${apiKey}`
- Map `NotificationPayload.format`:
  - `"markdown"` → send as plain text (or convert to HTML if simple)
  - `"html"` → send as HTML content
  - `"text"` → send as plain text
- Use `payload.title` as email subject (fallback: "SWEny Notification")
- Support single recipient or array of recipients in `to`

### `packages/providers/src/notification/index.ts`
Add export:
```typescript
export { email } from "./email.js";
export type { EmailConfig } from "./email.js";
```

### `packages/providers/src/index.ts`
Add to notification exports:
```typescript
export { githubSummary, slackWebhook, teamsWebhook, discordWebhook, email } from "./notification/index.js";
```
Add type export for `EmailConfig`.

### `packages/providers/tests/notification/email.test.ts`
Tests (mock fetch):
- Sends email with correct headers and body
- Handles single and array `to` recipients
- Maps markdown/html/text format correctly
- Uses payload title as subject
- Throws `ProviderApiError` on non-2xx response
- Validates config with Zod (missing apiKey, invalid email)

## Verification
- `npm run build --workspace=packages/providers` passes
- `npm run test --workspace=packages/providers` passes
- `npm run typecheck --workspace=packages/providers` passes
- No new runtime dependencies (uses native `fetch`)
