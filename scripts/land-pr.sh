#!/usr/bin/env bash
# Land one PR on main the way this repo requires: bring the branch up to date,
# wait until GitHub reports it mergeable with required checks green, squash-merge.
# Never forces, never uses --admin. Exits non-zero and says why when it cannot land.
#
#   scripts/land-pr.sh <pr-number> [--timeout-min 30]
#
# Merging to main deploys (release.yml publishes to npm and moves the v5 tag),
# so run this only for PRs the owner has approved to land. Land one PR at a
# time: each merge makes the next PR stale, and this script updates it.
set -euo pipefail

PR=${1:?usage: land-pr.sh <pr-number> [--timeout-min N]}
TIMEOUT_MIN=30
[ "${2:-}" = "--timeout-min" ] && TIMEOUT_MIN=${3:?}
REPO=${SWENY_REPO:-swenyai/sweny}

state=$(gh pr view "$PR" -R "$REPO" --json state -q .state)
[ "$state" = "OPEN" ] || { echo "PR #$PR is $state, nothing to land"; exit 0; }

# update-branch fails quietly when the branch conflicts; the state loop below catches that.
gh pr update-branch "$PR" -R "$REPO" >/dev/null 2>&1 || true

deadline=$(($(date +%s) + TIMEOUT_MIN * 60))
while :; do
  ms=$(gh api "repos/$REPO/pulls/$PR" -q .mergeable_state)
  case "$ms" in
    clean) break ;;
    dirty) echo "PR #$PR conflicts with main: rebase the branch, then rerun"; exit 2 ;;
    unstable)
      # GitHub also reports "unstable" while non-required checks are still pending.
      # Stop only on an actual failure; otherwise keep waiting.
      if gh pr checks "$PR" -R "$REPO" 2>/dev/null | awk -F'\t' '$2=="fail"{f=1} END{exit !f}'; then
        echo "PR #$PR has failing checks:"
        gh pr checks "$PR" -R "$REPO" | awk -F'\t' '$2=="fail"'
        exit 3
      fi
      ;;
    behind) gh pr update-branch "$PR" -R "$REPO" >/dev/null 2>&1 || true ;;
  esac
  if [ "$(date +%s)" -ge "$deadline" ]; then
    echo "PR #$PR not mergeable after ${TIMEOUT_MIN}m (state: $ms)"
    gh pr checks "$PR" -R "$REPO" | grep -v pass || true
    exit 4
  fi
  sleep 20
done

# main can move between "clean" and the merge call; update and retry a few times.
merged=""
for _ in 1 2 3; do
  if gh pr merge "$PR" -R "$REPO" --squash >/dev/null 2>&1; then merged=1; break; fi
  gh pr update-branch "$PR" -R "$REPO" >/dev/null 2>&1 || true
  for _ in $(seq 1 60); do
    ms=$(gh api "repos/$REPO/pulls/$PR" -q .mergeable_state)
    [ "$ms" = clean ] && break
    [ "$ms" = dirty ] && { echo "PR #$PR conflicts with main: rebase the branch, then rerun"; exit 2; }
    sleep 20
  done
done
[ -n "$merged" ] || { echo "PR #$PR could not be merged after 3 attempts"; exit 5; }
sha=$(gh pr view "$PR" -R "$REPO" --json mergeCommit -q .mergeCommit.oid)
echo "PR #$PR landed as ${sha:0:8}"
