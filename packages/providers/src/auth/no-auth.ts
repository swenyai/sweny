import type { AuthProvider, UserIdentity } from "./types.js";

const LOCAL_USER: UserIdentity = {
  userId: "local",
  displayName: "Local User",
  roles: ["admin"],
  metadata: {},
};

export function noAuth(): AuthProvider {
  return {
    displayName: "No Auth",

    async authenticate(_userId: string): Promise<UserIdentity> {
      return LOCAL_USER;
    },

    async hasValidSession(_userId: string): Promise<boolean> {
      return true;
    },

    async clearSession(_userId: string): Promise<void> {
      // nothing to clear
    },
  };
}
