#!/usr/bin/env bash
# ==============================================================================
#  CYBERNETIC MATRIX LAUNCHER
# ==============================================================================
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_SCRIPT="$SCRIPT_DIR/../scripts/matrix.sh"

if [ ! -f "$TARGET_SCRIPT" ]; then
  echo "Error: Could not locate $TARGET_SCRIPT" >&2
  exit 1
fi

exec bash "$TARGET_SCRIPT" "$@"
