// ==========================================
// 🎨 Next-Gen Terminal Skin Engine (ANSI 24-bit TrueColor)
// ==========================================
export const CLI_SKINS = {
  aiui: {
    id: 'aiui',
    name: 'AIUI Signature',
    primary: [190, 80, 255],     // Neon Purple (vivid violet)
    secondary: [140, 255, 60],   // Lime Green (electric chartreuse)
    accent: [230, 50, 255],      // Hot Magenta / Orchid
    gold: [180, 255, 90],        // Electric Lime (bright yellow-green)
    success: [100, 240, 80],     // Vivid Lime Green
    warning: [255, 200, 50],     // Warm Yellow
    danger: [240, 50, 50],       // Vivid Crimson Red
    border: [50, 30, 70],        // Deep Purple Border
    borderActive: [190, 80, 255],// Neon Purple
    muted: [160, 150, 180],      // Lavender Gray
    dark: [14, 10, 22],          // Deep Void Purple #0E0A16
    badgeBg: [28, 18, 42],       // Dark Plum Slate
  },
  cyberpunk: {
    id: 'cyberpunk',
    name: 'Cyberpunk Neon',
    primary: [0, 240, 255],      // Electric Cyan
    secondary: [168, 85, 247],   // Neon Violet
    accent: [244, 63, 94],       // Hot Pink / Coral
    gold: [251, 191, 36],        // Amber Gold
    success: [16, 185, 129],     // Emerald
    warning: [245, 158, 11],     // Amber
    danger: [239, 68, 68],       // Ruby Red
    border: [71, 85, 105],       // Slate 600
    borderActive: [0, 240, 255], // Electric Cyan
    muted: [148, 163, 184],      // Slate 400
    dark: [15, 23, 42],          // Slate 900
    badgeBg: [30, 41, 59],       // Slate 800
  },
  matrix: {
    id: 'matrix',
    name: 'Matrix Obsidian',
    primary: [52, 211, 153],     // Mint Green
    secondary: [16, 185, 129],   // Deep Emerald
    accent: [74, 222, 128],      // Bright Lime
    gold: [234, 179, 8],         // Amber Lime
    success: [34, 197, 94],      // Green
    warning: [234, 179, 8],      // Yellow/Lime
    danger: [239, 68, 68],       // Red
    border: [39, 70, 52],        // Dark Forest Green
    borderActive: [52, 211, 153],// Mint Green
    muted: [110, 140, 120],      // Sage Green
    dark: [10, 20, 15],          // Deep Forest Black
    badgeBg: [20, 40, 30],       // Dark Green Tint
  },
  ember: {
    id: 'ember',
    name: 'Solar Flare',
    primary: [251, 146, 60],     // Solar Orange
    secondary: [244, 63, 94],    // Crimson Rose
    accent: [253, 224, 71],      // Golden Sunlight
    gold: [251, 191, 36],        // Amber
    success: [52, 211, 153],     // Jade
    warning: [245, 158, 11],     // Hot Amber
    danger: [225, 29, 72],       // Deep Crimson
    border: [87, 43, 25],        // Dark Rust
    borderActive: [251, 146, 60],// Solar Orange
    muted: [168, 130, 110],      // Warm Sand
    dark: [26, 15, 12],          // Obsidian Charcoal
    badgeBg: [45, 25, 20],       // Roasted Bronze
  },
  nord: {
    id: 'nord',
    name: 'Arctic Aurora',
    primary: [136, 192, 208],    // Frost Blue
    secondary: [129, 161, 193],  // Glacial Deep
    accent: [163, 190, 140],     // Aurora Green
    gold: [235, 203, 139],       // Polar Yellow
    success: [163, 190, 140],    // Aurora Green
    warning: [208, 135, 112],    // Orange
    danger: [191, 97, 106],      // Frost Red
    border: [76, 86, 106],       // Polar Night Slate
    borderActive: [136, 192, 208],// Frost Blue
    muted: [140, 150, 170],      // Winter Gray
    dark: [46, 52, 64],          // Polar Night 0
    badgeBg: [59, 66, 82],       // Polar Night 1
  },
  synthwave: {
    id: 'synthwave',
    name: 'Outrun 1984',
    primary: [255, 113, 206],    // Neon Pink
    secondary: [1, 205, 254],    // Neon Cyan
    accent: [254, 237, 85],      // Laser Yellow
    gold: [255, 165, 0],         // Orange Sunset
    success: [5, 255, 161],      // Radical Mint
    warning: [254, 237, 85],     // Electric Yellow
    danger: [255, 33, 90],       // Neon Crimson
    border: [75, 30, 95],        // Dark Violet
    borderActive: [255, 113, 206],// Neon Pink
    muted: [170, 140, 190],      // Pastel Lavender
    dark: [20, 10, 30],          // Deep Purple Abyss
    badgeBg: [40, 20, 60],       // Synthwave Purple
  },
};

export const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  underline: '\x1b[4m',
  red: '\x1b[38;2;240;50;50m',     // Vivid Crimson (matches AIUI danger)
  green: '\x1b[38;2;140;255;60m',  // Lime Green (matches AIUI secondary)
  yellow: '\x1b[38;2;180;255;90m', // Electric Lime (matches AIUI gold)
  blue: '\x1b[38;2;130;100;255m',  // Indigo Purple
  magenta: '\x1b[38;2;190;80;255m',// Neon Purple (matches AIUI primary)
  cyan: '\x1b[38;2;160;120;255m',  // Soft Violet
  white: '\x1b[37m',
  gray: '\x1b[38;2;160;150;180m',  // Lavender Gray (matches AIUI muted)
};

export function rgb(r, g, b) {
  return `\x1b[38;2;${r};${g};${b}m`;
}

export function bgRgb(r, g, b) {
  return `\x1b[48;2;${r};${g};${b}m`;
}

export function stripAnsi(str) {
  return String(str || '').replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '');
}

export function getSkin(name) {
  const k = String(name || '').toLowerCase().trim();
  return CLI_SKINS[k] || CLI_SKINS.aiui || CLI_SKINS.cyberpunk;
}

export function gradient(text, startRgb, midRgb, endRgb) {
  const chars = Array.from(text);
  const n = chars.length;
  if (n <= 1) return rgb(...startRgb) + text + c.reset;
  return chars
    .map((ch, i) => {
      let r, g, b;
      if (midRgb) {
        const half = n / 2;
        if (i < half) {
          const t = i / half;
          r = Math.round(startRgb[0] + (midRgb[0] - startRgb[0]) * t);
          g = Math.round(startRgb[1] + (midRgb[1] - startRgb[1]) * t);
          b = Math.round(startRgb[2] + (midRgb[2] - startRgb[2]) * t);
        } else {
          const t = (i - half) / half;
          r = Math.round(midRgb[0] + (endRgb[0] - midRgb[0]) * t);
          g = Math.round(midRgb[1] + (endRgb[1] - midRgb[1]) * t);
          b = Math.round(midRgb[2] + (endRgb[2] - midRgb[2]) * t);
        }
      } else {
        const t = i / (n - 1);
        r = Math.round(startRgb[0] + (endRgb[0] - startRgb[0]) * t);
        g = Math.round(startRgb[1] + (endRgb[1] - startRgb[1]) * t);
        b = Math.round(startRgb[2] + (endRgb[2] - startRgb[2]) * t);
      }
      return `${rgb(r, g, b)}${ch}`;
    })
    .join('') + c.reset;
}
