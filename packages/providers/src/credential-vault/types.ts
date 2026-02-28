/** Provider interface for securely storing and retrieving tenant secrets. */
export interface CredentialVaultProvider {
  /**
   * Retrieve a secret value.
   * @param tenantId - Tenant identifier.
   * @param key - Secret key name.
   * @returns The secret value, or null if not found.
   */
  getSecret(tenantId: string, key: string): Promise<string | null>;

  /**
   * Store or update a secret value.
   * @param tenantId - Tenant identifier.
   * @param key - Secret key name.
   * @param value - Secret value to store.
   */
  setSecret(tenantId: string, key: string, value: string): Promise<void>;

  /**
   * Delete a secret.
   * @param tenantId - Tenant identifier.
   * @param key - Secret key name.
   */
  deleteSecret(tenantId: string, key: string): Promise<void>;

  /**
   * List all secret key names for a tenant.
   * @param tenantId - Tenant identifier.
   * @returns Array of secret key names.
   */
  listKeys(tenantId: string): Promise<string[]>;
}
