import { z } from "zod";

export const envSchema = z
  .object({
    claudeApiKey: z.string().min(1).optional(),
    claudeOauthToken: z.string().min(1).optional(),
    slackAppToken: z.string().startsWith("xapp-").optional(),
    slackBotToken: z.string().startsWith("xoxb-").optional(),
    slackSigningSecret: z.string().min(1).optional(),
    logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
  })
  .refine((e) => e.claudeApiKey || e.claudeOauthToken, {
    message: "Either ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN must be set",
  });

export type EnvConfig = z.infer<typeof envSchema>;

export function loadEnv(): EnvConfig {
  const raw = {
    claudeApiKey: process.env["ANTHROPIC_API_KEY"] || undefined,
    claudeOauthToken: process.env["CLAUDE_CODE_OAUTH_TOKEN"] || undefined,
    slackAppToken: process.env["SLACK_APP_TOKEN"] || undefined,
    slackBotToken: process.env["SLACK_BOT_TOKEN"] || undefined,
    slackSigningSecret: process.env["SLACK_SIGNING_SECRET"] || undefined,
    logLevel: process.env["LOG_LEVEL"] || undefined,
  };

  return envSchema.parse(raw);
}
