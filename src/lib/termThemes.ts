/** Terminal-window palettes in the style of the Figma terminal theme kit. */
export interface TermTheme {
  id: string
  name: string
  bg: string
  surface: string
  surface2: string
  fg: string
  muted: string
  accent: string
  red: string
  green: string
  yellow: string
  blue: string
  /** Panel/chrome hairline (e.g. Lumen #1c2a40). */
  border?: string
  /** Softer secondary text between muted and fg (e.g. Lumen #8ea5c2). */
  fgSoft?: string
  /** Elevated cards / rows (e.g. Lumen #101829). Falls back to surface2. */
  elevated?: string
  light?: boolean
}

export const TERM_THEMES: TermTheme[] = [
  // Lumen — Figma frame 3:584 (QeXZRrDsxOfxS8NhD3Cc3B). Default Studio theme.
  {
    id: 'lumen',
    name: 'Lumen',
    bg: '#050812',
    surface: '#080d18',
    surface2: '#0b111f',
    elevated: '#101829',
    fg: '#e8f5ff',
    muted: '#526a88',
    accent: '#a363ff',
    red: '#ff7180',
    green: '#33ff9e',
    yellow: '#ff8c4d',
    blue: '#2eedff',
    border: '#1c2a40',
    fgSoft: '#8ea5c2',
  },
  { id: 'dracula', name: 'Dracula', bg: '#282a36', surface: '#21222c', surface2: '#343746', fg: '#f8f8f2', muted: '#6272a4', accent: '#bd93f9', red: '#ff5555', green: '#50fa7b', yellow: '#f1fa8c', blue: '#8be9fd' },
  { id: 'nord', name: 'Nord', bg: '#2e3440', surface: '#3b4252', surface2: '#434c5e', fg: '#eceff4', muted: '#d8dee9', accent: '#88c0d0', red: '#bf616a', green: '#a3be8c', yellow: '#ebcb8b', blue: '#81a1c1' },
  { id: 'gruvbox', name: 'Gruvbox Dark', bg: '#282828', surface: '#3c3836', surface2: '#504945', fg: '#ebdbb2', muted: '#a89984', accent: '#fe8019', red: '#fb4934', green: '#b8bb26', yellow: '#fabd2f', blue: '#83a598' },
  { id: 'mocha', name: 'Catppuccin Mocha', bg: '#1e1e2e', surface: '#313244', surface2: '#45475a', fg: '#cdd6f4', muted: '#a6adc8', accent: '#cba6f7', red: '#f38ba8', green: '#a6e3a1', yellow: '#f9e2af', blue: '#89b4fa' },
  { id: 'tokyo', name: 'Tokyo Night', bg: '#1a1b26', surface: '#24283b', surface2: '#2f334d', fg: '#c0caf5', muted: '#565f89', accent: '#7aa2f7', red: '#f7768e', green: '#9ece6a', yellow: '#e0af68', blue: '#7dcfff' },
  { id: 'solarized', name: 'Solarized Dark', bg: '#002b36', surface: '#073642', surface2: '#094451', fg: '#839496', muted: '#586e75', accent: '#2aa198', red: '#dc322f', green: '#859900', yellow: '#b58900', blue: '#268bd2' },
  { id: 'onedark', name: 'One Dark', bg: '#282c34', surface: '#21252b', surface2: '#2c313a', fg: '#abb2bf', muted: '#5c6370', accent: '#61afef', red: '#e06c75', green: '#98c379', yellow: '#e5c07b', blue: '#61afef' },
  { id: 'monokai', name: 'Monokai', bg: '#272822', surface: '#3e3d32', surface2: '#49483e', fg: '#f8f8f2', muted: '#75715e', accent: '#a6e22e', red: '#f92672', green: '#a6e22e', yellow: '#e6db74', blue: '#66d9ef' },
  { id: 'rose', name: 'Rosé Pine', bg: '#191724', surface: '#1f1d2e', surface2: '#26233a', fg: '#e0def4', muted: '#908caa', accent: '#c4a7e7', red: '#eb6f92', green: '#9ccfd8', yellow: '#f6c177', blue: '#31748f' },
  { id: 'ayu', name: 'Ayu Dark', bg: '#0b0e14', surface: '#0f131a', surface2: '#1a1f29', fg: '#bfbdb6', muted: '#565b66', accent: '#e6b450', red: '#f07178', green: '#aad94c', yellow: '#ffb454', blue: '#59c2ff' },
  { id: 'github', name: 'GitHub Dark', bg: '#0d1117', surface: '#161b22', surface2: '#21262d', fg: '#e6edf3', muted: '#8b949e', accent: '#58a6ff', red: '#ff7b72', green: '#3fb950', yellow: '#d29922', blue: '#79c0ff' },
  { id: 'horizon', name: 'Horizon', bg: '#1c1e26', surface: '#232530', surface2: '#2e303e', fg: '#d5d8da', muted: '#6c6f93', accent: '#e95678', red: '#e95678', green: '#29d398', yellow: '#fab795', blue: '#26bbd9' },
  { id: 'matrix', name: 'Matrix', bg: '#0d0208', surface: '#0a140c', surface2: '#102016', fg: '#b6f5c2', muted: '#3d8f4a', accent: '#00ff41', red: '#ff4d4d', green: '#00ff41', yellow: '#c6ff6a', blue: '#7dffb3' },
  { id: 'synth', name: 'Synthwave', bg: '#241b2f', surface: '#2a2139', surface2: '#34294a', fg: '#f8f8f2', muted: '#8481a0', accent: '#ff7edb', red: '#fe4450', green: '#72f1b8', yellow: '#fede5d', blue: '#36f9f6' },
  { id: 'solar-light', name: 'Solarized Light', bg: '#fdf6e3', surface: '#eee8d5', surface2: '#e4dcc4', fg: '#586e75', muted: '#93a1a1', accent: '#268bd2', red: '#dc322f', green: '#859900', yellow: '#b58900', blue: '#268bd2', light: true },
]

const STORAGE_KEY = 'aiui.termTheme'
const DEFAULT_THEME_ID = 'lumen'

export function hexToRgb(hex: string): string {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16)
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`
}

export function loadTermThemeId(): string {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved && TERM_THEMES.some((t) => t.id === saved)) return saved
  } catch {
    /* private mode */
  }
  return DEFAULT_THEME_ID
}

export function applyTermTheme(id: string): TermTheme {
  const theme =
    TERM_THEMES.find((t) => t.id === id) ||
    TERM_THEMES.find((t) => t.id === DEFAULT_THEME_ID)!
  const root = document.documentElement
  const set = (key: string, value: string) => root.style.setProperty(key, value)
  const border = theme.border || theme.surface2
  const fgSoft = theme.fgSoft || theme.muted
  const elevated = theme.elevated || theme.surface2
  const borderRgb = hexToRgb(border)
  const greenRgb = hexToRgb(theme.green)
  const blueRgb = hexToRgb(theme.blue)
  const redRgb = hexToRgb(theme.red)
  const accentRgb = hexToRgb(theme.accent)
  const surfaceRgb = hexToRgb(theme.surface)
  const surface2Rgb = hexToRgb(theme.surface2)

  set('--canvas', theme.bg)
  set('--boldface-cocoa', theme.bg)
  set('--boldface-void', theme.bg)
  set('--boldface-espresso-ink', theme.bg)
  set('--surface', theme.surface)
  set('--boldface-espresso', theme.surface)
  set('--boldface-cream-panel', theme.surface2)
  set('--surface-2', theme.surface2)
  set('--surface-3', elevated)
  set('--panel-elevated', elevated)
  set('--bg-lighter', elevated)
  set('--text', theme.fg)
  set('--boldface-cream-ink', theme.fg)
  set('--muted', theme.muted)
  set('--boldface-taupe', theme.muted)
  set('--text-muted', theme.muted)
  set('--text-dim', fgSoft)
  set('--accent', theme.accent)
  set('--boldface-tomato', theme.accent)
  set('--boldface-blush', theme.blue)
  set('--accent-2', theme.blue)
  set('--accent-rgb', accentRgb)
  set('--accent-2-rgb', blueRgb)
  set('--canvas-rgb', hexToRgb(theme.bg))
  set('--surface-rgb', surfaceRgb)
  set('--border-rgb', borderRgb)
  set('--text-rgb', hexToRgb(theme.fg))
  set('--ok', theme.green)
  set('--sat-emerald', theme.green)
  set('--danger', theme.red)
  set('--sat-danger', theme.red)
  set('--warn', theme.yellow)
  set('--sat-amber', theme.yellow)
  set('--sat-blue', theme.blue)
  set('--sat-cyan', theme.blue)
  set('--sat-magenta', theme.accent)
  set('--border', border)
  set('--border-subtle', `rgba(${borderRgb}, 0.72)`)
  set('--border-highlight', `rgba(${blueRgb}, 0.45)`)
  set('--border-muted', `rgba(${borderRgb}, 0.85)`)
  set('--border-focus', theme.accent)
  set('--border-glow', `0 0 16px rgba(${accentRgb}, 0.22)`)
  set('--glass-border-subtle', `rgba(${borderRgb}, 0.85)`)
  set('--panel-glass', `rgba(${surfaceRgb}, 0.92)`)
  set('--glass-surface-1', `rgba(${surfaceRgb}, 0.82)`)
  set('--glass-surface-2', `rgba(${surface2Rgb}, 0.94)`)
  set('--shadow-glow', `0 0 28px rgba(${accentRgb}, 0.14)`)
  set('--term-green', theme.green)
  set('--term-cyan', theme.blue)
  set('--term-blue', theme.blue)
  set('--term-red', theme.red)
  set('--term-purple', theme.accent)
  set('--term-yellow', theme.yellow)
  set('--term-orange', theme.yellow)
  set('--status-ok-bg', `rgba(${greenRgb}, 0.07)`)
  set('--status-ok-border', `rgba(${greenRgb}, 0.27)`)
  set('--status-ok-fg', theme.green)
  set('--status-danger-bg', `rgba(${redRgb}, 0.07)`)
  set('--status-danger-border', `rgba(${redRgb}, 0.33)`)
  set('--status-danger-fg', theme.red)
  set('--radius-sm', '6px')
  set('--radius-md', '10px')
  set('--radius-lg', '12px')
  set(
    '--bg-gradient',
    `radial-gradient(ellipse 70% 40% at 50% -8%, rgba(${accentRgb}, 0.12), transparent 55%), linear-gradient(180deg, ${theme.surface} 0%, ${theme.bg} 100%)`,
  )
  root.dataset.term = theme.id
  root.style.colorScheme = theme.light ? 'light' : 'dark'
  try {
    localStorage.setItem(STORAGE_KEY, theme.id)
  } catch {
    /* ignore */
  }
  return theme
}
