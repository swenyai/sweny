#!/usr/bin/env bash
# Host check and relaxation for the agent sandbox (bubblewrap, and srt on top of it).
# One implementation for action.yml's two sandbox steps and CI's sandbox jobs.
#
#   sandbox-userns.sh probe   Exit 0 when bwrap can sandbox on this host: a plain
#                             bwrap run, then a user namespace nested inside bwrap,
#                             which srt's seccomp helper (apply-seccomp) needs. The
#                             nested run is skipped when unshare is not installed.
#   sandbox-userns.sh relax   Relax the host's user-namespace restrictions. Only on a
#                             GitHub-hosted runner (ephemeral VM) or when the caller set
#                             SWENY_SANDBOX=strict, never under SWENY_SANDBOX=off, and
#                             never by default on self-hosted (persistent host): exits 3
#                             without touching anything there. Exits 0 once it has tried;
#                             run probe again to see whether it worked.
set -u

SUDO=""
if [ "$(id -u)" != "0" ] && command -v sudo >/dev/null 2>&1; then SUDO="sudo -n"; fi

probe() {
  bwrap --ro-bind / / --dev /dev --proc /proc true >/dev/null 2>&1 || return 1
  command -v unshare >/dev/null 2>&1 || return 0
  bwrap --ro-bind / / --dev /dev --proc /proc unshare --user --map-root-user true >/dev/null 2>&1
}

relax() {
  [ "${SWENY_SANDBOX:-}" != "off" ] || return 3
  { [ "${SWENY_SANDBOX:-}" = "strict" ] || [ "${RUNNER_ENVIRONMENT:-}" = "github-hosted" ]; } || return 3
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
  probe) probe ;;
  relax) relax ;;
  *)
    echo "usage: $0 probe|relax" >&2
    exit 2
    ;;
esac
