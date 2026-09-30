#!/usr/bin/env bash
# Post or update the single SWEny run comment on a pull request.
#
# Env: COMMENT_FILE (markdown from `sweny workflow run --comment-file`),
#      PR_NUMBER, GITHUB_REPOSITORY, GH_TOKEN (the job's GITHUB_TOKEN).
# The first line of the file is the hidden marker
# `<!-- sweny-run-comment:<workflow-id> -->`; an existing comment that starts
# with the same marker is updated in place, otherwise a new one is created.
#
# Never fails the job: every problem is a ::warning:: and exit 0.

warn() { echo "::warning::sweny pr-comment: $*"; exit 0; }

if [ -z "${COMMENT_FILE:-}" ] || [ ! -s "$COMMENT_FILE" ]; then
  echo "sweny pr-comment: no comment file, skipping"
  exit 0
fi
if [ -z "${PR_NUMBER:-}" ]; then
  echo "sweny pr-comment: not a pull request, skipping"
  exit 0
fi
[ -n "${GITHUB_REPOSITORY:-}" ] || warn "GITHUB_REPOSITORY not set"
command -v gh >/dev/null 2>&1 || warn "gh CLI not found"
command -v jq >/dev/null 2>&1 || warn "jq not found"

MARKER=$(head -n 1 "$COMMENT_FILE")
case "$MARKER" in
  "<!-- sweny-run-comment:"*" -->") ;;
  *) warn "comment file has no sweny marker on its first line" ;;
esac

LIST=$(gh api --paginate "repos/${GITHUB_REPOSITORY}/issues/${PR_NUMBER}/comments" 2>&1) \
  || warn "could not list comments (does the job have pull-requests: write?): ${LIST%%$'\n'*}"
EXISTING=$(printf '%s' "$LIST" | jq -r --arg m "$MARKER" '.[] | select(.body | startswith($m)) | .id' 2>/dev/null | head -n 1)

if [ -n "$EXISTING" ]; then
  OUT=$(gh api -X PATCH "repos/${GITHUB_REPOSITORY}/issues/comments/${EXISTING}" -F "body=@${COMMENT_FILE}" 2>&1) \
    || warn "could not update comment ${EXISTING}: ${OUT%%$'\n'*}"
  echo "sweny pr-comment: updated comment ${EXISTING}"
else
  OUT=$(gh api -X POST "repos/${GITHUB_REPOSITORY}/issues/${PR_NUMBER}/comments" -F "body=@${COMMENT_FILE}" 2>&1) \
    || warn "could not create comment: ${OUT%%$'\n'*}"
  echo "sweny pr-comment: created comment"
fi
exit 0
