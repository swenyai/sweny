import type { AuthProvider, LoginField, UserIdentity } from "./types.js";

export interface ApiKeyAuthOpts {
  validate: (apiKey: string) => Promise<UserIdentity | null>;
}

export function apiKeyAuth(opts: ApiKeyAuthOpts): AuthProvider {
  const sessions = new Map<string, UserIdentity>();

  return {
    displayName: "API Key",

    loginFields: [
      {
        key: "apiKey",
        label: "API Key",
        type: "password" as LoginField["type"],
        placeholder: "Enter your API key",
      },
    ],

    async authenticate(userId: string): Promise<UserIdentity | null> {
      return sessions.get(userId) ?? null;
    },

    async login(_userId: string, credentials: Record<string, string>): Promise<UserIdentity> {
      const apiKey = credentials["apiKey"];
      if (!apiKey) {
        throw new Error("API key is required");
      }

      const identity = await opts.validate(apiKey);
      if (!identity) {
        throw new Error("Invalid API key");
      }

      sessions.set(identity.userId, identity);
      return identity;
    },

    async hasValidSession(userId: string): Promise<boolean> {
      return sessions.has(userId);
    },

    async clearSession(userId: string): Promise<void> {
      sessions.delete(userId);
    },
  };
}
