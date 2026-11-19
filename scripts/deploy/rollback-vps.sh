#!/usr/bin/env bash
# Restores the FBF frontend on the VPS from a backup made by deploy-vps.sh.
# Usage: rollback-vps.sh [backup-directory]   (default: the last backup recorded)
# Required environment: FBF_VPS_HOST, FBF_VPS_KEY. Optional: FBF_WEB_ROOT, FBF_SITE_DOMAIN.
set -euo pipefail

: "${FBF_VPS_HOST:?set FBF_VPS_HOST}"
: "${FBF_VPS_KEY:?set FBF_VPS_KEY}"
WEB_ROOT="${FBF_WEB_ROOT:-/usr/share/nginx/fbf}"
DOMAIN="${FBF_SITE_DOMAIN:-fbfhax.com}"
SSH_OPTS=(-i "$FBF_VPS_KEY" -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o BatchMode=yes -o ConnectTimeout=15)

ssh "${SSH_OPTS[@]}" "$FBF_VPS_HOST" bash -s -- "${1:-}" "$WEB_ROOT" "$DOMAIN" <<'REMOTE'
set -euo pipefail
BACKUP="${1:-}"; WEB_ROOT="$2"; DOMAIN="$3"
[ -n "$BACKUP" ] || BACKUP="$(cat "$HOME/releases/LAST_BACKUP")"
case "$BACKUP" in "${WEB_ROOT}-backup-"*) ;; *) echo "Refusing: $BACKUP is not a backup of $WEB_ROOT" >&2; exit 1;; esac
[ -f "$BACKUP/index.html" ] || { echo "Backup $BACKUP has no index.html" >&2; exit 1; }
sudo rsync -a --delete "$BACKUP/" "$WEB_ROOT/"
sudo chown -R nginx:nginx "$WEB_ROOT"
echo "rollback from $BACKUP" > "$HOME/releases/CURRENT"
curl -s -m 15 --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/" | grep -oE 'index-[A-Za-z0-9_-]+\.js' | head -n 1 | sed 's/^/Now serving /'
REMOTE
