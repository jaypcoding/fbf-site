#!/usr/bin/env bash
# Publishes the already-built frontend (dist/) to the FBF VPS.
#
# The build happens on the developer machine or CI, never on the VPS (the
# instance has under 1 GB of RAM and also serves another site). The script:
#   1. checks the local tree, the commit and the Supabase host inside the bundle;
#   2. uploads dist/ as a versioned release under ~/releases on the VPS;
#   3. backs up the published directory;
#   4. syncs the release into the nginx root and fixes ownership;
#   5. verifies the site through nginx on the VPS itself.
# Nothing is reloaded: nginx serves static files, so no restart is needed.
#
# Required environment (no secrets are stored in the repository):
#   FBF_VPS_HOST      e.g. ec2-user@<ip>
#   FBF_VPS_KEY       path to the private key file
#   FBF_EXPECTED_SUPABASE_HOST  e.g. <project-ref>.supabase.co (must appear in the bundle)
# Optional:
#   FBF_WEB_ROOT      default /usr/share/nginx/fbf
#   FBF_SITE_DOMAIN   default fbfhax.com
set -euo pipefail

: "${FBF_VPS_HOST:?set FBF_VPS_HOST}"
: "${FBF_VPS_KEY:?set FBF_VPS_KEY}"
: "${FBF_EXPECTED_SUPABASE_HOST:?set FBF_EXPECTED_SUPABASE_HOST}"
WEB_ROOT="${FBF_WEB_ROOT:-/usr/share/nginx/fbf}"
DOMAIN="${FBF_SITE_DOMAIN:-fbfhax.com}"
SSH_OPTS=(-i "$FBF_VPS_KEY" -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o BatchMode=yes -o ConnectTimeout=15)

cd "$(dirname "$0")/../.."

if [ -n "$(git status --porcelain)" ]; then
  echo "Working tree is not clean; commit or stash first." >&2
  exit 1
fi
SHA="$(git rev-parse --short=12 HEAD)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RELEASE="${STAMP}-${SHA}"

# Build from the committed tree so dist/ always matches the published commit.
npm run build

[ -f dist/index.html ] || { echo "dist/index.html not found; run the build first." >&2; exit 1; }
BUNDLE="$(ls dist/assets/index-*.js | head -n 1)"
if ! grep -q "$FBF_EXPECTED_SUPABASE_HOST" "$BUNDLE"; then
  echo "The bundle does not reference the expected Supabase host; refusing to publish." >&2
  exit 1
fi
BUNDLE_NAME="$(basename "$BUNDLE")"
echo "Release $RELEASE (bundle $BUNDLE_NAME)"

ARCHIVE="$(mktemp -t fbf-release-XXXXXX).tar.gz"
tar -czf "$ARCHIVE" -C dist .
scp "${SSH_OPTS[@]}" "$ARCHIVE" "$FBF_VPS_HOST:/tmp/fbf-release-$RELEASE.tar.gz"
rm -f "$ARCHIVE"

ssh "${SSH_OPTS[@]}" "$FBF_VPS_HOST" bash -s -- "$RELEASE" "$WEB_ROOT" "$DOMAIN" "$BUNDLE_NAME" "$SHA" <<'REMOTE'
set -euo pipefail
RELEASE="$1"; WEB_ROOT="$2"; DOMAIN="$3"; BUNDLE_NAME="$4"; SHA="$5"
DIR="$HOME/releases/$RELEASE"
mkdir -p "$DIR"
tar -xzf "/tmp/fbf-release-$RELEASE.tar.gz" -C "$DIR"
rm -f "/tmp/fbf-release-$RELEASE.tar.gz"
[ -f "$DIR/index.html" ] && [ -f "$DIR/assets/$BUNDLE_NAME" ] || { echo "Uploaded release is incomplete" >&2; exit 1; }

BACKUP="${WEB_ROOT}-backup-${RELEASE}"
sudo cp -a "$WEB_ROOT" "$BACKUP"
echo "$BACKUP" > "$HOME/releases/LAST_BACKUP"

sudo rsync -a --delete "$DIR/" "$WEB_ROOT/"
sudo chown -R nginx:nginx "$WEB_ROOT"
echo "$RELEASE $SHA" > "$HOME/releases/CURRENT"

PAGE="$(curl -s -m 15 --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/")"
if ! grep -q "$BUNDLE_NAME" <<<"$PAGE"; then
  echo "Verification failed: nginx is not serving $BUNDLE_NAME; restoring $BACKUP" >&2
  sudo rsync -a --delete "$BACKUP/" "$WEB_ROOT/"
  exit 1
fi
STATUS="$(curl -s -o /dev/null -m 15 -w '%{http_code}' --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/competicoes")"
echo "Published $RELEASE; https://$DOMAIN/ serves $BUNDLE_NAME; SPA route status $STATUS; backup at $BACKUP"
REMOTE
