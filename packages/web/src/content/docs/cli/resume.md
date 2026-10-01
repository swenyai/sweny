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

Routing is replayed too: the edge a finished node took is read from the journal, so neither a model route decision nor a `when: { expr }` expression is decided again.

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
| workflow changed | The workflow file (including its `spec_version`) differs from the one the run started with. Mixing results from two workflows is not a resume. | Start a new run, or `--force` (warns). |
| instructions, rules or context files changed | A `file:` or `url:` Source resolved to different text. | Same. |
| configured skills, agent or sweny version changed | Different tools could have produced different results. The fingerprint covers each skill's id, name, description, category, instruction, config field names and their env var names, every tool's name, description, input schema, access class and a digest of its handler source, the MCP server's type, command, args, URL, env var names and header names, the agent, and the sweny version. Secret values are never part of it (MCP env and header values are left out, args are redacted first), so rotating a token is not a change. | Same. |
| input differs, or the journal redacted it | The input held secrets, so the journal kept a redacted copy. | Pass the same `--input` JSON again. |
| may repeat writes | A node that writes outside safe outputs had started. | Check what it did, then `--allow-repeat-writes`. |
| already finished successfully | Nothing to resume. | Nothing. |
| damaged journal | A record in the middle of the file is unreadable. | Start a new run. |
| fails authentication | A whole record does not match the run's key: it was edited or written by something other than the run. | Start a new run. |
| impossible record sequence, or a route that is not an edge | The journal describes control flow the executor never writes (a record after `run:end`, a node that no route pointed to, a second route for one visit), or a route the workflow does not have or whose `max_iterations` is used up. Not overridable by `--force`. | Start a new run. |
| key missing | The run's key is not in this user's state dir. | Resume as the user that started the run, or point `SWENY_STATE_DIR` at its state dir. |
| in use by process N | Another resume of the same run is still running. | Wait for it, or stop it. |

## The journal

Location: `.sweny/runs/<run-id>/journal.ndjson` (mode `0600`, in a `0700` run directory), next to the run's history record. One JSON record per line, each with a format version, a sequence number and an HMAC-SHA256 under a per-run key. Every record is fsync'd before the run moves on.

- **The key**: 32 random bytes made when the run starts, kept outside the workspace in `$SWENY_STATE_DIR/run-keys/` (default `$XDG_STATE_HOME/sweny/run-keys/`, else `~/.local/state/sweny/run-keys/`; directory `0700`, file `0600`). Anything that can write the workspace but not your state dir cannot forge a record a resume accepts. Sandboxed agents cannot read the key directory (the agent sandbox and the process sandbox both deny it), and the process sandbox also denies writes to `.sweny/runs/`. An agent running unsandboxed as your user can read the key, so resume also checks the record sequence and every replayed route against the workflow's edges. Journals written before keys existed (format v1) cannot be resumed.
- **Spend**: each agent attempt's token and cost usage is journaled as it is reported (live reports at most every 2 seconds, plus the final figure). A resume starts the run budget from that total, so `budget:` and `--max-tokens` / `--max-cost` cap the whole logical run, not each attempt.

- **Torn last record** (power loss mid-write): dropped on resume, with a note. The run resumes from the last whole record.
- **Damage in the middle**: refused, never "repaired" by cutting valid records.
- **What it holds**: workflow, instruction, input and tool hashes, the run input, each node's result data and eval verdicts, safe-output intents and receipts, and routing decisions. Not tool call inputs or outputs.
- **What it never holds**: environment values. Secret-looking keys (`token`, `secret`, `password`, `api_key`, ...), known token shapes, and the values of secret environment variables and skill credentials are replaced with `[redacted]`.
- **Git**: each run directory has a `.gitignore` of `*`, so an agent's `git add -A` never commits a journal.
- **Retention**: the 20 most recent journals are kept; pruning a journal deletes its run directory and its key.

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

`--timeout`, `--max-steps`, `--json`, `--stream`, `--verbose`, `--mermaid`, `--comment-file`, `--agent`, `--harness-policy`, `--show-output` and `--no-history` work as on [`sweny workflow run`](/cli/commands/#sweny-workflow-run).
