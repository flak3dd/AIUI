#!/usr/bin/env bash
# ==============================================================================
# AI Agent Response Debug Monitor - Launcher Script
# ==============================================================================
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$DIR/.." && pwd)"

export AGENT_MONITOR_PORT="${AGENT_MONITOR_PORT:-17335}"
export AGENT_MONITOR_HOST="${AGENT_MONITOR_HOST:-127.0.0.1}"

case "${1:-}" in
  --probe)
    exec node "$DIR/monitor-agent-responses.mjs" --probe
    ;;
  --tail)
    exec node "$DIR/monitor-agent-responses.mjs" --tail "${2:-30}"
    ;;
  --once)
    exec node "$DIR/monitor-agent-responses.mjs" --once
    ;;
  --status)
    curl -sS "http://${AGENT_MONITOR_HOST}:${AGENT_MONITOR_PORT}/health" 2>/dev/null || echo "Monitor is offline"
    ;;
  --help|-h)
    echo "Usage: ./scripts/monitor-agent.sh [--probe|--tail [N]|--once|--status]"
    exit 0
    ;;
  *)
    exec node "$DIR/monitor-agent-responses.mjs" "$@"
    ;;
esac
