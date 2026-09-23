#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

echo "⚡ Setting up 'aiui' quick-action start..."

# 1. Prepare ~/aiui-agent directory
mkdir -p "$HOME/aiui-agent" "$HOME/.local/bin"

# 2. Sync scripts to ~/aiui-agent
cp "$ROOT_DIR/scripts/aiui-agent.mjs" "$HOME/aiui-agent/aiui-agent.mjs"
cp "$ROOT_DIR/scripts/dynamic-tool-manager.mjs" "$HOME/aiui-agent/dynamic-tool-manager.mjs" 2>/dev/null || true
cp "$ROOT_DIR/scripts/matrix.sh" "$HOME/aiui-agent/matrix.sh" 2>/dev/null || true
chmod +x "$HOME/aiui-agent/aiui-agent.mjs"
if [[ -f "$ROOT_DIR/src/lib/scaffoldTemplates.json" ]]; then
  cp "$ROOT_DIR/src/lib/scaffoldTemplates.json" "$HOME/aiui-agent/scaffoldTemplates.json"
fi

# 3. Create global symlinks in ~/.local/bin
chmod +x "$ROOT_DIR/aiui"
ln -sf "$ROOT_DIR/aiui" "$HOME/.local/bin/aiui"
ln -sf "$ROOT_DIR/aiui" "$HOME/.local/bin/aiui-agent"
chmod +x "$HOME/.local/bin/aiui" "$HOME/.local/bin/aiui-agent"

# 4. Update or add aliases to ~/.zshrc
if [[ -f "$HOME/.zshrc" ]]; then
  sed -i '' "s|alias aiui=.*|alias aiui='$ROOT_DIR/aiui'|g" "$HOME/.zshrc" 2>/dev/null || true
  sed -i '' "s|alias aiui-agent=.*|alias aiui-agent='$ROOT_DIR/aiui'|g" "$HOME/.zshrc" 2>/dev/null || true
  if ! grep -q "alias aiui=" "$HOME/.zshrc" 2>/dev/null; then
    echo "alias aiui='$ROOT_DIR/aiui'" >> "$HOME/.zshrc"
    echo "alias aiui-agent='$ROOT_DIR/aiui'" >> "$HOME/.zshrc"
  fi
  echo "✔ Configured alias aiui in ~/.zshrc"
fi

# 5. Update or add aliases to ~/.bashrc if present
if [[ -f "$HOME/.bashrc" ]]; then
  sed -i '' "s|alias aiui=.*|alias aiui='$ROOT_DIR/aiui'|g" "$HOME/.bashrc" 2>/dev/null || true
  sed -i '' "s|alias aiui-agent=.*|alias aiui-agent='$ROOT_DIR/aiui'|g" "$HOME/.bashrc" 2>/dev/null || true
  if ! grep -q "alias aiui=" "$HOME/.bashrc" 2>/dev/null; then
    echo "alias aiui='$ROOT_DIR/aiui'" >> "$HOME/.bashrc"
    echo "alias aiui-agent='$ROOT_DIR/aiui'" >> "$HOME/.bashrc"
  fi
  echo "✔ Configured alias aiui in ~/.bashrc"
fi

echo "✔ Quick action 'aiui' installed successfully!"
echo "Run: 'source ~/.zshrc' or launch with: 'aiui'"
