#!/usr/bin/env bash
# Prove a merge actually reached users: wait for the release run on a commit,
# then check npm and (optionally) that the published CLI contains a feature.
#
#   scripts/verify-release.sh [<main-sha>] [--expect '<text in `sweny <args> --help`>' --help-args 'workflow run']
#
# A green PR is not shipped. Shipped means: release.yml succeeded for the commit,
# npm serves a new @sweny-ai/core, and `npx @sweny-ai/core@<version>` shows the change.
set -euo pipefail

REPO=${SWENY_REPO:-swenyai/sweny}
SHA=${1:-$(gh api "repos/$REPO/commits/main" -q .sha)}
shift || true
EXPECT="" HELP_ARGS=""
while [ $# -gt 0 ]; do
  case "$1" in
    --expect) EXPECT=$2; shift 2 ;;
    --help-args) HELP_ARGS=$2; shift 2 ;;
    *) echo "unknown arg $1"; exit 64 ;;
  esac
done

run=""
for _ in $(seq 1 30); do
  run=$(gh run list -R "$REPO" --workflow release.yml --commit "$SHA" --limit 1 --json databaseId -q '.[0].databaseId // empty')
  [ -n "$run" ] && break
  sleep 10
done
[ -n "$run" ] || { echo "no release run for ${SHA:0:8}"; exit 2; }

gh run watch "$run" -R "$REPO" --exit-status >/dev/null 2>&1 || {
  echo "release run $run FAILED for ${SHA:0:8}:"
  gh run view "$run" -R "$REPO" --log-failed | grep -E "npm error|::error" | head -10
  echo "hints: E404 = NPM_TOKEN expired; E422 = package.json repository missing (provenance); EOTP = token is not an Automation token"
  exit 1
}

for p in core studio mcp; do
  printf '@sweny-ai/%s %s\n' "$p" "$(npm view "@sweny-ai/$p" version 2>/dev/null)"
done

if [ -n "$EXPECT" ]; then
  v=$(npm view @sweny-ai/core version)
  # Run from an empty dir: inside the monorepo npx resolves the workspace package, not npm.
  tmp=$(mktemp -d)
  # shellcheck disable=SC2086
  if (cd "$tmp" && npx -y "@sweny-ai/core@$v" $HELP_ARGS --help 2>&1) | grep -qF -- "$EXPECT"; then
    echo "@sweny-ai/core@$v contains: $EXPECT"
  else
    echo "@sweny-ai/core@$v does NOT contain: $EXPECT"
    exit 3
  fi
fi
echo "release ${run} ok for ${SHA:0:8}"
