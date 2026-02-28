# Tests: Teams Messaging + OpsGenie Incident Providers

Add unit tests for both providers. Follow existing patterns in `tests/messaging.test.ts` and `tests/incident.test.ts`.

## Working directory
`/Users/nate/src/swenyai/sweny/packages/providers`

## Pattern: Messaging tests (from tests/messaging.test.ts)

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { slack } from "../src/messaging/slack.js";
import type { MessagingProvider } from "../src/messaging/types.js";

// Mock @slack/web-api
const mockPostMessage = vi.fn();
const mockUpdate = vi.fn();
vi.mock("@slack/web-api", () => ({
  WebClient: class { chat = { postMessage: mockPostMessage, update: mockUpdate }; },
}));

describe("slack messaging provider", () => {
  let provider: MessagingProvider;
  beforeEach(() => { vi.clearAllMocks(); provider = slack({ token: "xoxb-test", logger }); });

  it("sends a basic message", async () => {
    mockPostMessage.mockResolvedValueOnce({ ts: "123.456" });
    const result = await provider.sendMessage({ channelId: "C12345", text: "Hello" });
    expect(result.messageId).toBe("123.456");
  });
});
```

## Pattern: Incident tests (from tests/incident.test.ts)

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { pagerduty, pagerdutyConfigSchema } from "../src/incident/pagerduty.js";

const silentLogger = { info: () => {}, debug: () => {}, warn: () => {} };
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

describe("PagerDutyProvider", () => {
  it("verifyAccess calls /abilities", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    globalThis.fetch = mockFetch;
    const provider = pagerduty({ apiToken: "tok", routingKey: "rk", logger: silentLogger });
    await provider.verifyAccess();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.pagerduty.com/abilities");
    expect(opts.headers.Authorization).toBe("Token token=tok");
  });
});
```

## Task

Create `tests/teams-opsgenie.test.ts`.

### Part 1: Teams Messaging Provider

Import: `import { teams } from "../src/messaging/teams.js";`

The Teams provider:
- Uses OAuth2 client credentials to get access token (POST to Azure AD)
- Uses Microsoft Graph API for messages
- channelId format: "teamId/channelId"
- Mock TWO fetch calls: first for token acquisition, then for the API call

Tests:
- Factory returns MessagingProvider with sendMessage/updateMessage
- `sendMessage()` acquires OAuth token then sends via Graph API
  - Mock token response: `{ access_token: "test-token", expires_in: 3600 }`
  - Mock message response: `{ id: "msg-123" }`
  - Verify Authorization: Bearer header on Graph call
  - Verify correct URL format
- `sendMessage()` with threadId sends reply to `/messages/{threadId}/replies`
- `updateMessage()` PATCHes the message
- Invalid channelId format (no "/") throws error
- Token caching: second call reuses cached token (only 1 token fetch)

### Part 2: OpsGenie Incident Provider

Import: `import { opsgenie, opsgenieConfigSchema } from "../src/incident/opsgenie.js";`

The OpsGenie provider:
- Auth: `GenieKey {apiKey}` header
- US: `https://api.opsgenie.com`, EU: `https://api.eu.opsgenie.com`

Tests:
- `opsgenieConfigSchema` validates config, applies defaults (region="us")
- `opsgenieConfigSchema` accepts region "eu"
- Rejects missing apiKey
- Factory returns IncidentProvider with all methods
- `verifyAccess()`: GETs `/v2/account` with GenieKey auth
- `createIncident()`: POSTs to `/v2/alerts`, maps priority (high→P1, low→P3)
- `acknowledgeIncident()`: POSTs to `/v2/alerts/{id}/acknowledge`
- `resolveIncident()`: POSTs to `/v2/alerts/{id}/close`
- EU region uses correct base URL
- Throws on non-ok response

## Completion

1. Run `npx vitest run tests/teams-opsgenie.test.ts`
2. Run `npx vitest run`
3. Rename: `mv packages/providers/17-test-teams-opsgenie.todo.md packages/providers/17-test-teams-opsgenie.done.md`
4. Commit:
```
test: add unit tests for Teams messaging and OpsGenie incident providers

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
```
