import type { App } from "@slack/bolt";
import type { AuthProvider } from "../auth/types.js";

const LOGIN_CALLBACK_ID = "sweny_login_modal";

/**
 * Register the /login command and login modal view handler on a Bolt App.
 * This is Slack-specific (Block Kit modals) and is called via the
 * optional `registerLoginUI` method on the Slack channel adapter.
 */
export function registerLoginModal(app: App, authProvider: AuthProvider): void {
  if (!authProvider.loginFields || authProvider.loginFields.length === 0) {
    return;
  }

  const fields = authProvider.loginFields;

  app.command("/login", async ({ ack, client, body }) => {
    await ack();

    const blocks = fields.map((field) => ({
      type: "input" as const,
      block_id: `${field.key}_block`,
      label: { type: "plain_text" as const, text: field.label },
      element: {
        type: field.type === "email" ? ("email_text_input" as const) : ("plain_text_input" as const),
        action_id: `${field.key}_input`,
        placeholder: field.placeholder ? { type: "plain_text" as const, text: field.placeholder } : undefined,
      },
    }));

    await client.views.open({
      trigger_id: body.trigger_id,
      view: {
        type: "modal",
        callback_id: LOGIN_CALLBACK_ID,
        title: { type: "plain_text", text: `${authProvider.displayName} Login` },
        submit: { type: "plain_text", text: "Login" },
        close: { type: "plain_text", text: "Cancel" },
        blocks,
      },
    });
  });

  app.view(LOGIN_CALLBACK_ID, async ({ ack, view, body }) => {
    const credentials: Record<string, string> = {};
    const errors: Record<string, string> = {};

    for (const field of fields) {
      const value = view.state.values[`${field.key}_block`]?.[`${field.key}_input`]?.value;
      if (!value) {
        errors[`${field.key}_block`] = `${field.label} is required`;
      } else {
        credentials[field.key] = value;
      }
    }

    if (Object.keys(errors).length > 0) {
      await ack({ response_action: "errors", errors });
      return;
    }

    try {
      if (!authProvider.login) {
        throw new Error("This auth provider does not support interactive login.");
      }

      const identity = await authProvider.login(body.user.id, credentials);
      await ack({
        response_action: "update",
        view: {
          type: "modal",
          title: { type: "plain_text", text: `${authProvider.displayName} Login` },
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `Logged in as *${identity.displayName}*. You can now DM me or @mention me to get started.`,
              },
            },
          ],
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      const firstFieldKey = fields[0]!.key;
      await ack({
        response_action: "errors",
        errors: { [`${firstFieldKey}_block`]: `Login failed: ${message}` },
      });
    }
  });
}
