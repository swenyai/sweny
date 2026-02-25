#!/usr/bin/env bash
#
# install.sh - Install or upgrade SWEny Triage in a target repository
#
# Usage:
#   ./install.sh <target-repo-path>
#
# This script:
#   1. Copies sweny-triage.yml to .github/workflows/ (overwrites existing)
#   2. Copies service map to .github/scripts/
#   3. Copies linear-cli to .github/scripts/linear-cli/ and builds it
#   4. Creates required GitHub labels
#   5. Runs setup wizard for Linear configuration variables
#   6. Verifies required secrets (repo + org level)
#   7. Commits changes to a branch, pushes, opens a PR, and opens browser
#
# Safe to re-run on repos with an older version - it will upgrade in place.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# --- Argument parsing ---

if [[ $# -lt 1 ]]; then
  echo "Usage: ./install.sh <target-repo-path>"
  echo ""
  echo "Example: ./install.sh /Users/you/src/my-org/my-service"
  exit 1
fi

TARGET_REPO="$1"

if [[ ! -d "$TARGET_REPO/.git" ]]; then
  echo "Error: $TARGET_REPO is not a git repository"
  exit 1
fi

REPO_NAME=$(cd "$TARGET_REPO" && gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || echo "")
if [[ -z "$REPO_NAME" ]]; then
  echo "Error: Could not determine GitHub repo name. Make sure 'gh' CLI is authenticated."
  exit 1
fi

# Detect if this is an upgrade
IS_UPGRADE="false"
if [[ -f "$TARGET_REPO/.github/workflows/sweny-triage.yml" ]]; then
  IS_UPGRADE="true"
fi

if [[ "$IS_UPGRADE" == "true" ]]; then
  echo "=== SWEny Triage Installer (UPGRADE) ==="
else
  echo "=== SWEny Triage Installer ==="
fi
echo "Target repo: $REPO_NAME ($TARGET_REPO)"
echo ""

# --- 1. Copy workflow file ---

echo "[1/7] Copying workflow file..."
mkdir -p "$TARGET_REPO/.github/workflows"
cp "$SCRIPT_DIR/sweny-triage.yml" "$TARGET_REPO/.github/workflows/sweny-triage.yml"
if [[ "$IS_UPGRADE" == "true" ]]; then
  echo "  -> .github/workflows/sweny-triage.yml (overwritten)"
else
  echo "  -> .github/workflows/sweny-triage.yml"
fi

# --- 2. Copy service map ---

echo "[2/7] Copying service map..."
mkdir -p "$TARGET_REPO/.github/scripts"
cp "$SCRIPT_DIR/service-map.yml" "$TARGET_REPO/.github/scripts/service-map.yml"
echo "  -> .github/scripts/service-map.yml"

# --- 3. Copy Linear CLI ---

echo "[3/7] Copying Linear CLI..."
mkdir -p "$TARGET_REPO/.github/scripts"

# Remove old linear-cli entirely (except node_modules for faster reinstall)
if [[ -d "$TARGET_REPO/.github/scripts/linear-cli/src" ]]; then
  rm -rf "$TARGET_REPO/.github/scripts/linear-cli/src"
  rm -rf "$TARGET_REPO/.github/scripts/linear-cli/dist"
  rm -f "$TARGET_REPO/.github/scripts/linear-cli/package.json"
  rm -f "$TARGET_REPO/.github/scripts/linear-cli/package-lock.json"
  rm -f "$TARGET_REPO/.github/scripts/linear-cli/yarn.lock"
  rm -f "$TARGET_REPO/.github/scripts/linear-cli/tsconfig.json"
  rm -f "$TARGET_REPO/.github/scripts/linear-cli/.gitignore"
fi

# Copy source files (not node_modules or dist - those get built fresh)
rsync -a \
  --exclude node_modules \
  --exclude dist \
  "$SCRIPT_DIR/.github/scripts/linear-cli/" \
  "$TARGET_REPO/.github/scripts/linear-cli/"
echo "  -> .github/scripts/linear-cli/"

# Build the CLI
echo "  Building Linear CLI..."
(cd "$TARGET_REPO/.github/scripts/linear-cli" && npm install --silent && npx tsc)
echo "  -> Build complete"

# --- 4. Create GitHub labels ---

echo "[4/7] Creating GitHub labels..."

create_label() {
  local name="$1"
  local color="$2"
  local description="$3"

  if gh label create "$name" \
    --repo "$REPO_NAME" \
    --color "$color" \
    --description "$description" \
    --force 2>/dev/null; then
    echo "  -> $name"
  else
    echo "  -> $name (already exists or error)"
  fi
}

# Agent work type labels
create_label "agent"              "5319E7" "Autonomous agent work"
create_label "triage"             "D93F0B" "Production log analysis / bug detection"
create_label "optimization"       "0E8A16" "Performance and code optimization"
create_label "support"            "FBCA04" "Support-initiated request"
create_label "spec"               "C5DEF5" "Spec generation from non-technical input"

# Agent signal labels
create_label "agent-needs-input"  "E4E669" "Agent needs human clarification to proceed"
create_label "agent-error"        "B60205" "Unexpected agent technical failure"
create_label "human-only"         "1D76DB" "Automation must not work on this issue"

# PR workflow labels
create_label "needs-review"       "FBCA04" "PR needs human review"

# --- 5. Setup wizard for Linear configuration ---

echo "[5/7] Setting up Linear configuration..."
echo ""

# --- LINEAR_TEAM_ID ---
CURRENT_TEAM_ID=$(gh variable get LINEAR_TEAM_ID --repo "$REPO_NAME" 2>/dev/null || echo "")
if [[ -n "$CURRENT_TEAM_ID" ]]; then
  echo "  LINEAR_TEAM_ID is already set: $CURRENT_TEAM_ID"
  read -rp "  Keep existing value? [Y/n]: " KEEP_TEAM
  if [[ "${KEEP_TEAM,,}" == "n" ]]; then
    CURRENT_TEAM_ID=""
  fi
fi

if [[ -z "$CURRENT_TEAM_ID" ]]; then
  echo ""
  echo "  LINEAR_TEAM_ID - The UUID of your Linear team."
  echo "  You can find this in Linear under Settings > Teams, or we can look it up."
  echo ""
  read -rp "  Enter your Linear team ID (or type a team NAME to look it up): " TEAM_INPUT

  # If it looks like a UUID, use it directly; otherwise, try to look it up
  if [[ "$TEAM_INPUT" =~ ^[0-9a-f-]{36}$ ]]; then
    CURRENT_TEAM_ID="$TEAM_INPUT"
  else
    echo "  Looking up team '$TEAM_INPUT' via Linear API..."
    if [[ -z "${LINEAR_API_KEY:-}" ]]; then
      read -rsp "  Enter your LINEAR_API_KEY (for lookup only, not stored): " LINEAR_API_KEY
      echo ""
      export LINEAR_API_KEY
    fi
    TEAM_OUTPUT=$(cd "$TARGET_REPO/.github/scripts/linear-cli" && node dist/linear-client.js get-team --name "$TEAM_INPUT" 2>&1) || true
    LOOKED_UP_ID=$(echo "$TEAM_OUTPUT" | grep "^TEAM_ID=" | cut -d= -f2)
    if [[ -n "$LOOKED_UP_ID" ]]; then
      TEAM_NAME_FOUND=$(echo "$TEAM_OUTPUT" | grep "^TEAM_NAME=" | cut -d= -f2)
      echo "  Found team: $TEAM_NAME_FOUND ($LOOKED_UP_ID)"
      CURRENT_TEAM_ID="$LOOKED_UP_ID"
    else
      echo "  Could not find team. Output: $TEAM_OUTPUT"
      read -rp "  Enter the LINEAR_TEAM_ID manually: " CURRENT_TEAM_ID
    fi
  fi

  gh variable set LINEAR_TEAM_ID --repo "$REPO_NAME" --body "$CURRENT_TEAM_ID"
  echo "  -> LINEAR_TEAM_ID set to: $CURRENT_TEAM_ID"
fi

# --- LINEAR_BUG_LABEL_ID ---
CURRENT_BUG_LABEL=$(gh variable get LINEAR_BUG_LABEL_ID --repo "$REPO_NAME" 2>/dev/null || echo "")
if [[ -n "$CURRENT_BUG_LABEL" ]]; then
  echo "  LINEAR_BUG_LABEL_ID is already set: $CURRENT_BUG_LABEL"
  read -rp "  Keep existing value? [Y/n]: " KEEP_BUG
  if [[ "${KEEP_BUG,,}" == "n" ]]; then
    CURRENT_BUG_LABEL=""
  fi
fi

if [[ -z "$CURRENT_BUG_LABEL" ]]; then
  echo ""
  echo "  LINEAR_BUG_LABEL_ID - The UUID of the 'Bug' label in Linear."
  echo "  This label is applied to issues created by the triage workflow."
  read -rp "  Enter your Linear Bug label ID: " CURRENT_BUG_LABEL
  gh variable set LINEAR_BUG_LABEL_ID --repo "$REPO_NAME" --body "$CURRENT_BUG_LABEL"
  echo "  -> LINEAR_BUG_LABEL_ID set to: $CURRENT_BUG_LABEL"
fi

# --- AGENT_TRIAGE_LABEL_ID ---
CURRENT_TRIAGE_LABEL=$(gh variable get AGENT_TRIAGE_LABEL_ID --repo "$REPO_NAME" 2>/dev/null || echo "")
if [[ -n "$CURRENT_TRIAGE_LABEL" ]]; then
  echo "  AGENT_TRIAGE_LABEL_ID is already set: $CURRENT_TRIAGE_LABEL"
  read -rp "  Keep existing value? [Y/n]: " KEEP_TRIAGE
  if [[ "${KEEP_TRIAGE,,}" == "n" ]]; then
    CURRENT_TRIAGE_LABEL=""
  fi
fi

if [[ -z "$CURRENT_TRIAGE_LABEL" ]]; then
  echo ""
  echo "  AGENT_TRIAGE_LABEL_ID - The UUID of the 'agent-triage' label in Linear."
  echo "  This label marks issues created by the automated triage agent."
  read -rp "  Enter your Linear agent-triage label ID: " CURRENT_TRIAGE_LABEL
  gh variable set AGENT_TRIAGE_LABEL_ID --repo "$REPO_NAME" --body "$CURRENT_TRIAGE_LABEL"
  echo "  -> AGENT_TRIAGE_LABEL_ID set to: $CURRENT_TRIAGE_LABEL"
fi

# --- SERVICE_FILTER ---
CURRENT_SERVICE_FILTER=$(gh variable get SERVICE_FILTER --repo "$REPO_NAME" 2>/dev/null || echo "")
if [[ -n "$CURRENT_SERVICE_FILTER" ]]; then
  echo "  SERVICE_FILTER is already set: $CURRENT_SERVICE_FILTER"
  read -rp "  Keep existing value? [Y/n]: " KEEP_FILTER
  if [[ "${KEEP_FILTER,,}" == "n" ]]; then
    CURRENT_SERVICE_FILTER=""
  fi
fi

if [[ -z "$CURRENT_SERVICE_FILTER" ]]; then
  echo ""
  echo "  SERVICE_FILTER - Pattern to filter observability data for this service."
  echo "  Examples: 'my-api-*', 'payment-service', 'service:web-*'"
  read -rp "  Enter the service filter pattern: " CURRENT_SERVICE_FILTER
  gh variable set SERVICE_FILTER --repo "$REPO_NAME" --body "$CURRENT_SERVICE_FILTER"
  echo "  -> SERVICE_FILTER set to: $CURRENT_SERVICE_FILTER"
fi

echo ""

# --- 6. Verify secrets ---

echo "[6/7] Checking repository secrets..."

# Collect repo-level and org-level secrets
ORG_NAME="${REPO_NAME%%/*}"
REPO_SECRETS=$(gh secret list --repo "$REPO_NAME" 2>/dev/null | awk '{print $1}')
ORG_SECRETS=$(gh api "orgs/${ORG_NAME}/actions/secrets" --jq '.secrets[].name' 2>/dev/null || echo "")
ALL_SECRETS=$(printf '%s\n%s' "$REPO_SECRETS" "$ORG_SECRETS" | sort -u)

MISSING_SECRETS=()
for SECRET_NAME in ANTHROPIC_API_KEY LINEAR_API_KEY GHA_BOT_TOKEN; do
  if echo "$ALL_SECRETS" | grep -q "^${SECRET_NAME}$"; then
    # Check if it's org-level or repo-level
    if echo "$ORG_SECRETS" | grep -q "^${SECRET_NAME}$"; then
      echo "  -> $SECRET_NAME: found (org secret)"
    else
      echo "  -> $SECRET_NAME: found (repo secret)"
    fi
  else
    echo "  -> $SECRET_NAME: MISSING"
    MISSING_SECRETS+=("$SECRET_NAME")
  fi
done

# --- 7. Commit and push ---

BRANCH_NAME="add-sweny-triage"

echo "[7/7] Committing changes..."

cd "$TARGET_REPO"

# Get default branch
DEFAULT_BRANCH=$(gh repo view --json defaultBranchRef -q .defaultBranchRef.name 2>/dev/null || echo "main")

# Ensure we're on a clean base - fetch latest
git fetch origin "$DEFAULT_BRANCH" --quiet 2>/dev/null || true

# Clean up any existing branch (local and remote)
EXISTING_PR=$(gh pr list --repo "$REPO_NAME" --head "$BRANCH_NAME" --json number -q '.[0].number' 2>/dev/null || echo "")
if [[ -n "$EXISTING_PR" ]]; then
  echo "  Closing existing PR #$EXISTING_PR..."
  gh pr close "$EXISTING_PR" --repo "$REPO_NAME" --delete-branch 2>/dev/null || true
fi

# Delete local branch if it exists (we're creating fresh from default)
git checkout "$DEFAULT_BRANCH" 2>/dev/null || git checkout "origin/$DEFAULT_BRANCH" --detach 2>/dev/null
git branch -D "$BRANCH_NAME" 2>/dev/null || true

# Create fresh branch from latest default
git checkout -b "$BRANCH_NAME" "origin/$DEFAULT_BRANCH"

# Stage all triage files
git add \
  .github/workflows/sweny-triage.yml \
  .github/scripts/service-map.yml \
  .github/scripts/linear-cli/

if [[ "$IS_UPGRADE" == "true" ]]; then
  COMMIT_MSG="Upgrade SWEny Triage workflow to latest version

- sweny-triage.yml: Updated from canonical source
- service-map.yml: Service ownership map for cross-repo dispatch
- linear-cli: Updated CLI with latest commands and fixes"
else
  COMMIT_MSG="Add SWEny Triage autonomous workflow

- sweny-triage.yml: GitHub Actions workflow for observability log monitoring,
  Linear issue creation, and automated fix PRs via Claude Code
- service-map.yml: Service ownership map for cross-repo dispatch
- linear-cli: Custom TypeScript CLI for Linear API operations"
fi

git commit --no-verify -m "$COMMIT_MSG"

echo "  -> Committed to branch: $BRANCH_NAME"

echo "  Pushing to origin..."
git push --force-with-lease -u origin "$BRANCH_NAME" 2>&1
echo "  -> Pushed"

# --- Create PR and open browser ---

echo "Creating pull request..."

if [[ "$IS_UPGRADE" == "true" ]]; then
  PR_TITLE="Upgrade SWEny Triage workflow to latest version"
  PR_BODY="$(cat <<'PREOF'
## Summary

Upgrades the SWEny Triage autonomous workflow to the latest version from the canonical source.

### What changed

Key improvements include:

- **Cross-repo dispatch**: When a repo discovers a bug in another service, it dispatches to the correct repo automatically
- **Service map**: Static ownership map linking services to GitHub repos
- Dedup system: known-issues context, novelty gate, error fingerprinting
- Agent label system: compound `agent` + `triage` labels
- Shell injection protection: `env:` blocks for dynamic content
- Daily cron schedule enabled (6 AM UTC)
- Job timeouts to prevent runaway workflows

## What's included

- `.github/workflows/sweny-triage.yml` - Full multi-job triage workflow
- `.github/scripts/service-map.yml` - Service ownership map for cross-repo dispatch
- `.github/scripts/linear-cli/` - Custom TypeScript CLI for Linear API operations

## Before merging

- [ ] Verify `LINEAR_TEAM_ID` and label IDs match your Linear setup
- [ ] Required secrets are available (ANTHROPIC_API_KEY, LINEAR_API_KEY, GHA_BOT_TOKEN)
- [ ] `GHA_BOT_TOKEN` must have `workflow` scope for cross-repo dispatch
- [ ] Test with `dry_run: true` after merging
PREOF
)"
else
  PR_TITLE="Add SWEny Triage autonomous workflow"
  PR_BODY="$(cat <<'PREOF'
## Summary

Adds the SWEny Triage autonomous agent workflow, which:

- Monitors production logs for errors via configurable observability providers
- Analyzes patterns and identifies highest-impact issues using Claude
- Creates Linear issues with dedup protection (known-issues context, novelty gate, fingerprinting)
- Opens fix PRs with code changes
- **Cross-repo dispatch**: When a bug belongs to another service, automatically dispatches to the correct repo

## What's included

- `.github/workflows/sweny-triage.yml` - Full multi-job triage workflow
- `.github/scripts/service-map.yml` - Service ownership map for cross-repo dispatch
- `.github/scripts/linear-cli/` - Custom TypeScript CLI for Linear API operations

## Before merging

- [ ] Verify `LINEAR_TEAM_ID` and label IDs match your Linear setup
- [ ] Required secrets are available (ANTHROPIC_API_KEY, LINEAR_API_KEY, GHA_BOT_TOKEN)
- [ ] `GHA_BOT_TOKEN` must have `workflow` scope for cross-repo dispatch
- [ ] Test with `dry_run: true` after merging
PREOF
)"
fi

PR_URL=$(gh pr create \
  --repo "$REPO_NAME" \
  --title "$PR_TITLE" \
  --body "$PR_BODY" 2>&1)

echo "  -> $PR_URL"

echo ""
echo "Opening PR in browser..."
gh pr view "$PR_URL" --web 2>/dev/null || open "$PR_URL" 2>/dev/null || echo "  Open manually: $PR_URL"

# --- Summary ---

echo ""
echo "=== Installation Complete ==="
echo ""
echo "Branch:  $BRANCH_NAME"
echo "PR:      $PR_URL"
echo ""

if [[ ${#MISSING_SECRETS[@]} -gt 0 ]]; then
  echo "ACTION REQUIRED - Missing secrets:"
  for s in "${MISSING_SECRETS[@]}"; do
    echo "  gh secret set $s --repo $REPO_NAME"
  done
  echo ""
fi

echo "After merging:"
echo "  1. Update 'service_filter' input default in sweny-triage.yml to match your service"
echo "  2. Trigger a test run: gh workflow run 'SWEny Triage' --repo $REPO_NAME -f dry_run=true"
echo "  3. Daily cron is enabled by default (6 AM UTC / 10 PM PST)"
