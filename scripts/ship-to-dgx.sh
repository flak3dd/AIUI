#!/usr/bin/env bash
# scripts/ship-to-dgx.sh — Mac only: push AIUI; does not start servers
set -euo pipefail
cd "$(dirname "$0")/.."
git push origin HEAD
echo "Pushed. On DGX: POST /api/sandbox/sync with this chat chatId (or ssh and pull in /tmp/spark-sandboxes/workspaceN)."
