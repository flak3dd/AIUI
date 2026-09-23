# AIUI Skin System (Token Packs) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make AIUI skins real and easy to update: each skin is a token pack; applying a skin sets CSS variables so the UI actually changes; adding a skin does not require hunting through `styles.css`.

**Architecture:** Ship built-in packs under `src/skins/*.skin.json`. `src/lib/skin.ts` loads the registry, validates required tokens, and `applySkin()` writes variables onto `document.documentElement` (plus `data-skin` / legacy `data-theme`). `styles.css` keeps semantic tokens (`--canvas`, `--accent`, …) as the only styling API. Settings picks from the registry. Later phases add a live editor and `.skin.json` import/export.

**Tech Stack:** React/Vite AIUI, TypeScript, CSS custom properties, Vitest (or existing test runner), JSON packs.

**Spec:** `docs/superpowers/specs/2026-09-19-skin-system-design.md`

## Global constraints

- Do **not** run AIUI/dev runtime on the Mac; use DGX `/tmp/spark-sandboxes/workspaceN` for install/dev/test when executing this plan.
- Mac may edit/commit/push git only.
- No silent full rewrite of `styles.css` (6031 lines) — migrate by applying vars at runtime; delete dead theme-only CSS only when proven unused.
- Preserve existing skin **ids** (`night`, `boldface`, `penumbra`, `verda`, `lattice`, `classic`, `blade`, `alucard`) so saved `localStorage` keeps working.
- Built-in packs are immutable at runtime; user customs come later (P1/P2).

---

### Task 1: Skin token schema + types

**Files:**
- Create: `src/skins/schema.ts`
- Create: `src/skins/types.ts`
- Test: `src/skins/schema.test.ts`

**Interfaces:**
```ts
export type SkinId = string // built-ins: night | boldface | ...

export type SkinTokens = {
  // required semantic core
  canvas: string
  surface: string
  surface2: string
  surface3: string
  text: string
  muted: string
  accent: string
  accent2: string
  ok: string
  warn: string
  danger: string
  border: string
  // required RGB triples "r, g, b" for rgba(var(--*-rgb), a)
  accentRgb: string
  accent2Rgb: string
  canvasRgb: string
  surfaceRgb: string
  textRgb: string
  // optional
  bgGradient?: string
  panelGlass?: string
  shadowElevated?: string
}

export type SkinPack = {
  id: SkinId
  name: string
  description: string
  isDark: boolean
  swatch: { bg: string; accent: string } // picker preview
  tokens: SkinTokens
  version: 1
}
```

- [ ] **Step 1: Write failing test for `assertSkinPack`**

```ts
import { describe, it, expect } from 'vitest'
import { assertSkinPack } from './schema'

it('rejects missing accent', () => {
  expect(() =>
    assertSkinPack({
      id: 'x',
      name: 'X',
      description: '',
      isDark: true,
      swatch: { bg: '#000', accent: '#fff' },
      version: 1,
      tokens: { canvas: '#000' },
    } as any),
  ).toThrow(/accent/)
})
```

- [ ] **Step 2: Run test — expect FAIL**

Run (on DGX workspace): `npm test -- src/skins/schema.test.ts`

- [ ] **Step 3: Implement `assertSkinPack` + export types**

- [ ] **Step 4: Run test — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add src/skins/schema.ts src/skins/types.ts src/skins/schema.test.ts
git commit -m "feat(skins): add skin pack schema and validation"
```

---

### Task 2: Built-in skin packs (migrate 8 themes)

**Files:**
- Create: `src/skins/packs/night.skin.json`
- Create: `src/skins/packs/boldface.skin.json`
- Create: `src/skins/packs/penumbra.skin.json`
- Create: `src/skins/packs/verda.skin.json`
- Create: `src/skins/packs/lattice.skin.json`
- Create: `src/skins/packs/classic.skin.json`
- Create: `src/skins/packs/blade.skin.json`
- Create: `src/skins/packs/alucard.skin.json`
- Create: `src/skins/registry.ts` (imports all packs)

**Notes:**
- Derive token values from current `DRACULA_THEMES` swatches + `:root` Night defaults in `styles.css` for `night`.
- For skins that previously only changed meta color, invent a coherent full palette (accent/surface/text) so apply is visibly distinct — document any invented values in pack `description`.
- `night` must match today’s actual `:root` look ( Abliterated Night / zinc+violet+cyan ).

- [ ] **Step 1: Author `night.skin.json` matching current `:root` tokens**

Minimum token keys from Task 1; set `bgGradient` from current `--bg-gradient`.

- [ ] **Step 2: Author the other seven packs** (distinct accent/canvas pairs from existing ThemeMeta)

- [ ] **Step 3: `registry.ts`**

```ts
import night from './packs/night.skin.json'
import boldface from './packs/boldface.skin.json'
// ...
import { assertSkinPack, type SkinPack } from './schema'

const packs = [night, boldface, penumbra, verda, lattice, classic, blade, alucard].map((p) =>
  assertSkinPack(p),
)

export const SKIN_REGISTRY: Record<string, SkinPack> = Object.fromEntries(
  packs.map((p) => [p.id, p]),
)
export const SKIN_LIST: SkinPack[] = packs
export const DEFAULT_SKIN_ID = 'night'
```

Enable JSON imports in `tsconfig` / Vite if not already (`resolveJsonModule`).

- [ ] **Step 4: Unit test — registry has 8 ids and each passes assert**

- [ ] **Step 5: Commit**

```bash
git add src/skins
git commit -m "feat(skins): migrate eight built-in skins to token packs"
```

---

### Task 3: `applySkin` engine (make picker real)

**Files:**
- Create: `src/lib/skin.ts`
- Modify: `src/lib/theme.ts` — thin re-export shim for backward compat OR deprecate in favor of `skin.ts`
- Test: `src/lib/skin.test.ts` (jsdom)

**Token → CSS variable map (normative):**

| Pack field | CSS variable |
|------------|----------------|
| canvas | `--canvas` |
| surface | `--surface` |
| surface2 | `--surface-2` |
| surface3 | `--surface-3` |
| text | `--text` |
| muted | `--muted` |
| accent | `--accent` |
| accent2 | `--accent-2` |
| ok | `--ok` |
| warn | `--warn` |
| danger | `--danger` |
| border | `--border` |
| accentRgb | `--accent-rgb` |
| accent2Rgb | `--accent-2-rgb` |
| canvasRgb | `--canvas-rgb` |
| surfaceRgb | `--surface-rgb` |
| textRgb | `--text-rgb` |
| bgGradient | `--bg-gradient` |

Also set legacy aliases used in CSS: `--bg`, `--bg-dark`, `--text-muted`, `--dracula-purple` ← accent, etc. (keep a fixed alias table in `skin.ts`).

```ts
export function applySkin(id: string) {
  const pack = SKIN_REGISTRY[id] ?? SKIN_REGISTRY[DEFAULT_SKIN_ID]
  const root = document.documentElement
  for (const [cssVar, value] of Object.entries(tokensToCssVars(pack.tokens))) {
    root.style.setProperty(cssVar, value)
  }
  root.setAttribute('data-skin', pack.id)
  root.setAttribute('data-theme', pack.id) // legacy
  root.style.colorScheme = pack.isDark ? 'dark' : 'light'
  localStorage.setItem('dracula_theme', pack.id) // keep old key
  // update meta theme-color from pack.swatch.bg
}
```

- [ ] **Step 1: Failing test — `applySkin('blade')` sets `--accent` and `data-skin`**

- [ ] **Step 2: Implement `tokensToCssVars` + `applySkin` + `loadSkin`**

- [ ] **Step 3: Change `theme.ts` `applyTheme`/`loadTheme` to call `applySkin`/`loadSkin` (preserve exports used by App/Settings)

- [ ] **Step 4: Tests pass**

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(skins): applySkin writes CSS variables so themes actually change"
```

---

### Task 4: Settings + App wiring

**Files:**
- Modify: `src/components/SettingsSheet.tsx` — iterate `SKIN_LIST` (or keep `DRACULA_THEMES` derived from registry)
- Modify: `src/App.tsx` — `applySkin(loadSkin())` on boot (via theme shim OK)
- Modify: `src/components/AsciiMatrixBackground.tsx` — already reads CSS vars; verify after apply

- [ ] **Step 1: Derive picker meta from registry**

```ts
export const DRACULA_THEMES = SKIN_LIST.map((p) => ({
  id: p.id as DraculaTheme,
  name: p.name,
  bg: p.swatch.bg,
  accent: p.swatch.accent,
  description: p.description,
  isDark: p.isDark,
}))
```

Widen `DraculaTheme` to `string` or union of the eight ids still.

- [ ] **Step 2: Manual/visual check list in commit message notes**

- [ ] **Step 3: Commit**

```bash
git commit -am "feat(skins): Settings picker driven by skin registry"
```

---

### Task 5: CSS hygiene pass (semantic-only rules)

**Files:**
- Modify: `src/styles.css` — ensure `:root` defines **fallback** tokens only (Night); remove any future temptation to add per-theme blocks
- Add: `docs/skins.md` — how to add a skin (copy JSON, register, done)

- [ ] **Step 1: Document required token list in `docs/skins.md`**

- [ ] **Step 2: Grep for hard-coded `#282a36|#bd93f9` in component CSS that should be tokens; replace obvious ones only (limit scope — no 6k-line rewrite)**

- [ ] **Step 3: Commit**

```bash
git commit -am "docs(skins): authoring guide; minor token hygiene"
```

---

### Task 6: Smoke verification

**Files:** none

- [ ] **Step 1: On DGX workspace — `npm run build` (or `vite build`) succeeds**

- [ ] **Step 2: Dev server on DGX — switch skins in Settings; confirm `--accent` / background change in computed styles**

- [ ] **Step 3: Reload — last skin persists via `localStorage`**

- [ ] **Step 4: Rain/matrix background still reads theme RGB vars**

---

## Phase 1 / 2 (backlog only — do not implement in P0)

- **P1 Live editor:** Settings panel edits token fields → `applySkinPack(draft)` → Save as `custom:<id>` in localStorage.
- **P2 Import/export:** Download/upload `.skin.json`; validate with `assertSkinPack`.

---

## Execution handoff

Plan saved to `docs/superpowers/plans/2026-09-19-skin-system.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — execute in this session with executing-plans checkpoints  

Which approach?
