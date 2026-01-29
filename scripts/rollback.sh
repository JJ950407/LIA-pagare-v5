#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="/opt/lia-pagare-v3"
RELEASES_DIR="$BASE_DIR/releases"
CURRENT_LINK="$BASE_DIR/current"

if [ ! -d "$RELEASES_DIR" ]; then
  echo "No releases directory found at $RELEASES_DIR" >&2
  exit 1
fi

current_target="$(readlink -f "$CURRENT_LINK" 2>/dev/null || true)"
current_name="$(basename "$current_target" 2>/dev/null || echo)"

mapfile -t releases < <(ls -1 "$RELEASES_DIR" | sort)
if [ ${#releases[@]} -lt 2 ]; then
  echo "Not enough releases to rollback" >&2
  exit 1
fi

# Determine previous release relative to current
idx=-1
for i in "${!releases[@]}"; do
  if [ "${releases[$i]}" = "$current_name" ]; then
    idx=$i
    break
  fi
done

if [ $idx -le 0 ]; then
  # If current not found or is the oldest, fallback to second latest
  prev_name="${releases[${#releases[@]}-2]}"
else
  prev_name="${releases[$((idx-1))]}"
fi

prev_target="$RELEASES_DIR/$prev_name"
if [ ! -d "$prev_target" ]; then
  echo "Previous release directory not found: $prev_target" >&2
  exit 1
fi

echo "==> Rolling back to $prev_target"
ln -sfn "$prev_target" "$CURRENT_LINK"

echo "==> Restarting pm2 process lia-pagare"
if pm2 describe lia-pagare >/dev/null 2>&1; then
  pm2 restart lia-pagare
else
  pm2 start "$CURRENT_LINK/src/lia.js" --name lia-pagare
fi
pm2 save || true

echo "==> Rolled back to $prev_name"

