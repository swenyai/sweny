#!/usr/bin/env bash
# Land one PR on main the way this repo requires: bring the branch up to date,
# wait until GitHub reports it mergeable with required checks green, squash-merge.
# Never forces, never uses --admin. Exits non-zero and says why when it cannot land.
#
#   scripts/land-pr.sh <pr-number> [--timeout-min 30]
#
# Exit codes: 0 landed (or PR not open), 2 conflicts with main, 3 a check failed,
# 4 timed out waiting, 5 the merge call itself kept failing (reason is printed).
#
# Env:
#   SWENY_REPO       repo to land in (default swenyai/sweny)
#   ADVISORY_CHECKS  comma-separated exact check names that only warn when they
#                    fail (default "review" and "risk", the AI review bot and the dogfood
#                    pr-risk-review job, which are not a
#                    gate). Every other failing check exits 3, whatever
#                    mergeable_state says. Set empty to make all checks gate.
#   POLL_SEC         seconds between polls (default 20)
#
# Merging to main deploys (release.yml publishes to npm and moves the v5 tag),
# so run this only for PRs the owner has approved to land. Land one PR at a
# time: each merge makes the next PR stale, and this script updates it.
set -euo pipefail

PR=${1:?usage: land-pr.sh <pr-number> [--timeout-min N]}
TIMEOUT_MIN=30
[ "${2:-}" = "--timeout-min" ] && TIMEOUT_MIN=${3:?}
REPO=${SWENY_REPO:-swenyai/sweny}
ADVISORY_CHECKS=${ADVISORY_CHECKS-review,risk}
POLL_SEC=${POLL_SEC:-20}
MERGE_ATTEMPTS=3
MERGE_WAIT_POLLS=60

# checks_report: print "<kind>\t<name>" lines for the PR's checks.
# kind is real-fail, advisory-fail or pending. gh exits non-zero while checks are
# pending or failing, so its status is ignored; an empty report means all clear.
checks_report() {
  { gh pr checks "$PR" -R "$REPO" 2>/dev/null || true; } | awk -F'\t' -v adv="$ADVISORY_CHECKS" '
    BEGIN { n = split(adv, a, ","); for (i = 1; i <= n; i++) { gsub(/^ +| +$/, "", a[i]); if (a[i] != "") isadv[a[i]] = 1 } }
    $2 == "fail" || $2 == "cancel" { print ($1 in isadv ? "advisory-fail" : "real-fail") "\t" $1; next }
    $2 == "pending" { print "pending\t" $1 }'
}

state=$(gh pr view "$PR" -R "$REPO" --json state -q .state)
[ "$state" = "OPEN" ] || { echo "PR #$PR is $state, nothing to land"; exit 0; }

# update-branch fails quietly when the branch conflicts; the state loop below catches that.
gh pr update-branch "$PR" -R "$REPO" >/dev/null 2>&1 || true

warned=""
deadline=$(($(date +%s) + TIMEOUT_MIN * 60))
while :; do
  ms=$(gh api "repos/$REPO/pulls/$PR" -q .mergeable_state)
  report=$(checks_report)

  # A real failure stops the run in every state; never wait on it.
  if printf '%s\n' "$report" | grep -q '^real-fail'; then
    echo "PR #$PR has failing checks:"
    printf '%s\n' "$report" | grep '^real-fail' | cut -f2 | sed 's/^/  /'
    exit 3
  fi
  if [ -z "$warned" ] && printf '%s\n' "$report" | grep -q '^advisory-fail'; then
    echo "warning: advisory check(s) failing, not blocking the land:"
    printf '%s\n' "$report" | grep '^advisory-fail' | cut -f2 | sed 's/^/  /'
    warned=1
  fi
  pending=$(printf '%s\n' "$report" | grep -c '^pending' || true)

  case "$ms" in
    clean) break ;;
    dirty) echo "PR #$PR conflicts with main: rebase the branch, then rerun"; exit 2 ;;
    # unstable = a non-required check is red or pending. With no real failure (above)
    # and nothing pending, only advisory checks are red, so the PR is mergeable.
    unstable) [ "$pending" -eq 0 ] && break ;;
    behind) gh pr update-branch "$PR" -R "$REPO" >/dev/null 2>&1 || true ;;
    blocked) ;; # required checks pending: keep waiting
  esac
  if [ "$(date +%s)" -ge "$deadline" ]; then
    echo "PR #$PR not mergeable after ${TIMEOUT_MIN}m (state: $ms)"
    { gh pr checks "$PR" -R "$REPO" 2>/dev/null || true; } | grep -v 'pass' || true
    exit 4
  fi
  sleep "$POLL_SEC"
done

# main can move between "clean" and the merge call; update and retry, bounded.
# Each failure's stderr is kept so the exit says why, not just that it failed.
merged=""
reason=""
attempt=0
while [ "$attempt" -lt "$MERGE_ATTEMPTS" ]; do
  attempt=$((attempt + 1))
  if reason=$(gh pr merge "$PR" -R "$REPO" --squash 2>&1 >/dev/null); then merged=1; break; fi
  echo "merge attempt $attempt/$MERGE_ATTEMPTS failed: ${reason:-no output}" >&2
  [ "$attempt" -lt "$MERGE_ATTEMPTS" ] || break
  gh pr update-branch "$PR" -R "$REPO" >/dev/null 2>&1 || true
  polls=0
  while [ "$polls" -lt "$MERGE_WAIT_POLLS" ]; do
    ms=$(gh api "repos/$REPO/pulls/$PR" -q .mergeable_state)
    [ "$ms" = clean ] || [ "$ms" = unstable ] && break
    [ "$ms" = dirty ] && { echo "PR #$PR conflicts with main: rebase the branch, then rerun"; exit 2; }
    polls=$((polls + 1))
    sleep "$POLL_SEC"
  done
done
[ -n "$merged" ] || { echo "PR #$PR could not be merged after $MERGE_ATTEMPTS attempts. Last error: ${reason:-none}"; exit 5; }
sha=$(gh pr view "$PR" -R "$REPO" --json mergeCommit -q .mergeCommit.oid)
echo "PR #$PR landed as ${sha:0:8}"
