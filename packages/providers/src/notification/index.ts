export type { NotificationProvider, NotificationPayload } from "./types.js";

export { githubSummary, githubSummaryConfigSchema, type GitHubSummaryConfig } from "./github-summary.js";
export { slackWebhook, slackWebhookConfigSchema, type SlackWebhookConfig } from "./slack-webhook.js";
export { teamsWebhook, teamsWebhookConfigSchema, type TeamsWebhookConfig } from "./teams-webhook.js";
export { discordWebhook, discordWebhookConfigSchema, type DiscordWebhookConfig } from "./discord-webhook.js";
export { email, emailConfigSchema, type EmailConfig } from "./email.js";
