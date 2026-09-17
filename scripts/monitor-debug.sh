#!/usr/bin/env bash
# AIUI stack debug monitor — polls health, tails errors, writes JSONL + human log.
# Usage:
#   ./scripts/monitor-debug.sh              # run until Ctrl-C
#   ./scripts/monitor-debug.sh --once        # single status snapshot
#   INTERVAL=2 ./scripts/monitor-debug.sh
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ABLITERATED="${ABLITERATED_UI:-$HOME/abliterated_ui}"
LOG_DIR="${LOG_DIR:-$ROOT/logs}"
RUN_DIR="${RUN_DIR:-/tmp/abliterated-web-api-stack}"
INTERVAL="${INTERVAL:-5}"
ONCE=0
[[ "${1:-}" == "--once" ]] && ONCE=1

mkdir -p "$LOG_DIR"
STAMP=$(date +%Y%m%d-%H%M%S)
HUMAN_LOG="$LOG_DIR/monitor-debug-$STAMP.log"
JSONL="$LOG_DIR/monitor-debug-$STAMP.jsonl"
LATEST_LOG="$LOG_DIR/monitor-debug-latest.log"
LATEST_JSONL="$LOG_DIR/monitor-debug-latest.jsonl"
PID_FILE="$LOG_DIR/monitor-debug.pid"

SPARK_HOST="${SPARK_HOST:-192.168.4.103}"
SPARK_PORT="${SPARK_PORT:-8000}"

SERVICES=(
  "vite|http://127.0.0.1:5173/|5173"
  "sandbox|http://127.0.0.1:17330/health|17330"
  "mempalace|http://127.0.0.1:17333/health|17333"
  "proxy|http://127.0.0.1:17332/health|17332"
  "spark|http://${SPARK_HOST}:${SPARK_PORT}/v1/models|${SPARK_PORT}"
)

http_code() {
  local url="$1"
  local code
  code=$(curl -sS -m 2 -o /dev/null -w '%{http_code}' "$url" 2>/dev/null) || code="000"
  # strip anything non-digit
  code=$(printf '%s' "$code" | tr -cd '0-9')
  [[ -z "$code" ]] && code="000"
  printf '%s' "$code"
}

port_listen() {
  local port="$1"
  lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | awk 'NR>1 {print $1"|"$2}' | head -1 || true
}

probe_service() {
  local name="$1" url="$2" port="$3"
  local code listen status ms t0 t1
  t0=$(python3 -c 'import time; print(int(time.time()*1000))' 2>/dev/null || echo 0)
  code=$(http_code "$url")
  if [[ "$code" != "200" && "$code" != "204" ]]; then
    case "$name" in
      sandbox) code=$(http_code "http://127.0.0.1:17330/api/sandbox/health") ;;
      mempalace) code=$(http_code "http://127.0.0.1:17333/mcp/status") ;;
      proxy) code=$(http_code "http://127.0.0.1:17332/") ;;
      vite) code=$(http_code "http://127.0.0.1:5173/index.html") ;;
    esac
  fi
  t1=$(python3 -c 'import time; print(int(time.time()*1000))' 2>/dev/null || echo 0)
  ms=$((t1 - t0))
  [[ "$ms" -lt 0 ]] && ms=0
  listen=$(port_listen "$port")
  if [[ "$code" =~ ^2 ]]; then
    status="UP"
  elif [[ -n "$listen" ]]; then
    status="DEGRADED"
  else
    status="DOWN"
  fi
  printf '%s %s %s %s %s' "$status" "$code" "$ms" "${listen:--}" "$url"
}

scan_errors() {
  local paths=()
  [[ -d "$LOG_DIR" ]] && paths+=("$LOG_DIR")
  [[ -d "$ABLITERATED/logs" ]] && paths+=("$ABLITERATED/logs")
  [[ -d "$RUN_DIR" ]] && paths+=("$RUN_DIR")

  if [[ ${#paths[@]} -eq 0 ]]; then
    echo "(no log dirs)"
    return 0
  fi

  if command -v rg >/dev/null 2>&1; then
    rg -n --no-heading -i \
      -e '"level":"error"|ECONNREFUSED|ENOTFOUND|FATAL|Unhandled|traceback|model_gated|CORS' \
      --glob '*.log' --glob '*.jsonl' \
      --glob '!**/node_modules/**' \
      --max-count 6 \
      "${paths[@]}" 2>/dev/null | tail -n 10 || true
  else
    grep -rniE 'ECONNREFUSED|FATAL|traceback|"level":"error"' --include='*.log' --include='*.jsonl' "${paths[@]}" 2>/dev/null \
      | grep -v node_modules | tail -n 10 || true
  fi
}

snapshot() {
  local ts entry name url port status code ms listen probe
  ts=$(date '+%Y-%m-%d %H:%M:%S %Z')
  {
    printf '\n======== %s ========\n' "$ts"
    printf 'AIUI monitor  root=%s  interval=%ss  pid=%s\n' "$ROOT" "$INTERVAL" "$$"
  } | tee -a "$HUMAN_LOG" >/dev/null

  local json_parts=()
  for entry in "${SERVICES[@]}"; do
    IFS='|' read -r name url port <<<"$entry"
    read -r status code ms listen probe <<<"$(probe_service "$name" "$url" "$port")"
    printf '  %-10s %-8s http=%-3s %4sms  listen=%-20s %s\n' \
      "$name" "$status" "$code" "$ms" "$listen" "$probe" | tee -a "$HUMAN_LOG" >/dev/null
    json_parts+=("{\"name\":\"$name\",\"status\":\"$status\",\"http\":$code,\"ms\":$ms,\"port\":$port,\"listen\":\"$listen\"}")
  done

  echo "  -- recent errors / warnings --" | tee -a "$HUMAN_LOG" >/dev/null
  local err_block
  err_block=$(scan_errors || true)
  if [[ -z "${err_block//[$' \t\n']/}" ]]; then
    echo "  (none matched)" | tee -a "$HUMAN_LOG" >/dev/null
  else
    printf '%s\n' "$err_block" | sed 's/^/  /' | tee -a "$HUMAN_LOG" >/dev/null
  fi

  local joined
  joined=$(IFS=,; echo "${json_parts[*]}")
  printf '{"ts":"%s","services":[%s]}\n' "$ts" "$joined" >> "$JSONL"
  cp "$HUMAN_LOG" "$LATEST_LOG" 2>/dev/null || true
  cp "$JSONL" "$LATEST_JSONL" 2>/dev/null || true
}

cleanup() {
  rm -f "$PID_FILE"
  echo "monitor stopped $(date '+%Y-%m-%d %H:%M:%S %Z')" >> "$HUMAN_LOG" 2>/dev/null || true
  cp "$HUMAN_LOG" "$LATEST_LOG" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo $$ > "$PID_FILE"
{
  echo "AIUI debug monitor started pid=$$"
  echo "  human:  $HUMAN_LOG"
  echo "  jsonl:  $JSONL"
  echo "  latest: $LATEST_LOG"
} | tee "$HUMAN_LOG"
: > "$JSONL"

snapshot || true
if [[ "$ONCE" -eq 1 ]]; then
  exit 0
fi

while true; do
  sleep "$INTERVAL" || true
  snapshot || true
done
