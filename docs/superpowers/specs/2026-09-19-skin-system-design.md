# AIUI Skin System — Design

**Date:** 2026-09-19  
**Status:** Draft (defaults locked after skipped picker: token packs first)  
**Problem:** `applyTheme()` only sets `data-theme` + meta color. `styles.css` has almost no `[data-theme=…]` overrides — picker swatches don’t really re-skin the app. Adding a look means editing TS unions **and** hoping CSS catches up.

## Goal

One **skin = one token pack**. Switching skins writes CSS variables onto `:root`. UI chrome uses semantic tokens only. Design updates = edit/add a pack file (no CSS archaeology).

## Phased scope

1. **P0 — Token packs + apply engine** (this plan’s implementation target)
2. **P1 — Live editor** in Settings (mutate pack → preview → save custom)
3. **P2 — Import/export** `.skin.json`

## Decisions

| Decision | Choice |
|----------|--------|
| Source of truth | `src/skins/*.skin.json` (+ tiny registry) |
| Apply mechanism | `applySkin(id)` sets `document.documentElement` CSS vars + `data-skin` |
| CSS rule | Components use `--canvas`, `--accent`, etc. — never hard-coded theme hex in rules |
| Legacy | Keep `data-theme` alias = `data-skin` during migration; map old Dracula ids |
| Custom skins | `localStorage` overlay for user packs (P1/P2); built-ins shipped in repo |
| Runtime | Implement/verify under DGX `/tmp/spark-sandboxes/workspaceN`; Mac is git client |

## Success

- Changing one pack file changes the live UI after reload/apply.
- Settings swatches visibly recolor chrome (not just meta tag).
- New skin = add JSON + one registry line; zero new CSS blocks required.
