#!/usr/bin/env bash
# Tell someone when a scheduled SWEny run failed or was refused (#474).
#
# Env: NOTIFY         `issue`, the NAME of an env var that holds a Slack webhook URL,
#                     or an https:// Slack webhook URL itself
#      WORKFLOW_PATH  the workflow file the Action ran
#      RUNS_DIR       directory holding .sweny/runs records (default .sweny/runs)
#      MARKER_FILE    touched just before the run; only newer run records count
#      RUN_URL, GITHUB_REPOSITORY, GH_TOKEN
#
# METADATA ONLY: workflow id, failed node ids, a reason class, the run link.
# Never error text, node output, prompts, or model prose.
# Reason classes: node_failed (a node failed), crashed (the run threw),
# did_not_start (no run record: refused, invalid, or setup failed).
#
# Never fails the job: every problem is a ::warning:: and exit 0.

warn() { echo "::warning::sweny notify-on-failure: $*"; exit 0; }

[ -n "${NOTIFY:-}" ] || { echo "sweny notify-on-failure: not configured, skipping"; exit 0; }

clean() { printf '%s' "$1" | tr -cd 'A-Za-z0-9._ ,-' | cut -c1-80; }

WF_ID=$(basename "${WORKFLOW_PATH:-workflow}")
WF_ID=$(clean "${WF_ID%.yml}")
[ -n "$WF_ID" ] || WF_ID="workflow"
REASON="did_not_start"
FAILED=""

RUNS="${RUNS_DIR:-.sweny/runs}"
RECORD=""
if [ -d "$RUNS" ] && command -v jq >/dev/null 2>&1; then
  for f in $(ls -1 "$RUNS"/*.json 2>/dev/null | sort -r); do
    if [ -n "${MARKER_FILE:-}" ] && [ -e "$MARKER_FILE" ] && [ ! "$f" -nt "$MARKER_FILE" ]; then continue; fi
    RECORD="$f"
    break
  done
fi
if [ -n "$RECORD" ]; then
  STATUS=$(jq -r '.status // empty' "$RECORD" 2>/dev/null)
  case "$STATUS" in
    crashed) REASON="crashed" ;;
    failed) REASON="node_failed" ;;
    success) echo "sweny notify-on-failure: the run succeeded, skipping"; exit 0 ;;
  esac
  ID=$(jq -r '.workflow_id // empty' "$RECORD" 2>/dev/null)
  [ -n "$ID" ] && WF_ID=$(clean "$ID")
  FAILED=$(jq -r '[.nodes[]? | select(.status == "failed") | .id] | join(", ")' "$RECORD" 2>/dev/null)
  FAILED=$(clean "$FAILED")
fi

LINES="workflow: ${WF_ID}"
[ -n "$FAILED" ] && LINES="${LINES}"$'\n'"failed node: ${FAILED}"
LINES="${LINES}"$'\n'"reason: ${REASON}"
[ -n "${RUN_URL:-}" ] && LINES="${LINES}"$'\n'"run: ${RUN_URL}"

TITLE="SWEny run failed: ${WF_ID}"

if [ "$NOTIFY" = "issue" ]; then
  [ -n "${GITHUB_REPOSITORY:-}" ] || warn "GITHUB_REPOSITORY not set"
  command -v gh >/dev/null 2>&1 || warn "gh CLI not found"
  command -v jq >/dev/null 2>&1 || warn "jq not found"
  LABEL="sweny-failure"
  LIST=$(gh api --paginate "repos/${GITHUB_REPOSITORY}/issues?state=open&labels=${LABEL}&per_page=100" 2>&1) \
    || warn "could not list issues (does the job have issues: write?): ${LIST%%$'\n'*}"
  EXISTING=$(printf '%s' "$LIST" | jq -r --arg t "$TITLE" '.[] | select(.pull_request == null and .title == $t) | .number' 2>/dev/null | head -n 1)
  if [ -n "$EXISTING" ]; then
    OUT=$(gh api -X POST "repos/${GITHUB_REPOSITORY}/issues/${EXISTING}/comments" -f "body=${LINES}" 2>&1) \
      || warn "could not comment on issue ${EXISTING}: ${OUT%%$'\n'*}"
    echo "sweny notify-on-failure: commented on issue ${EXISTING}"
  else
    gh api -X POST "repos/${GITHUB_REPOSITORY}/labels" -f "name=${LABEL}" -f "color=B60205" >/dev/null 2>&1 || true
    OUT=$(gh api -X POST "repos/${GITHUB_REPOSITORY}/issues" -f "title=${TITLE}" -f "body=${LINES}" -f "labels[]=${LABEL}" 2>&1) \
      || warn "could not create issue: ${OUT%%$'\n'*}"
    echo "sweny notify-on-failure: opened an issue"
  fi
  exit 0
fi

URL=""
case "$NOTIFY" in
  https://*) URL="$NOTIFY" ;;
  *)
    if printf '%s' "$NOTIFY" | grep -Eq '^[A-Za-z_][A-Za-z0-9_]*$'; then
      URL="${!NOTIFY:-}"
      [ -n "$URL" ] || warn "env var ${NOTIFY} is empty or not set on the step"
    else
      warn "notify-on-failure must be 'issue', an env var name, or an https:// webhook URL"
    fi
    ;;
esac
case "$URL" in https://*) ;; *) warn "the webhook value is not an https:// URL" ;; esac
echo "::add-mask::${URL}"
command -v curl >/dev/null 2>&1 || warn "curl not found"
command -v jq >/dev/null 2>&1 || warn "jq not found"
PAYLOAD=$(jq -nc --arg text "${TITLE}"$'\n'"${LINES}" '{text: $text}')
OUT=$(curl -sS -f -X POST -H 'Content-type: application/json' --data "$PAYLOAD" "$URL" 2>&1) \
  || warn "could not post to the webhook: ${OUT%%$'\n'*}"
echo "sweny notify-on-failure: posted to the webhook"
exit 0
