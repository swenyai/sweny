# Consistency Fixes: Add Zod Validation to All Providers

Three providers lack Zod config validation while all others use it. Fix consistency.

## Working directory
`/Users/nate/src/swenyai/sweny/packages/providers`

## Fix 1: GitLab Source Control - Add Zod Schema

**File:** `src/source-control/gitlab.ts`

Currently uses a plain TypeScript interface. Replace with Zod schema matching the pattern in other providers.

**Current:**
```ts
export interface GitLabSourceControlConfig {
  token: string;
  projectId: string | number;
  baseUrl?: string;
  baseBranch?: string;
  logger?: Logger;
}
```

**Change to:**
```ts
import { z } from "zod";

export const gitlabConfigSchema = z.object({
  token: z.string().min(1, "GitLab token is required"),
  projectId: z.union([z.string().min(1), z.number()]),
  baseUrl: z.string().default("https://gitlab.com"),
  baseBranch: z.string().default("main"),
  logger: z.custom<Logger>().optional(),
});

export type GitLabSourceControlConfig = z.infer<typeof gitlabConfigSchema>;
```

Update the `gitlab()` factory to `parse(config)` like other providers do. Update `src/source-control/index.ts` to also export `gitlabConfigSchema`. Keep the existing `GitLabSourceControlConfig` type export (it's now inferred from Zod).

## Fix 2: Teams Messaging - Add Zod Schema

**File:** `src/messaging/teams.ts`

Currently uses a plain interface. Add Zod.

**Change to:**
```ts
import { z } from "zod";

export const teamsConfigSchema = z.object({
  tenantId: z.string().min(1, "Azure AD tenant ID is required"),
  clientId: z.string().min(1, "Azure AD client ID is required"),
  clientSecret: z.string().min(1, "Azure AD client secret is required"),
  logger: z.custom<Logger>().optional(),
});

export type TeamsMessagingConfig = z.infer<typeof teamsConfigSchema>;
```

Update the `teams()` factory to parse config. Update `src/messaging/index.ts` to also export `teamsConfigSchema`.

## Fix 3: AWS Secrets Manager - Add Zod Schema and Logger

**File:** `src/credential-vault/aws-secrets-manager.ts`

Currently uses plain interface, has no logger support, and uses `unknown` client type.

**Changes:**
1. Add Zod schema:
```ts
import { z } from "zod";
import type { Logger } from "../logger.js";
import { consoleLogger } from "../logger.js";

export const awsSecretsManagerConfigSchema = z.object({
  region: z.string().default("us-east-1"),
  prefix: z.string().default("sweny"),
  logger: z.custom<Logger>().optional(),
});

export type AwsSecretsManagerConfig = z.infer<typeof awsSecretsManagerConfigSchema>;
```

2. Add logger to the class constructor and use it (log.info on operations)
3. Fix the `unknown` client type by using a typed private field:
```ts
private client: import("@aws-sdk/client-secrets-manager").SecretsManagerClient | null = null;
```

Update barrel exports in `src/credential-vault/index.ts` to also export `awsSecretsManagerConfigSchema`.

## Completion

After fixing all files:
1. Run `npx tsc --noEmit`
2. Run `npx vitest run`
3. Rename: `mv packages/providers/12-consistency-fixes.todo.md packages/providers/12-consistency-fixes.done.md`
4. Commit:
```
refactor: add Zod config validation to GitLab, Teams, and AWS SM providers

Ensures all providers follow the same config validation pattern
using Zod schemas with descriptive error messages.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
```
