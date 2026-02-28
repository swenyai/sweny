export type { MessagingProvider, ChatMessage } from "./types.js";

export { slack } from "./slack.js";
export type { SlackMessagingConfig } from "./slack.js";

export { teams, teamsConfigSchema } from "./teams.js";
export type { TeamsMessagingConfig } from "./teams.js";
