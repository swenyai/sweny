---
title: Agent sandbox
description: What the agent subprocess can see and reach, the sandbox modes, and how to override them.
---

Every node runs a coding agent (headless Claude Code by default) over input that may be attacker-controlled: issue bodies, alert payloads, fetched pages, earlier steps' output. SWEny bounds what that agent can see and reach in three ways.

## Scoped environment

In CI (`CI=true`) the agent subprocess does not inherit your full environment. Locally it does, as before, so workflows that rely on `DATABASE_URL`, `BASE_URL`, `NODE_ENV` and friends keep working. `env-scope: on|off` (`SWENY_ENV_SCOPE`) overrides the default in either place.

When scoped, the agent gets:

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
| Your `env-passthrough` list | Anything else a node's commands need (never a skill credential, see below) |
| The node's `agent_env` list | A skill credential this one node's shell genuinely needs |

Everything else is withheld. Nothing sees `NPM_TOKEN` unless you pass it through. Add any a node needs to `env-passthrough`.

### Skill credentials stay in SWEny

Skill tools (`github_*`, `linear_*`, ...) run in the SWEny process, so the agent never needs their credentials. On every agent (`claude`, `codex`, `pi`, ACP), scoped or not, locally and in CI, the agent process never receives `GITHUB_TOKEN`, `GH_TOKEN`, GitLab and Bitbucket tokens, `LINEAR_API_KEY`, `SLACK_*`, or any config variable of a skill the run uses. `env-passthrough` (even `"*"`) does not bring them back.

A node whose own shell needs one (say, a script that calls an API sweny has no skill for) names it in `agent_env`:

```yaml
nodes:
  publish:
    permissions: write
    agent_env: [GITHUB_TOKEN]
```

That node's agent process gets the secret and can use it outside sweny's opinions: any API call, any push, none of it gated by `permissions`, `outputs` or `tools.deny`. Only that node gets it. A `permissions: read` node cannot declare `agent_env` (the workflow fails to load), and a staged or dry run withholds it. The built-in workflows need none: `github_create_pr` pushes the PR's head branch itself, from the SWEny process, with the `github` skill's `GITHUB_TOKEN`, before it opens the PR. Locally, your own git credential helper still works too.

### The checkout's persisted token

By default `actions/checkout` keeps the job token on disk (`persist-credentials: true`): in `.git/config` (v4, v5) or in a file under `$RUNNER_TEMP` that `.git/config` includes (v6 and later). Env scoping cannot reach a file, so any agent that can read the repo could read a token that pushes to it. Check out without it:

```yaml
permissions:
  contents: write       # sweny pushes the PR branch with this token
  pull-requests: write
  issues: write

steps:
  - uses: actions/checkout@v4
    with:
      persist-credentials: false
      fetch-depth: 0
  - uses: swenyai/sweny@v5
    with:
      workflow: triage
      claude-oauth-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
    env:
      GITHUB_TOKEN: ${{ github.token }}   # the github skill's token; sweny pushes and opens the PR with it
```

With that, no agent holds a push credential: the built-in `create_pr` node's own `git push` fails and SWEny pushes the head branch: only when every `origin` URL (fetch and push) is the PR's own repo, to that repo's URL on the GitHub server with an explicit refspec, never forced, never the base or default branch. The push runs from a private copy of the branch with no system, global or repository git config and no hooks, so nothing the agent wrote in the checkout runs while the token is in use. It needs `GITHUB_TOKEN`; an ssh `origin` is pushed over https with it. A custom node whose shell must push itself declares `agent_env: [GITHUB_TOKEN]` and runs `gh auth setup-git` (or uses a credential helper that reads the token) before `git push`.

When a run does start with a persisted credential (an `http.*.extraheader`, a credential helper holding a token, a `store` helper's file, or a URL with a password or token in it, in the repo, worktree or global git config or any file they include), SWEny warns once with the file and key (never the value), then keeps it from every read-only and staged node's agent:

| Agent | Read-only and staged nodes |
|-------|----------------------------|
| `claude` | `Read(...)` deny rules for the file (Read, Grep, Glob). A read-only node has no Bash. A staged node's Bash needs the sandbox, whose filesystem `denyRead` and `denyWrite` cover the file; with no sandbox the node is reported `degraded`, and refused under a strict harness policy. |
| `codex`, `pi`, ACP | The process sandbox (`srt`) denies reads and writes of the file. With no sandbox the node is reported `degraded`, and refused under a strict harness policy. |

On Linux the masked file reads as empty, so `git` in that node sees no remotes for a v4/v5 checkout; on macOS reading it fails. `persist-credentials: false` avoids both. Default write nodes are not masked: they keep today's behavior.

CI images set many variables of their own (`ANDROID_HOME`, `CHROME_BIN`, `JAVA_HOME_*`, `DOTNET_*`, `ACTIONS_*`, `RUNNER_*`, `ACCEPT_EULA`, and so on). SWEny treats these as the runner baseline and does not warn about them. Once per process it logs one plain line:

```
sweny: agent env scoped (128 withheld, 120 from the CI image). Add names to env-passthrough if a node needs them; --verbose lists them.
```

Only when a variable outside the baseline is withheld (for example `DATABASE_URL` or `NPM_TOKEN`) does SWEny also emit a warning (a `::warning::` annotation under GitHub Actions) listing just those names, names only, never values, sorted and capped at 30. `--verbose` lists every withheld name, baseline included.

MCP servers that SWEny wires for a skill get their credentials explicitly, so they keep working.

## Sandbox

In CI (`CI=true`) the default is `sandbox: auto`: the agent's shell commands run sandboxed whenever the host supports it (Claude Code's own sandbox; for pi, ACP agents and other agents without one, SWEny wraps the whole agent process in its process sandbox). Locally the default is `off`, so nothing changes on your laptop (private registries, docker, cargo and go keep working) unless you opt in. When sandboxed:

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
| `auto` (default in CI) | Sandboxed | One loud warning naming what is missing, then runs **unsandboxed**. Unattended CI never breaks on a missing dependency. |
| `strict` | Sandboxed | The node **fails closed** with the same message. Never runs unsandboxed. |
| `off` (default locally) | Not sandboxed | Not sandboxed |

Env scoping is controlled separately by `env-scope`. Untrusted-input fencing always applies.

On Ubuntu 23.10 and later, AppArmor can block the unprivileged user namespaces bubblewrap needs, and GitHub-hosted `ubuntu-24.04` runners do. Ubuntu 26.04 (GitHub's `ubuntu-26.04` image, which `ubuntu-latest` now runs) also loads the `bwrap-userns-restrict` AppArmor profile, which denies every capability to the processes bubblewrap starts, so the sandbox's seccomp helper fails with `apply-seccomp: write /proc/self/setgroups ... Permission denied`. On GitHub-hosted runners (ephemeral VMs) the Action relaxes both by default (`scripts/sandbox-userns.sh`), so agents are sandboxed there with no setup:

```bash
sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0
sudo apparmor_parser -R /etc/apparmor.d/bwrap-userns-restrict   # only where the profile exists
```

The profile unload works around [anthropics/sandbox-runtime#429](https://github.com/anthropics/sandbox-runtime/issues/429) and goes away once a fixed sandbox runtime is pinned.

On self-hosted runners those settings belong to a persistent host, so the Action only changes them when you set `SWENY_SANDBOX: strict` in the step's `env`; otherwise `auto` warns and runs unsandboxed. `off` never touches them.

:::note[Scope]
The sandbox covers the agent's shell commands. SWEny's own skill tools run in the SWEny process, and MCP servers run outside the sandbox; both only receive the credentials wired for them.
:::

## Untrusted input

Workflow input (issues, alerts, tickets), earlier steps' output, and `context:` sources (including fetched URLs) reach the model inside a delimited `<untrusted-data>` block with an instruction not to follow instructions inside it. Your workflow and node `instruction` and `rules` stay outside the block. This lowers prompt-injection risk; it does not remove it, which is why the env and network limits above exist.

## Configuration

`.sweny.yml`, or the matching env var (env wins):

| `.sweny.yml` | Env var | Values | Default |
|--------------|---------|--------|---------|
| `sandbox` | `SWENY_SANDBOX` | `auto`, `strict`, `off` (see [Sandbox](#sandbox)) | `auto` in CI, `off` locally |
| `sandbox-allowed-domains` | `SWENY_SANDBOX_ALLOWED_DOMAINS` | List of hosts; `*.example.com` wildcards allowed | none |
| `env-scope` | `SWENY_ENV_SCOPE` | `on`, `off` | `on` in CI, `off` locally |
| `env-passthrough` | `SWENY_ENV_PASSTHROUGH` | List of env var names; `"*"` inherits everything except skill credentials (not recommended) | none |
| `pi-provider` | `SWENY_PI_PROVIDER` | The pi model provider (`anthropic`, `openai`, `amazon-bedrock`, ...); only its key reaches pi | the model's `provider/` prefix, else the only provider whose key is set |

```yaml
# .sweny.yml
sandbox: strict
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

### Library use

When you call `execute()` yourself, each harness also takes `env` and `envRemove`, for giving one run its own login or home without touching `process.env`:

```ts
import { createHarness, execute } from "@sweny-ai/core";

const harness = createHarness("claude-code", {
  env: { HOME: runHome, CLAUDE_CONFIG_DIR: `${runHome}/.claude` },
  // use the login under CLAUDE_CONFIG_DIR, not the parent's credentials
  envRemove: ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN"],
});
await execute(workflow, input, { skills, harness });
```

`execute()`'s own `env` option is different: it is the environment SWEny itself reads (skill config, `context:` Source auth, the run's identity) and never reaches the agent. To change the agent's environment, use the harness options.

`envRemove` names are dropped after scoping and passthrough, then `env` is laid on top. Then:

- The skill credential rule still applies: an overlaid `GITHUB_TOKEN` or `SLACK_*` reaches the agent only on a node that grants it with `agent_env`.
- When `env` sets one of the agent's own credentials, the inherited ones are dropped, so a parent key cannot sit beside the run's login. Those are `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` for Claude Code; `CODEX_API_KEY`, `CODEX_ACCESS_TOKEN` and `OPENAI_API_KEY` for Codex; the provider keys for pi; your `authVars` for ACP. `HOME`, `CLAUDE_CONFIG_DIR` and `CODEX_HOME` are not credentials and drop nothing: remove inherited keys with `envRemove`, as above.
- Under the sandbox, the login files an overlaid `HOME`, `CLAUDE_CONFIG_DIR` or `CODEX_HOME` selects are denied like the host's. For Claude Code that covers its shell commands; the agent itself still reads its login. Codex, pi and ACP agents run inside the process sandbox with a scratch `HOME` (an overlaid `HOME` does not reach them), so a login file is unreadable to the agent itself: give a sandboxed Codex run `CODEX_API_KEY` or `OPENAI_API_KEY` in `env`.

Staged and dry runs still apply the push block on top. `SWENY_*` names in `env` reach the agent only; SWEny reads its own settings from `process.env`. Both options hold for every node and every judge and route call on that harness instance, so build one harness per run when runs need different envs. The same options work on `codex`, `pi` and `acp:` harnesses.
