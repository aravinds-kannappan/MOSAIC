#!/usr/bin/env bash
# Enable GitHub Actions workflows (requires 'workflow' scope on your GitHub token).
# Run once after cloning:
#   gh auth refresh -h github.com -s workflow
#   bash scripts/enable-workflows.sh

set -e

REPO="aravinds-kannappan/MOSAIC"

push_workflow() {
  local file="$1"
  local name=$(basename "$file")
  local b64=$(python3 -c "import base64,sys; print(base64.b64encode(open('$file','rb').read()).decode())")

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

echo "Pushing GitHub Actions workflows..."
push_workflow ".github/workflows/ci.yml"
push_workflow ".github/workflows/data-refresh.yml"
echo "Done — GitHub Actions are now enabled."
