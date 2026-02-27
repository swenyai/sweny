# Add Missing Provider Documentation Pages

## Problem
Three provider categories shipped without documentation pages: credential-vault, coding-agent, and agent-tool.

## Context
- Docs site lives at `packages/web/src/content/docs/providers/`
- Each provider doc follows a consistent format: title, description, interface, factory usage example, config options
- The providers sidebar uses `autogenerate: { directory: 'providers' }` in `packages/web/astro.config.mjs`, so new .md files in the providers directory are auto-discovered

## Tasks

### 1. Create `packages/web/src/content/docs/providers/credential-vault.md`
- **Source**: `packages/providers/src/credential-vault/`
- **Interface**: `CredentialVaultProvider` — getSecret, setSecret, deleteSecret, listKeys
- **Factory**: `envVault(config?)` — reads from environment variables
- **Config**: `EnvVaultConfig` with optional `prefix` (default: "SWENY")
- **Key details**: Tenant-scoped lookup `{PREFIX}_{TENANT_ID}_{KEY}`, falls back to `{PREFIX}_{KEY}`, read-only (setSecret/deleteSecret/listKeys throw)

### 2. Create `packages/web/src/content/docs/providers/coding-agent.md`
- **Source**: `packages/providers/src/coding-agent/`
- **Interface**: `CodingAgent` — install(), run(options)
- **Factory**: `claudeCode(config?)` — wraps Claude Code CLI via @actions/exec
- **Config**: `ClaudeCodeConfig` with optional `logger`
- **Key details**: `CodingAgentRunOptions` has prompt, cwd, maxTurns, allowedTools, env, additionalArgs

### 3. Create `packages/web/src/content/docs/providers/agent-tool.md`
- **Source**: `packages/providers/src/agent-tool/`
- **Interface**: `AgentTool<T>` — name, description, schema, execute
- **Factory**: `agentTool(config)` — creates typed tools with Zod schema validation
- **Config**: name, description, schema (ZodRawShape), execute function
- **Key details**: Returns `ToolResult` with content string and optional isError flag

## Verification
- Read each source file for accurate interface/config details
- Follow the style of existing provider docs (e.g., `packages/web/src/content/docs/providers/observability.md`)
- Run `npm run build --workspace=packages/web` to verify site builds with new pages
