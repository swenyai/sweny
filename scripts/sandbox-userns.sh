#!/usr/bin/env bash
# Host check and relaxation for the agent sandbox (bubblewrap, and srt on top of it).
# One implementation for action.yml's two sandbox steps and CI's sandbox jobs.
#
#   sandbox-userns.sh mode    Print the sandbox mode as core reads it (resolveSandboxMode in
#                             packages/core/src/agent-env.ts): SWENY_SANDBOX when it is a
#                             mode (off|false|0|no is off, strict|on|true|1 is strict, auto
#                             is auto, case and spaces ignored), else SWENY_SANDBOX_DEFAULT
#                             when it is a mode (the Action sets strict, #599), else auto
#                             when CI is truthy, else off. It does not read .sweny.yml.
#   sandbox-userns.sh explicit  Print SWENY_SANDBOX's mode when it is one, else nothing:
#                             strict here is the operator's choice, not the Action default.
#   sandbox-userns.sh probe   Exit 0 when bwrap can sandbox on this host: a plain
#                             bwrap run, then a user namespace nested inside bwrap,
#                             which srt's seccomp helper (apply-seccomp) needs. The
#                             nested run is skipped when there is no system unshare or
#                             it lacks --map-root-user (busybox).
#   sandbox-userns.sh hint    Print how to make this host sandbox, or opt out (#599): one
#                             line for the Action's warnings and errors.
#   sandbox-userns.sh relax   Relax the host's user-namespace restrictions. Only on a
#                             GitHub-hosted runner (ephemeral VM) or when SWENY_SANDBOX is
#                             strict (the Action's strict default does not count), never
#                             when the mode is off, and never by default on
#                             self-hosted (persistent host): exits 3 without touching
#                             anything there. Exits 0 once it has tried; run probe again
#                             to see whether it worked.
#
# bwrap and unshare are taken only from system directories and run by absolute path with
# an empty environment, never from PATH: a directory an agent can write may be on PATH.
set -u
PATH=/usr/sbin:/usr/bin:/sbin:/bin
export PATH

# Same as core's .trim().toLowerCase(): strip leading and trailing whitespace across
# lines (sed would trim each line separately, so "\noff" would not read as off).
lower() {
  local v=$1
  v=${v#"${v%%[![:space:]]*}"}
  v=${v%"${v##*[![:space:]]}"}
  printf '%s' "$v" | tr '[:upper:]' '[:lower:]'
}

# One mode value, or nothing when it is empty or not a mode.
parse_mode() {
  case "$(lower "$1")" in
    off | false | 0 | no) echo off ;;
    strict | on | true | 1) echo strict ;;
    auto) echo auto ;;
  esac
}

explicit() { parse_mode "${SWENY_SANDBOX:-}"; }

mode() {
  local m ci
  m=$(explicit)
  [ -z "$m" ] && m=$(parse_mode "${SWENY_SANDBOX_DEFAULT:-}")
  if [ -n "$m" ]; then
    echo "$m"
    return
  fi
  ci=$(lower "${CI:-}")
  case "$ci" in
    "" | 0 | false | no | off) echo off ;;
    *) echo auto ;;
  esac
}

sys_bin() {
  local d
  for d in /usr/bin /bin /usr/local/bin /usr/sbin; do
    if [ -f "$d/$1" ] && [ -x "$d/$1" ]; then
      echo "$d/$1"
      return 0
    fi
  done
  return 1
}

run_clean() { /usr/bin/env -i PATH=/usr/bin:/bin "$@"; }

probe() {
  local bwrap unshare
  bwrap=$(sys_bin bwrap) || return 1
  run_clean "$bwrap" --ro-bind / / --dev /dev --proc /proc true >/dev/null 2>&1 || return 1
  unshare=$(sys_bin unshare) || return 0
  run_clean "$unshare" --help 2>&1 | grep -q -- --map-root-user || return 0
  run_clean "$bwrap" --ro-bind / / --dev /dev --proc /proc "$unshare" --user --map-root-user true >/dev/null 2>&1
}

relax() {
  local m
  m=$(mode)
  [ "$m" != "off" ] || return 3
  { [ "$(explicit)" = "strict" ] || [ "${RUNNER_ENVIRONMENT:-}" = "github-hosted" ]; } || return 3
  local SUDO=""
  if [ "$(id -u)" != "0" ] && command -v sudo >/dev/null 2>&1; then SUDO="sudo -n"; fi
  # Ubuntu 23.10+ restricts unprivileged user namespaces via AppArmor, which bubblewrap needs.
  $SUDO sysctl -w kernel.apparmor_restrict_unprivileged_userns=0 >/dev/null 2>&1 || true
  # Ubuntu 26.04 also loads the bwrap-userns-restrict profile (apparmor 5): bwrap's children
  # run under unpriv_bwrap with every capability denied, so apply-seccomp cannot nest its user
  # namespace ("write /proc/self/setgroups ... Permission denied") and the sysctl above does not
  # reach it. Unloading the profile restores the 24.04 behavior. Remove this once
  # https://github.com/anthropics/sandbox-runtime/issues/429 is fixed in the pinned srt.
  if [ -f /etc/apparmor.d/bwrap-userns-restrict ]; then
    $SUDO apparmor_parser -R /etc/apparmor.d/bwrap-userns-restrict >/dev/null 2>&1 || true
  fi
  return 0
}

hint() {
  echo "Install bubblewrap and socat (sudo apt-get install -y bubblewrap socat) and allow unprivileged user namespaces (Ubuntu 23.10+: sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0; Ubuntu 26.04 also: sudo apparmor_parser -R /etc/apparmor.d/bwrap-userns-restrict), or set SWENY_SANDBOX: strict in the step env to let the Action do that on this host, or opt out with SWENY_SANDBOX: off in the step env (in CI, .sweny.yml and .env cannot lower the sandbox) and harness-policy: warn. See https://docs.sweny.ai/advanced/agent-sandbox/"
}

case "${1:-}" in
  mode) mode ;;
  explicit) explicit ;;
  hint) hint ;;
  probe) probe ;;
  relax) relax ;;
  *)
    echo "usage: $0 mode|explicit|hint|probe|relax" >&2
    exit 2
    ;;
esac
