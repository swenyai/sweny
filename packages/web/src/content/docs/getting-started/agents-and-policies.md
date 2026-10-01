---
title: Agents and policies
description: Which coding agents SWEny runs on, how each is tested, and which policies each one enforces.
---

SWEny runs each node on a coding agent and applies one set of rules to it: scoped env, only the MCP servers SWEny injects, read-only dry runs, output checks, timeouts, untrusted-input fencing, cleanup. An agent is checked against the harness contract suite (22 cases, scripted fakes, no model calls) on every CI run.

## Status

| Agent | Status |
|-------|--------|
| Claude Code | Supported. Passes the 22-case contract suite on every CI run, with skill tools in process and over the tool bridge. |
| Codex | Shipped, contract suite green; not yet run against a live Codex. `--agent codex`, Codex CLI 0.159+. |
| pi | Experimental, contract suite green. `--agent pi`, pi 0.99.2+. Not run against a live pi yet. |
| ACP agents (OpenCode, Hermes, goose, Gemini CLI, ...) | Experimental. `--agent "acp:<command>"`. The suite runs against a scripted fake ACP agent only; no real agent is tested. |

Claude Code is the default. In the GitHub Action, set `agent: codex` to use Codex.

## What each agent enforces

| Policy | Claude Code | Codex |
|---|---|---|
| Scoped env (no stray secrets) | enforced | enforced |
| Read-only dry run | enforced | enforced (`--sandbox read-only`, no shell, web search or subagents) |
| Only the MCP servers SWEny injects | enforced | enforced (`--ignore-user-config`) |
| `tools.deny` tool classes | shell, write, edit, net, subagent | shell, net, subagent |
| Structured output (JSON schema) | enforced | enforced (`--output-schema`) |
| Tool call trace with status | enforced | enforced |
| Turn limit (`max_turns`) | enforced | SWEny watchdog over tool calls |
| Per-host egress allowlist | enforced when sandboxed | only inside the sandbox wrapper (srt); Codex's own network switch is on or off |
| Usage | tokens and cost | tokens |
| Timeout and cancel | enforced | enforced |

## Degraded and refused

What an agent cannot enforce itself is never dropped silently. It is listed as `degraded` in the log, the run receipt and `.sweny/runs/`. With `--harness-policy strict` (the default under GitHub Actions) the node is refused instead.

- **Codex:** `max_turns` (kept by the watchdog, never refused), `tools.deny: [write]` / `[edit]`, `disallowed_tools` names Codex has no tool for, and the per-host egress allowlist unless Codex runs inside the sandbox wrapper.
- **pi:** the process sandbox (pi has none; it runs only inside the sandbox wrapper, and strict refuses without it), `max_turns` (SWEny watchdog), `tools.deny: [net]`, and `disallowed_tools` names pi has no tool for. pi keeps read-only dry runs and `tools.deny` for shell, write, edit and subagent natively.
- **ACP agents:** most policies. ACP carries a prompt and a stream of updates, not SWEny's policies. There is no deny list, no structured output, no sandbox and no per-host egress. SWEny rejects permission requests for denied classes and non-read operations, parses and checks output itself, and runs the agent inside the sandbox wrapper when `SWENY_SANDBOX` is `auto` or `strict`.

The full per-agent detail lives in the [README](https://github.com/swenyai/sweny#agent-harnesses).
