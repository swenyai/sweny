import type { AuthProvider } from "../auth/types.js";
import type { StorageProvider } from "../storage/types.js";
import type { AccessGuard } from "../access/types.js";
import type { ToolPlugin } from "../plugins/types.js";
import type { AuditLogger } from "../audit/types.js";

export interface SwenyConfig {
  name: string;
  auth: AuthProvider;
  storage: StorageProvider;
  accessGuard?: AccessGuard;
  plugins: ToolPlugin[];
  systemPrompt?: string;
  claude: {
    maxTurns?: number;
    disallowedTools?: string[];
  };
  slack?: {
    appToken?: string;
    botToken?: string;
    signingSecret?: string;
  };
  rateLimit?: {
    maxPerMinute?: number;
    maxPerHour?: number;
  };
  audit?: AuditLogger;
  healthPort?: number;
  logLevel?: "debug" | "info" | "warn" | "error";
  allowedUsers?: string[];
}

export function defineConfig(config: SwenyConfig): SwenyConfig {
  return config;
}
