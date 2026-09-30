---
title: Agent sandbox
description: What the agent subprocess can see and reach, the sandbox modes, and how to override them.
---

Every node runs headless Claude Code over input that may be attacker-controlled: issue bodies, alert payloads, fetched pages, earlier steps' output. SWEny bounds what that agent can see and reach in three ways.

## Scoped environment

The agent subprocess no longer inherits your full environment. It gets:

| Always | Why |
|--------|-----|
| `PATH`, `HOME`, `USER`, `LOGNAME`, `SHELL`, `TERM`, `TMPDIR`/`TMP`/`TEMP`, `XDG_*_HOME`, `XDG_RUNTIME_DIR` (and the Windows equivalents) | Process basics |
| `LANG`, `LANGUAGE`, `LC_*`, `TZ` | Locale and time |
| `HTTP(S)_PROXY`, `NO_PROXY`, `ALL_PROXY` (both cases), `NODE_EXTRA_CA_CERTS`, `SSL_CERT_FILE`, `SSL_CERT_DIR` | Corporate egress |
| `CI`, `GITHUB_ACTIONS`, `GITHUB_REPOSITORY`, `GITHUB_SHA`, `GITHUB_REF`, `GITHUB_RUN_ID`, `RUNNER_OS`, and similar CI identity vars (never tokens) | CI context |
| `ANTHROPIC_*`, `CLAUDE_*` | The agent's own auth and backend config, after [`SWENY_AUTH`](/advanced/model-gateway/) precedence |
| `AWS_*` when `CLAUDE_CODE_USE_BEDROCK` is set; `GOOGLE_APPLICATION_CREDENTIALS`, `CLOUD_ML_REGION`, `GOOGLE_CLOUD_PROJECT` when `CLAUDE_CODE_USE_VERTEX` is set | Cloud-hosted Claude |
| Claude Code knobs: `MAX_THINKING_TOKENS`, `MCP_TIMEOUT`, `MCP_TOOL_TIMEOUT`, `BASH_DEFAULT_TIMEOUT_MS`, `BASH_MAX_TIMEOUT_MS`, `DISABLE_*` | Runtime tuning |

| Per node | |
|----------|---|
| Every env var declared by the node's skills (for example `GITHUB_TOKEN` for a node with `skills: [github]`) | So `gh` and friends work where the node asked for them |
| Your `env-passthrough` list | Anything else a node's commands need |

Everything else is dropped. A node without the `linear` skill never sees `LINEAR_API_KEY`; nothing sees `NPM_TOKEN` unless you pass it through.

MCP servers that SWEny wires for a skill get their credentials explicitly, so they keep working.

## Sandbox

By default (`sandbox: auto`, locally and in CI), the agent's shell commands run in the Claude Code sandbox whenever the host supports it:

- Network egress is limited to an allowlist: source hosting and package registries (`github.com`, `api.github.com`, `*.githubusercontent.com`, `registry.npmjs.org`, `pypi.org`, `proxy.golang.org`, `crates.io`, `rubygems.org`, ...), plus the provider hosts of the node's skills (`api.linear.app` for `linear`, `*.sentry.io` for `sentry`, `*.datadoghq.com` for `datadog`, ...), plus your `sandbox-allowed-domains`.
- Commands cannot opt out of the sandbox.
- The agent's own Anthropic credentials are unset inside sandboxed commands, and `~/.claude/.credentials.json` is unreadable.

The sandbox needs macOS, or Linux with `bubblewrap` and `socat` installed and able to create user namespaces. The `swenyai/sweny` Action installs both on Linux runners for you. Elsewhere:

```bash
sudo apt-get install -y bubblewrap socat
```

Three modes:

| Mode | Host supports the sandbox | Host does not |
|------|---------------------------|---------------|
| `auto` (default) | Sandboxed | One loud warning naming what is missing, then runs **unsandboxed**. Unattended CI never breaks on a missing dependency. |
| `strict` | Sandboxed | The node **fails closed** with the same message. Never runs unsandboxed. |
| `off` | Not sandboxed | Not sandboxed |

Env scoping and untrusted-input fencing apply in every mode.

On Ubuntu 23.10 and later, AppArmor can block the unprivileged user namespaces bubblewrap needs. SWEny reports this in the warning. The fix is `sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0`, which changes a host kernel setting, so the Action only applies it when you set `SWENY_SANDBOX: strict` in the step's `env`.

:::note[Scope]
The sandbox covers the agent's shell commands. SWEny's own skill tools run in the SWEny process, and MCP servers run outside the sandbox; both only receive the credentials wired for them.
:::

## Untrusted input

Workflow input (issues, alerts, tickets), earlier steps' output, and `context:` sources (including fetched URLs) reach the model inside a delimited `<untrusted-data>` block with an instruction not to follow instructions inside it. Your workflow and node `instruction` and `rules` stay outside the block. This lowers prompt-injection risk; it does not remove it, which is why the env and network limits above exist.

## Configuration

`.sweny.yml`, or the matching env var (env wins):

| `.sweny.yml` | Env var | Values | Default |
|--------------|---------|--------|---------|
| `sandbox` | `SWENY_SANDBOX` | `auto`, `strict`, `off` (see [Sandbox](#sandbox)) | `auto` |
| `sandbox-allowed-domains` | `SWENY_SANDBOX_ALLOWED_DOMAINS` | List of hosts; `*.example.com` wildcards allowed | none |
| `env-passthrough` | `SWENY_ENV_PASSTHROUGH` | List of env var names; `"*"` inherits everything (not recommended) | none |

```yaml
# .sweny.yml
sandbox: auto
sandbox-allowed-domains: [internal.example.com]
env-passthrough: [NPM_TOKEN]
```

In the GitHub Action, set the env vars on the step:

```yaml
- uses: swenyai/sweny@v5
  env:
    SWENY_SANDBOX_ALLOWED_DOMAINS: internal.example.com
    SWENY_ENV_PASSTHROUGH: NPM_TOKEN
    NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
```
