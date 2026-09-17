export type DraculaTheme =
  | 'night'
  | 'boldface'
  | 'penumbra'
  | 'verda'
  | 'lattice'
  | 'classic'
  | 'blade'
  | 'alucard'

export interface ThemeMeta {
  id: DraculaTheme
  name: string
  bg: string
  accent: string
  description: string
  isDark: boolean
}

export const DRACULA_THEMES: ThemeMeta[] = [
  {
    id: 'night',
    name: 'Abliterated Night',
    bg: '#09090B',
    accent: '#8B5CF6',
    description: 'Zinc canvas · violet primary · cyan signal — the unified web default',
    isDark: true,
  },
  {
    id: 'boldface',
    name: 'Boldface',
    bg: '#22150f',
    accent: '#ef5b35',
    description: 'Uiverse Boldface — cocoa stage, tomato accent, editorial type',
    isDark: true,
  },
  {
    id: 'penumbra',
    name: 'Penumbra',
    bg: '#08080A',
    accent: '#E8E5DC',
    description: 'Uiverse Penumbra — onyx, hairlines, Beacon accent',
    isDark: true,
  },
  {
    id: 'verda',
    name: 'Verda Finance',
    bg: '#0B1410',
    accent: '#38F2A1',
    description: 'Uiverse Verda Finance — forest fintech, mint voltage',
    isDark: true,
  },
  {
    id: 'lattice',
    name: 'Lattice',
    bg: '#08090B',
    accent: '#C6F94D',
    description: 'Uiverse Lattice-2 — dark protocol, signal lime',
    isDark: true,
  },
  {
    id: 'classic',
    name: 'Dracula Classic',
    bg: '#282a36',
    accent: '#bd93f9',
    description: 'Official dark slate Dracula specification',
    isDark: true,
  },
  {
    id: 'blade',
    name: 'Dracula Blade (OLED)',
    bg: '#000000',
    accent: '#bd93f9',
    description: 'Pure black background with vivid neon accents',
    isDark: true,
  },
  {
    id: 'alucard',
    name: 'Dracula Alucard',
    bg: '#fffbeb',
    accent: '#644ac9',
    description: 'Official complementary light parchment theme',
    isDark: false,
  },
]

const STORAGE_KEY = 'dracula_theme'

export function loadTheme(): DraculaTheme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
  const ok: DraculaTheme[] = [
    'night',
    'boldface',
    'penumbra',
    'verda',
    'lattice',
    'blade',
    'alucard',
    'classic',
  ]
  if (saved && (ok as string[]).includes(saved)) return saved as DraculaTheme
  } catch {
    // fallback
  }
  return 'night'
}

export function applyTheme(theme: DraculaTheme) {
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // ignore
  }

  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', theme)
    const metaThemeColor = document.querySelector('meta[name="theme-color"]')
    const targetMeta = DRACULA_THEMES.find((t) => t.id === theme)
    if (metaThemeColor && targetMeta) {
      metaThemeColor.setAttribute('content', targetMeta.bg)
    }
  }
}
