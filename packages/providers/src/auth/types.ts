export interface UserIdentity {
  userId: string;
  displayName: string;
  email?: string;
  roles: string[];
  metadata: Record<string, unknown>;
}

export interface LoginField {
  key: string;
  label: string;
  type: "text" | "email" | "password";
  placeholder?: string;
}

export interface AuthProvider {
  readonly displayName: string;
  readonly loginFields?: LoginField[];

  authenticate(userId: string): Promise<UserIdentity | null>;
  login?(userId: string, credentials: Record<string, string>): Promise<UserIdentity>;
  hasValidSession(userId: string): boolean;
  clearSession(userId: string): void;
}
