import { z } from "zod";
import type { Logger } from "../logger.js";
import { consoleLogger } from "../logger.js";
import type { CredentialVaultProvider } from "./types.js";

export const awsSecretsManagerConfigSchema = z.object({
  region: z.string().default("us-east-1"),
  prefix: z.string().default("sweny"),
  logger: z.custom<Logger>().optional(),
});

export type AwsSecretsManagerConfig = z.infer<typeof awsSecretsManagerConfigSchema>;

export function awsSecretsManager(config?: AwsSecretsManagerConfig): CredentialVaultProvider {
  const parsed = awsSecretsManagerConfigSchema.parse(config ?? {});
  return new AwsSecretsManagerProvider(parsed);
}

class AwsSecretsManagerProvider implements CredentialVaultProvider {
  private readonly region: string;
  private readonly prefix: string;
  private readonly log: Logger;
  private client: import("@aws-sdk/client-secrets-manager").SecretsManagerClient | null = null;

  constructor(config: AwsSecretsManagerConfig) {
    this.region = config.region ?? "us-east-1";
    this.prefix = config.prefix ?? "sweny";
    this.log = config.logger ?? consoleLogger;
  }

  private async getClient() {
    if (!this.client) {
      const { SecretsManagerClient } = await import("@aws-sdk/client-secrets-manager");
      this.client = new SecretsManagerClient({ region: this.region });
    }
    return this.client;
  }

  private secretName(tenantId: string, key: string): string {
    return `${this.prefix}/${tenantId}/${key}`;
  }

  async getSecret(tenantId: string, key: string): Promise<string | null> {
    const client = await this.getClient();
    const { GetSecretValueCommand } = await import("@aws-sdk/client-secrets-manager");

    try {
      const result = await client.send(new GetSecretValueCommand({ SecretId: this.secretName(tenantId, key) }));
      this.log.info(`Retrieved secret ${this.secretName(tenantId, key)}`);
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
    this.log.info(`Set secret ${name}`);
  }

  async deleteSecret(tenantId: string, key: string): Promise<void> {
    const client = await this.getClient();
    const { DeleteSecretCommand } = await import("@aws-sdk/client-secrets-manager");

    const name = this.secretName(tenantId, key);
    await client.send(
      new DeleteSecretCommand({
        SecretId: name,
        ForceDeleteWithoutRecovery: true,
      }),
    );
    this.log.info(`Deleted secret ${name}`);
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

    this.log.info(`Listed ${keys.length} keys for tenant ${tenantId}`);
    return keys;
  }
}
