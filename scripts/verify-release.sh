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

# The run log names what it published. npm serves new versions after a few
# minutes, so wait for the registry to list them before checking anything.
published=$(gh run view "$run" -R "$REPO" --log 2>/dev/null | grep -oE 'Published @sweny-ai/[a-z]+@[0-9][^ ]*' | sed 's/^Published //' | sort -u || true)
[ -n "$published" ] || echo "release ${run} published nothing (no package changed)"
for spec in $published; do
  name=${spec%@*} ver=${spec##*@}
  enc=$(printf '%s' "$name" | sed 's#/#%2f#')
  for _ in $(seq 1 60); do
    [ "$(curl -s "https://registry.npmjs.org/$enc" | jq -r --arg v "$ver" '.versions[$v].version // empty')" = "$ver" ] && break
    sleep 10
  done
  printf '%s %s (gitHead %s)\n' "$name" "$ver" "$(npm view "$name@$ver" gitHead --prefer-online 2>/dev/null | cut -c1-8)"
done

if [ -n "$EXPECT" ]; then
  # shellcheck disable=SC2086
  v=$(printf '%s\n' $published | grep '^@sweny-ai/core@' | sed 's/.*@//' | tail -1)
  [ -n "$v" ] || v=$(npm view @sweny-ai/core version --prefer-online)
  # Install into an empty prefix and run that exact binary. npx can resolve a
  # globally installed @sweny-ai/core (or the monorepo workspace) instead.
  tmp=$(mktemp -d)
  npm install --prefix "$tmp" --no-audit --no-fund --loglevel=error --prefer-online "@sweny-ai/core@$v" >/dev/null 2>&1 \
    || { echo "could not install @sweny-ai/core@$v"; exit 3; }
  # shellcheck disable=SC2086
  if "$tmp/node_modules/.bin/sweny" $HELP_ARGS --help 2>&1 | grep -qF -- "$EXPECT"; then
    echo "@sweny-ai/core@$v contains: $EXPECT"
  else
    echo "@sweny-ai/core@$v does NOT contain: $EXPECT"
    exit 3
  fi
fi
echo "release ${run} ok for ${SHA:0:8}"
