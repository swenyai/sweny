export interface CredentialVaultProvider {
  getSecret(tenantId: string, key: string): Promise<string | null>;
  setSecret(tenantId: string, key: string, value: string): Promise<void>;
  deleteSecret(tenantId: string, key: string): Promise<void>;
  listKeys(tenantId: string): Promise<string[]>;
}
