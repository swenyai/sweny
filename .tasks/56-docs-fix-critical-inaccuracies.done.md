# Task 56: Fix critical inaccuracies across docs

## Goal
Fix factual errors in the Starlight docs site that would mislead users.

## Files to edit
All under `packages/web/src/content/docs/`

## Changes required

### 1. `skills/linear.md` — Team ID claim (CRITICAL)
**Current (wrong):** Around line 37, claims "Claude will use the team ID from the workflow context or prompt" — implying auto-discovery.
**Fix:** Replace with: "The `linear_create_issue` tool requires a team ID. Provide it via the `linear-team-id` GitHub Action input or the `--linear-team-id` CLI flag. You can find your team ID in Linear under Settings > Team > General."

### 2. `skills/notification.md` — Confusing "no env vars required" (SIGNIFICANT)
**Current (wrong):** Line 14 says "Required env vars: None required" then line 28 contradicts by saying at least one is needed.
**Fix:** Replace the config section with: "No single env var is required, but the skill only activates when at least one notification channel is configured. Set one or more of: `DISCORD_WEBHOOK_URL`, `TEAMS_WEBHOOK_URL`, `NOTIFICATION_WEBHOOK_URL`, `SENDGRID_API_KEY`."
Also: If `notify_email` tool exists in the source code (`packages/core/src/skills/notification.ts`), add its documentation. If not, add a note that email notifications are configured via SendGrid but the tool is not yet exposed — check source first.

### 3. `getting-started/faq.md` — Wrong package name
**Current (wrong):** Line ~39 references `npx @sweny-ai/cli workflow run`
**Fix:** Change to `npx @sweny-ai/core workflow run` (or just `sweny workflow run` if installed globally).

### 4. `getting-started/faq.md` — Incomplete skills list
**Current (wrong):** Line ~19 lists built-in skills but omits Slack and Notification.
**Fix:** Add Slack and Notification to the list of built-in skills.

### 5. `action/inputs.md` vs `cli/commands.md` — Terminology mismatch
**Current:** Action uses `linear-issue` input, CLI uses `--issue-override` for the same concept.
**Fix:** Align both to the same name. Check `packages/core/src/cli/main.ts` and `packages/action/src/config.ts` to see what the actual flag/input names are. Update the docs to match the source code exactly. If they genuinely differ between Action and CLI, document both clearly with a note explaining the mapping.

### 6. `advanced/troubleshooting.md` — Token scope language
**Current:** References classic GitHub token scopes (`repo`, `issues`, `pull-requests`).
**Fix:** Align with `skills/github.md` which documents fine-grained PAT permissions. Add both: "Fine-grained PAT (recommended): Contents read/write, Issues read/write, Pull requests read/write. Classic token: `repo` scope."

## Verification
- Read each file after editing to confirm the fix is correct
- Cross-reference with source code in `packages/core/src/` to verify claims
- Run `npm run build` in `packages/web` to confirm no broken markdown

## Context
These are the highest-priority fixes — users hitting these will get stuck or configure things wrong.
