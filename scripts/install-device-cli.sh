#!/usr/bin/env bash
# ==============================================================================
#  ⚡ AIUI TERMINAL PULL & INSTALL SUITE FOR ANY NETWORK DEVICE
# ==============================================================================
#  Install and run the AIUI CLI agent from any computer across the LAN
#  (Mac, Linux, WSL). Enables running from each local directory respectively
#  with live user interjection, zero hardcoded paths, and remote Spark vLLM.
#
#  Usage from any computer on the network:
#    curl -fsSL http://192.168.4.50:17333/install.sh | bash
#  Or with custom host:
#    curl -fsSL http://192.168.4.50:17333/install.sh | bash -s -- --host 192.168.4.103
#  Or locally on host machine:
#    ./scripts/install-device-cli.sh --local
# ==============================================================================

set -eo pipefail

# ANSI color codes
CYAN='\033[38;2;0;240;255m'
VIOLET='\033[38;2;168;85;247m'
GOLD='\033[38;2;251;191;36m'
GREEN='\033[38;2;16;185;129m'
RED='\033[38;2;239;68;68m'
MUTED='\033[38;2;148;163;184m'
BOLD='\033[1m'
RESET='\033[0m'

printf "\n"
printf "${CYAN}${BOLD}  █████╗ ██╗██╗   ██╗██╗${RESET}  ${VIOLET}${BOLD}⚡ SOVEREIGN AI CLUSTER CLIENT${RESET}\n"
printf "${CYAN}${BOLD} ██╔══██╗██║██║   ██║██║${RESET}  ${MUTED}Universal Device Installer & Shell Controller${RESET}\n"
printf "${CYAN}${BOLD} ███████║██║██║   ██║██║${RESET}  ${GOLD}Local Directory Execution & DGX Spark Mesh${RESET}\n"
printf "${CYAN}${BOLD} ██╔══██║██║██║   ██║██║${RESET}\n"
printf "${CYAN}${BOLD} ██║  ██║██║╚██████╔╝██║${RESET}\n"
printf "${CYAN}${BOLD} ╚═╝  ╚═╝╚═╝ ╚═════╝ ╚═╝${RESET}\n"
printf "\n"

# Default configuration
BRIDGE_HOST="192.168.4.50"
BRIDGE_PORT="17333"
SPARK_HOST="192.168.4.103"
SPARK_PORT="8000"
INSTALL_DIR="${HOME}/.aiui"
LOCAL_MODE=false

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --local)
      LOCAL_MODE=true
      shift
      ;;
    --host|--spark-host)
      SPARK_HOST="$2"
      shift 2
      ;;
    --bridge|--server)
      BRIDGE_HOST="$2"
      shift 2
      ;;
    --key|--ssh-key)
      SPARK_SSH_KEY="$2"
      shift 2
      ;;
    --dir)
      INSTALL_DIR="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

printf "${VIOLET}╭──────────────────────────────────────────────────────────────────────────╮${RESET}\n"
printf "${VIOLET}│${RESET}  ${BOLD}TARGET PLATFORM AUDIT & ENVIRONMENT CHECK${RESET}                               ${VIOLET}│${RESET}\n"
printf "${VIOLET}╰──────────────────────────────────────────────────────────────────────────╯${RESET}\n"

# 1. Audit OS & Architecture
OS="$(uname -s)"
ARCH="$(uname -m)"
printf "  ${CYAN}•${RESET} Host Operating System:  ${BOLD}${OS} (${ARCH})${RESET}\n"
printf "  ${CYAN}•${RESET} Local Hostname:          ${MUTED}$(hostname)${RESET}\n"
printf "  ${CYAN}•${RESET} Target Spark Host:       ${GOLD}${SPARK_HOST}:${SPARK_PORT}${RESET}\n"
printf "  ${CYAN}•${RESET} AIUI Install Directory:  ${MUTED}${INSTALL_DIR}${RESET}\n"

# 2. Check Node.js runtime
if ! command -v node >/dev/null 2>&1; then
  printf "\n${RED}${BOLD}✘ Node.js not found!${RESET}\n"
  printf "  Node.js (v18+) is required to run the AIUI terminal client.\n"
  if [[ "$OS" == "Darwin" ]]; then
    printf "  Install via Homebrew:  ${CYAN}brew install node${RESET}\n"
  else
    printf "  Install via NodeSource: ${CYAN}curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt install -y nodejs${RESET}\n"
    printf "  Or install via nvm:    ${CYAN}curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash${RESET}\n"
  fi
  exit 1
fi

NODE_VER="$(node -v)"
printf "  ${GREEN}✔${RESET} Node.js Runtime:        ${GREEN}${NODE_VER}${RESET}\n"

# 3. Setup client files
printf "\n${VIOLET}╭──────────────────────────────────────────────────────────────────────────╮${RESET}\n"
printf "${VIOLET}│${RESET}  ${BOLD}INSTALLING AIUI CLIENT SUITE${RESET}                                             ${VIOLET}│${RESET}\n"
printf "${VIOLET}╰──────────────────────────────────────────────────────────────────────────╯${RESET}\n"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AIUI_ROOT="$(cd "$SCRIPT_DIR/.." && pwd 2>/dev/null || true)"

if [[ "$LOCAL_MODE" == "true" ]] || [[ -f "$AIUI_ROOT/scripts/aiui-agent.mjs" && "$AIUI_ROOT" != "$INSTALL_DIR" && -d "$AIUI_ROOT/scripts/aiui-agent" ]]; then
  printf "  ${CYAN}•${RESET} Detected local repository at ${BOLD}${AIUI_ROOT}${RESET}\n"
  INSTALL_DIR="$AIUI_ROOT"
  printf "  ${GREEN}✔${RESET} Configured direct local workspace link\n"
else
  printf "  ${CYAN}•${RESET} Preparing client directory: ${INSTALL_DIR}...\n"
  mkdir -p "$INSTALL_DIR"
  BUNDLE_URL="http://${BRIDGE_HOST}:${BRIDGE_PORT}/dist/aiui-client.tar.gz"
  
  printf "  ${CYAN}•${RESET} Fetching AIUI client bundle from ${BUNDLE_URL}...\n"
  if curl -fsSL --connect-timeout 5 "$BUNDLE_URL" -o /tmp/aiui-client.tar.gz 2>/dev/null; then
    tar -xzf /tmp/aiui-client.tar.gz -C "$INSTALL_DIR"
    rm -f /tmp/aiui-client.tar.gz
    printf "  ${GREEN}✔${RESET} Unpacked AIUI client distribution\n"
  elif [[ -f "${HOME}/AIUI/dist/aiui-client.tar.gz" ]]; then
    tar -xzf "${HOME}/AIUI/dist/aiui-client.tar.gz" -C "$INSTALL_DIR"
    printf "  ${GREEN}✔${RESET} Unpacked pre-built bundle from ~/AIUI/dist\n"
  elif [[ -d "${HOME}/AIUI/scripts/aiui-agent" ]]; then
    printf "  ${CYAN}•${RESET} Detected local repository at ${BOLD}${HOME}/AIUI${RESET}\n"
    INSTALL_DIR="${HOME}/AIUI"
    printf "  ${GREEN}✔${RESET} Linked direct local workspace at ~/AIUI\n"
  elif [[ -f "$SCRIPT_DIR/../dist/aiui-client.tar.gz" ]]; then
    tar -xzf "$SCRIPT_DIR/../dist/aiui-client.tar.gz" -C "$INSTALL_DIR"
    printf "  ${GREEN}✔${RESET} Unpacked local pre-built bundle\n"
  elif [[ -d "$AIUI_ROOT/scripts" ]]; then
    cp -R "$AIUI_ROOT/aiui" "$AIUI_ROOT/bin" "$AIUI_ROOT/package.json" "$AIUI_ROOT/scripts" "$INSTALL_DIR/"
    printf "  ${GREEN}✔${RESET} Mirrored client scripts to ${INSTALL_DIR}\n"
  else
    printf "  ${RED}✘ Failed to download client bundle from ${BUNDLE_URL}${RESET}\n"
    printf "  Ensure the AIUI server is running on ${BRIDGE_HOST}:${BRIDGE_PORT}, or run directly from the AIUI directory:\n"
    printf "    ${CYAN}cd ~/AIUI && ./scripts/install-device-cli.sh --local${RESET}\n"
    exit 1
  fi
fi

# Ensure executable permissions
chmod +x "$INSTALL_DIR/aiui" 2>/dev/null || true
if [[ -f "$INSTALL_DIR/bin/aiui" ]]; then
  chmod +x "$INSTALL_DIR/bin/aiui"
fi

# 4. Prompt / Detect SSH Key for DGX Spark Cluster Access
printf "\n${VIOLET}╭──────────────────────────────────────────────────────────────────────────╮${RESET}\n"
printf "${VIOLET}│${RESET}  ${BOLD}DGX SPARK SSH ACCESS & AUTHENTICATION KEY${RESET}                               ${VIOLET}│${RESET}\n"
printf "${VIOLET}╰──────────────────────────────────────────────────────────────────────────╯${RESET}\n"

CHOSEN_SSH_KEY="${SPARK_SSH_KEY:-}"

# Auto-detect existing keys on host
DETECTED_KEY=""
for candidate in \
  "$HOME/Library/Application Support/NVIDIA/Sync/config/nvsync.key" \
  "$HOME/.ssh/id_ed25519" \
  "$HOME/.ssh/id_rsa" \
  "$HOME/.ssh/spark.key" \
  "$HOME/.ssh/nvsync.key"; do
  if [[ -f "$candidate" ]]; then
    DETECTED_KEY="$candidate"
    break
  fi
done

# If running interactively, prompt user
if [[ -z "$CHOSEN_SSH_KEY" ]]; then
  TTY_SRC=""
  if [[ -c /dev/tty ]]; then
    TTY_SRC="/dev/tty"
  elif [[ -t 0 ]]; then
    TTY_SRC="&0"
  fi

  if [[ -n "$TTY_SRC" ]]; then
    if [[ -n "$DETECTED_KEY" ]]; then
      printf "  ${CYAN}•${RESET} Detected SSH Key on device: ${BOLD}${DETECTED_KEY}${RESET}\n"
      printf "  ${GOLD}Use this SSH key for DGX Spark cluster access? [Y/n/custom path]: ${RESET}"
      if [[ "$TTY_SRC" == "/dev/tty" ]]; then
        read -r user_choice < /dev/tty || user_choice=""
      else
        read -r user_choice || user_choice=""
      fi
      user_choice="$(echo "$user_choice" | tr '[:upper:]' '[:lower:]')"

      if [[ -z "$user_choice" || "$user_choice" == "y" || "$user_choice" == "yes" ]]; then
        CHOSEN_SSH_KEY="$DETECTED_KEY"
      elif [[ "$user_choice" == "n" || "$user_choice" == "no" ]]; then
        CHOSEN_SSH_KEY=""
      else
        EXPANDED_PATH="${user_choice/#\~/$HOME}"
        if [[ -f "$EXPANDED_PATH" ]]; then
          CHOSEN_SSH_KEY="$EXPANDED_PATH"
        else
          printf "  ${RED}✘ File not found at ${EXPANDED_PATH}. Proceeding without SSH key.${RESET}\n"
        fi
      fi
    else
      printf "  ${GOLD}Do you have an SSH private key for DGX Spark (${SPARK_USER:-flak3dd}@${SPARK_HOST})? [y/N]: ${RESET}"
      if [[ "$TTY_SRC" == "/dev/tty" ]]; then
        read -r has_key < /dev/tty || has_key=""
      else
        read -r has_key || has_key=""
      fi
      has_key="$(echo "$has_key" | tr '[:upper:]' '[:lower:]')"

      if [[ "$has_key" == "y" || "$has_key" == "yes" ]]; then
        printf "  ${CYAN}Enter full path to SSH private key (e.g. ~/.ssh/id_ed25519): ${RESET}"
        if [[ "$TTY_SRC" == "/dev/tty" ]]; then
          read -r key_input < /dev/tty || key_input=""
        else
          read -r key_input || key_input=""
        fi
        EXPANDED_PATH="${key_input/#\~/$HOME}"
        if [[ -f "$EXPANDED_PATH" ]]; then
          CHOSEN_SSH_KEY="$EXPANDED_PATH"
        else
          printf "  ${RED}✘ File not found at ${EXPANDED_PATH}. Proceeding without SSH key.${RESET}\n"
        fi
      fi
    fi
  else
    # Non-interactive fallback: auto-assign detected key if present
    CHOSEN_SSH_KEY="$DETECTED_KEY"
  fi
fi

if [[ -n "$CHOSEN_SSH_KEY" && -f "$CHOSEN_SSH_KEY" ]]; then
  chmod 600 "$CHOSEN_SSH_KEY" 2>/dev/null || true
  printf "  ${GREEN}✔${RESET} Configured Spark SSH Key: ${GREEN}${CHOSEN_SSH_KEY}${RESET}\n"
else
  printf "  ${MUTED}• Note: No SSH key configured. Model inference will connect directly via HTTP (:8000).${RESET}\n"
  printf "  ${MUTED}  (You can add an SSH key anytime by setting SPARK_SSH_KEY in ~/.aiuirc)${RESET}\n"
fi

# 5. Generate ~/.aiuirc environment file
printf "\n  ${CYAN}•${RESET} Generating client environment config (~/.aiuirc)...\n"
cat > "${HOME}/.aiuirc" <<EOF
# ==============================================================================
# ⚡ AIUI SOVEREIGN CLUSTER CLIENT CONFIGURATION
# Generated on $(date) for $(hostname)
# ==============================================================================
export AIUI_HOME="${INSTALL_DIR}"
export SPARK_HOST="${SPARK_HOST}"
export AIUI_PROVIDER="spark"
export MEMPALACE_URL="http://${BRIDGE_HOST}:${BRIDGE_PORT}"
export SPARK_SSH_KEY="${CHOSEN_SSH_KEY}"
export PATH="\${HOME}/.local/bin:\${HOME}/bin:\${PATH}"
EOF
printf "  ${GREEN}✔${RESET} Wrote ${HOME}/.aiuirc\n"

# 5. Configure global PATH and symlinks
mkdir -p "${HOME}/.local/bin" "${HOME}/bin"
ln -sf "${INSTALL_DIR}/aiui" "${HOME}/.local/bin/aiui"
ln -sf "${INSTALL_DIR}/aiui" "${HOME}/.local/bin/aiui-agent"
ln -sf "${INSTALL_DIR}/aiui" "${HOME}/bin/aiui" 2>/dev/null || true
ln -sf "${INSTALL_DIR}/aiui" "${HOME}/bin/aiui-agent" 2>/dev/null || true

# Attempt /usr/local/bin if writable
if [[ -w "/usr/local/bin" ]]; then
  ln -sf "${INSTALL_DIR}/aiui" "/usr/local/bin/aiui" 2>/dev/null || true
  ln -sf "${INSTALL_DIR}/aiui" "/usr/local/bin/aiui-agent" 2>/dev/null || true
  printf "  ${GREEN}✔${RESET} Symlinked to /usr/local/bin/aiui\n"
fi
printf "  ${GREEN}✔${RESET} Symlinked to ~/.local/bin/aiui\n"

# 6. Source .aiuirc in shell profiles
for rc in "${HOME}/.zshrc" "${HOME}/.bashrc" "${HOME}/.profile"; do
  if [[ -f "$rc" ]]; then
    if ! grep -q '\.aiuirc' "$rc" 2>/dev/null; then
      printf "\n# AIUI Sovereign Client\n[ -f \"\$HOME/.aiuirc\" ] && source \"\$HOME/.aiuirc\"\n" >> "$rc"
      printf "  ${GREEN}✔${RESET} Configured $(basename "$rc")\n"
    fi
  fi
done

# 7. Network connectivity probe
printf "\n${VIOLET}╭──────────────────────────────────────────────────────────────────────────╮${RESET}\n"
printf "${VIOLET}│${RESET}  ${BOLD}NETWORK CLUSTER CONNECTIVITY PROBE${RESET}                                      ${VIOLET}│${RESET}\n"
printf "${VIOLET}╰──────────────────────────────────────────────────────────────────────────╯${RESET}\n"

printf "  ${CYAN}•${RESET} Probing DGX Spark vLLM (http://${SPARK_HOST}:${SPARK_PORT}/v1/models)... "
if curl -fsSL --connect-timeout 3 "http://${SPARK_HOST}:${SPARK_PORT}/v1/models" >/tmp/aiui-probe.json 2>/dev/null; then
  MODEL_NAME="$(grep -o '"id": *"[^"]*"' /tmp/aiui-probe.json 2>/dev/null | head -n1 | cut -d'"' -f4 || echo 'active')"
  rm -f /tmp/aiui-probe.json
  printf "${GREEN}${BOLD}ONLINE${RESET} (${MODEL_NAME})\n"
else
  printf "${GOLD}${BOLD}STANDBY / UNREACHABLE${RESET} (Will auto-route when cluster starts)\n"
fi

printf "  ${CYAN}•${RESET} Probing MemPalace Knowledge Bridge (http://${BRIDGE_HOST}:${BRIDGE_PORT}/health)... "
if curl -fsSL --connect-timeout 2 "http://${BRIDGE_HOST}:${BRIDGE_PORT}/health" >/dev/null 2>&1; then
  printf "${GREEN}${BOLD}ONLINE${RESET}\n"
else
  printf "${MUTED}${BOLD}OFFLINE${RESET} (Local fallback memory active)\n"
fi

# 8. Success summary & usage banner
printf "\n"
printf "${GREEN}══════════════════════════════════════════════════════════════════════════${RESET}\n"
printf "${GREEN}${BOLD}✔ AIUI CLI IS READY ON THIS DEVICE!${RESET}\n"
printf "${GREEN}══════════════════════════════════════════════════════════════════════════${RESET}\n"
printf "\n"
printf "  ${BOLD}How to run from any local directory:${RESET}\n"
printf "    ${CYAN}cd /path/to/any/project${RESET}\n"
printf "    ${CYAN}aiui \"Fix the type error in src/index.ts and run tests\"${RESET}\n"
printf "\n"
printf "  ${BOLD}Interactive REPL mode with Live User Interjection:${RESET}\n"
printf "    ${CYAN}aiui${RESET}              ${MUTED}# Launches interactive terminal agent${RESET}\n"
printf "    ${CYAN}aiui -P spark${RESET}     ${MUTED}# Explicitly target DGX Spark vLLM${RESET}\n"
printf "\n"
printf "  ${GOLD}⚡ Live Interjection Feature:${RESET}\n"
printf "    While the agent is thinking or running tools, you can type at any time\n"
printf "    and press ${BOLD}Enter${RESET} to steer the agent immediately, or type ${BOLD}'stop'${RESET} to abort!\n"
printf "\n"
printf "  ${MUTED}To apply environment changes to the current terminal:${RESET}\n"
printf "    ${BOLD}source ~/.aiuirc${RESET}\n"
printf "\n"
