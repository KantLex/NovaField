#!/usr/bin/env bash
# Copy the ComfyUI node pack into its standalone repo, commit and tag it (the same steps as
# .github/workflows/release-nodes.yml, for doing it by hand).
#
#   scripts/release-nodes.sh git@github.com:KantLex/ComfyUI-NovaField.git
#
# Pushing to that repo publishes to the Comfy Registry if its workflow and secret are set up.
set -euo pipefail

REMOTE="${1:?Usage: scripts/release-nodes.sh <standalone pack repo git URL>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PACK="$ROOT/comfyui-novafield"
VERSION="$(python3 -c "import tomllib;print(tomllib.load(open('$PACK/pyproject.toml','rb'))['project']['version'])")"

echo "Testing the pack (v$VERSION)…"
(cd "$PACK" && uv run --python 3.12 --with torch --with numpy --with pytest pytest -q)

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
git clone --quiet "$REMOTE" "$WORK/repo" 2>/dev/null || { git init --quiet -b main "$WORK/repo" && git -C "$WORK/repo" remote add origin "$REMOTE"; }

rsync -a --delete --exclude .git --exclude tests/_out --exclude __pycache__ --exclude .pytest_cache --exclude .DS_Store "$PACK/" "$WORK/repo/"
cd "$WORK/repo"
git add -A
if git diff --cached --quiet; then echo "Nothing changed in the pack."; else git commit --quiet -m "Release v$VERSION"; fi

echo
git log --oneline -3
echo
read -r -p "Push main and tag v$VERSION to $REMOTE? [y/N] " ok
[[ "$ok" == "y" || "$ok" == "Y" ]] || { echo "Not pushed."; exit 0; }
git tag -f "v$VERSION"
git push origin HEAD:main
git push -f origin "v$VERSION"
echo "Pushed v$VERSION."
