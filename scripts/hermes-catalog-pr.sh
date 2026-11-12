#!/usr/bin/env bash
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

VERSION="$(sed -n 's/^version: "\(.*\)"/\1/p' plugin.yaml | head -n 1)"
UPSTREAM="NousResearch/hermes-agent"
FORK="${HERMES_STAGE_FORK:-davidpgil/hermes-agent}"
SHA="$(git rev-parse HEAD)"
MODE="publish"

case "${1:-}" in
  --check) MODE="check" ;;
  --dry-run) MODE="dry-run" ;;
  -h|--help)
    cat <<'EOF'
Usage: scripts/hermes-catalog-pr.sh [--check|--dry-run] [git-sha]

Updates Hermes' plugin-catalog/hermes-stage.yaml to the current plugin version
and commit SHA, then opens a catalog PR against NousResearch/hermes-agent.

The plugin commit must already be pushed to origin/master. Run --check to verify
the catalog is current without changing anything; run --dry-run to print the
planned branch and PR without calling GitHub changes.
EOF
    exit 0
    ;;
esac

if [ "${2:-}" ]; then
  SHA="$2"
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "gh CLI is required for catalog release." >&2
  exit 1
fi

REMOTE_SHA="$(git ls-remote origin refs/heads/master | awk '{print $1}')"
if [ "$REMOTE_SHA" != "$SHA" ]; then
  echo "Plugin commit $SHA is not the current origin/master ($REMOTE_SHA). Push first." >&2
  exit 1
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

gh api "repos/$UPSTREAM/contents/plugin-catalog/hermes-stage.yaml?ref=main" \
  --jq '.content' | base64 -d > "$work/catalog.yaml"

if grep -q "^sha: $SHA$" "$work/catalog.yaml" && grep -q "^version: \"$VERSION\"$" "$work/catalog.yaml"; then
  echo "Catalog already pins $VERSION at $SHA."
  exit 0
fi

if [ "$MODE" = "check" ]; then
  echo "Catalog is stale: expected $VERSION at $SHA, found $(grep '^version:' "$work/catalog.yaml" | head -n 1) / $(grep '^sha:' "$work/catalog.yaml" | head -n 1)." >&2
  exit 1
fi

BRANCH="catalog/hermes-stage-${VERSION}-${SHA:0:8}"

if [ "$MODE" = "dry-run" ]; then
  echo "Would sync $FORK from $UPSTREAM."
  echo "Would create/update the release branch with sha $SHA and version $VERSION."
  echo "Would open or refresh the catalog PR against $UPSTREAM main."
  exit 0
fi

EXISTING_URL="$(gh pr list --repo "$UPSTREAM" --state open --author @me --search "hermes-stage $VERSION" --json url --jq '.[0].url // ""')"
if [ -n "$EXISTING_URL" ]; then
  BRANCH="$(gh pr view "$EXISTING_URL" --repo "$UPSTREAM" --json headRefName --jq '.headRefName')"
fi

gh repo sync "$FORK" --source "$UPSTREAM" --branch main >/dev/null

FORK_MAIN_SHA="$(gh api "repos/$FORK/commits/main" --jq '.sha')"

if ! gh api "repos/$FORK/git/ref/heads/$BRANCH" >/dev/null 2>&1; then
  gh api -X POST "repos/$FORK/git/refs" \
    -f ref="refs/heads/$BRANCH" \
    -f sha="$FORK_MAIN_SHA" >/dev/null
fi

FILE_SHA="$(gh api "repos/$FORK/contents/plugin-catalog/hermes-stage.yaml?ref=$BRANCH" --jq '.sha')"

python3 - "$work/catalog.yaml" "$SHA" "$VERSION" <<'PY'
from pathlib import Path
import re
import sys
path, sha, version = sys.argv[1], sys.argv[2], sys.argv[3]
p = Path(path)
s = p.read_text()
s = re.sub(r'^sha: .*$', f'sha: {sha}', s, count=1, flags=re.M)
s = re.sub(r'^version: .*$', f'version: "{version}"', s, count=1, flags=re.M)
p.write_text(s)
PY

B64="$(python3 -c 'import base64,sys; print(base64.b64encode(open(sys.argv[1], "rb").read()).decode())' "$work/catalog.yaml")"
gh api -X PUT "repos/$FORK/contents/plugin-catalog/hermes-stage.yaml" \
  -f message="chore(catalog): bump hermes-stage to $VERSION" \
  -f content="$B64" \
  -f sha="$FILE_SHA" \
  -f branch="$BRANCH" >/dev/null

BODY="Bump Hermes Stage from the previous catalog pin to $VERSION at $SHA. The plugin release includes the approval-settlement fix, skin-driven pass acknowledgements, blue mention styling, gray tool-call styling, new-user docs, and the sanitization/docs pre-commit hook."

if [ -n "$EXISTING_URL" ]; then
  gh pr edit "$EXISTING_URL" --body "$BODY" >/dev/null
  echo "$EXISTING_URL"
  exit 0
fi

gh pr create --repo "$UPSTREAM" --base main --head "${FORK%/*}:$BRANCH" \
  --title "chore(catalog): bump hermes-stage to $VERSION" \
  --body "$BODY"
