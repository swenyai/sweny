---
title: Notification
description: Send triage results to Slack, Teams, Discord, email, webhooks, or GitHub Actions.
---

## Quick reference

| If you want... | Use |
|----------------|-----|
| Results inline in a GitHub Actions run | `github-summary` (Action default) |
| Results printed to the terminal | `console` (CLI default) |
| A message in a Slack channel | `slack` |
| A message in Microsoft Teams | `teams` |
| A message in Discord | `discord` |
| An email to your team | `email` |
| Structured JSON to a custom endpoint | `webhook` |
| Results written to disk | `file` |

```typescript
import { githubSummary, slackWebhook, teamsWebhook, discordWebhook, email, webhook } from "@sweny-ai/providers/notification";
```

## Interface

```typescript
interface NotificationProvider {
  send(payload: NotificationPayload): Promise<void>;
}

interface NotificationPayload {
  /** Short heading shown in bold / as the message title. */
  title?: string;
  /** Flat markdown/text fallback used by providers that don't render structured fields. */
  body: string;
  format?: "markdown" | "html" | "text";

  // --- Structured fields (channel-native rendering) ---

  /** Drives status color and emoji across all channels. */
  status?: "success" | "error" | "warning" | "info" | "skipped";
  /** One-line outcome summary shown prominently below the title. */
  summary?: string;
  /** Key-value metadata rendered as a grid (Slack), FactSet (Teams), table (email/GitHub). */
  fields?: Array<{ label: string; value: string; short?: boolean }>;
  /** Named content blocks (investigation log, issues report, etc.). */
  sections?: Array<{ title?: string; content: string }>;
  /** Action links rendered as buttons (Slack/Teams) or anchor tags (email). */
  links?: Array<{ label: string; url: string }>;
}
```

## Channel rendering matrix

| Field      | Slack              | Teams               | Discord             | Email               | GitHub Summary      | Webhook        |
|------------|--------------------|---------------------|---------------------|---------------------|---------------------|----------------|
| `title`    | Header block       | Bold TextBlock      | Embed title         | `<h2>` + subject   | `addHeading(2)`     | JSON field     |
| `status`   | Emoji in section   | Colored TextBlock   | Embed color + emoji | Colored banner      | Emoji via addRaw    | JSON field     |
| `summary`  | Section block      | TextBlock           | Embed description   | Colored banner text | addRaw              | JSON field     |
| `fields`   | Fields grid        | FactSet             | Inline embed fields | `<table>`           | `addTable`          | JSON field     |
| `links`    | Action buttons     | Action.OpenUrl      | content field       | `<a>` buttons       | Markdown links      | JSON field     |
| `sections` | Divider + section  | Container           | content field       | `<h3>` + `<pre>`   | `addHeading(3)` + addRaw | JSON field |
| `body`     | Fallback only      | Fallback only       | Fallback only       | Fallback only       | Fallback only       | JSON field     |

## Sending a notification

```typescript
await notifier.send({
  title: "SWEny Triage Complete",
  body: "Found 2 novel issues. Created ENG-456. Opened PR #89.", // flat fallback
  status: "success",
  summary: "Success: New PR created — https://github.com/org/repo/pull/89",
  fields: [
    { label: "Service Filter", value: "`api-*`", short: true },
    { label: "Time Range",     value: "`24h`",   short: true },
    { label: "Dry Run",        value: "false",   short: true },
  ],
  links: [
    { label: "ENG-456", url: "https://linear.app/org/issue/ENG-456" },
    { label: "PR #89",  url: "https://github.com/org/repo/pull/89" },
  ],
  sections: [
    { title: "Investigation Log", content: "..." },
  ],
});
```

## GitHub Summary

Writes to the GitHub Actions Job Summary using `@actions/core`:

```typescript
const notifier = githubSummary({ logger: myLogger });
```

Requires `@actions/core` as a peer dependency. Only works inside GitHub Actions.

Rendering: `addHeading` for title/section titles, `addTable` for fields, `addRaw` for
status/summary and links, `addHeading(3)` + `addRaw` for sections.

## Slack Webhook

```typescript
const notifier = slackWebhook({
  webhookUrl: process.env.SLACK_WEBHOOK_URL!,
  logger: myLogger,
});
```

Sends a [Block Kit](https://api.slack.com/block-kit) payload:
- **Header block** for `title`
- **Section block** with status emoji + `summary`
- **Section block with fields** (up to 10 per block) for `fields`
- **Actions block** with URL buttons for `links`
- **Divider + section block** per entry in `sections`
- `text` field kept as screen-reader / notification-preview fallback

## Teams Webhook

```typescript
const notifier = teamsWebhook({
  webhookUrl: process.env.TEAMS_WEBHOOK_URL!,
  logger: myLogger,
});
```

Sends a Workflow-compatible Adaptive Card (`application/vnd.microsoft.card.adaptive`):
- Bold `TextBlock` for `title`
- Colored `TextBlock` for `status` + `summary`
- `FactSet` for `fields`
- `Container` with separator per entry in `sections`
- `Action.OpenUrl` list for `links`

## Discord Webhook

```typescript
const notifier = discordWebhook({
  webhookUrl: process.env.DISCORD_WEBHOOK_URL!,
  logger: myLogger,
});
```

Sends a Discord embed object:
- `title` → embed title (max 256 chars)
- `status` → embed color (green/red/yellow/blurple/gray) and emoji prefix
- `summary` → embed description; falls back to `body` when no summary or fields
- `fields` → inline embed fields (`short: true` → `inline: true`)
- `sections` + `links` → combined into the `content` field (max 2000 chars)

## Email

```typescript
const notifier = email({
  apiKey: process.env.SENDGRID_API_KEY!,
  from: "sweny@mycompany.com",
  to: ["oncall@mycompany.com", "team-lead@mycompany.com"],
  logger: myLogger,
});
```

Uses the SendGrid v3 API. When any structured field is present the body is automatically
built as `text/html`:
- Status-colored banner for `status` + `summary`
- `<table>` for `fields`
- `<a>` buttons for `links`
- `<h3>` + `<pre>` per entry in `sections`

All user-controlled strings are HTML-escaped. Link `href` values are validated to `https?://`
(non-HTTP schemes fall back to `#`). When no structured fields are present the `body` is
sent as-is, with content type matching `format`.

## Generic Webhook

```typescript
const notifier = webhook({
  url: "https://hooks.mycompany.com/sweny",
  headers: { Authorization: "Bearer my-token" },
  method: "POST",           // optional — "POST" | "PUT", defaults to "POST"
  signingSecret: process.env.WEBHOOK_SECRET,  // optional — HMAC-SHA256
  logger: myLogger,
});
```

Sends the full structured payload as JSON:

```json
{
  "title": "SWEny Triage Complete",
  "body": "...",
  "format": "markdown",
  "status": "success",
  "summary": "Success: New PR created",
  "fields": [{ "label": "Service Filter", "value": "`api-*`", "short": true }],
  "sections": [{ "title": "Investigation Log", "content": "..." }],
  "links": [{ "label": "PR #89", "url": "https://github.com/..." }],
  "timestamp": "2024-03-02T03:00:00.000Z"
}
```

When `signingSecret` is provided, an `X-Signature-256: sha256=<hmac>` header is added so
receivers can verify authenticity.

---

The notification provider is fire-and-forget — there is no message ID or threading. For
two-way conversations, see the [Messaging provider](/providers/messaging/).
