/**
 * RFC 0002 M2 (#576): approval bundles and `sweny publish`, end to end.
 *
 * A run whose workflow sets `safe_outputs.approval.required` writes nothing.
 * Its write stage freezes the exact applier calls into a bundle under the
 * run's private state dir, named by the sha256 of its bytes, and the visit
 * ends with `pending` receipts that carry that digest. `publishRun` (the
 * engine of `sweny publish <run>`) verifies the bundle against the run's
 * authenticated journal, prints the exact arguments, and with `approve`
 * consumes a one-time approval and sends each write once, byte for byte.
 *
 * The transports here are fakes that record every call, so "sent once" is a
 * count, and a crash is the publisher's fault seam throwing after a send
 * returned and before its receipt reached the disk.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execute } from "../executor.js";
import { createSkillMap } from "../skills/index.js";
import { notification } from "../skills/notification.js";
import { RunJournal, journalDir, markerToken, type JournalRecord } from "../journal.js";
import { prepareResume } from "../cli/resume.js";
import { publishRun, BUNDLES_DIR, type PublishFaults } from "../approval.js";
import { parseWorkflow, validateWorkflow } from "../schema.js";
import type { Claude, NodeResult, Skill, Workflow } from "../types.js";

vi.setConfig({ testTimeout: 30_000 });

// nodemailer is the email transport (owner decision 5); the real notify_email handler is driven against this stub.
const mail = vi.hoisted(() => ({ urls: [] as unknown[], sent: [] as Record<string, unknown>[] }));
vi.mock("nodemailer", () => ({
  default: {
    createTransport(url: unknown) {
      mail.urls.push(url);
      return {
        async sendMail(msg: Record<string, unknown>) {
          mail.sent.push(msg);
          return { messageId: "<real-1@smtp.test>", accepted: [msg.to], rejected: [] };
        },
      };
    },
  },
}));

const RUN_ID = "20261111-090000-m2a576";
const silent = { info() {}, warn() {}, error() {}, debug() {} };

class Kill extends Error {
  constructor(at: string) {
    super(`killed at ${at}`);
    this.name = "Kill";
  }
}

const dirs: string[] = [];
function tmp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A contained fake agent that requests the scripted writes for its node. */
function fakeAgent(emit: Record<string, object[]>, contained = true) {
  const calls: string[] = [];
  const claude: Claude = {
    async run(req) {
      const node = /NODE:(\w+)/.exec(req.instruction)![1];
      calls.push(node);
      const emitter = req.tools.find((t) => t.name === "emit_output");
      for (const e of emit[node] ?? []) await emitter!.handler(e, { config: {}, logger: silent });
      return { status: "success", data: { value: `${node}-out` }, toolCalls: [], contained } as NodeResult;
    },
    async evaluate() {
      throw new Error("no conditional routing here");
    },
    async ask() {
      return "ALLOW";
    },
  };
  return { claude, calls };
}

interface Sent {
  tool: string;
  args: Record<string, unknown>;
}

/** Slack, email (notification) and GitHub transports that record every send. */
function fakeTransports() {
  const sent: Sent[] = [];
  const write = (name: string, out: (args: Record<string, unknown>) => unknown) => ({
    name,
    description: name,
    input_schema: { type: "object" },
    access: "write" as const,
    handler: async (args: Record<string, unknown>) => {
      sent.push({ tool: name, args });
      return out(args);
    },
  });
  const slack: Skill = {
    id: "slack",
    name: "Slack",
    description: "",
    category: "notification",
    config: {},
    tools: [write("slack_send_message", () => ({ ok: true, ts: `17000000${sent.length}.0001` }))],
  };
  const notification: Skill = {
    id: "notification",
    name: "Notification",
    description: "",
    category: "notification",
    config: {},
    tools: [write("notify_email", () => ({ id: `<msg-${sent.length}@test>`, accepted: ["ops@acme.test"] }))],
  };
  const github: Skill = {
    id: "github",
    name: "GitHub",
    description: "",
    category: "git",
    config: {},
    tools: [
      write("github_add_comment", () => ({ id: 900 + sent.length, html_url: "https://github.test/acme/api/issues/7" })),
    ],
  };
  return { sent, skills: [slack, notification, github] };
}

/** Offload-style store: one node drafts, a notify node asks for one Slack message and one email. */
function approvalWorkflow(over: Partial<Workflow> = {}): Workflow {
  return {
    id: "store",
    name: "Approval store",
    description: "",
    spec_version: "3",
    entry: "draft",
    safe_outputs: { approval: { required: true } },
    nodes: {
      draft: { name: "Draft", instruction: "NODE:draft", skills: [], permissions: "read" },
      notify: {
        name: "Notify",
        instruction: "NODE:notify",
        skills: ["slack", "notification"],
        outputs: [
          { type: "slack_message", target: "C0OPS" },
          { type: "email", target: "ops@acme.test" },
        ],
      },
    },
    edges: [{ from: "draft", to: "notify" }],
    ...over,
  };
}

const SLACK = { type: "slack_message", body: "Morning prompts are ready: 3 drafts." };
const EMAIL = { type: "email", title: "Morning prompts", body: "Three drafts are ready for review." };

async function produce(cwd: string, workflow: Workflow, emit: Record<string, object[]>, contained = true) {
  const t = fakeTransports();
  const agent = fakeAgent(emit, contained);
  const journal = RunJournal.create({ runId: RUN_ID, cwd, workflowFile: "store.yml" });
  const { results } = await execute(
    workflow,
    {},
    {
      skills: createSkillMap(t.skills),
      claude: agent.claude,
      config: {},
      logger: silent,
      cwd,
      env: {},
      journal,
    },
  );
  journal.end([...results.values()].some((r) => r.status === "failed") ? "failed" : "success");
  return { results, sent: t.sent };
}

function bundlesOf(cwd: string): string[] {
  const dir = join(journalDir(cwd, RUN_ID), BUNDLES_DIR);
  return existsSync(dir) ? readdirSync(dir).sort() : [];
}

function publish(cwd: string, approve: boolean, extra: { faults?: PublishFaults; now?: () => number } = {}) {
  const t = fakeTransports();
  const lines: string[] = [];
  const run = () =>
    publishRun({
      runId: RUN_ID,
      cwd,
      approve,
      skills: createSkillMap(t.skills),
      config: {},
      logger: silent,
      user: "nate",
      print: (l: string) => lines.push(l),
      ...extra,
    });
  return { run, sent: t.sent, lines };
}

const sha256 = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

describe("approval mode: the producer freezes writes into a bundle (#576)", () => {
  it("sends nothing, ends the visit with pending receipts, and writes one bundle named by its digest", async () => {
    process.env.SWENY_STATE_DIR = tmp("sweny-state-");
    const cwd = tmp("sweny-ws-");
    const { results, sent } = await produce(cwd, approvalWorkflow(), { notify: [SLACK, EMAIL] });

    expect(sent).toEqual([]);
    const notify = results.get("notify")!;
    expect(notify.status).toBe("success");
    const files = bundlesOf(cwd);
    expect(files).toHaveLength(1);
    const digest = files[0].replace(/\.json$/, "");
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    const bytes = readFileSync(join(journalDir(cwd, RUN_ID), BUNDLES_DIR, files[0]));
    expect(sha256(bytes)).toBe(digest);
    expect(notify.outputs).toEqual([
      { type: "slack_message", via: "slack", target: "C0OPS", status: "pending", digest },
      { type: "email", via: "notification", target: "ops@acme.test", status: "pending", digest },
    ]);

    const bundle = JSON.parse(bytes.toString("utf-8"));
    expect(bundle.proposal).toEqual({ run: RUN_ID, node: "notify", iteration: expect.any(Number) });
    expect(Date.parse(bundle.expires_at) - Date.parse(bundle.created_at)).toBe(7 * 86_400_000);
    expect(bundle.writes).toEqual([
      {
        n: 0,
        type: "slack_message",
        via: "slack",
        tool: "slack_send_message",
        target: "C0OPS",
        args: { channel: "C0OPS", text: SLACK.body },
      },
      {
        n: 1,
        type: "email",
        via: "notification",
        tool: "notify_email",
        target: "ops@acme.test",
        args: { to: "ops@acme.test", subject: EMAIL.title, text: EMAIL.body },
      },
    ]);
  });

  it("freezes the reconciliation marker into a GitHub write's body up front", async () => {
    process.env.SWENY_STATE_DIR = tmp("sweny-state-");
    const cwd = tmp("sweny-ws-");
    const wf = approvalWorkflow({
      nodes: {
        draft: { name: "Draft", instruction: "NODE:draft", skills: [], permissions: "read" },
        notify: {
          name: "Notify",
          instruction: "NODE:notify",
          skills: ["github"],
          outputs: [{ type: "comment", target: "acme/api", number: 7 }],
        },
      },
    });
    await produce(cwd, wf, { notify: [{ type: "comment", body: "Drafts ready" }] });
    const [file] = bundlesOf(cwd);
    const bundle = JSON.parse(readFileSync(join(journalDir(cwd, RUN_ID), BUNDLES_DIR, file), "utf-8"));
    const body = bundle.writes[0].args.body as string;
    expect(body).toMatch(/^Drafts ready\n\n<!-- sweny-output swenyk[0-9a-f]{24} -->$/);
    expect(body.startsWith(`Drafts ready\n\n<!-- sweny-output ${markerToken("")}`)).toBe(true);
  });

  it("never freezes a pr: it is refused, nothing is bundled, and the node fails", async () => {
    process.env.SWENY_STATE_DIR = tmp("sweny-state-");
    const cwd = tmp("sweny-ws-");
    const wf = approvalWorkflow({
      nodes: {
        draft: { name: "Draft", instruction: "NODE:draft", skills: [], permissions: "read" },
        notify: {
          name: "Notify",
          instruction: "NODE:notify",
          skills: ["github"],
          outputs: [
            { type: "pr", target: "acme/api" },
            { type: "comment", target: "acme/api", number: 7 },
          ],
        },
      },
    });
    const { results, sent } = await produce(cwd, wf, {
      notify: [
        { type: "pr", title: "Fix", body: "b", head: "sweny/fix" },
        { type: "comment", body: "c" },
      ],
    });
    expect(sent).toEqual([]);
    expect(bundlesOf(cwd)).toEqual([]);
    const notify = results.get("notify")!;
    expect(notify.status).toBe("failed");
    expect(notify.outputs!.map((o) => [o.type, o.status, o.reason])).toEqual([
      ["pr", "refused", "pr writes cannot wait for approval"],
      ["comment", "refused", "pr writes cannot wait for approval"],
    ]);
  });

  it("refuses every write when approval is required and the run has no journal", async () => {
    const t = fakeTransports();
    const agent = fakeAgent({ notify: [SLACK] });
    const { results } = await execute(
      approvalWorkflow(),
      {},
      {
        skills: createSkillMap(t.skills),
        claude: agent.claude,
        config: {},
        logger: silent,
        env: {},
      },
    );
    expect(t.sent).toEqual([]);
    const notify = results.get("notify")!;
    expect(notify.status).toBe("failed");
    expect(notify.outputs).toEqual([
      expect.objectContaining({ type: "slack_message", status: "refused", reason: "approval needs a run journal" }),
    ]);
  });
});

describe("approval mode across a crash (#576)", () => {
  it("a bundle written before its visit ended is an orphan; the resumed visit freezes the same bytes and names them", async () => {
    process.env.SWENY_STATE_DIR = tmp("sweny-state-");
    const cwd = tmp("sweny-ws-");
    const wf = approvalWorkflow();
    const t = fakeTransports();
    const agent = fakeAgent({ notify: [SLACK, EMAIL] });
    const opts = { skills: createSkillMap(t.skills), claude: agent.claude, config: {}, logger: silent, cwd, env: {} };
    const journal = RunJournal.create({
      runId: RUN_ID,
      cwd,
      workflowFile: "store.yml",
      faults: {
        beforeAppend(rec: JournalRecord) {
          if (rec.type === "node:end" && rec.node === "notify") throw new Kill("node:end notify");
        },
      },
    });
    await expect(execute(wf, {}, { ...opts, journal })).rejects.toThrow(Kill);
    // A killed process leaves its lock behind with a pid that no longer runs.
    writeFileSync(
      join(journalDir(cwd, RUN_ID), "lock"),
      JSON.stringify({ pid: 2 ** 31 - 1, started: 0, nonce: "dead" }),
    );
    const [orphan] = bundlesOf(cwd);
    const digest = orphan.replace(/\.json$/, "");

    const early = publish(cwd, true);
    const before = await early.run();
    expect(before).toEqual({ bundles: [], orphans: [digest] });
    expect(early.sent).toEqual([]);

    const prepared = prepareResume(RUN_ID, {}, { cwd, loadWorkflow: () => wf });
    if (!prepared.ok || "planOnly" in prepared) throw new Error("resume refused");
    const { results } = await execute(wf, prepared.ctx.input, { ...opts, journal: prepared.ctx.journal });
    prepared.ctx.journal.end("success");
    expect(agent.calls.filter((c) => c === "notify")).toHaveLength(1);
    expect(bundlesOf(cwd)).toEqual([orphan]);
    expect(results.get("notify")!.outputs!.map((o) => o.digest)).toEqual([digest, digest]);
    expect(t.sent).toEqual([]);

    const p = publish(cwd, true);
    const out = await p.run();
    expect(out.orphans).toEqual([]);
    expect(out.bundles[0]).toMatchObject({ digest, state: "published" });
    expect(p.sent.map((s) => s.tool)).toEqual(["slack_send_message", "notify_email"]);
  });
});

describe("sweny publish: the CLI publisher (#576)", () => {
  async function produced() {
    process.env.SWENY_STATE_DIR = tmp("sweny-state-");
    const cwd = tmp("sweny-ws-");
    await produce(cwd, approvalWorkflow(), { notify: [SLACK, EMAIL] });
    const [file] = bundlesOf(cwd);
    const digest = file.replace(/\.json$/, "");
    const bundle = JSON.parse(readFileSync(join(journalDir(cwd, RUN_ID), BUNDLES_DIR, file), "utf-8"));
    return { cwd, digest, bundle };
  }

  it("without approve it prints the exact arguments and sends nothing", async () => {
    const { cwd, digest } = await produced();
    const p = publish(cwd, false);
    const out = await p.run();
    expect(p.sent).toEqual([]);
    expect(out.bundles).toEqual([expect.objectContaining({ digest, node: "notify", state: "awaiting approval" })]);
    const text = p.lines.join("\n");
    expect(text).toContain(digest);
    expect(text).toContain(JSON.stringify({ channel: "C0OPS", text: SLACK.body }));
    expect(text).toContain(JSON.stringify({ to: "ops@acme.test", subject: EMAIL.title, text: EMAIL.body }));
  });

  it("with approve it sends each write once, byte for byte, with receipts", async () => {
    const { cwd, digest, bundle } = await produced();
    const p = publish(cwd, true);
    const out = await p.run();
    expect(p.sent).toEqual(bundle.writes.map((w: { tool: string; args: object }) => ({ tool: w.tool, args: w.args })));
    expect(out.bundles[0]).toMatchObject({ digest, state: "published", approver: "local:nate" });
    expect(out.bundles[0].receipts).toEqual([
      expect.objectContaining({ n: 0, type: "slack_message", status: "sent" }),
      expect.objectContaining({ n: 1, type: "email", status: "sent", ref: "<msg-2@test>" }),
    ]);
  });

  it("sends a GitHub write's frozen body as is: no second marker", async () => {
    process.env.SWENY_STATE_DIR = tmp("sweny-state-");
    const cwd = tmp("sweny-ws-");
    const wf = approvalWorkflow({
      nodes: {
        draft: { name: "Draft", instruction: "NODE:draft", skills: [], permissions: "read" },
        notify: {
          name: "Notify",
          instruction: "NODE:notify",
          skills: ["github"],
          outputs: [{ type: "comment", target: "acme/api", number: 7 }],
        },
      },
    });
    await produce(cwd, wf, { notify: [{ type: "comment", body: "Drafts ready" }] });
    const [file] = bundlesOf(cwd);
    const bundle = JSON.parse(readFileSync(join(journalDir(cwd, RUN_ID), BUNDLES_DIR, file), "utf-8"));
    const p = publish(cwd, true);
    await p.run();
    expect(p.sent).toEqual([{ tool: "github_add_comment", args: bundle.writes[0].args }]);
    expect((p.sent[0].args.body as string).match(/sweny-output/g)).toHaveLength(1);
  });

  it("a second publish sends nothing", async () => {
    const { cwd } = await produced();
    const first = publish(cwd, true);
    await first.run();
    expect(first.sent).toHaveLength(2);
    const second = publish(cwd, true);
    const out = await second.run();
    expect(second.sent).toEqual([]);
    expect(out.bundles[0].state).toBe("already published");
    expect(out.bundles[0].receipts!.map((r) => r.status)).toEqual(["sent", "sent"]);
  });

  it("a crash between a send and its receipt leaves that write unknown, and it is not resent", async () => {
    const { cwd } = await produced();
    const crash = publish(cwd, true, {
      faults: {
        afterSend(n) {
          if (n === 0) throw new Kill("after send 0");
        },
      },
    });
    await expect(crash.run()).rejects.toThrow(Kill);
    expect(crash.sent).toHaveLength(1);

    const again = publish(cwd, true);
    const out = await again.run();
    expect(again.sent).toEqual([]);
    expect(out.bundles[0].state).toBe("already published");
    expect(out.bundles[0].receipts).toEqual([
      expect.objectContaining({ n: 0, type: "slack_message", status: "unknown", reason: "not resent" }),
      expect.objectContaining({ n: 1, type: "email", status: "not sent" }),
    ]);
    expect(again.lines.join("\n")).toMatch(/unknown: not resent/);
  });

  it("refuses a bundle whose bytes no longer match its digest", async () => {
    const { cwd, digest } = await produced();
    const file = join(journalDir(cwd, RUN_ID), BUNDLES_DIR, `${digest}.json`);
    writeFileSync(file, readFileSync(file, "utf-8").replace("C0OPS", "C0EVIL"));
    const p = publish(cwd, true);
    const out = await p.run();
    expect(p.sent).toEqual([]);
    expect(out.bundles[0]).toMatchObject({ state: "refused", reason: "bundle bytes do not match its digest" });
  });

  it("refuses an orphan bundle the run's journal never named", async () => {
    const { cwd, bundle } = await produced();
    const forged = JSON.stringify({
      ...bundle,
      writes: [{ ...bundle.writes[0], args: { channel: "C0EVIL", text: "x" } }],
    });
    const orphan = sha256(forged);
    writeFileSync(join(journalDir(cwd, RUN_ID), BUNDLES_DIR, `${orphan}.json`), forged);
    const p = publish(cwd, true);
    const out = await p.run();
    expect(out.orphans).toEqual([orphan]);
    expect(p.sent.map((s) => s.args.channel ?? s.args.to)).toEqual(["C0OPS", "ops@acme.test"]);
  });

  it("refuses an expired bundle", async () => {
    const { cwd } = await produced();
    const p = publish(cwd, true, { now: () => Date.now() + 8 * 86_400_000 });
    const out = await p.run();
    expect(p.sent).toEqual([]);
    expect(out.bundles[0]).toMatchObject({ state: "refused", reason: "bundle expired" });
  });

  it("refuses a run whose agent ran unsandboxed", async () => {
    process.env.SWENY_STATE_DIR = tmp("sweny-state-");
    const cwd = tmp("sweny-ws-");
    await produce(cwd, approvalWorkflow(), { notify: [SLACK] }, false);
    const p = publish(cwd, true);
    const out = await p.run();
    expect(p.sent).toEqual([]);
    expect(out.bundles[0]).toMatchObject({
      state: "refused",
      reason: "the run had an agent without an enforced sandbox",
    });
  });

  it("refuses an approver the workflow's approvers list does not name", async () => {
    process.env.SWENY_STATE_DIR = tmp("sweny-state-");
    const cwd = tmp("sweny-ws-");
    await produce(
      cwd,
      approvalWorkflow({ safe_outputs: { approval: { required: true, approvers: ["local:someone-else"] } } }),
      {
        notify: [SLACK],
      },
    );
    const p = publish(cwd, true);
    const out = await p.run();
    expect(p.sent).toEqual([]);
    expect(out.bundles[0]).toMatchObject({ state: "refused", reason: "approver not trusted" });
    // Refused before consuming: a trusted approver can still publish it.
    const ok = publishRun({
      runId: RUN_ID,
      cwd,
      approve: true,
      skills: createSkillMap(fakeTransports().skills),
      config: {},
      logger: silent,
      user: "someone-else",
      print: () => {},
    });
    expect((await ok).bundles[0].state).toBe("published");
  });
});

describe("slack_message and email outputs: schema (#576)", () => {
  const node = (outputs: unknown, top: Record<string, unknown> = { spec_version: "3" }) =>
    ({
      ...top,
      id: "w",
      name: "w",
      description: "",
      entry: "a",
      nodes: { a: { name: "a", instruction: "x", skills: ["slack", "notification"], outputs } },
      edges: [],
    }) as unknown as Workflow;

  it("accepts slack_message and email with a pinned target", () => {
    const errors = validateWorkflow(
      node([
        { type: "slack_message", target: "C0OPS" },
        { type: "email", target: { input: "to" } },
      ]),
    );
    expect(errors).toEqual([]);
  });

  it("refuses slack_message or email without a pinned target: the destination is never the agent's", () => {
    const errors = validateWorkflow(node([{ type: "slack_message" }, { type: "email" }]));
    expect(errors.map((e) => e.message).join("\n")).toMatch(/slack_message.*must pin target/);
    expect(errors.map((e) => e.message).join("\n")).toMatch(/email.*must pin target/);
  });

  it("slack_message, email and safe_outputs.approval need spec_version 3", () => {
    const errors = validateWorkflow(
      node([{ type: "slack_message", target: "C0OPS" }], {
        spec_version: "2",
        safe_outputs: { approval: { required: true } },
      }),
    );
    const text = errors.map((e) => e.message).join("\n");
    expect(text).toMatch(/output "slack_message" needs spec_version "3"/);
    expect(text).toMatch(/safe_outputs\.approval needs spec_version "3"/);
  });

  it("parses safe_outputs.approval with expires and approvers", () => {
    const wf = parseWorkflow({
      id: "w",
      name: "w",
      spec_version: "3",
      entry: "a",
      safe_outputs: { approval: { required: true, expires: "2d", approvers: ["local:nate"] } },
      nodes: {
        a: { name: "a", instruction: "x", skills: ["slack"], outputs: [{ type: "slack_message", target: "C1" }] },
      },
      edges: [],
    });
    expect(wf.safe_outputs?.approval).toEqual({ required: true, expires: "2d", approvers: ["local:nate"] });
    expect(() =>
      parseWorkflow({
        id: "w",
        name: "w",
        spec_version: "3",
        entry: "a",
        safe_outputs: { approval: { required: true, expires: "soon" } },
        nodes: { a: { name: "a", instruction: "x", skills: [] } },
        edges: [],
      }),
    ).toThrow();
  });
});

describe("notify_email: email over SMTP_URL through nodemailer (#576)", () => {
  const tool = () => notification.tools.find((t) => t.name === "notify_email")!;

  it("is a write tool that sends exactly to, subject and text from SMTP_FROM over SMTP_URL", async () => {
    mail.urls.length = 0;
    mail.sent.length = 0;
    expect(tool().access).toBe("write");
    const out = await tool().handler(
      { to: "ops@acme.test", subject: "Morning prompts", text: "Three drafts." },
      { config: { SMTP_URL: "smtps://u:p@smtp.acme.test:465", SMTP_FROM: "sweny@acme.test" }, logger: silent },
    );
    expect(mail.urls).toEqual(["smtps://u:p@smtp.acme.test:465"]);
    expect(mail.sent).toEqual([
      { from: "sweny@acme.test", to: "ops@acme.test", subject: "Morning prompts", text: "Three drafts." },
    ]);
    expect(out).toMatchObject({ id: "<real-1@smtp.test>" });
  });

  it("refuses to send without SMTP_URL or a from address", async () => {
    mail.sent.length = 0;
    await expect(
      tool().handler(
        { to: "a@b.test", subject: "s", text: "t" },
        { config: { SMTP_FROM: "x@y.test" }, logger: silent },
      ),
    ).rejects.toThrow(/SMTP_URL/);
    await expect(
      tool().handler(
        { to: "a@b.test", subject: "s", text: "t" },
        { config: { SMTP_URL: "smtp://smtp.test" }, logger: silent },
      ),
    ).rejects.toThrow(/SMTP_FROM/);
    expect(mail.sent).toEqual([]);
  });
});
