#!/usr/bin/env bash
# Host check and relaxation for the agent sandbox (bubblewrap, and srt on top of it).
# One implementation for action.yml's two sandbox steps and CI's sandbox jobs.
#
#   sandbox-userns.sh mode    Print SWENY_SANDBOX as core reads it (resolveSandboxMode in
#                             packages/core/src/agent-env.ts): off|false|0|no is off,
#                             strict|on|true|1 is strict, auto is auto, case and spaces
#                             ignored; anything else is auto when CI is truthy, else off.
#   sandbox-userns.sh probe   Exit 0 when bwrap can sandbox on this host: a plain
#                             bwrap run, then a user namespace nested inside bwrap,
#                             which srt's seccomp helper (apply-seccomp) needs. The
#                             nested run is skipped when there is no system unshare or
#                             it lacks --map-root-user (busybox).
#   sandbox-userns.sh relax   Relax the host's user-namespace restrictions. Only on a
#                             GitHub-hosted runner (ephemeral VM) or when the mode is
#                             strict, never when it is off, and never by default on
#                             self-hosted (persistent host): exits 3 without touching
#                             anything there. Exits 0 once it has tried; run probe again
#                             to see whether it worked.
#
# bwrap and unshare are taken only from system directories and run by absolute path with
# an empty environment, never from PATH: a directory an agent can write may be on PATH.
set -u
PATH=/usr/sbin:/usr/bin:/sbin:/bin
export PATH

lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//'; }

mode() {
  local raw ci
  raw=$(lower "${SWENY_SANDBOX:-}")
  case "$raw" in
    off | false | 0 | no) echo off; return ;;
    strict | on | true | 1) echo strict; return ;;
    auto) echo auto; return ;;
  esac
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
  { [ "$m" = "strict" ] || [ "${RUNNER_ENVIRONMENT:-}" = "github-hosted" ]; } || return 3
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

case "${1:-}" in
  mode) mode ;;
  probe) probe ;;
  relax) relax ;;
  *)
    echo "usage: $0 mode|probe|relax" >&2
    exit 2
    ;;
esac
