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
