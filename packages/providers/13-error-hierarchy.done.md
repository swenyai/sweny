# Custom Error Hierarchy

Create a proper error class hierarchy so consumers can catch and handle specific error types.

## Working directory
`/Users/nate/src/swenyai/sweny/packages/providers`

## Task

### 1. Create `src/errors.ts`

Create a new file with the following error classes:

```ts
export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export class ProviderAuthError extends ProviderError {
  constructor(provider: string, message?: string, cause?: unknown) {
    super(message ?? `Authentication failed for ${provider}`, provider, cause);
    this.name = "ProviderAuthError";
  }
}

export class ProviderApiError extends ProviderError {
  constructor(
    provider: string,
    public readonly statusCode: number,
    public readonly statusText: string,
    public readonly responseBody?: string,
  ) {
    super(`${provider} API error: ${statusCode} ${statusText}`, provider);
    this.name = "ProviderApiError";
  }
}

export class ProviderConfigError extends ProviderError {
  constructor(provider: string, message: string) {
    super(`Invalid ${provider} configuration: ${message}`, provider);
    this.name = "ProviderConfigError";
  }
}
```

### 2. Export from `src/index.ts`

Add to the root barrel:
```ts
// Errors
export { ProviderError, ProviderAuthError, ProviderApiError, ProviderConfigError } from "./errors.js";
```

### 3. Update existing `AccessDeniedError`

Read `src/access/types.ts` first - the existing `AccessDeniedError` should extend `ProviderError`. If it already works fine as-is, leave it alone but make sure both are exported.

### 4. Write tests

Create `tests/errors.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { ProviderError, ProviderAuthError, ProviderApiError, ProviderConfigError } from "../src/errors.js";

describe("ProviderError", () => {
  it("has provider name and message", () => {
    const err = new ProviderError("something failed", "datadog");
    expect(err.message).toBe("something failed");
    expect(err.provider).toBe("datadog");
    expect(err.name).toBe("ProviderError");
    expect(err).toBeInstanceOf(Error);
  });
});

describe("ProviderAuthError", () => {
  it("extends ProviderError", () => {
    const err = new ProviderAuthError("sentry");
    expect(err).toBeInstanceOf(ProviderError);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("ProviderAuthError");
    expect(err.message).toContain("sentry");
  });

  it("accepts custom message", () => {
    const err = new ProviderAuthError("jira", "Token expired");
    expect(err.message).toBe("Token expired");
  });
});

describe("ProviderApiError", () => {
  it("includes status code and text", () => {
    const err = new ProviderApiError("datadog", 403, "Forbidden", "rate limited");
    expect(err.statusCode).toBe(403);
    expect(err.statusText).toBe("Forbidden");
    expect(err.responseBody).toBe("rate limited");
    expect(err).toBeInstanceOf(ProviderError);
  });
});

describe("ProviderConfigError", () => {
  it("formats config error message", () => {
    const err = new ProviderConfigError("splunk", "baseUrl is required");
    expect(err.message).toContain("splunk");
    expect(err.message).toContain("baseUrl is required");
  });
});
```

## Completion

1. Run `npx tsc --noEmit`
2. Run `npx vitest run`
3. Rename: `mv packages/providers/13-error-hierarchy.todo.md packages/providers/13-error-hierarchy.done.md`
4. Commit:
```
feat: add custom error hierarchy for provider error handling

Adds ProviderError, ProviderAuthError, ProviderApiError, and
ProviderConfigError so consumers can catch specific failure modes.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
```
