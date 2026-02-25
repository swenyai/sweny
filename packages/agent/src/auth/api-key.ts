import type { AuthProvider, LoginField, UserIdentity } from "./types.js";

export interface ApiKeyAuthOpts {
  validate: (apiKey: string) => Promise<UserIdentity | null>;
}

class ApiKeyAuthProvider implements AuthProvider {
  readonly displayName = "API Key";

  readonly loginFields: LoginField[] = [
    {
      key: "apiKey",
      label: "API Key",
      type: "password",
      placeholder: "Enter your API key",
    },
  ];

  private readonly sessions = new Map<string, UserIdentity>();
  private readonly validate: ApiKeyAuthOpts["validate"];

  constructor(opts: ApiKeyAuthOpts) {
    this.validate = opts.validate;
  }

  async authenticate(userId: string): Promise<UserIdentity | null> {
    return this.sessions.get(userId) ?? null;
  }

  async login(
    _userId: string,
    credentials: Record<string, string>,
  ): Promise<UserIdentity> {
    const apiKey = credentials["apiKey"];
    if (!apiKey) {
      throw new Error("API key is required");
    }

    const identity = await this.validate(apiKey);
    if (!identity) {
      throw new Error("Invalid API key");
    }

    this.sessions.set(identity.userId, identity);
    return identity;
  }

  hasValidSession(userId: string): boolean {
    return this.sessions.has(userId);
  }

  clearSession(userId: string): void {
    this.sessions.delete(userId);
  }
}

export function apiKeyAuth(opts: ApiKeyAuthOpts): AuthProvider {
  return new ApiKeyAuthProvider(opts);
}
