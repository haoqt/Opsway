#!/bin/sh
set -e

# Populate /app/node_modules from the Linux-compiled backup if needed.
# This runs on every container start but only does work when the volume
# is empty or the package.json hash has changed (i.e., deps were updated).

HASH_FILE="/app/node_modules/.opsway_installed"
CURRENT_HASH=$(md5sum /app/package.json 2>/dev/null | cut -d' ' -f1)

if [ ! -f "$HASH_FILE" ] || [ "$(cat "$HASH_FILE" 2>/dev/null)" != "$CURRENT_HASH" ]; then
  echo "→ Syncing Linux node_modules from image..."
  cp -rf /opt/node_modules_linux/. /app/node_modules/
  echo "$CURRENT_HASH" > "$HASH_FILE"
  echo "→ Done."
fi

exec "$@"
