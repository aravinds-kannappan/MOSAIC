#!/usr/bin/env bash
# Enable GitHub Actions workflows in repositories where workflows were not
# committed under .github/workflows yet.

set -e

REPO="aravinds-kannappan/MOSAIC"
WORKFLOW_DIR=".github/workflows"

push_workflow() {
  local file="$1"
  local name=$(basename "$file")
  local b64
  b64=$(python3 -c "import base64; print(base64.b64encode(open('$file','rb').read()).decode())")

  # Check if file exists to get SHA
  local sha
  sha=$(gh api "repos/$REPO/contents/.github/workflows/$name" --jq '.sha' 2>/dev/null || echo "")

  if [ -n "$sha" ]; then
    gh api "repos/$REPO/contents/.github/workflows/$name" \
      --method PUT \
      -f message="ci: update $name" \
      -f content="$b64" \
      -f sha="$sha" > /dev/null
  else
    gh api "repos/$REPO/contents/.github/workflows/$name" \
      --method PUT \
      -f message="ci: add $name" \
      -f content="$b64" > /dev/null
  fi
  echo "  ✓ Pushed .github/workflows/$name"
}

if [ ! -d "$WORKFLOW_DIR" ]; then
  echo "Missing $WORKFLOW_DIR; copy github-workflows/ there first."
  exit 1
fi

echo "Pushing GitHub Actions workflows..."
push_workflow "$WORKFLOW_DIR/ci.yml"
push_workflow "$WORKFLOW_DIR/data-refresh.yml"
echo "Done — GitHub Actions are now enabled."
