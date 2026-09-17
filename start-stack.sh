#!/usr/bin/env bash
# Convenience wrapper — runs the repo stack launcher
DIR="$(cd "$(dirname "$0")" && pwd)"
if [[ -f "$DIR/../scripts/start-web-api-stack.sh" ]]; then
  exec "$DIR/../scripts/start-web-api-stack.sh" "$@"
elif [[ -f "$DIR/../abliterated_ui/scripts/start-web-api-stack.sh" ]]; then
  exec "$DIR/../abliterated_ui/scripts/start-web-api-stack.sh" "$@"
else
  echo "Error: start-web-api-stack.sh not found in ../scripts or ../abliterated_ui/scripts" >&2
  exit 1
fi

