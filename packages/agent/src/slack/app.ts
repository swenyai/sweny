import { App } from "@slack/bolt";

export function createSlackApp(opts: {
  botToken: string;
  appToken: string;
  signingSecret: string;
}): App {
  return new App({
    token: opts.botToken,
    appToken: opts.appToken,
    signingSecret: opts.signingSecret,
    socketMode: true,
  });
}
