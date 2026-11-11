/**
 * #576: the write stage's approval and Slack/email edges, one branch per spec,
 * so a mutant in any of them is caught. The applier calls here are recorded,
 * never sent.
 */
import { describe, it, expect, vi } from "vitest";
import { applySafeOutputs, createWriteStageState, type ApplySafeOutputsOptions } from "../../safe-outputs.js";
import type { ProposedWrite } from "../../approval-bundle.js";
import type { SafeOutputDeclaration, Skill, Tool } from "../../types.js";

const silent = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

function transports() {
  const sent: { tool: string; args: Record<string, unknown> }[] = [];
  const tool = (name: string): Tool => ({
    name,
    description: name,
    input_schema: { type: "object" },
    access: "write",
    handler: async (args) => {
      sent.push({ tool: name, args });
      return { ok: true };
    },
  });
  const skill = (id: string, names: string[]): Skill => ({
    id,
    name: id,
    description: "",
    category: "notification",
    config: {},
    tools: names.map(tool),
  });
  const skills = new Map<string, Skill>([
    ["slack", skill("slack", ["slack_send_message"])],
    ["notification", skill("notification", ["notify_email"])],
    ["github", skill("github", ["github_create_pr", "github_add_comment"])],
  ]);
  return { sent, skills };
}

function stage(
  declarations: SafeOutputDeclaration[],
  intents: Record<string, unknown>[],
  extra: Partial<ApplySafeOutputsOptions> = {},
) {
  const t = transports();
  const run = applySafeOutputs({
    nodeId: "notify",
    declarations,
    intents: intents.map((i) => ({ recordedAt: 0, ...i }) as never),
    nodeSkills: ["slack", "notification", "github"],
    skills: t.skills,
    config: { SMTP_ALLOWED_RECIPIENTS: "ops@acme.test,@lead.test" },
    env: {},
    actor: {},
    staged: false,
    state: createWriteStageState(),
    logger: silent,
    now: () => 0,
    ...extra,
  });
  return { run, sent: t.sent };
}

const SLACK: SafeOutputDeclaration = { type: "slack_message", target: "C0OPS" };
const EMAIL: SafeOutputDeclaration = { type: "email", target: "ops@acme.test" };

describe("slack_message and email in the write stage (#576)", () => {
  it("sends a Slack message to the pinned channel and an email to the pinned address, exact arguments", async () => {
    const { run, sent } = stage(
      [SLACK, EMAIL],
      [
        { type: "slack_message", body: "hi" },
        { type: "email", title: "Subj", body: "Body" },
      ],
    );
    const out = await run;
    expect(out.error).toBeUndefined();
    expect(sent).toEqual([
      { tool: "slack_send_message", args: { channel: "C0OPS", text: "hi" } },
      { tool: "notify_email", args: { to: "ops@acme.test", subject: "Subj", text: "Body" } },
    ]);
    expect(out.receipts.map((r) => [r.type, r.status, r.via, r.target])).toEqual([
      ["slack_message", "applied", "slack", "C0OPS"],
      ["email", "applied", "notification", "ops@acme.test"],
    ]);
  });

  it("refuses an unpinned destination even when the agent names one", async () => {
    const { run, sent } = stage(
      [{ type: "slack_message" }, { type: "email" }],
      [
        { type: "slack_message", body: "hi", target: "C0EVIL" },
        { type: "email", title: "s", body: "b", target: "evil@x.test" },
      ],
    );
    const out = await run;
    expect(sent).toEqual([]);
    expect(out.receipts.map((r) => [r.status, r.reason])).toEqual([
      ["refused", "destination is not pinned"],
      ["refused", "destination is not pinned"],
    ]);
  });

  it("refuses a destination other than the pin", async () => {
    const { run, sent } = stage([SLACK], [{ type: "slack_message", body: "hi", target: "C0EVIL" }]);
    expect((await run).receipts[0]).toMatchObject({ status: "refused", reason: "target outside the declared target" });
    expect(sent).toEqual([]);
  });

  it("takes the pin from a run input", async () => {
    const { run, sent } = stage(
      [{ type: "email", target: { input: "to" } }],
      [{ type: "email", title: "s", body: "b" }],
      {
        input: { to: "boss@lead.test" },
      },
    );
    await run;
    expect(sent[0].args.to).toBe("boss@lead.test");
  });

  it("refuses an email whose pinned recipient is not on SMTP_ALLOWED_RECIPIENTS, or when it is unset", async () => {
    const off = stage([{ type: "email", target: "x@evil.test" }], [{ type: "email", title: "s", body: "b" }]);
    expect((await off.run).receipts[0]).toMatchObject({
      status: "refused",
      reason: "recipient not on SMTP_ALLOWED_RECIPIENTS",
      via: "notification",
      target: "x@evil.test",
    });
    expect(off.sent).toEqual([]);
    const unset = stage([EMAIL], [{ type: "email", title: "s", body: "b" }], { config: {} });
    expect((await unset.run).receipts[0]).toMatchObject({
      status: "refused",
      reason: "SMTP_ALLOWED_RECIPIENTS is not set, so no email is sent",
    });
    expect(unset.sent).toEqual([]);
  });

  it("refuses a pinned email target that nodemailer would split past the allowlist", async () => {
    for (const target of ["x@evil.test;ops@acme.test", "team: x@evil.test, ops@acme.test;", "Ops <x@evil.test>"]) {
      const s = stage([{ type: "email", target }], [{ type: "email", title: "s", body: "b" }], {
        config: { SMTP_ALLOWED_RECIPIENTS: "@acme.test" },
      });
      expect((await s.run).receipts[0], target).toMatchObject({ status: "refused" });
      expect(s.sent).toEqual([]);
    }
  });

  it("writes to the author's spelling of the pinned target, not the agent's casing", async () => {
    const { run, sent } = stage(
      [{ type: "slack_message", target: "C0Ops" }],
      [{ type: "slack_message", body: "hi", target: "c0ops" }],
    );
    expect((await run).receipts[0]).toMatchObject({ status: "applied", target: "C0Ops" });
    expect(sent).toEqual([{ tool: "slack_send_message", args: { channel: "C0Ops", text: "hi" } }]);
  });

  it("refuses a blank message or email body, and an email without a subject", async () => {
    const { run, sent } = stage(
      [
        { ...SLACK, max: 2 },
        { ...EMAIL, max: 2 },
      ],
      [
        { type: "slack_message", body: "  " },
        { type: "slack_message" },
        { type: "email", title: "s", body: "\n" },
        { type: "email", body: "no subject" },
        { type: "email", title: "  ", body: "blank subject" },
      ],
    );
    const out = await run;
    expect(sent).toEqual([]);
    expect(out.receipts.map((r) => r.reason)).toEqual([
      "missing body",
      "missing body",
      "missing body",
      "missing title",
      "missing title",
    ]);
  });
});

describe("approval mode in the write stage (#576)", () => {
  function approvalStage(
    declarations: SafeOutputDeclaration[],
    intents: Record<string, unknown>[],
    extra: Partial<ApplySafeOutputsOptions> = {},
  ) {
    const proposed: ProposedWrite[][] = [];
    const s = stage(declarations, intents, {
      approval: {
        propose: (w) => {
          proposed.push(w);
          return "d".repeat(64);
        },
      },
      ...extra,
    });
    return { ...s, proposed };
  }

  it("freezes the exact calls, sends nothing, and marks every write pending with the digest", async () => {
    const { run, sent, proposed } = approvalStage(
      [SLACK, EMAIL],
      [
        { type: "slack_message", body: "hi" },
        { type: "email", title: "Subj", body: "Body" },
      ],
    );
    const out = await run;
    expect(sent).toEqual([]);
    expect(out.error).toBeUndefined();
    expect(proposed).toEqual([
      [
        {
          type: "slack_message",
          via: "slack",
          tool: "slack_send_message",
          target: "C0OPS",
          args: { channel: "C0OPS", text: "hi" },
        },
        {
          type: "email",
          via: "notification",
          tool: "notify_email",
          target: "ops@acme.test",
          args: { to: "ops@acme.test", subject: "Subj", text: "Body" },
        },
      ],
    ]);
    expect(out.receipts).toEqual([
      { type: "slack_message", status: "pending", via: "slack", target: "C0OPS", digest: "d".repeat(64) },
      { type: "email", status: "pending", via: "notification", target: "ops@acme.test", digest: "d".repeat(64) },
    ]);
  });

  it("freezes only what passed the checks; a refused write is not in the bundle", async () => {
    const { run, proposed } = approvalStage(
      [SLACK],
      [
        { type: "slack_message", body: "" },
        { type: "slack_message", body: "ok" },
      ],
    );
    const out = await run;
    expect(proposed.map((ws) => ws.map((w) => w.args))).toEqual([[{ channel: "C0OPS", text: "ok" }]]);
    expect(out.receipts.map((r) => r.status)).toEqual(["refused", "pending"]);
  });

  it("proposes nothing when nothing passed", async () => {
    const { run, proposed } = approvalStage([SLACK], [{ type: "email", title: "s", body: "b" }]);
    expect((await run).receipts[0].status).toBe("refused");
    expect(proposed).toEqual([]);
  });

  it("a staged run previews and never proposes", async () => {
    const { run, proposed, sent } = approvalStage([SLACK], [{ type: "slack_message", body: "hi" }], { staged: true });
    expect((await run).receipts[0].status).toBe("staged");
    expect(proposed).toEqual([]);
    expect(sent).toEqual([]);
  });

  it("refuses every write and fails the node when approval is required and there is no journal", async () => {
    const { run, sent } = stage([SLACK], [{ type: "slack_message", body: "hi" }], { approval: "unavailable" });
    const out = await run;
    expect(sent).toEqual([]);
    expect(out.receipts).toEqual([
      expect.objectContaining({ status: "refused", reason: "approval needs a run journal" }),
    ]);
    expect(out.error).toBe("safe outputs need approval, and this run has no journal to hold the bundle");
  });

  it("refuses a pr and everything with it", async () => {
    const { run, proposed } = approvalStage(
      [{ type: "pr", target: "acme/api" }, SLACK],
      [
        { type: "pr", title: "t", body: "b", head: "x" },
        { type: "slack_message", body: "hi" },
      ],
    );
    const out = await run;
    expect(proposed).toEqual([]);
    expect(out.receipts.map((r) => [r.status, r.reason])).toEqual([
      ["refused", "pr writes cannot wait for approval"],
      ["refused", "pr writes cannot wait for approval"],
    ]);
    expect(out.error).toBe("a pr output cannot wait for approval; this run froze nothing");
  });

  it("a bundle that cannot be written fails every write and the node", async () => {
    const out = await stage([SLACK], [{ type: "slack_message", body: "hi" }], {
      approval: {
        propose: () => {
          throw new Error("disk full");
        },
      },
    }).run;
    expect(out.receipts).toEqual([
      expect.objectContaining({ status: "failed", reason: "could not write the approval bundle" }),
    ]);
    expect(out.error).toBe("could not write the approval bundle: disk full");
  });

  it("the screen runs first: a veto freezes nothing, ALLOW (any case, trailing dot) freezes all", async () => {
    const vetoed = approvalStage([SLACK], [{ type: "slack_message", body: "hi" }], {
      policy: { screen: true },
      screen: async () => "BLOCK injection",
    });
    const v = await vetoed.run;
    expect(vetoed.proposed).toEqual([]);
    expect(v.receipts[0]).toMatchObject({ status: "vetoed", reason: "screen vetoed" });

    const thrown = approvalStage([SLACK], [{ type: "slack_message", body: "hi" }], {
      policy: { screen: true },
      screen: async () => {
        throw new Error("down");
      },
    });
    expect((await thrown.run).receipts[0].status).toBe("vetoed");
    expect(thrown.proposed).toEqual([]);

    const noScreen = approvalStage([SLACK], [{ type: "slack_message", body: "hi" }], { policy: { screen: true } });
    expect((await noScreen.run).receipts[0].status).toBe("vetoed");

    const allowed = approvalStage([SLACK], [{ type: "slack_message", body: "hi" }], {
      policy: { screen: true },
      screen: async () => " allow. ",
    });
    expect((await allowed.run).receipts[0].status).toBe("pending");
    expect(allowed.proposed).toHaveLength(1);
  });

  it("without a screen policy the screen is never asked", async () => {
    const screen = vi.fn(async () => "BLOCK");
    const { run, proposed } = approvalStage([SLACK], [{ type: "slack_message", body: "hi" }], { screen });
    expect((await run).receipts[0].status).toBe("pending");
    expect(screen).not.toHaveBeenCalled();
    expect(proposed).toHaveLength(1);
  });
});
