#!/usr/bin/env bash
#
# Publish this package to npm.
#
# The backend bundles a *published* version of this UI (it doesn't build from
# source), so a release is: bump the version in package.json, stamp CHANGELOG.md,
# then run this. `prepublishOnly` builds dist/ and `"files": ["dist"]` ships it.
#
# This script only adds the safety rails around `npm publish`:
#   - refuse to publish from a dirty working tree,
#   - refuse if this version was already published,
#   - tag the release (v<version>) so the CHANGELOG compare/release links resolve.
#
# Usage:
#   ./publish.sh            # publish the current package.json version
#   ./publish.sh --dry-run  # build + pack, but don't publish or tag
#
set -euo pipefail

cd "$(dirname "$0")"

DRY_RUN=0
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=1
fi

NAME="$(node -p "require('./package.json').name")"
VERSION="$(node -p "require('./package.json').version")"
TAG="v${VERSION}"

echo "==> ${NAME}@${VERSION}"

# 1. Clean working tree — never publish something that isn't committed.
if [[ -n "$(git status --porcelain)" ]]; then
  echo "error: working tree is dirty. Commit or stash before publishing." >&2
  git status --short >&2
  exit 1
fi

# 2. Don't re-publish an existing version (npm would reject it anyway, but fail early).
if npm view "${NAME}@${VERSION}" version >/dev/null 2>&1; then
  echo "error: ${NAME}@${VERSION} is already published. Bump the version first." >&2
  exit 1
fi

# 3. Make sure the CHANGELOG mentions this version (cheap guard against forgetting to stamp it).
if ! grep -q "\[${VERSION}\]" CHANGELOG.md; then
  echo "error: CHANGELOG.md has no entry for [${VERSION}]. Stamp it before publishing." >&2
  exit 1
fi

if [[ "$DRY_RUN" == "1" ]]; then
  echo "==> dry run: building and packing, not publishing"
  npm publish --dry-run
  echo "==> dry run complete. Nothing was published or tagged."
  exit 0
fi

# 4. Publish. prepublishOnly runs `npm run build`; "files": ["dist"] ships the bundle.
echo "==> npm publish"
npm publish --access public

# 5. Tag the release so CHANGELOG's v<version> compare/release links resolve.
if git rev-parse -q --verify "refs/tags/${TAG}" >/dev/null; then
  echo "==> tag ${TAG} already exists, leaving it as-is"
else
  echo "==> git tag ${TAG}"
  git tag -a "${TAG}" -m "${NAME} ${TAG}"
  echo "    Push it with: git push origin ${TAG}"
fi

echo "==> Published ${NAME}@${VERSION}."
echo "    Next: bump CURRY_LEAVES_WEB_VERSION (and the Dockerfile WEB_VERSION arg) in the backend repo."
