---
title: Resume a run
description: Pick up a killed or failed workflow run where it stopped, without re-running finished nodes or repeating writes.
---

Every `sweny workflow run` writes a journal. When a run is killed (Ctrl-C, a lost laptop lid, a CI timeout) or fails on one node, resume it:

```bash
sweny workflow resume 20260930-142233-9f1c2a
```

Finished nodes are replayed from the journal without calling the agent. The first unfinished node runs again. Writes that already happened are not sent twice.

## What a resume does

```text
  Resume run 20260930-142233-9f1c2a (workflow triage, attempt 2)
    ✓ gather        replay from journal (success)
    ✓ investigate   replay from journal (success)
    ↻ report        write stage only: agent result reused; 1 write(s) to confirm on the provider first
    ▶ notify        run (not started before the crash)
```

| Mark | Meaning |
|------|---------|
| `✓` replay | The node finished. Its result, eval verdicts and safe-output receipts come from the journal. Its agent is not called. |
| `↻` write stage only | The agent finished and its result passed every eval, but the run stopped while sweny was applying the node's [safe outputs](/workflows/yaml-reference/#permissions-and-safe-outputs). The agent is not called again. Each write is checked against the journal and, if needed, the provider (see below). |
| `▶` run | The node never finished, so it runs from the start. |

Routing is replayed too: the edge a finished node took is read from the journal, so an LLM route decision is not asked again.

Preview the plan without running anything:

```bash
sweny workflow resume <run-id> --plan
```

A unique prefix of the run id is enough. `sweny runs` lists recent runs.

## Writes are not repeated

A write through safe outputs (`outputs:` on a node) gets an idempotency key built from the node, its visit, the tool and the exact arguments. Before the call sweny journals the key, after the call it journals what the call produced. On resume:

- **Key with a receipt**: the write is not sent. The receipt (issue number, URL) is reused.
- **Key without a receipt**: the process died between the API call and the receipt. sweny looks for the write on the provider before sending anything. Issue and comment bodies carry a hidden marker with the key (`<!-- sweny-output ... -->`), which sweny finds with GitHub issue search, Linear issue search, or the Linear issue's comment list. Label and state changes, and pull requests for the same branch, are idempotent and are simply applied again.
- **Cannot confirm** (the lookup failed or the provider has no lookup): the node fails instead of risking a duplicate. Check the target, then resume with `--allow-repeat-writes`.

Nodes that write outside safe outputs (an agent with write tools, shell or `git push`) are different: sweny cannot see what the agent did before the crash. If such a node had started, the plan flags it as **may repeat writes** and the resume refuses until you pass `--allow-repeat-writes`. Nodes with `permissions: read` or `outputs:` are never flagged.

## When a resume is refused

| Refusal | Why | What to do |
|---------|-----|-----------|
| workflow changed | The workflow file differs from the one the run started with. Mixing results from two workflows is not a resume. | Start a new run, or `--force` (warns). |
| instructions, rules or context files changed | A `file:` or `url:` Source resolved to different text. | Same. |
| configured skills, agent or sweny version changed | Different tools could have produced different results. | Same. |
| input differs, or the journal redacted it | The input held secrets, so the journal kept a redacted copy. | Pass the same `--input` JSON again. |
| may repeat writes | A node that writes outside safe outputs had started. | Check what it did, then `--allow-repeat-writes`. |
| already finished successfully | Nothing to resume. | Nothing. |
| damaged journal | A record in the middle of the file fails its checksum. | Start a new run. |
| in use by process N | Another resume of the same run is still running. | Wait for it, or stop it. |

## The journal

Location: `.sweny/runs/<run-id>/journal.ndjson`, next to the run's history record. One JSON record per line, each with a format version, a sequence number and a checksum. Every record is fsync'd before the run moves on.

- **Torn last record** (power loss mid-write): dropped on resume, with a note. The run resumes from the last whole record.
- **Damage in the middle**: refused, never "repaired" by cutting valid records.
- **What it holds**: workflow, instruction, input and tool hashes, the run input, each node's result data and eval verdicts, safe-output intents and receipts, and routing decisions. Not tool call inputs or outputs.
- **What it never holds**: environment values. Secret-looking keys (`token`, `secret`, `password`, `api_key`, ...), known token shapes, and the values of secret environment variables and skill credentials are replaced with `[redacted]`.
- **Git**: each run directory has a `.gitignore` of `*`, so an agent's `git add -A` never commits a journal.
- **Retention**: the 20 most recent journals are kept.

Turn it off with `--no-journal`, or `journal: off` in `.sweny.yml`. A run without a journal cannot be resumed.

## In GitHub Actions

A fresh runner starts without `.sweny/runs/`, so the Action cannot resume yet. Persisting the journal between workflow attempts is planned.

## Options

| Option | Description |
|--------|-------------|
| `--plan` | Print the plan and exit. A torn record is reported, not cut. |
| `--force` | Resume although the workflow, instruction files, input or tools changed. Warns. |
| `--allow-repeat-writes` | Re-run nodes flagged as may repeat writes, and re-send writes whose outcome cannot be confirmed. |
| `--workflow <file>` | Load the workflow from here, when the file moved. Its content must still match. |
| `--input <json>` | The original input, when the journal redacted it. Must match the original. |

`--timeout`, `--max-steps`, `--json`, `--stream`, `--verbose`, `--mermaid`, `--comment-file`, `--agent`, `--harness-policy` and `--no-history` work as on [`sweny workflow run`](/cli/commands/#sweny-workflow-run).
