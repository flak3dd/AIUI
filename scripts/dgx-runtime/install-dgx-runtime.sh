#!/usr/bin/env bash
# ==============================================================================
# install-dgx-runtime.sh — Deploy DGX Spark Per-Chat Workspace Runtime
# ==============================================================================
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SPARK_HOST="${SPARK_HOST:-192.168.4.103}"
SPARK_USER="${SPARK_USER:-flak3dd}"
SSH_KEY="${SPARK_SSH_KEY:-$HOME/Library/Application Support/NVIDIA/Sync/config/nvsync.key}"

echo "======================================================================"
echo "⚡ DEPLOYING DGX SPARK WORKSPACE RUNNER & ALLOCATOR"
echo "   Target: $SPARK_USER@$SPARK_HOST"
echo "======================================================================"

SSH_OPTS=(-o StrictHostKeyChecking=no -o ConnectTimeout=8)
if [[ -f "$SSH_KEY" ]]; then
  SSH_OPTS+=(-i "$SSH_KEY")
fi

# 1. Copy modules and tests to DGX
echo "• Transferring allocator, sync module, and unit tests..."
scp "${SSH_OPTS[@]}" \
  "$DIR/sandbox-workspaces.mjs" \
  "$DIR/sandbox-workspaces.test.mjs" \
  "$DIR/sandbox-git-sync.mjs" \
  "$DIR/sandbox-git-sync.test.mjs" \
  "$DIR/patch-sandbox-runner.mjs" \
  "$SPARK_USER@$SPARK_HOST:~/abliterated_ui/scripts/"

# 2. Patch runner and execute test suites on DGX
echo "• Patching sandbox-runner.mjs and executing test suites on DGX..."
ssh "${SSH_OPTS[@]}" "$SPARK_USER@$SPARK_HOST" bash -s <<'EOF'
set -euo pipefail
cd ~/abliterated_ui

echo "  -> Applying route patch to sandbox-runner.mjs..."
node scripts/patch-sandbox-runner.mjs ~/abliterated_ui/scripts/sandbox-runner.mjs

echo "  -> Running sandbox-workspaces.test.mjs..."
node scripts/sandbox-workspaces.test.mjs

echo "  -> Running sandbox-git-sync.test.mjs..."
node scripts/sandbox-git-sync.test.mjs

echo "• Installing systemd user unit for spark-sandbox-runner..."
mkdir -p ~/.config/systemd/user
EOF

# 3. Transfer systemd unit and enable
scp "${SSH_OPTS[@]}" \
  "$DIR/spark-sandbox-runner.service" \
  "$SPARK_USER@$SPARK_HOST:~/.config/systemd/user/"

ssh "${SSH_OPTS[@]}" "$SPARK_USER@$SPARK_HOST" bash -s <<'EOF'
set -euo pipefail
loginctl enable-linger "$USER" 2>/dev/null || true
systemctl --user daemon-reload
systemctl --user enable --now spark-sandbox-runner.service
systemctl --user restart spark-sandbox-runner.service

echo "• Verifying runner health & workspaces endpoint..."
sleep 1
curl -sS -m 3 http://127.0.0.1:17330/api/sandbox/workspaces
EOF

echo ""
echo "======================================================================"
echo "✔ DGX Spark Per-Chat Workspace Runtime successfully deployed!"
echo "======================================================================"
