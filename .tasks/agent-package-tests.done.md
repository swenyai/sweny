# Task: Test coverage for `@sweny-ai/agent` package

## Why

`packages/agent` is the most complex package in the monorepo. It implements a
full agent orchestrator with:
- Multi-model support (Claude, Codex, Gemini adapters)
- Slack channel integration (bot, slash commands, OAuth login)
- Session management with persistence
- Plugin system (memory, workspace)
- Rate limiting
- Access control (allow-all and role-based)

It currently has **zero test coverage**. This makes it risky to modify and
impossible to verify behavior in CI.

---

## Package structure

```
packages/agent/src/
  orchestrator.ts       ← Main agent loop — highest value target
  rate-limit.ts         ← Rate limiter — pure function, easy to test
  session/manager.ts    ← Session lifecycle
  model/
    adapter.ts          ← Model provider abstraction
    claude-code.ts      ← Claude adapter
  channel/
    cli.ts              ← CLI channel
    slack.ts            ← Slack channel
    slack-formatter.ts  ← Message formatting
    slack-commands.ts   ← Slash command parsing
  plugins/
    registry.ts         ← Plugin registry
    memory/index.ts     ← Memory plugin
    workspace/index.ts  ← Workspace plugin
  access/
    allow-all.ts        ← Access policy
    role-based.ts       ← Role-based access
  auth/
    api-key.ts          ← API key auth
    no-auth.ts          ← No-auth policy
```

---

## Vitest config

`packages/agent/vitest.config.ts` already exists. Tests go in `packages/agent/tests/`
(create the directory).

---

## Priority 1 — Rate limiter (`rate-limit.ts`)

This is the easiest target — it's a pure function with no side effects.

Read `packages/agent/src/rate-limit.ts` to understand the interface, then write:

```typescript
// packages/agent/tests/rate-limit.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRateLimiter } from "../src/rate-limit.js"; // adjust import

describe("rate limiter", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("allows requests within the limit", () => { ... });
  it("blocks requests that exceed the limit", () => { ... });
  it("resets after the time window", () => {
    // vi.advanceTimersByTime(windowMs + 1)
    // verify request is allowed again
  });
  it("tracks limits per user/key independently", () => { ... });
});
```

---

## Priority 2 — Slack formatter (`channel/slack-formatter.ts`)

Read the file. It transforms agent messages into Slack Block Kit format. Pure
function, no I/O — very easy to test:

```typescript
// packages/agent/tests/slack-formatter.test.ts
describe("slack formatter", () => {
  it("formats a text message as a section block", () => { ... });
  it("formats code blocks correctly", () => { ... });
  it("truncates long messages to Slack's 3000 char limit", () => { ... });
  it("formats tool use / tool result messages", () => { ... });
});
```

---

## Priority 3 — Slash command parsing (`channel/slack-commands.ts`)

Read the file. It parses Slack slash command text into structured commands:

```typescript
// packages/agent/tests/slack-commands.test.ts
describe("slack command parser", () => {
  it("parses 'help' command", () => { ... });
  it("parses 'start <session-id>' command", () => { ... });
  it("parses 'stop' command", () => { ... });
  it("returns error for unknown command", () => { ... });
  it("handles empty input", () => { ... });
});
```

---

## Priority 4 — Access policies

Read `access/allow-all.ts` and `access/role-based.ts`:

```typescript
// packages/agent/tests/access.test.ts
import { allowAll } from "../src/access/allow-all.js";
import { roleBased } from "../src/access/role-based.js";

describe("allowAll policy", () => {
  it("permits any action for any user", async () => {
    const policy = allowAll();
    const result = await policy.check({ userId: "u1", action: "run", resource: "any" });
    expect(result.allowed).toBe(true);
  });
});

describe("roleBased policy", () => {
  it("allows action for user with correct role", async () => { ... });
  it("denies action for user without role", async () => { ... });
  it("allows admins to do everything", async () => { ... });
});
```

---

## Priority 5 — Orchestrator (`orchestrator.ts`)

This is the most valuable but also most complex. Read it carefully before writing tests.
The orchestrator calls a model, handles tool use, manages turns, and emits events.

Mock the model and channel:

```typescript
// packages/agent/tests/orchestrator.test.ts
const mockModel = {
  run: vi.fn(),
  countTokens: vi.fn().mockResolvedValue(100),
};
const mockChannel = {
  send: vi.fn(),
  sendError: vi.fn(),
};

describe("orchestrator", () => {
  it("runs a single turn and sends response", async () => {
    mockModel.run.mockResolvedValueOnce({ type: "text", content: "Done" });
    await orchestrate({ model: mockModel, channel: mockChannel, prompt: "Hello" });
    expect(mockChannel.send).toHaveBeenCalledWith(expect.objectContaining({ content: "Done" }));
  });

  it("stops after maxTurns", async () => {
    mockModel.run.mockResolvedValue({ type: "continue", content: "thinking..." });
    // should stop at maxTurns even if model keeps returning "continue"
  });

  it("handles model errors gracefully", async () => {
    mockModel.run.mockRejectedValueOnce(new Error("API timeout"));
    // should call channel.sendError or re-throw with context
  });
});
```

---

## Target coverage

Aim for coverage of the pure/functional parts:
- rate-limit.ts: 90%+
- slack-formatter.ts: 80%+
- slack-commands.ts: 90%+
- access/allow-all.ts: 100%
- access/role-based.ts: 80%+
- orchestrator.ts: 60%+ (core paths)

Skip: Slack API calls, OAuth flows, S3 storage, model HTTP calls — mock these.

---

## Acceptance

- `npm test --workspace=packages/agent` passes with ≥ 30 new tests
- Rate limiter, formatter, command parser, access policies all have tests
- Orchestrator has at least basic path coverage (success, error, maxTurns)
- No existing tests broken
