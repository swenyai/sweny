/** Represents an authenticated user's identity. */
export interface UserIdentity {
  /** Unique user identifier. */
  userId: string;
  /** Tenant identifier for multi-tenant deployments. */
  tenantId?: string;
  /** Human-readable display name. */
  displayName: string;
  /** User's email address. */
  email?: string;
  /** Roles assigned to the user (e.g., "admin", "viewer"). */
  roles: string[];
  /** Additional provider-specific metadata. */
  metadata: Record<string, unknown>;
}

/** Describes a single field in a login form. */
export interface LoginField {
  /** Field key used in the credentials record. */
  key: string;
  /** Human-readable label shown in the UI. */
  label: string;
  /** HTML input type for the field. */
  type: "text" | "email" | "password";
  /** Placeholder text for the input field. */
  placeholder?: string;
}

/** Provider interface for authentication and session management. */
export interface AuthProvider {
  /** Human-readable name of the auth provider (e.g., "Google", "GitHub"). */
  readonly displayName: string;
  /** Login form field definitions; omit if the provider uses external OAuth. */
  readonly loginFields?: LoginField[];

  /**
   * Authenticate a user by their ID (e.g., from a session token).
   * @param userId - User identifier to authenticate.
   * @returns The user's identity, or null if authentication fails.
   */
  authenticate(userId: string): Promise<UserIdentity | null>;

  /**
   * Log in a user with explicit credentials.
   * @param userId - User identifier.
   * @param credentials - Key-value credential pairs matching loginFields.
   * @returns The authenticated user's identity.
   */
  login?(userId: string, credentials: Record<string, string>): Promise<UserIdentity>;

  /**
   * Check whether a user has a valid active session.
   * @param userId - User identifier.
   * @returns True if the session is valid.
   */
  hasValidSession(userId: string): Promise<boolean>;

  /**
   * Clear / invalidate a user's session.
   * @param userId - User identifier.
   */
  clearSession(userId: string): Promise<void>;
}
