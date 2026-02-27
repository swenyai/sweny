import * as path from "node:path";
import { pathToFileURL } from "node:url";
import type { SwenyConfig } from "./types.js";
import { loadEnv } from "./schema.js";
import type { EnvConfig } from "./schema.js";
import { noAuth } from "../auth/no-auth.js";

export interface ResolvedConfig {
  sweny: SwenyConfig;
  env: EnvConfig;
}

function defaultConfig(): SwenyConfig {
  return {
    name: "sweny-agent",
    auth: noAuth(),
    storage: undefined as unknown as SwenyConfig["storage"],
    plugins: [],
    model: {},
  };
}

export async function loadConfig(configPath?: string): Promise<ResolvedConfig> {
  const env = loadEnv();

  let sweny: SwenyConfig;

  const resolvedPath = configPath
    ? path.resolve(configPath)
    : path.resolve(process.cwd(), "sweny.config.ts");

  try {
    const fileUrl = pathToFileURL(resolvedPath).href;
    const mod = (await import(fileUrl)) as {
      default?: SwenyConfig;
    };
    sweny = mod.default ?? defaultConfig();
  } catch {
    sweny = defaultConfig();
  }

  // Auto-construct slack config from env vars when not explicitly set
  if (!sweny.slack && env.slackAppToken && env.slackBotToken && env.slackSigningSecret) {
    sweny.slack = {
      appToken: env.slackAppToken,
      botToken: env.slackBotToken,
      signingSecret: env.slackSigningSecret,
    };
  }

  // Merge log level from env if not set in config
  sweny.logLevel ??= env.logLevel as SwenyConfig["logLevel"];

  return { sweny, env };
}
