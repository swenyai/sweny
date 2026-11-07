#!/usr/bin/env bash
# Drives scripts/land-pr.sh against a fake `gh` on PATH, one scenario per state.
#   bash scripts/land-pr.test.sh
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
mkdir "$T/bin"

# Fake gh. Scenario files in $FAKE: seq (one "mergeable_state|checks-file" per api poll,
# last line repeats), merge_fail_n (merge fails this many times), merge_err.
cat > "$T/bin/gh" <<'FAKE'
#!/usr/bin/env bash
cur() { # current "state|checks" line, advancing on api polls only when asked
  local i; i=$(cat "$FAKE/idx" 2>/dev/null || echo 0)
  local n; n=$(wc -l < "$FAKE/seq")
  [ "$i" -ge "$n" ] && i=$((n - 1))
  sed -n "$((i + 1))p" "$FAKE/seq"
}
case "$1 $2" in
  "pr view") case "$*" in *mergeCommit*) echo deadbeefcafe0000;; *) echo OPEN;; esac ;;
  "pr update-branch") echo update >> "$FAKE/calls" ;;
  "api repos"*|"api "*) l=$(cur); echo "${l%%|*}"; echo $(( $(cat "$FAKE/idx" 2>/dev/null || echo 0) + 1 )) > "$FAKE/idx" ;;
  "pr checks") l=$(cur); cat "$FAKE/${l#*|}" ;;
  "pr merge")
    echo merge >> "$FAKE/calls"
    k=$(grep -c merge "$FAKE/calls"); f=$(cat "$FAKE/merge_fail_n" 2>/dev/null || echo 0)
    if [ "$k" -le "$f" ]; then echo "$(cat "$FAKE/merge_err")" >&2; exit 1; fi ;;
esac
exit 0
FAKE
chmod +x "$T/bin/gh"

fails=0
# run <name> <want-exit> <want-output-grep> <merge_fail_n> <seq lines...>; checks files c_<name> set by caller
run() {
  local name=$1 want=$2 pat=$3 mf=$4; shift 4
  export FAKE="$T/$name"; mkdir -p "$FAKE"
  printf '%s\n' "$@" > "$FAKE/seq"
  echo "$mf" > "$FAKE/merge_fail_n"; echo "HTTP 405 base branch was modified" > "$FAKE/merge_err"
  cp "$T"/c_*.txt "$FAKE"/
  local out rc
  out=$(PATH="$T/bin:$PATH" POLL_SEC=0 timeout 30 bash "$HERE/land-pr.sh" 1 2>&1); rc=$?
  if [ "$rc" = "$want" ] && printf '%s' "$out" | grep -q -- "$pat"; then echo "ok   $name"
  else echo "FAIL $name (exit $rc, want $want, pattern '$pat')"; printf '%s\n' "$out" | sed 's/^/     /'; fails=$((fails + 1)); fi
}
tab() { printf '%s\t%s\t1s\thttp://x\n' "$1" "$2"; }
{ tab lint pass; tab test pass; } > "$T/c_pass.txt"
{ tab lint pass; tab review fail; } > "$T/c_advfail.txt"
{ tab lint fail; tab review fail; } > "$T/c_realfail.txt"
{ tab lint pass; tab test pending; } > "$T/c_pending.txt"
{ tab lint pass; tab review fail; tab test pending; } > "$T/c_advpending.txt"

run clean            0 "landed as deadbeef" 0 "clean|c_pass.txt"
run unstable_adv     0 "warning: advisory" 0 "unstable|c_advfail.txt"
run unstable_adv_pending 0 "landed as" 0 "unstable|c_advpending.txt" "clean|c_pass.txt"
run unstable_real    3 "lint" 0 "unstable|c_realfail.txt"
run blocked_real     3 "lint" 0 "blocked|c_realfail.txt"
run blocked_then_ok  0 "landed as" 0 "blocked|c_pending.txt" "blocked|c_pending.txt" "clean|c_pass.txt"
run dirty            2 "conflicts" 0 "dirty|c_pass.txt"
run merge_flaky      0 "landed as" 2 "clean|c_pass.txt"
run merge_always_bad 5 "HTTP 405" 9 "clean|c_pass.txt"

[ "$fails" = 0 ] && echo "all passed" || { echo "$fails failed"; exit 1; }
