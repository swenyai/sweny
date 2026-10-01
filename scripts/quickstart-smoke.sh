#!/bin/sh
# Runs the README quickstart against the packed @sweny-ai/core tarball in a
# clean temp dir. No LLM calls, no credentials: HOME and the environment are
# scrubbed so no Claude login or API key can leak in. Exits non-zero on the
# first broken step. Keep in sync with the Quickstart section of README.md.
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT INT TERM

pass() { printf 'ok   %s\n' "$1"; }
fail() {
  printf 'FAIL %s\n' "$1" >&2
  [ -n "${2:-}" ] && printf '%s\n' "$2" >&2
  exit 1
}

# contains <step> <file> <fixed string>
contains() { grep -qF -- "$3" "$2" || fail "$1: expected output to contain: $3" "$(cat "$2")"; }
# excludes <step> <file> <fixed string>
excludes() { if grep -qF -- "$3" "$2"; then fail "$1: output must not contain: $3" "$(cat "$2")"; fi; }

# run <step> <expected exit code> <command...>; stdout+stderr land in $OUT
OUT="$WORK/out.txt"
run() {
  step=$1
  want=$2
  shift 2
  got=0
  "$@" >"$OUT" 2>&1 || got=$?
  [ "$got" -eq "$want" ] || fail "$step: exit $got, expected $want" "$(cat "$OUT")"
}

# 1. Pack core (build first if dist is missing) and install it like a user would.
[ -f "$ROOT/packages/core/dist/cli/main.js" ] || (cd "$ROOT" && npm run build --workspace=packages/core)
mkdir -p "$WORK/pack" "$WORK/prefix" "$WORK/home" "$WORK/project"
(cd "$ROOT" && npm pack --workspace=packages/core --pack-destination "$WORK/pack" --silent >/dev/null)
TARBALL=$(ls "$WORK"/pack/*.tgz)
npm install --global --prefix "$WORK/prefix" --no-audit --no-fund --loglevel=error "$TARBALL"
pass "npm install -g (packed tarball)"

# Clean environment: only PATH (with the fresh install first) and an empty HOME.
SWENY_ENV="PATH=$WORK/prefix/bin:$PATH HOME=$WORK/home"
# shellcheck disable=SC2086
sweny() { env -i $SWENY_ENV sweny "$@"; }
cd "$WORK/project"

# 2. sweny --help
run "sweny --help" 0 sweny --help
contains "sweny --help" "$OUT" "Usage: sweny"
contains "sweny --help" "$OUT" "new"
contains "sweny --help" "$OUT" "check"
pass "sweny --help"

# 2b. sweny try: recorded demo, no credentials, no network. Banner, answer, receipt, exit 0, nothing written.
run "sweny try" 0 sweny try
cat "$OUT"
contains "sweny try" "$OUT" "Recorded demo"
contains "sweny try" "$OUT" "What it is:"
contains "sweny try" "$OUT" "✓ 2/2 nodes"
contains "sweny try" "$OUT" "policy: env scoped, sandbox on"
contains "sweny try" "$OUT" "npx @sweny-ai/core new --template explain-repo"
[ ! -e .sweny ] || fail "sweny try: wrote .sweny/ (it must write nothing)" "$(ls -R .sweny)"
pass "sweny try (recorded demo, exit 0, nothing written)"

# 2c. sweny try --record: an animated, self-contained SVG of the demo, and the committed copy must match.
# CI uploads the fresh recording (DEMO_SVG_OUT) so a stale assets/demo.svg is fixed by committing the artifact.
run "sweny try --record" 0 sweny try --record "$WORK/demo.svg"
[ -s "$WORK/demo.svg" ] || fail "sweny try --record: wrote no file" "$(cat "$OUT")"
contains "sweny try --record" "$WORK/demo.svg" "@keyframes"
for banned in "<script" "@import" "<image" "href=" "font-face"; do
  excludes "sweny try --record" "$WORK/demo.svg" "$banned"
done
if [ -n "${DEMO_SVG_OUT:-}" ]; then
  case "$DEMO_SVG_OUT" in /*) cp "$WORK/demo.svg" "$DEMO_SVG_OUT" ;; *) cp "$WORK/demo.svg" "$ROOT/$DEMO_SVG_OUT" ;; esac
fi
[ -f "$ROOT/assets/demo.svg" ] || fail "assets/demo.svg is missing: run 'sweny try --record assets/demo.svg' and commit it (CI artifact: demo-svg)"
cmp -s "$WORK/demo.svg" "$ROOT/assets/demo.svg" ||
  fail "assets/demo.svg is stale: run 'sweny try --record assets/demo.svg' and commit it (CI artifact: demo-svg)"
pass "sweny try --record (self-contained, assets/demo.svg is current)"

# 3. sweny new --template explain-repo --yes (no TTY, no prompts)
run "sweny new" 0 sweny new --template explain-repo --yes </dev/null
[ -f .sweny.yml ] || fail "sweny new: .sweny.yml missing" "$(cat "$OUT")"
[ -f .env ] || fail "sweny new: .env missing" "$(cat "$OUT")"
[ -f .sweny/workflows/explain-repo.yml ] || fail "sweny new: workflow file missing" "$(cat "$OUT")"
grep -qx '\.env' .gitignore || fail "sweny new: .gitignore does not contain .env" "$(cat .gitignore 2>&1)"
pass "sweny new --template explain-repo --yes"

# 4. sweny workflow validate
run "sweny workflow validate" 0 sweny workflow validate .sweny/workflows/explain-repo.yml
pass "sweny workflow validate"

# 5. sweny workflow diagram
run "sweny workflow diagram" 0 sweny workflow diagram .sweny/workflows/explain-repo.yml
contains "sweny workflow diagram" "$OUT" "graph TB"
contains "sweny workflow diagram" "$OUT" "survey --> explain"
pass "sweny workflow diagram"

# 6. sweny check with no credentials: exit 1 with the auth message, and no git noise.
run "sweny check" 1 sweny check
contains "sweny check" "$OUT" "Configuration Error"
contains "sweny check" "$OUT" "Missing: ANTHROPIC_API_KEY"
excludes "sweny check" "$OUT" "fatal:"
excludes "sweny check" "$OUT" "not a git repository"
pass "sweny check (no credentials: auth failure, exit 1)"

printf '\nquickstart smoke: all steps passed\n'
