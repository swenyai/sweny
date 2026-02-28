import type { CredentialVaultProvider } from "./types.js";

export interface AwsSecretsManagerConfig {
  region?: string;
  prefix?: string;
}

export function awsSecretsManager(config?: AwsSecretsManagerConfig): CredentialVaultProvider {
  return new AwsSecretsManagerProvider(config);
}

class AwsSecretsManagerProvider implements CredentialVaultProvider {
  private readonly region: string;
  private readonly prefix: string;
  private client: unknown;

  constructor(config?: AwsSecretsManagerConfig) {
    this.region = config?.region ?? "us-east-1";
    this.prefix = config?.prefix ?? "sweny";
  }

  private async getClient() {
    if (!this.client) {
      const { SecretsManagerClient } = await import("@aws-sdk/client-secrets-manager");
      this.client = new SecretsManagerClient({ region: this.region });
    }
    return this.client as import("@aws-sdk/client-secrets-manager").SecretsManagerClient;
  }

  private secretName(tenantId: string, key: string): string {
    return `${this.prefix}/${tenantId}/${key}`;
  }

  async getSecret(tenantId: string, key: string): Promise<string | null> {
    const client = await this.getClient();
    const { GetSecretValueCommand } = await import("@aws-sdk/client-secrets-manager");

    try {
      const result = await client.send(new GetSecretValueCommand({ SecretId: this.secretName(tenantId, key) }));
      return result.SecretString ?? null;
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "ResourceNotFoundException") {
        return null;
      }
      throw err;
    }
  }

  async setSecret(tenantId: string, key: string, value: string): Promise<void> {
    const client = await this.getClient();
    const { CreateSecretCommand, PutSecretValueCommand } = await import("@aws-sdk/client-secrets-manager");

    const name = this.secretName(tenantId, key);

    try {
      await client.send(new CreateSecretCommand({ Name: name, SecretString: value }));
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "ResourceExistsException") {
        await client.send(new PutSecretValueCommand({ SecretId: name, SecretString: value }));
      } else {
        throw err;
      }
    }
  }

  async deleteSecret(tenantId: string, key: string): Promise<void> {
    const client = await this.getClient();
    const { DeleteSecretCommand } = await import("@aws-sdk/client-secrets-manager");

    await client.send(
      new DeleteSecretCommand({
        SecretId: this.secretName(tenantId, key),
        ForceDeleteWithoutRecovery: true,
      }),
    );
  }

  async listKeys(tenantId: string): Promise<string[]> {
    const client = await this.getClient();
    const { ListSecretsCommand } = await import("@aws-sdk/client-secrets-manager");

    const namePrefix = `${this.prefix}/${tenantId}/`;
    const keys: string[] = [];
    let nextToken: string | undefined;

    do {
      const result = await client.send(
        new ListSecretsCommand({
          Filters: [{ Key: "name", Values: [namePrefix] }],
          NextToken: nextToken,
        }),
      );

      for (const secret of result.SecretList ?? []) {
        if (secret.Name?.startsWith(namePrefix)) {
          keys.push(secret.Name.slice(namePrefix.length));
        }
      }

      nextToken = result.NextToken;
    } while (nextToken);

    return keys;
  }
}
