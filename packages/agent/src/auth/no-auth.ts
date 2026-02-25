import type { AuthProvider, UserIdentity } from "./types.js";

const LOCAL_USER: UserIdentity = {
  userId: "local",
  displayName: "Local User",
  roles: ["admin"],
  metadata: {},
};

class NoAuthProvider implements AuthProvider {
  readonly displayName = "No Auth";

  async authenticate(_userId: string): Promise<UserIdentity> {
    return LOCAL_USER;
  }

  hasValidSession(_userId: string): boolean {
    return true;
  }

  clearSession(_userId: string): void {
    // nothing to clear
  }
}

export function noAuth(): AuthProvider {
  return new NoAuthProvider();
}
