#!/usr/bin/env bash
# ==============================================================================
#  CYBERNETIC DIGITAL MATRIX — FEATHERLESS VIOLET / CYAN EDITION
#  Ultra-Fast TrueColor Terminal Visualizer & Phosphor ASCII Rain
#  Compatible with macOS (Default Bash 3.2+ / Zsh) & Linux
# ==============================================================================

# Ensure terminal state is gracefully restored
cleanup() {
  trap - EXIT INT TERM
  printf "\033[?25h\033[0m\033[?1049l"
  stty echo icanon 2>/dev/null || true
  exit 0
}
trap cleanup EXIT INT TERM

# Enter alternate screen buffer & hide cursor
printf "\033[?1049h\033[?25l\033[2J"
stty -echo -icanon 2>/dev/null || true

# ------------------------------------------------------------------------------
# 24-bit TrueColor Palettes (Native ANSI-C strings for zero-overhead rendering)
# ------------------------------------------------------------------------------
CURRENT_PALETTE=0
COLOR_RESET=$'\033[0m'

get_colors() {
  case $CURRENT_PALETTE in
    0)
      COLOR_LEAD=$'\033[38;2;255;255;255;1m'      # Pure white-hot lead
      COLOR_SPARK=$'\033[38;2;0;242;254;1m'       # Radiant cyan spark
      COLOR_T1=$'\033[38;2;6;182;212m'            # Electric cyan
      COLOR_T2=$'\033[38;2;168;85;247m'           # Ultraviolet
      COLOR_T3=$'\033[38;2;139;92;246m'           # Deep violet
      COLOR_FAINT=$'\033[38;2;76;29;149m'         # Abyssal purple
      COLOR_HUD=$'\033[38;2;0;242;254;1m'
      PALETTE_NAME="FEATHERLESS NEON (VIOLET/CYAN)"
      ;;
    1)
      COLOR_LEAD=$'\033[38;2;255;255;255;1m'
      COLOR_SPARK=$'\033[38;2;110;231;183;1m'
      COLOR_T1=$'\033[38;2;16;185;129m'
      COLOR_T2=$'\033[38;2;5;150;105m'
      COLOR_T3=$'\033[38;2;4;120;87m'
      COLOR_FAINT=$'\033[38;2;2;44;34m'
      COLOR_HUD=$'\033[38;2;52;211;153;1m'
      PALETTE_NAME="CYBERPUNK EMERALD"
      ;;
    2)
      COLOR_LEAD=$'\033[38;2;255;255;255;1m'
      COLOR_SPARK=$'\033[38;2;254;240;138;1m'
      COLOR_T1=$'\033[38;2;251;191;36m'
      COLOR_T2=$'\033[38;2;245;158;11m'
      COLOR_T3=$'\033[38;2;217;119;6m'
      COLOR_FAINT=$'\033[38;2;120;53;15m'
      COLOR_HUD=$'\033[38;2;251;191;36;1m'
      PALETTE_NAME="OBSIDIAN SOLAR GOLD"
      ;;
    3)
      COLOR_LEAD=$'\033[38;2;255;255;255;1m'
      COLOR_SPARK=$'\033[38;2;254;205;211;1m'
      COLOR_T1=$'\033[38;2;251;113;133m'
      COLOR_T2=$'\033[38;2;244;63;94m'
      COLOR_T3=$'\033[38;2;225;29;72m'
      COLOR_FAINT=$'\033[38;2;136;19;55m'
      COLOR_HUD=$'\033[38;2;244;63;94;1m'
      PALETTE_NAME="BREACH PROTOCOL CRIMSON"
      ;;
  esac
}
get_colors

# Fixed 1-column-width character pool: Half-width Katakana + Hex + Math operators
GLYPHS=(
  "ｦ" "ｧ" "ｨ" "ｩ" "ｪ" "ｫ" "ｬ" "ｭ" "ｮ" "ｯ" "ｰ" "ｱ" "ｲ" "ｳ" "ｴ" "ｵ" "ｶ" "ｷ" "ｸ" "ｹ" "ｺ" "ｻ" "ｼ" "ｽ" "ｾ" "ｿ"
  "ﾀ" "ﾁ" "ﾂ" "ﾃ" "ﾄ" "ﾅ" "ﾆ" "ﾇ" "ﾈ" "ﾉ" "ﾊ" "ﾋ" "ﾌ" "ﾍ" "ﾎ" "ﾏ" "ﾐ" "ﾑ" "ﾒ" "ﾓ" "ﾔ" "ﾕ" "ﾖ" "ﾗ" "ﾘ" "ﾙ" "ﾚ" "ﾛ" "ﾜ" "ﾝ"
  "0" "1" "2" "3" "4" "5" "6" "7" "8" "9"
  "A" "B" "C" "D" "E" "F" "X" "Y" "Z"
  "#" "%" "*" "+" "-" "=" ":" "<" ">" "/" "~" "$" "@" "!"
)
NUM_GLYPHS=${#GLYPHS[@]}

# Grid Dimensions & State
update_dimensions() {
  COLS=$(tput cols 2>/dev/null)
  LINES=$(tput lines 2>/dev/null)
  case "$COLS" in ''|*[!0-9]*) COLS=80 ;; esac
  case "$LINES" in ''|*[!0-9]*) LINES=24 ;; esac
  [ "$COLS" -lt 10 ] && COLS=80
  [ "$LINES" -lt 5 ] && LINES=24

  HEAD_Y=()
  DROP_LEN=()
  SPEED_DELAY=()
  STEP_COUNT=()
  GLYPH_BUF=()

  local c=1
  while [ "$c" -le "$COLS" ]; do
    HEAD_Y[$c]=$(( (RANDOM % LINES) - LINES ))
    DROP_LEN[$c]=$(( (RANDOM % (LINES / 2 + 6)) + 8 ))
    SPEED_DELAY[$c]=$(( (RANDOM % 3) + 1 ))
    STEP_COUNT[$c]=0
    GLYPH_BUF[$c]="${GLYPHS[$((RANDOM % NUM_GLYPHS))]}"
    c=$((c + 1))
  done
}
update_dimensions
trap update_dimensions SIGWINCH

draw_hud() {
  local hud_text="[ ⚡ FEATHERLESS MATRIX // $PALETTE_NAME // [1-4] THEME  [G] GLITCH  [Q] QUIT ]"
  local pad=$(( (COLS - ${#hud_text}) / 2 ))
  [ "$pad" -lt 1 ] && pad=1
  printf "\033[1;%dH%s%s%s" "$pad" "$COLOR_HUD" "$hud_text" "$COLOR_RESET"
}

# ------------------------------------------------------------------------------
# Main Visualizer Loop
# ------------------------------------------------------------------------------
run_matrix() {
  local frame=0
  local fps_sleep="0.03"
  local key=""
  local c=1
  local hy=0
  local dlen=0
  local step=0
  local delay=0
  local g=""
  local py=0
  local t1=0
  local t2=0
  local t3=0
  local t4=0
  local erase_y=0

  # Initial HUD draw
  draw_hud

  while true; do
    frame=$((frame + 1))

    # Completely non-blocking keyboard check:
    # read -t 0 tests if input is pending without reading or blocking.
    # If a key is waiting, read -r -s -n 1 consumes it immediately.
    if read -t 0 2>/dev/null; then
      read -r -s -n 1 key 2>/dev/null
      case "$key" in
        q|Q) cleanup ;;
        1) CURRENT_PALETTE=0; get_colors; draw_hud ;;
        2) CURRENT_PALETTE=1; get_colors; draw_hud ;;
        3) CURRENT_PALETTE=2; get_colors; draw_hud ;;
        4) CURRENT_PALETTE=3; get_colors; draw_hud ;;
        g|G)
          printf "\033[48;2;255;40;100m\033[2J\033[0m"
          sleep 0.04 2>/dev/null || true
          printf "\033[2J"
          draw_hud
          ;;
        +) fps_sleep="0.015" ;;
        -) fps_sleep="0.05" ;;
      esac
    fi

    # Redraw HUD every 40 frames
    if [ $((frame % 40)) -eq 0 ]; then
      draw_hud
    fi

    # Iterate through columns (step by 2 for optimal monospace aspect ratio)
    c=1
    while [ "$c" -le "$COLS" ]; do
      step=${STEP_COUNT[$c]:-0}
      delay=${SPEED_DELAY[$c]:-2}

      if [ "$step" -ge "$delay" ]; then
        STEP_COUNT[$c]=0
        hy=${HEAD_Y[$c]:-0}
        dlen=${DROP_LEN[$c]:-12}

        # Draw glowing lead character
        if [ "$hy" -ge 2 ] && [ "$hy" -le "$LINES" ]; then
          g="${GLYPHS[$((RANDOM % NUM_GLYPHS))]}"
          GLYPH_BUF[$c]="$g"
          printf "\033[%d;%dH%s%s%s" "$hy" "$c" "$COLOR_LEAD" "$g" "$COLOR_RESET"
        fi

        # Draw spark character right behind lead
        py=$((hy - 1))
        if [ "$py" -ge 2 ] && [ "$py" -le "$LINES" ]; then
          printf "\033[%d;%dH%s%s%s" "$py" "$c" "$COLOR_SPARK" "${GLYPH_BUF[$c]}" "$COLOR_RESET"
        fi

        # Draw gradient phosphor trail (Zero subshell overhead)
        t1=$((hy - 2))
        if [ "$t1" -ge 2 ] && [ "$t1" -le "$LINES" ]; then
          printf "\033[%d;%dH%s%s%s" "$t1" "$c" "$COLOR_T1" "${GLYPHS[$((RANDOM % NUM_GLYPHS))]}" "$COLOR_RESET"
        fi

        t2=$((hy - 4))
        if [ "$t2" -ge 2 ] && [ "$t2" -le "$LINES" ]; then
          printf "\033[%d;%dH%s%s%s" "$t2" "$c" "$COLOR_T2" "${GLYPHS[$((RANDOM % NUM_GLYPHS))]}" "$COLOR_RESET"
        fi

        t3=$((hy - 7))
        if [ "$t3" -ge 2 ] && [ "$t3" -le "$LINES" ]; then
          printf "\033[%d;%dH%s%s%s" "$t3" "$c" "$COLOR_T3" "${GLYPHS[$((RANDOM % NUM_GLYPHS))]}" "$COLOR_RESET"
        fi

        t4=$((hy - 10))
        if [ "$t4" -ge 2 ] && [ "$t4" -le "$LINES" ]; then
          printf "\033[%d;%dH%s%s%s" "$t4" "$c" "$COLOR_FAINT" "${GLYPHS[$((RANDOM % NUM_GLYPHS))]}" "$COLOR_RESET"
        fi

        # Erase trailing drop tail
        erase_y=$((hy - dlen))
        if [ "$erase_y" -ge 2 ] && [ "$erase_y" -le "$LINES" ]; then
          printf "\033[%d;%dH " "$erase_y" "$c"
        fi

        # Advance drop downward
        HEAD_Y[$c]=$((hy + 1))

        # Reset column once tail leaves screen
        if [ "$((hy - dlen))" -gt "$LINES" ]; then
          HEAD_Y[$c]=$(( (RANDOM % 6) - 6 ))
          DROP_LEN[$c]=$(( (RANDOM % (LINES / 2 + 6)) + 8 ))
          SPEED_DELAY[$c]=$(( (RANDOM % 3) + 1 ))
        fi
      else
        STEP_COUNT[$c]=$((step + 1))
      fi

      c=$((c + 2))
    done

    # High-precision frame timing
    sleep "$fps_sleep" 2>/dev/null || sleep 0.03 2>/dev/null || true
  done
}

run_matrix
