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
