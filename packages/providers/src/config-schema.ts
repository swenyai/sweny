/**
 * A single required (or optional) configuration field for a provider.
 * Used by the engine to validate all credentials are present before starting.
 */
export interface ProviderConfigField {
  /** Logical field name (e.g. "apiKey"). Matches the key in the provider's config object. */
  key: string;
  /** Primary env var that satisfies this field (e.g. "DD_API_KEY"). */
  envVar: string;
  /** If true, workflow will fail pre-flight if this env var is not set. Default: true. */
  required?: boolean;
  /** Human-readable description for error messages and docs. */
  description: string;
  /** Default value used when envVar is absent and required is false. */
  default?: string;
}

/**
 * Config schema for a provider. Declare this alongside your provider factory.
 * The engine reads it during pre-flight validation.
 */
export interface ProviderConfigSchema {
  /** Provider role identifier (e.g. "observability", "issueTracker"). */
  role: string;
  /** Human-readable provider name for error messages (e.g. "Datadog"). */
  name: string;
  /** All configuration fields this provider needs. */
  fields: ProviderConfigField[];
}
